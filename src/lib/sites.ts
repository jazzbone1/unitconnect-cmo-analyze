import type { ChargerType } from './settlement'

/** 저장된 현장(단지) 한 곳의 정보 + 충전기 설정 */
export interface SavedSite {
  id: string
  name: string
  address: string
  households: number
  hours: number
  chargers: ChargerType[]
}

const STORAGE_KEY = 'unitconnect.sites.v1'

/** 저장된 현장 목록을 불러온다. 실패 시 빈 배열. */
export function loadSites(): SavedSite[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as SavedSite[]) : []
  } catch {
    return []
  }
}

/** 현장 목록을 저장한다. (localStorage 사용 불가 환경이면 무시) */
export function saveSites(sites: SavedSite[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sites))
  } catch {
    /* 저장 실패는 무시 (세션 내 메모리로만 유지) */
  }
}

/** 새 현장 id 생성 */
export function newSiteId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID()
    }
  } catch {
    /* fallthrough */
  }
  return 's' + Date.now().toString(36)
}
