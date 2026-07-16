// Railway 서버: 정적 사이트(dist) 서빙 + /api/projects 를 R2에 저장/조회
//
// 필요한 환경변수 (Railway Variables):
//   R2_ACCOUNT_ID        Cloudflare 계정 ID
//   R2_ACCESS_KEY_ID     R2 API 토큰의 Access Key ID
//   R2_SECRET_ACCESS_KEY R2 API 토큰의 Secret Access Key
//   R2_BUCKET            버킷 이름 (예: wecha-cmo-analysis)
//   (프론트) VITE_REMOTE_STORE=1  ← 빌드 시 주입 (같은 도메인 /api 사용)
//
// R2 환경변수가 없으면 /api 는 비활성(앱은 localStorage로 동작).

import express from 'express'
import { AwsClient } from 'aws4fetch'
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
} = process.env

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

// 정적 파일 + SPA 폴백
app.use(express.static(DIST))
app.use((_req, res) => res.sendFile(path.join(DIST, 'index.html')))

app.listen(PORT, '0.0.0.0', () => {
  console.log(`listening on ${PORT} · R2 ${r2Ready ? 'ON' : 'OFF(localStorage)'}`)
})
