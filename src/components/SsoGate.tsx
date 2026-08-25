import { useEffect, useState } from 'react'
import { resolveSso, type SsoState } from '../lib/sso'

/**
 * SSO 게이트. 서버에 SSO_SECRET이 설정돼 SSO가 켜진 경우에만 로그인 요구.
 *  - ?sso=<JWT> 로 들어오면 자동 검증 후 통과(자동로그인).
 *  - SSO가 꺼져 있으면(로컬/단독 운영) 그대로 통과 — 기존 동작 유지.
 */
export default function SsoGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SsoState | null>(null)

  useEffect(() => {
    let alive = true
    resolveSso().then((s) => {
      if (alive) setState(s)
    })
    return () => {
      alive = false
    }
  }, [])

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
            UC 메신저(ERP)에서 로그인 후 <b>분석 → 위차 분석</b>으로 접속해
            주세요.
          </p>
          <p className="sso-card__sub">
            로그인 세션이 없거나 만료되었습니다. 메신저에서 다시 링크로
            진입하면 자동으로 로그인됩니다.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
