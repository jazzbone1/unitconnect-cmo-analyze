import type { SavedSite } from './sites'
import { loadSites as loadLocal, saveSites as saveLocal } from './sites'

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
  constructor(private base: string) {}
  async load(): Promise<SavedSite[]> {
    const res = await fetch(`${this.base}/api/projects`, {
      credentials: 'include',
    })
    if (!res.ok) throw new Error(`목록 불러오기 실패: ${res.status}`)
    const data = await res.json()
    return Array.isArray(data) ? (data as SavedSite[]) : []
  }
  async save(sites: SavedSite[]): Promise<void> {
    const res = await fetch(`${this.base}/api/projects`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(sites),
    })
    if (!res.ok) throw new Error(`저장 실패: ${res.status}`)
  }
}

export function getStore(): ProjectStore {
  const remote = import.meta.env.VITE_REMOTE_STORE
  if (remote === '1' || remote === 'true') {
    return new RemoteStore(import.meta.env.VITE_API_BASE ?? '')
  }
  return new LocalStore()
}
