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
