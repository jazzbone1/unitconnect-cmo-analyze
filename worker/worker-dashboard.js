// Cloudflare 대시보드에 붙여넣는 버전 (터미널 없이 사용)
// Workers & Pages → Create → Worker → Edit code 에 아래 전체를 붙여넣고 Deploy.
// 그리고 Settings → Variables & Bindings 에서 KV 바인딩 이름을 반드시 PROJECTS 로.

const STORE_KEY = 'projects:shared'
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type,x-app-key',
  'Access-Control-Max-Age': '86400',
}
const JSON_HEADERS = { ...CORS, 'content-type': 'application/json; charset=utf-8' }

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })

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
      const data = await env.PROJECTS.get(STORE_KEY)
      return new Response(data ?? '[]', { headers: JSON_HEADERS })
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
      await env.PROJECTS.put(STORE_KEY, body)
      return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS })
    }

    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: JSON_HEADERS,
    })
  },
}
