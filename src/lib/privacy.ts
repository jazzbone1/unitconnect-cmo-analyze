import type { CellValue, Dataset } from '../types'

// 정확히 일치하면 개인정보로 보고 제외할 컬럼명
const PII_EXACT = new Set(['동', '호', '세대', '세대주'])
// 이 문자열을 포함하면 개인정보로 보고 제외
const PII_CONTAINS = [
  '사용자',
  '성명',
  '이름',
  '고객명',
  '건물',
  '연락처',
  '전화',
  '휴대',
  '주민',
]

function isPii(column: string): boolean {
  const n = column.replace(/\s/g, '')
  if (PII_EXACT.has(n)) return true
  return PII_CONTAINS.some((p) => n.includes(p))
}

/**
 * 개인정보 컬럼(사용자명·건물명·동·호 등)을 제거한 데이터셋을 반환한다.
 * 이런 컬럼이 없으면 원본을 그대로 반환한다.
 */
export function stripPii(dataset: Dataset): Dataset {
  const keep = dataset.columns.filter((c) => !isPii(c))
  if (keep.length === dataset.columns.length) return dataset
  const rows = dataset.rows.map((row) => {
    const out: Record<string, CellValue> = {}
    for (const c of keep) out[c] = row[c] ?? null
    return out
  })
  return { ...dataset, columns: keep, rows }
}
