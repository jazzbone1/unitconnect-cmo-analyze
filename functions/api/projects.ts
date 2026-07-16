// Cloudflare Pages Function — /api/projects
// 프로젝트(현장) 목록을 KV에 사용자별로 저장/조회한다.
//
// 배포 준비:
//   1) Cloudflare에 KV 네임스페이스 생성 후 wrangler.toml의 id 채우기
//   2) Pages 프로젝트 빌드 환경변수에 VITE_REMOTE_STORE=1 설정
//   3) (권장) Cloudflare Access로 접근 제어 → 로그인 이메일별로 데이터 분리
//
// 주의: 명부 데이터는 앱에서 개인정보(이름·전화 등)를 제거한 뒤 저장되므로
//       KV에는 이름·연락처가 저장되지 않습니다(차량번호·차종만).

interface KVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
}
interface Env {
  PROJECTS: KVNamespace
}
type Ctx = { request: Request; env: Env }

// Cloudflare Access가 있으면 로그인 이메일로, 없으면 공용 키로 저장
function userKey(request: Request): string {
  const email = request.headers.get('cf-access-authenticated-user-email')
  return `projects:${email ?? 'default'}`
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

export async function onRequestGet({ request, env }: Ctx): Promise<Response> {
  const data = await env.PROJECTS.get(userKey(request))
  return new Response(data ?? '[]', { headers: JSON_HEADERS })
}

export async function onRequestPut({ request, env }: Ctx): Promise<Response> {
  const body = await request.text()
  // 최소 검증: JSON 배열인지 확인
  try {
    const parsed = JSON.parse(body)
    if (!Array.isArray(parsed)) throw new Error('array expected')
  } catch {
    return new Response(JSON.stringify({ error: 'invalid body' }), {
      status: 400,
      headers: JSON_HEADERS,
    })
  }
  await env.PROJECTS.put(userKey(request), body)
  return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS })
}
