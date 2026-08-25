import { useEffect, useState } from 'react'
import { resolveSso, ssoDirectLogin, type SsoState } from '../lib/sso'

/**
 * SSO 게이트. 서버에 SSO_SECRET이 설정돼 SSO가 켜진 경우에만 로그인 요구.
 *  - ?sso=<JWT> 로 들어오면 자동 검증 후 통과(DEALERCONNECT 자동로그인).
 *  - DIRECT_LOGIN_PASSWORD 설정 시 별도(직접) 로그인 폼 제공.
 *  - SSO가 꺼져 있으면(로컬/단독 운영) 그대로 통과 — 기존 동작 유지.
 */
export default function SsoGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SsoState | null>(null)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    resolveSso().then((s) => {
      if (alive) setState(s)
    })
    return () => {
      alive = false
    }
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const user = await ssoDirectLogin(name.trim(), password)
      setState((s) => (s ? { ...s, user } : s))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (state === null) {
    return <div className="sso-screen">확인 중…</div>
  }

  // SSO 활성인데 로그인 세션이 없으면 접근 차단
  if (state.enabled && !state.user) {
    return (
      <div className="sso-screen">
        <div className="sso-card">
          <div className="sso-card__title">위차 분석</div>
          <p className="sso-card__msg">
            <b>DEALERCONNECT</b>에서 로그인 후 <b>분석 → 위차 분석</b>으로 접속해
            주세요.
          </p>
          <p className="sso-card__sub">
            로그인 세션이 없거나 만료되었습니다. DEALERCONNECT에서 다시 링크로
            진입하면 자동으로 로그인됩니다.
          </p>

          {state.directLogin && (
            <form className="sso-login" onSubmit={submit}>
              <div className="sso-login__divider">또는 별도 로그인</div>
              <input
                className="sso-login__input"
                type="text"
                placeholder="이름"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="username"
              />
              <input
                className="sso-login__input"
                type="password"
                placeholder="접속 비밀번호"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              {error && <p className="sso-login__error">{error}</p>}
              <button
                type="submit"
                className="sso-login__btn"
                disabled={busy || !name.trim() || !password}
              >
                {busy ? '로그인 중…' : '로그인'}
              </button>
            </form>
          )}
        </div>
      </div>
    )
  }

  return <>{children}</>
}
