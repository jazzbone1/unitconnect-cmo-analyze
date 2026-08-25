/**
 * 데이터 API(프로젝트 저장소·AI)가 401을 받았을 때 앱 전체에 알리는 통로.
 *
 * 서버가 세션을 강제하므로(server.mjs requireAuth), 세션이 만료되거나 없는 상태로
 * 데이터 API를 부르면 401이 온다. 그때 이 이벤트를 쏘면 SsoGate가 세션을 다시 확인해
 * 로그인 게이트를 띄운다 — 이 처리가 없으면 게이트 대신 빈 화면이나 에러 토스트만 뜬다.
 */
export const UNAUTHORIZED_EVENT = 'uc:unauthorized'

/** 데이터 API에서 401을 받았음을 알린다. */
export function notifyUnauthorized(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
}

/** 401 알림 구독. 해제 함수를 반환한다. */
export function onUnauthorized(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(UNAUTHORIZED_EVENT, handler)
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler)
}
