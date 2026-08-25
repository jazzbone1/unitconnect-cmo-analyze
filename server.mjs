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
  return `uc_sso=${value}; HttpOnly; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax; Secure`
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

const app = express()

app.get('/api/projects', async (_req, res) => {
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

app.post('/api/ai/analyze', express.json({ limit: '4mb' }), async (req, res) => {
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
  const session = signJwt(
    {
      sub: String(payload.sub),
      name: String(payload.name || ''),
      iat: now,
      exp: now + SSO_SESSION_HOURS * 3600,
    },
    SSO_SECRET,
  )
  res.setHeader('Set-Cookie', sessionCookie(session, SSO_SESSION_HOURS * 3600))
  res.json({ ok: true, user: { sub: String(payload.sub), name: String(payload.name || '') } })
})

// 현재 로그인 사용자(세션 쿠키 기준)
app.get('/api/sso/me', (req, res) => {
  if (!ssoReady) return res.json({ enabled: false, user: null, directLogin: false })
  const payload = verifyJwt(readCookie(req, 'uc_sso'), SSO_SECRET)
  if (!payload)
    return res.status(401).json({ enabled: true, user: null, directLogin: directLoginReady })
  res.json({
    enabled: true,
    user: { sub: payload.sub, name: payload.name || '' },
    directLogin: directLoginReady,
  })
})

app.post('/api/sso/logout', (_req, res) => {
  res.setHeader('Set-Cookie', sessionCookie('', 0))
  res.json({ ok: true })
})

// 정적 파일 + SPA 폴백
app.use(express.static(DIST))
app.use((_req, res) => res.sendFile(path.join(DIST, 'index.html')))

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `listening on ${PORT} · R2 ${r2Ready ? 'ON' : 'OFF(localStorage)'} · AI ${
      aiReady ? `ON(${AI_MODEL})` : 'OFF(no ANTHROPIC_API_KEY)'
    } · SSO ${
      ssoReady
        ? `ON${directLoginReady ? '+직접로그인' : ''}`
        : 'OFF(no SSO_SECRET)'
    }`,
  )
})
