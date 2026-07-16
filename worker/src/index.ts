// Cloudflare Worker — 공용 저장소 API (/api/projects), R2 버킷 사용
// 모든 방문자가 같은 현장 데이터를 보고 저장하는 단일 저장소.
//
// - GET  /api/projects  → 저장된 프로젝트 배열(JSON)
// - PUT  /api/projects  → 프로젝트 배열 전체 저장
//
// 명부(사용자 정보)는 앱에서 개인정보(이름·전화 등)를 제거한 뒤 저장하므로
// R2에는 이름·연락처가 저장되지 않습니다(차량번호·차종만).

interface R2ObjectBody {
  text(): Promise<string>
}
interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>
  put(key: string, value: string): Promise<unknown>
}
export interface Env {
  // R2 버킷 바인딩 (이름: BUCKET)
  BUCKET: R2Bucket
  // (선택) 공유 키. 설정하면 x-app-key 헤더가 일치해야 접근 허용
  AUTH_KEY?: string
}

const OBJECT_KEY = 'projects.json'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type,x-app-key',
  'Access-Control-Max-Age': '86400',
}
const JSON_HEADERS = {
  ...CORS,
  'content-type': 'application/json; charset=utf-8',
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS })
    }

    const url = new URL(request.url)
    if (!url.pathname.replace(/\/$/, '').endsWith('/api/projects')) {
      return new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: JSON_HEADERS,
      })
    }

    if (env.AUTH_KEY && request.headers.get('x-app-key') !== env.AUTH_KEY) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: JSON_HEADERS,
      })
    }

    if (request.method === 'GET') {
      const obj = await env.BUCKET.get(OBJECT_KEY)
      const data = obj ? await obj.text() : '[]'
      return new Response(data, { headers: JSON_HEADERS })
    }

    if (request.method === 'PUT') {
      const body = await request.text()
      try {
        if (!Array.isArray(JSON.parse(body))) throw new Error('array expected')
      } catch {
        return new Response(JSON.stringify({ error: 'invalid body' }), {
          status: 400,
          headers: JSON_HEADERS,
        })
      }
      await env.BUCKET.put(OBJECT_KEY, body)
      return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS })
    }

    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: JSON_HEADERS,
    })
  },
}
