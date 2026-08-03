import type { ChargerType } from './settlement'
import type { RegistryResult } from './registry'
import type { FeasibilityInputs } from './feasibility'
import type { ReportModel } from './report'
import type { TariffInputs } from './tariff'
import type { StandbyInputs } from './standby'
import type { FileEntry } from '../types'

/** 저장된 현장(단지) 한 곳의 정보 + 충전기 설정 + 분석 데이터 */
export interface SavedSite {
  id: string
  name: string
  address: string
  households: number
  /** 총 주차대수 */
  parking?: number
  hours: number
  chargers: ChargerType[]
  /** 프로젝트에 저장된 전체 업로드 파일 (이용량·명부 등) */
  files?: FileEntry[]
  /** (구버전 호환) 저장 당시의 정산 파일 */
  settlementFiles?: FileEntry[]
  /** (구버전 호환) 저장 당시의 이용자 명부 분석 결과 */
  registry?: RegistryResult | null
  /** 사업성 분석(영업비 산정) 입력값 */
  feas?: FeasibilityInputs
  /** 컨설팅 보고서 데이터 (현장별) */
  report?: ReportModel
  /** 요금 구조 분석 입력값 */
  tariff?: TariffInputs
  /** 대기전력 분석 입력값 */
  standby?: StandbyInputs
  /** 저장 시각 (ISO) */
  savedAt?: string

  // ── 프로젝트 관리(파이프라인) 필드 ──
  /** 프로젝트 코드 (예: BF-2608) */
  code?: string
  /** CPO */
  cpo?: string
  /** 계약 합계 (금액 또는 대수) */
  contractTotal?: number
  /** 실사 상태 */
  surveyStatus?: string
  /** 영업 상태 (본사기입) */
  salesStatus?: string
  /** 시공 상태 (본사기입) */
  constructionStatus?: string
  /** 환경부 접수일 */
  envSubmitDate?: string
  /** 시공 예정일(종료) */
  constructionEndDate?: string
  /** 안전점검일 */
  safetyCheckDate?: string
}

/** 상태 선택지 */
export const SALES_STATUS = [
  '계약진행필요',
  '영업중',
  '계약완료',
  '보류',
  '해당없음',
]
export const SURVEY_STATUS = ['미실사', '실사예정', '실사완료']
export const CONSTRUCTION_STATUS = ['미시공', '시공예정', '시공중', '시공완료']
export const CPO_OPTIONS = [
  '선택안함',
  '유닛커넥트',
  '기타',
]

/** 프로젝트 id로부터 안정적인 표시용 코드(BF-####)를 만든다. */
export function projectCode(site: SavedSite): string {
  if (site.code && site.code.trim()) return site.code
  let h = 0
  for (let i = 0; i < site.id.length; i++) {
    h = (h * 31 + site.id.charCodeAt(i)) >>> 0
  }
  return `BF-${1000 + (h % 9000)}`
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
