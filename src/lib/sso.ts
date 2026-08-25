/**
 * SSO(A안: 서명 JWT) 클라이언트.
 *  - 메신저(ERP)가 "위차 분석" 링크를 열 때 ?sso=<JWT> 를 붙여 진입.
 *  - 이 파일이 토큰을 서버(server.mjs)의 /api/sso/verify 로 넘겨 세션 쿠키를 받고,
 *    /api/sso/me 로 현재 로그인 사용자를 확인한다.
 *  - SSO 엔드포인트는 앱을 서빙하는 서버(같은 오리진)에 있으므로 상대경로로 호출.
 */
export interface SsoUser {
  sub: string
  name: string
}
export interface SsoState {
  /** 서버에 SSO_SECRET이 설정되어 SSO가 켜져 있는지 */
  enabled: boolean
  user: SsoUser | null
}

/** URL의 ?sso= 토큰을 소비(검증→세션쿠키)하고 파라미터를 제거한다. */
async function consumeTokenFromUrl(): Promise<void> {
  const url = new URL(window.location.href)
  const token = url.searchParams.get('sso')
  if (!token) return
  try {
    await fetch('/api/sso/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
      credentials: 'same-origin',
    })
  } catch {
    /* 검증 실패는 아래 me 조회에서 미로그인으로 처리 */
  }
  url.searchParams.delete('sso')
  window.history.replaceState(
    {},
    '',
    url.pathname + (url.search ? url.search : '') + url.hash,
  )
}

/** 진입 시 SSO 상태 해석: ?sso 소비 후 현재 세션 확인. */
export async function resolveSso(): Promise<SsoState> {
  await consumeTokenFromUrl()
  try {
    const res = await fetch('/api/sso/me', { credentials: 'same-origin' })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      return { enabled: !!d.enabled, user: null }
    }
    const d = await res.json()
    return { enabled: !!d.enabled, user: (d.user as SsoUser) ?? null }
  } catch {
    // 서버(server.mjs)가 없는 환경(로컬 vite 등) → SSO 비활성 취급
    return { enabled: false, user: null }
  }
}

export async function ssoLogout(): Promise<void> {
  try {
    await fetch('/api/sso/logout', {
      method: 'POST',
      credentials: 'same-origin',
    })
  } catch {
    /* ignore */
  }
}
