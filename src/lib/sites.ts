import type { ChargerType } from './settlement'
import type { RegistryResult } from './registry'
import type { FeasibilityInputs } from './feasibility'
import type { ReportModel } from './report'
import type { TariffInputs } from './tariff'
import type { StandbyInputs } from './standby'
import type { ApartmentBillInputs } from './apartmentBill'
import type { FileEntry } from '../types'

/** 순차 승인 단계(승인자 1명) */
export interface ApprovalStep {
  /** 메신저(DEALERCONNECT) 계정 ID(SSO sub). 계정 연동 시 지정, 차례 게이트 매칭 기준. */
  id?: string
  /** 승인자 이름(표시용) */
  name: string
  decision?: 'approved' | 'rejected'
  /** 처리 시각(ISO) */
  at?: string
  comment?: string
}

/** 현장 분석 승인 워크플로 */
export interface AnalysisApproval {
  /**
   * review=검토중, reviewed=검토완료, requested=승인요청(진행중),
   * approved=승인완료(승인자 전원 승인 시 자동), rejected=반려
   */
  status: 'review' | 'reviewed' | 'requested' | 'approved' | 'rejected'
  /** 담당자 이름(표시용) */
  assignee?: string
  /** 담당자 계정 ID(SSO sub) */
  assigneeId?: string
  /** 순차 승인자 목록(앞에서부터 차례로 승인) */
  approvers: ApprovalStep[]
  /** 현재 승인 차례(approvers index) */
  currentStep: number
  requestedBy?: string
  requestedAt?: string
  /** 결재 대상 분석안 id — null/undefined=기본안, 그 외=대체안 variant id */
  slotId?: string | null
  /** 결재 계약기간(년). 미설정 가능; 설정 시 요약에서 해당 연도 지표 강조 */
  contractYears?: number
}

export function defaultApproval(): AnalysisApproval {
  return { status: 'review', approvers: [], currentStep: 0 }
}

/** 승인 요청 시작(검토→승인요청). 이전 처리 이력 초기화. */
export function approvalRequest(
  a: AnalysisApproval,
  byName: string | undefined,
  nowIso: string,
): AnalysisApproval {
  return {
    ...a,
    status: 'requested',
    currentStep: 0,
    requestedBy: byName || a.requestedBy || '',
    requestedAt: nowIso,
    approvers: a.approvers.map((s) => ({ id: s.id, name: s.name })),
  }
}

/** 현재 차례 승인자가 승인/반려. 마지막까지 승인 시 approved. */
export function approvalDecide(
  a: AnalysisApproval,
  decision: 'approved' | 'rejected',
  nowIso: string,
): AnalysisApproval {
  const i = a.currentStep
  const approvers = a.approvers.map((s, idx) =>
    idx === i ? { ...s, decision, at: nowIso } : s,
  )
  if (decision === 'rejected') return { ...a, approvers, status: 'rejected' }
  const next = i + 1
  return {
    ...a,
    approvers,
    currentStep: next,
    status: next >= a.approvers.length ? 'approved' : 'requested',
  }
}

/** 현재 차례 승인자 본인인지(계정ID 또는 이름 일치). 로그인 정보 없으면 제약 없음. */
export function approvalCanDecide(
  a: AnalysisApproval,
  user: { sub?: string; name?: string } | null | undefined,
): boolean {
  if (a.status !== 'requested') return false
  const cur = a.approvers[a.currentStep]
  if (!cur) return false
  if (!user) return true
  return (
    (!!cur.id && cur.id === user.sub) ||
    cur.name.trim() === (user.name || '').trim()
  )
}

/**
 * 대체안(변형 분석): 이용량 분석은 기본안과 공유하고, 충전기 구성(일부 제외 등)만
 * 달리하여 사업성~아파트요금 분석을 별도로 저장한다. 보고서는 기본안 기준.
 */
export interface AnalysisVariant {
  id: string
  label: string
  /** 이용시간(시간/일) — 정산 설정 */
  hours: number
  /** 충전기 구성(제외 플래그 포함) */
  chargers: ChargerType[]
  feas?: FeasibilityInputs
  tariff?: TariffInputs
  standby?: StandbyInputs
  aptBill?: ApartmentBillInputs
}

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
  /** 아파트 요금(고지서) 분석 입력값 */
  aptBill?: ApartmentBillInputs
  /** 저장 시각 (ISO) */
  savedAt?: string

  /** 현장 분석 승인 워크플로(검토중→승인요청→순차승인) */
  approval?: AnalysisApproval

  /** 대체안(변형 분석) 목록 — 사업성~아파트요금을 달리한 별도 저장안 */
  variants?: AnalysisVariant[]

  /** 현장 의견(결재 참고용 공통 메모) */
  fieldNote?: string

  /** 분석안별 의견 — 키 'base'=기본안, 그 외=대체안 variant id. 변형 배열과 독립 저장. */
  slotNotes?: Record<string, string>

  /**
   * 프로젝트별 영업비 1대분(계약년수별, 1~7년).
   *  숫자(0 포함)=명시적 적용, null/undefined=미기입(전체 기준값 사용).
   */
  bizFeeByYear?: (number | null)[]

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
