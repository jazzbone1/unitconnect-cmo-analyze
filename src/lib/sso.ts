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
  /** 별도(직접) 로그인 폼 사용 가능 여부(DIRECT_LOGIN_PASSWORD 설정 시) */
  directLogin: boolean
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
    const d = await res.json().catch(() => ({}))
    return {
      enabled: !!d.enabled,
      user: (d.user as SsoUser) ?? null,
      directLogin: !!d.directLogin,
    }
  } catch {
    // 서버(server.mjs)가 없는 환경(로컬 vite 등) → SSO 비활성 취급
    return { enabled: false, user: null, directLogin: false }
  }
}

/** 별도(직접) 로그인: 이름 + 공용 접속 비밀번호. 성공 시 사용자 반환. */
export async function ssoDirectLogin(
  name: string,
  password: string,
): Promise<SsoUser> {
  const res = await fetch('/api/sso/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, password }),
    credentials: 'same-origin',
  })
  if (!res.ok) {
    let msg = `로그인 실패 (${res.status})`
    try {
      const e = await res.json()
      if (e?.error) msg = e.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  const d = await res.json()
  return d.user as SsoUser
}

/** 현재 로그인 사용자만 조회(URL 토큰 소비 없음). 미로그인/비활성 시 null. */
export async function ssoCurrentUser(): Promise<SsoUser | null> {
  try {
    const res = await fetch('/api/sso/me', { credentials: 'same-origin' })
    if (!res.ok) return null
    const d = await res.json()
    return (d.user as SsoUser) ?? null
  } catch {
    return null
  }
}

/** 메신저 계정(승인자 지정용). id=계정ID(sub), name=표시 이름. */
export interface SsoAccount {
  id: string
  name: string
}

/**
 * 계정 명부 조회(승인자 드롭다운용). 로그인/직접로그인한 계정이 자동 축적된 목록.
 * 미로그인·비활성 시 빈 배열.
 */
export async function ssoDirectory(): Promise<SsoAccount[]> {
  try {
    const res = await fetch('/api/sso/directory', { credentials: 'same-origin' })
    if (!res.ok) return []
    const d = await res.json()
    return Array.isArray(d.accounts) ? (d.accounts as SsoAccount[]) : []
  } catch {
    return []
  }
}

/** 본사 명단 조회(관리 화면용). */
export async function ssoHqMembers(): Promise<SsoAccount[]> {
  try {
    const res = await fetch('/api/sso/hq', { credentials: 'same-origin' })
    if (!res.ok) return []
    const d = await res.json()
    return Array.isArray(d.members) ? (d.members as SsoAccount[]) : []
  } catch {
    return []
  }
}

/** 본사 명단 전체 저장(교체). 저장된 결과를 반환. */
export async function ssoSaveHqMembers(
  members: { id?: string; name: string }[],
): Promise<SsoAccount[]> {
  const res = await fetch('/api/sso/hq', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ members }),
    credentials: 'same-origin',
  })
  if (!res.ok) {
    let msg = `저장 실패 (${res.status})`
    try {
      const e = await res.json()
      if (e?.error) msg = e.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  const d = await res.json()
  return Array.isArray(d.members) ? (d.members as SsoAccount[]) : []
}

/** 전역 앱 설정. baseManagers=기본안 수정 담당자(전체 공통). */
export interface AppSettings {
  baseManagers: SsoAccount[]
}

export async function ssoGetSettings(): Promise<AppSettings> {
  try {
    const res = await fetch('/api/sso/settings', { credentials: 'same-origin' })
    if (!res.ok) return { baseManagers: [] }
    const d = await res.json()
    return {
      baseManagers: Array.isArray(d.baseManagers)
        ? (d.baseManagers as SsoAccount[])
        : [],
    }
  } catch {
    return { baseManagers: [] }
  }
}

export async function ssoSaveSettings(s: AppSettings): Promise<AppSettings> {
  const res = await fetch('/api/sso/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(s),
    credentials: 'same-origin',
  })
  if (!res.ok) {
    let msg = `저장 실패 (${res.status})`
    try {
      const e = await res.json()
      if (e?.error) msg = e.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  const d = await res.json()
  return {
    baseManagers: Array.isArray(d.baseManagers)
      ? (d.baseManagers as SsoAccount[])
      : [],
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
