import type { SavedSite } from './sites'
import { loadSites as loadLocal, saveSites as saveLocal } from './sites'
import { notifyUnauthorized } from './authEvents'

/**
 * 프로젝트(현장) 저장소 추상화.
 * 기본은 브라우저 localStorage, 환경변수로 원격(Cloudflare 등)으로 전환한다.
 *  - VITE_REMOTE_STORE=1  → 원격 저장소 사용
 *  - VITE_API_BASE        → API 주소 (비우면 같은 도메인 /api 사용)
 */
export interface ProjectStore {
  readonly kind: 'local' | 'remote'
  load(): Promise<SavedSite[]>
  save(sites: SavedSite[]): Promise<void>
}

class LocalStore implements ProjectStore {
  readonly kind = 'local'
  async load(): Promise<SavedSite[]> {
    return loadLocal()
  }
  async save(sites: SavedSite[]): Promise<void> {
    saveLocal(sites)
  }
}

class RemoteStore implements ProjectStore {
  readonly kind = 'remote'
  constructor(
    private base: string,
    private appKey?: string,
  ) {}
  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' }
    if (this.appKey) h['x-app-key'] = this.appKey
    return h
  }
  async load(): Promise<SavedSite[]> {
    const res = await fetch(`${this.base}/api/projects`, {
      headers: this.headers(),
      credentials: 'same-origin', // 세션 쿠키(uc_sso) 동봉 — 서버가 로그인을 요구한다
    })
    if (res.status === 401) {
      notifyUnauthorized()
      throw new Error('로그인이 필요합니다.')
    }
    if (!res.ok) throw new Error(`목록 불러오기 실패: ${res.status}`)
    const data = await res.json()
    return Array.isArray(data) ? (data as SavedSite[]) : []
  }
  async save(sites: SavedSite[]): Promise<void> {
    const res = await fetch(`${this.base}/api/projects`, {
      method: 'PUT',
      headers: this.headers(),
      body: JSON.stringify(sites),
      credentials: 'same-origin',
    })
    if (res.status === 401) {
      notifyUnauthorized()
      throw new Error('로그인이 필요합니다.')
    }
    if (!res.ok) throw new Error(`저장 실패: ${res.status}`)
  }
}

export function getStore(): ProjectStore {
  const remote = import.meta.env.VITE_REMOTE_STORE
  if (remote === '1' || remote === 'true') {
    return new RemoteStore(
      import.meta.env.VITE_API_BASE ?? '',
      import.meta.env.VITE_APP_KEY,
    )
  }
  return new LocalStore()
}
