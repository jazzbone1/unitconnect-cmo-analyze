// Railway 서버: 정적 사이트(dist) 서빙 + /api/projects 를 R2에 저장/조회
//
// 필요한 환경변수 (Railway Variables):
//   R2_ACCOUNT_ID        Cloudflare 계정 ID
//   R2_ACCESS_KEY_ID     R2 API 토큰의 Access Key ID
//   R2_SECRET_ACCESS_KEY R2 API 토큰의 Secret Access Key
//   R2_BUCKET            버킷 이름 (예: wecha-cmo-analysis)
//   (프론트) VITE_REMOTE_STORE=1  ← 빌드 시 주입 (같은 도메인 /api 사용)
//
//   ANTHROPIC_API_KEY    Claude API 키 (AI 분석 기능 활성화). 없으면 기능 비활성.
//   ANTHROPIC_MODEL      (선택) 모델 ID. 기본 claude-opus-5. 저비용은 claude-haiku-4-5.
//   SSO_SECRET           메신저(ERP)와 공유하는 SSO 서명 시크릿(HS256). 설정 시
//                        ?sso=<JWT> 자동로그인 활성화. 없으면 SSO 비활성(무인증).
//   DIRECT_LOGIN_PASSWORD (선택) 별도(직접) 로그인용 공용 접속 비밀번호.
//                        설정 시 게이트에 로그인 폼(이름+비밀번호) 노출.
//
// R2 환경변수가 없으면 /api 는 비활성(앱은 localStorage로 동작).
// ANTHROPIC_API_KEY 가 없으면 /api/ai 는 비활성(status.enabled=false).
// SSO_SECRET 이 없으면 /api/sso 는 비활성(앱은 로그인 없이 동작).

import express from 'express'
import { AwsClient } from 'aws4fetch'
import Anthropic from '@anthropic-ai/sdk'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, 'dist')
const PORT = Number(process.env.PORT) || 3000

const {
  R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET,
  // AI 분석(Claude). 키가 없으면 /api/ai 는 비활성(앱은 정상 동작).
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL, // 기본 claude-opus-5, 비용 절감 시 claude-haiku-4-5 등으로 지정
} = process.env

const aiReady = !!ANTHROPIC_API_KEY
const anthropic = aiReady ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null
const AI_MODEL = ANTHROPIC_MODEL || 'claude-opus-5'

// ── SSO (A안: 서명 JWT) ─────────────────────────────────────────
// 메신저(ERP)가 발급한 단기 JWT(HS256)를 SSO_SECRET로 검증 → 세션 쿠키(uc_sso) 발급.
// SSO_SECRET 미설정 시 SSO 비활성(앱은 로그인 없이 동작).
const SSO_SECRET = process.env.SSO_SECRET
const ssoReady = !!SSO_SECRET
const SSO_SESSION_HOURS = 8
// 별도(직접) 로그인용 공용 접속 비밀번호. 설정 시 게이트에 로그인 폼 노출.
const DIRECT_LOGIN_PASSWORD = process.env.DIRECT_LOGIN_PASSWORD
const directLoginReady = ssoReady && !!DIRECT_LOGIN_PASSWORD

// ── 결재 알림(DealerConnect 메신저) ──────────────────────────────
// 결재 상신/승인/반려 시 메신저로 알림 발송. 키 미설정 시 비활성(no-op).
const WECHA_APPROVAL_API_KEY = process.env.WECHA_APPROVAL_API_KEY
const APPROVAL_NOTIFY_URL =
  process.env.APPROVAL_NOTIFY_URL ||
  'https://dealerconnect-production.up.railway.app/internal/erp/notifications'
const approvalNotifyReady = !!WECHA_APPROVAL_API_KEY

/** DealerConnect 알림 1회 발송(10초 타임아웃). 반환: {status, body} 또는 throw(네트워크·타임아웃). */
async function postApprovalNotify(payload) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 10000)
  try {
    const r = await fetch(APPROVAL_NOTIFY_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-api-key': WECHA_APPROVAL_API_KEY,
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    let body = null
    try {
      body = await r.json()
    } catch {
      /* 비 JSON 응답 */
    }
    return { status: r.status, body }
  } finally {
    clearTimeout(t)
  }
}

/**
 * 결재 알림 발송 + 배경 재시도. 결재 흐름을 막지 않도록 첫 시도 결과만 반환하고,
 * 5xx·타임아웃은 같은 requestId 로 배경 재시도(30초→2분→10분). 400·403 은 중단.
 */
async function sendApprovalNotification(payload) {
  const delays = [30000, 120000, 600000]
  const attempt = async (n) => {
    try {
      const { status, body } = await postApprovalNotify(payload)
      if (status >= 200 && status < 300) {
        if (body && Array.isArray(body.unresolved) && body.unresolved.length)
          console.warn('[approval-notify] unresolved', payload.requestId, JSON.stringify(body.unresolved))
        return { ok: true, status, body }
      }
      // 400·403 등 클라이언트 오류 → 재시도 무의미
      if (status < 500) {
        console.warn('[approval-notify] rejected', status, JSON.stringify(body))
        return { ok: false, status, body }
      }
      throw new Error(`retryable ${status}`)
    } catch (e) {
      if (n < delays.length) {
        setTimeout(() => {
          attempt(n + 1).catch(() => {})
        }, delays[n])
        return { ok: false, retrying: true, error: String(e) }
      }
      console.warn('[approval-notify] giving up', payload.requestId, String(e))
      return { ok: false, error: String(e) }
    }
  }
  return attempt(0)
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest()
  const hb = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(ha, hb)
}

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlToBuf = (s) =>
  Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')

function signJwt(payload, secret) {
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const p = b64url(JSON.stringify(payload))
  const sig = b64url(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest())
  return `${h}.${p}.${sig}`
}
/** HS256 JWT 검증(서명·exp). 유효하면 payload, 아니면 null. */
function verifyJwt(token, secret) {
  const parts = String(token || '').split('.')
  if (parts.length !== 3) return null
  const [h, p, sig] = parts
  const expected = b64url(crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest())
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  let payload
  try {
    payload = JSON.parse(b64urlToBuf(p).toString('utf8'))
  } catch {
    return null
  }
  if (payload.exp && Date.now() / 1000 > payload.exp) return null
  return payload
}
function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i > -1 && part.slice(0, i).trim() === name)
      return decodeURIComponent(part.slice(i + 1).trim())
  }
  return null
}
function sessionCookie(value, maxAgeSec) {
  // ⚠️ SameSite=None 필수 — 딜러커넥트(메신저)가 이 사이트를 iframe 으로 임베드하는데,
  //    Lax 면 교차 사이트 iframe 안에서 브라우저가 쿠키를 저장·전송하지 않아
  //    SSO 검증에 성공해도 로그인 게이트가 그대로 뜬다.
  //    Partitioned(CHIPS)는 서드파티 쿠키 차단 환경 대비. 최상위 방문 시에도 자기 사이트로
  //    파티션되므로 직접 접속 로그인은 그대로 동작한다. 모르는 속성은 구형 브라우저가 무시한다.
  //    로그아웃 만료 쿠키도 같은 함수를 쓰므로 속성이 일치해야 삭제가 먹는다.
  return `uc_sso=${value}; HttpOnly; Path=/; Max-Age=${maxAgeSec}; SameSite=None; Secure; Partitioned`
}

const r2Ready =
  R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET
const r2 = r2Ready
  ? new AwsClient({
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      region: 'auto',
      service: 's3',
    })
  : null
const OBJECT_URL = r2Ready
  ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/projects.json`
  : null

// ── 계정 명부(디렉터리) ─────────────────────────────────────────
// SSO/직접 로그인한 계정을 {id, name} 으로 자동 축적 → 승인자 지정 드롭다운에 사용.
// R2 가 있으면 R2(sso-directory.json)에 영속, 없으면 컨테이너 메모리에만 유지.
const DIRECTORY_URL = r2Ready
  ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/sso-directory.json`
  : null
// 본사 명단(관리자 수동 관리). 메신저 계정 API가 없어 이 사이트에서 직접 관리.
const HQ_URL = r2Ready
  ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/hq-members.json`
  : null
let memDirectory = [] // [{ id, name, at }] — 로그인 자동수집 명부
let memHq = [] // [{ id, name }] — 본사 수동 명단

async function loadJsonArray(url, fallback) {
  if (!r2) return fallback
  try {
    const r = await r2.fetch(url, { method: 'GET' })
    if (r.status === 404) return []
    if (!r.ok) return fallback
    const arr = JSON.parse((await r.text()) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return fallback
  }
}

async function loadDirectory() {
  return loadJsonArray(DIRECTORY_URL, memDirectory)
}
async function loadHqMembers() {
  return loadJsonArray(HQ_URL, memHq)
}
async function saveHqMembers(list) {
  memHq = list
  if (!r2) return
  await r2.fetch(HQ_URL, { method: 'PUT', body: JSON.stringify(list) })
}

// 전역 앱 설정(app-settings.json). baseManagers=기본안 수정 담당자(전체 공통).
const SETTINGS_URL = r2Ready
  ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/app-settings.json`
  : null
let memSettings = {}
async function loadSettings() {
  if (!r2) return memSettings
  try {
    const r = await r2.fetch(SETTINGS_URL, { method: 'GET' })
    if (r.status === 404) return {}
    if (!r.ok) return memSettings
    const obj = JSON.parse((await r.text()) || '{}')
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return memSettings
  }
}
async function saveSettings(obj) {
  memSettings = obj
  if (!r2) return
  await r2.fetch(SETTINGS_URL, { method: 'PUT', body: JSON.stringify(obj) })
}

/** 본사 명단 + 로그인 자동수집 명부를 합쳐(계정ID 기준 중복 제거) 반환. uid/email 포함. */
async function mergedAccounts() {
  const [hq, dir] = await Promise.all([loadHqMembers(), loadDirectory()])
  const map = new Map()
  const put = (e) => {
    if (!e || !e.id) return
    const id = String(e.id)
    const prev = map.get(id) || {}
    map.set(id, {
      id,
      name: String(e.name || e.id),
      // uid/email 은 어느 소스든 값이 있으면 보존.
      uid: e.uid || prev.uid || undefined,
      email: e.email || prev.email || undefined,
    })
  }
  for (const e of dir) put(e) // 로그인 명부(uid/email 보유 가능)
  for (const e of hq) put(e) // 본사 명단(이름 우선 덮어쓰기)
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}

/** 로그인 계정을 명부에 upsert (이름 갱신 + 최근 접속 시각). 실패는 무시. */
async function recordAccount(id, name, at, extra) {
  const accId = String(id || '').trim()
  const accName = String(name || '').trim() || accId
  if (!accId) return
  // uid/email 은 값이 있을 때만 갱신(직접로그인 등 미제공 시 기존 값 보존).
  const uid = extra && extra.uid ? String(extra.uid) : undefined
  const email = extra && extra.email ? String(extra.email) : undefined
  const list = await loadDirectory()
  const i = list.findIndex((e) => e && e.id === accId)
  if (i > -1)
    list[i] = {
      ...list[i],
      name: accName,
      at,
      ...(uid ? { uid } : {}),
      ...(email ? { email } : {}),
    }
  else
    list.push({
      id: accId,
      name: accName,
      at,
      ...(uid ? { uid } : {}),
      ...(email ? { email } : {}),
    })
  memDirectory = list
  if (r2) {
    try {
      await r2.fetch(DIRECTORY_URL, {
        method: 'PUT',
        body: JSON.stringify(list),
      })
    } catch {
      /* 명부 저장 실패는 로그인 흐름을 막지 않는다 */
    }
  }
}

/** 세션 쿠키(uc_sso) 검증 → payload 또는 null. 쿠키 검사 로직의 단일 출처. */
function requireSession(req) {
  return verifyJwt(readCookie(req, 'uc_sso'), SSO_SECRET)
}

/**
 * 데이터 API 보호 미들웨어 — 로그인한 사람만 조회·수정·AI 호출 가능.
 * 게이트가 프론트에만 있으면 주소만 알아도 API 를 직접 부를 수 있어 서버에서 강제한다.
 *
 * ⚠️ SSO_SECRET 미설정(ssoReady=false)이면 검사를 건너뛴다 — 파일 상단 주석의
 *    "SSO_SECRET 이 없으면 앱은 로그인 없이 동작" 설계 유지. 이걸 깨면 시크릿이
 *    빠진 환경에서 앱이 통째로 먹통이 된다.
 * 정적 파일·SPA 셸에는 걸지 않는다. 게이트 화면이 떠야 로그인을 할 수 있다.
 */
function requireAuth(req, res, next) {
  if (!ssoReady) return next()
  if (!requireSession(req)) return res.status(401).json({ error: 'unauthorized' })
  next()
}

const app = express()

app.get('/api/projects', requireAuth, async (_req, res) => {
  if (!r2) return res.status(503).json({ error: 'R2 not configured' })
  try {
    const r = await r2.fetch(OBJECT_URL, { method: 'GET' })
    if (r.status === 404) return res.type('application/json').send('[]')
    if (!r.ok) return res.status(502).json({ error: 'r2 get', status: r.status })
    const text = await r.text()
    res.type('application/json').send(text || '[]')
  } catch (e) {
    res.status(502).json({ error: String(e) })
  }
})

app.put(
  '/api/projects',
  // 인증을 본문 파서보다 먼저 — 미인증 요청의 50mb 본문을 버퍼링하지 않는다.
  requireAuth,
  express.text({ type: () => true, limit: '50mb' }),
  async (req, res) => {
    if (!r2) return res.status(503).json({ error: 'R2 not configured' })
    const body = typeof req.body === 'string' ? req.body : ''
    try {
      if (!Array.isArray(JSON.parse(body))) throw new Error('array expected')
    } catch {
      return res.status(400).json({ error: 'invalid body' })
    }
    try {
      const r = await r2.fetch(OBJECT_URL, { method: 'PUT', body })
      if (!r.ok) return res.status(502).json({ error: 'r2 put', status: r.status })
      res.json({ ok: true })
    } catch (e) {
      res.status(502).json({ error: String(e) })
    }
  },
)

// ── AI 분석 (Claude) ─────────────────────────────────────────────
// 키가 없으면 enabled:false 로만 응답. 프론트는 이 값으로 버튼 노출 여부 결정.
app.get('/api/ai/status', (_req, res) => {
  res.json({ enabled: aiReady, model: aiReady ? AI_MODEL : null })
})

const AI_SYSTEM = `당신은 UNITCONNECT의 전기차 충전 인프라 CMO(위탁운영) 컨설턴트입니다.
아파트 단지 충전 사업의 사업성·요금구조·운영비 데이터를 해석해 한국어로 간결하고
전문적인 진단을 작성합니다. 규칙:
- 반드시 제공된 데이터(JSON)에 근거해서만 서술하고, 없는 수치는 지어내지 않습니다.
- 숫자는 데이터의 값을 그대로 인용하고, 단위(원/kWh, %, 원)를 붙입니다.
- 과장·홍보 문구가 아닌 컨설팅 톤으로, 근거→판단→제언 순서로 씁니다.
- 마크다운 소제목(###)과 불릿(-)을 사용해 읽기 쉽게 구성합니다.`

function aiPrompt(kind, data) {
  const json = JSON.stringify(data, null, 2)
  if (kind === 'report') {
    return `아래는 한 아파트 단지의 컨설팅 보고서용 계산 데이터입니다.
이 데이터를 근거로 보고서 "문제점 → 해결방안 → 권고" 초안을 작성하세요.

구성:
### 문제점
- 현행 요금·전기원가·운영비 구조에서 드러난 핵심 문제 3~5가지 (수치 근거 포함)
### 해결방안
- 각 문제에 대응하는 구체적 개선안 (요금 조정·운영비 최적화·모자분리 등)
### 권고
- 우선순위와 기대효과를 1~2문장으로 요약

데이터:
\`\`\`json
${json}
\`\`\``
  }
  // summary (단지별 사업성 총평)
  return `아래는 한 아파트 단지의 사업성 분석 결과 데이터입니다.
이 데이터를 근거로 "사업성 총평"을 작성하세요.

구성:
### 진단
- 진행가능/진행불가 판정과 그 사유 (영업이익률 vs 목표, 회수기간 등 수치 근거)
### 핵심 리스크
- 사업성을 떨어뜨리는 요인 2~4가지 (예: 저이용 충전기, 높은 원가/운영비)
### 개선 포인트
- 목표이익률 달성을 위한 실행 가능한 제언 2~4가지

데이터:
\`\`\`json
${json}
\`\`\``
}

app.post('/api/ai/analyze', requireAuth, express.json({ limit: '4mb' }), async (req, res) => {
  if (!anthropic) return res.status(503).json({ error: 'AI not configured' })
  const kind = req.body?.kind === 'report' ? 'report' : 'summary'
  const data = req.body?.data
  if (data == null || typeof data !== 'object') {
    return res.status(400).json({ error: 'data required' })
  }
  try {
    // 스트리밍으로 받아 HTTP 타임아웃을 피하고, 완성 텍스트만 한 번에 반환.
    const stream = anthropic.messages.stream({
      model: AI_MODEL,
      max_tokens: kind === 'report' ? 12000 : 8000,
      system: AI_SYSTEM,
      messages: [{ role: 'user', content: aiPrompt(kind, data) }],
    })
    const msg = await stream.finalMessage()
    const text = (msg.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim()
    if (msg.stop_reason === 'refusal' || !text) {
      return res.status(502).json({ error: 'AI 응답을 생성하지 못했습니다.' })
    }
    res.json({ text, model: msg.model })
  } catch (e) {
    const status = e?.status && Number.isInteger(e.status) ? e.status : 502
    res.status(status).json({ error: e?.message || String(e) })
  }
})

// ── SSO 라우트 ───────────────────────────────────────────────────
app.get('/api/sso/status', (_req, res) => {
  res.json({ enabled: ssoReady, directLogin: directLoginReady })
})

// 별도(직접) 로그인: 이름 + 공용 접속 비밀번호 → 세션 쿠키 발급
app.post('/api/sso/login', express.json({ limit: '16kb' }), (req, res) => {
  if (!ssoReady) return res.status(503).json({ error: 'SSO not configured' })
  if (!directLoginReady)
    return res.status(403).json({ error: 'direct login disabled' })
  const name = String(req.body?.name || '').trim()
  const password = String(req.body?.password || '')
  if (!name) return res.status(400).json({ error: 'name required' })
  if (!safeEqual(password, DIRECT_LOGIN_PASSWORD)) {
    return res.status(401).json({ error: '비밀번호가 올바르지 않습니다.' })
  }
  const now = Math.floor(Date.now() / 1000)
  const session = signJwt(
    { sub: name, name, iat: now, exp: now + SSO_SESSION_HOURS * 3600 },
    SSO_SECRET,
  )
  res.setHeader('Set-Cookie', sessionCookie(session, SSO_SESSION_HOURS * 3600))
  recordAccount(name, name, new Date().toISOString()).catch(() => {})
  res.json({ ok: true, user: { sub: name, name } })
})

// 메신저 발급 JWT 검증 → 세션 쿠키 발급(자동로그인)
app.post('/api/sso/verify', express.json({ limit: '64kb' }), (req, res) => {
  if (!ssoReady) return res.status(503).json({ error: 'SSO not configured' })
  const payload = verifyJwt(req.body?.token, SSO_SECRET)
  if (!payload || !payload.sub) {
    return res.status(401).json({ error: 'invalid token' })
  }
  const now = Math.floor(Date.now() / 1000)
  // 메신저가 넣어준 uid 클레임 보관 → 알림 발송 시 userId 로 되돌려 보냄.
  const uid = payload.uid != null ? String(payload.uid) : ''
  const email = payload.email != null ? String(payload.email) : ''
  const session = signJwt(
    {
      sub: String(payload.sub),
      name: String(payload.name || ''),
      uid,
      email,
      iat: now,
      exp: now + SSO_SESSION_HOURS * 3600,
    },
    SSO_SECRET,
  )
  res.setHeader('Set-Cookie', sessionCookie(session, SSO_SESSION_HOURS * 3600))
  recordAccount(
    String(payload.sub),
    String(payload.name || ''),
    new Date().toISOString(),
    { uid, email },
  ).catch(() => {})
  res.json({
    ok: true,
    user: { sub: String(payload.sub), name: String(payload.name || ''), uid, email },
  })
})

// 계정 명부(디렉터리) — 승인자 지정 드롭다운용. 본사 명단 + 로그인 명부 합본. 로그인 사용자만 조회.
app.get('/api/sso/directory', async (req, res) => {
  if (!ssoReady) return res.json({ accounts: [] })
  const payload = requireSession(req)
  if (!payload) return res.status(401).json({ error: 'unauthorized' })
  res.json({ accounts: await mergedAccounts() })
})

// 본사 명단 조회 — 관리 화면용. 로그인 사용자만.
app.get('/api/sso/hq', async (req, res) => {
  if (!ssoReady) return res.json({ members: [] })
  const payload = requireSession(req)
  if (!payload) return res.status(401).json({ error: 'unauthorized' })
  const list = await loadHqMembers()
  const members = list
    .filter((e) => e && (e.id || e.name))
    .map((e) => ({
      id: String(e.id || e.name).trim(),
      name: String(e.name || e.id).trim(),
    }))
  res.json({ members })
})

// 본사 명단 저장(전체 교체) — 관리 화면용. 로그인 사용자만.
app.put('/api/sso/hq', express.json({ limit: '256kb' }), async (req, res) => {
  if (!ssoReady) return res.status(503).json({ error: 'SSO not configured' })
  const payload = requireSession(req)
  if (!payload) return res.status(401).json({ error: 'unauthorized' })
  const raw = Array.isArray(req.body?.members) ? req.body.members : null
  if (!raw) return res.status(400).json({ error: 'members array required' })
  // 이름 필수. id 미지정 시 이름을 계정ID로 사용(메신저 SSO 식별자=이름).
  const seen = new Set()
  const members = []
  for (const e of raw) {
    const name = String(e?.name || '').trim()
    if (!name) continue
    const id = String(e?.id || name).trim()
    if (seen.has(id)) continue
    seen.add(id)
    members.push({ id, name })
  }
  try {
    await saveHqMembers(members)
    res.json({ ok: true, members })
  } catch (e) {
    res.status(502).json({ error: String(e) })
  }
})

// 전역 설정 정규화 — baseManagers(담당자) + utilProfile(표준 이용률) + bizFeeByYear(영업비 기준값).
function normalizeSettings(s) {
  const baseManagers = Array.isArray(s?.baseManagers)
    ? s.baseManagers
        .filter((m) => m && (m.id || m.name))
        .map((m) => ({
          id: String(m.id || m.name).trim(),
          name: String(m.name || m.id).trim(),
        }))
    : []
  const utilProfile =
    s?.utilProfile && typeof s.utilProfile === 'object'
      ? Object.fromEntries(
          Object.entries(s.utilProfile)
            .filter(([, v]) => Number.isFinite(Number(v)))
            .map(([k, v]) => [String(k), Number(v)]),
        )
      : undefined
  const bizFeeByYear = Array.isArray(s?.bizFeeByYear)
    ? s.bizFeeByYear.map((v) => (Number.isFinite(Number(v)) ? Number(v) : 0))
    : undefined
  const feasUtil =
    s?.feasUtil && typeof s.feasUtil === 'object'
      ? Object.fromEntries(
          Object.entries(s.feasUtil)
            .filter(([, v]) => Number.isFinite(Number(v)))
            .map(([k, v]) => [String(k), Number(v)]),
        )
      : undefined
  const out = { baseManagers }
  if (utilProfile) out.utilProfile = utilProfile
  if (bizFeeByYear) out.bizFeeByYear = bizFeeByYear
  if (feasUtil) out.feasUtil = feasUtil
  return out
}

// 전역 설정 조회 — 담당자·표준 이용률·영업비 기준값(모든 사용자 공통). 로그인 사용자만.
app.get('/api/sso/settings', async (req, res) => {
  if (!ssoReady) return res.json({ baseManagers: [] })
  const payload = requireSession(req)
  if (!payload) return res.status(401).json({ error: 'unauthorized' })
  const s = await loadSettings()
  res.json(normalizeSettings(s))
})

// 전역 설정 저장 — 제공된 필드만 병합(부분 갱신). 로그인 사용자만.
app.put('/api/sso/settings', express.json({ limit: '256kb' }), async (req, res) => {
  if (!ssoReady) return res.status(503).json({ error: 'SSO not configured' })
  const payload = requireSession(req)
  if (!payload) return res.status(401).json({ error: 'unauthorized' })
  try {
    const cur = normalizeSettings(await loadSettings())
    // 요청에 포함된 키만 덮어쓴다(나머지 전역값 보존).
    const patch = {}
    if (Array.isArray(req.body?.baseManagers))
      patch.baseManagers = req.body.baseManagers
    if (req.body?.utilProfile && typeof req.body.utilProfile === 'object')
      patch.utilProfile = req.body.utilProfile
    if (Array.isArray(req.body?.bizFeeByYear))
      patch.bizFeeByYear = req.body.bizFeeByYear
    if (req.body?.feasUtil && typeof req.body.feasUtil === 'object')
      patch.feasUtil = req.body.feasUtil
    const merged = normalizeSettings({ ...cur, ...patch })
    await saveSettings(merged)
    res.json({ ok: true, ...merged })
  } catch (e) {
    res.status(502).json({ error: String(e) })
  }
})

// 결재 알림 발송 — 클라이언트가 결재 이벤트를 보내면 DealerConnect 메신저로 전달.
//  키(WECHA_APPROVAL_API_KEY)는 서버에만 두고, 브라우저엔 노출하지 않는다.
app.post(
  '/api/approval/notify',
  requireAuth,
  express.json({ limit: '256kb' }),
  async (req, res) => {
    if (!approvalNotifyReady) return res.json({ enabled: false })
    const b = req.body || {}
    const title = String(b.title || '').trim()
    if (!title) return res.status(400).json({ error: 'title required' })
    // 수신자 → 정밀 식별자 우선(uid > email > name)
    const assigneeNames = []
    const assigneeUserIds = []
    const assigneeEmails = []
    for (const r of Array.isArray(b.recipients) ? b.recipients : []) {
      if (!r) continue
      const uid = String(r.uid || '').trim()
      const email = String(r.email || '').trim()
      const name = String(r.name || '').trim()
      if (uid) assigneeUserIds.push(uid)
      else if (email) assigneeEmails.push(email)
      else if (name) assigneeNames.push(name)
    }
    if (!assigneeNames.length && !assigneeUserIds.length && !assigneeEmails.length)
      return res.status(400).json({ error: 'no recipients' })
    const fields = []
    if (b.projectName)
      fields.push({ label: '현장', value: String(b.projectName).slice(0, 200) })
    if (b.requesterName)
      fields.push({ label: '요청자', value: String(b.requesterName).slice(0, 200) })
    const payload = {
      category: 'APPROVAL',
      title: title.slice(0, 200),
      ...(b.message ? { message: String(b.message).slice(0, 5000) } : {}),
      ...(b.status ? { status: String(b.status).slice(0, 40) } : {}),
      ...(b.eventType ? { eventType: String(b.eventType).slice(0, 50) } : {}),
      ...(b.refId ? { refId: String(b.refId).slice(0, 100) } : {}),
      ...(b.requestId ? { requestId: String(b.requestId).slice(0, 80) } : {}),
      ...(b.sourceUrl ? { sourceUrl: String(b.sourceUrl).slice(0, 500) } : {}),
      ...(fields.length ? { fields: fields.slice(0, 12) } : {}),
      ...(assigneeNames.length ? { assigneeNames: assigneeNames.slice(0, 50) } : {}),
      ...(assigneeUserIds.length
        ? { assigneeUserIds: assigneeUserIds.slice(0, 50) }
        : {}),
      ...(assigneeEmails.length
        ? { assigneeEmails: assigneeEmails.slice(0, 50) }
        : {}),
    }
    const result = await sendApprovalNotification(payload)
    res.json({ enabled: true, ...result })
  },
)

// 현재 로그인 사용자(세션 쿠키 기준)
app.get('/api/sso/me', (req, res) => {
  if (!ssoReady) return res.json({ enabled: false, user: null, directLogin: false })
  const payload = requireSession(req)
  if (!payload)
    return res.status(401).json({ enabled: true, user: null, directLogin: directLoginReady })
  res.json({
    enabled: true,
    user: {
      sub: payload.sub,
      name: payload.name || '',
      uid: payload.uid || '',
      email: payload.email || '',
    },
    directLogin: directLoginReady,
  })
})

app.post('/api/sso/logout', (_req, res) => {
  res.setHeader('Set-Cookie', sessionCookie('', 0))
  res.json({ ok: true })
})

// 정적 파일 + SPA 폴백
// 해시된 에셋(js/css)은 불변 → 장기 캐시. index.html 은 항상 재검증(no-cache)
//  → 새 배포 시 iframe 임베드(강제 새로고침 어려움)에서도 최신 번들을 받는다.
app.use(
  express.static(DIST, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, must-revalidate')
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
    },
  }),
)
app.use((_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate')
  res.sendFile(path.join(DIST, 'index.html'))
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `listening on ${PORT} · R2 ${r2Ready ? 'ON' : 'OFF(localStorage)'} · AI ${
      aiReady ? `ON(${AI_MODEL})` : 'OFF(no ANTHROPIC_API_KEY)'
    } · SSO ${
      ssoReady
        ? `ON${directLoginReady ? '+직접로그인' : ''}`
        : 'OFF(no SSO_SECRET)'
    } · 결재알림 ${approvalNotifyReady ? 'ON' : 'OFF(no WECHA_APPROVAL_API_KEY)'}`,
  )
})
