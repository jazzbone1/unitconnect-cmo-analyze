// 파싱된 데이터셋의 셀 값. 문자열, 숫자, 또는 결측(null).
export type CellValue = string | number | null

export interface Dataset {
  /** 컬럼(헤더) 이름 목록 */
  columns: string[]
  /** 행 배열. 각 행은 컬럼명 → 값 매핑 */
  rows: Record<string, CellValue>[]
  /** 원본 파일명 */
  fileName: string
}

export type ColumnType = 'numeric' | 'categorical'

/** 숫자형 컬럼의 요약 통계 */
export interface NumericSummary {
  type: 'numeric'
  column: string
  count: number // 결측이 아닌 값의 개수
  missing: number // 결측(빈 값)의 개수
  mean: number
  std: number
  min: number
  q1: number
  median: number
  q3: number
  max: number
}

/** 범주형(문자열) 컬럼의 요약 통계 */
export interface CategoricalSummary {
  type: 'categorical'
  column: string
  count: number // 결측이 아닌 값의 개수
  missing: number // 결측의 개수
  unique: number // 고유값 개수
  top: string // 최빈값
  topFreq: number // 최빈값의 빈도
}

export type ColumnSummary = NumericSummary | CategoricalSummary

/** 파일명에서 추출한 기간 정보 */
export interface Period {
  /** 표시용 라벨 (예: "2024-06", "2024", "24.06.01~25.07.03") */
  label: string
  /** 시간순 정렬 키 (YYYYMMDD 형태의 숫자, 시작일 기준) */
  sortKey: number
  /** 월간=month, 연간=year(범위 포함), 전체 기간="전체" 파일=total */
  type: 'month' | 'year' | 'total' | 'unknown'
  /** 기간에 포함된 개월 수 (월간=1, 연간=12/범위 계산값). 이용률 환산에 사용 */
  months: number
}

/** 개별 충전기 한 대의 이용량 집계(코스텔). */
export interface PerChargerUsage {
  name: string
  type: string
  kw: number
  kwh: number
  amount: number
  rate: number
  count: number
}
/** 시간대(0~23시)별 종류(kW)별 가동 시간(분) 프로파일 + 운영일수. */
export interface CostelHourly {
  /** kW(문자열 키) → 길이 24 배열(시간대별 가동 분) */
  byHourByKw: Record<string, number[]>
  /** 운영 일수(해당 기간 내 충전이 있었던 고유 날짜 수) — 이용률 분모용 */
  days: number
}
/** 코스텔 월별 집계(한 달). */
export interface CostelMonthAgg {
  ym: string
  sortKey: number
  users: number
  amountRaw: number
  usageTotal: number
  /** 종류(kW, 문자열 키)별 사용량(kWh) */
  byKw: Record<string, number>
  /** 종류(kW, 문자열 키)별 실제 금액(원) — 코스텔 비용 합계 */
  byKwAmount?: Record<string, number>
  /** 시간대별 가동 프로파일 */
  hourly?: CostelHourly
}
/** 최근 12개월 연간 집계. */
export interface CostelAnnual {
  label: string
  fromYm: string
  toYm: string
  sortKey: number
  users: number
  amountRaw: number
  usageTotal: number
  byKw: Record<string, number>
  byKwAmount: Record<string, number>
  hourly: CostelHourly
}
/**
 * 코스텔 충전내역 사전 집계 — 원본 거래 행 대신 저장되는 소형 요약.
 * 저장 payload를 수 KB 수준으로 줄인다(거래 id 중복 제거 후 산출).
 */
export interface CostelAgg {
  months: CostelMonthAgg[]
  chargers: PerChargerUsage[]
  /** 최근 12개월 연간 집계(있을 때) */
  annual?: CostelAnnual
}

/** 업로드되어 파싱·분류된 개별 파일 */
export interface FileEntry {
  id: string
  dataset: Dataset
  /** 파일명에서 기간을 제거한 분류 기준(카테고리) */
  category: string
  /** 파일명에서 추출한 기간. 인식 실패 시 null */
  period: Period | null
  /** 코스텔 충전내역 사전 집계(저장용). 있으면 원본 행 대신 이 값으로 분석. */
  costel?: CostelAgg
}

/** 같은 카테고리로 묶인 파일 그룹 */
export interface FileGroup {
  category: string
  /** 기간순으로 정렬된 파일들 */
  files: FileEntry[]
  /** 그룹 내 모든 파일 컬럼의 합집합 */
  columns: string[]
  /** 그룹 내 모든 행을 이어붙인 통합 데이터셋 */
  combined: Dataset
}

/** 기간 비교 표에서 사용할 집계 방식 */
export type AggKind = 'sum' | 'mean' | 'count'
