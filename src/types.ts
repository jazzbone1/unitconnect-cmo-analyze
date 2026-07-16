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

/** 업로드되어 파싱·분류된 개별 파일 */
export interface FileEntry {
  id: string
  dataset: Dataset
  /** 파일명에서 기간을 제거한 분류 기준(카테고리) */
  category: string
  /** 파일명에서 추출한 기간. 인식 실패 시 null */
  period: Period | null
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
