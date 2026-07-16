import type {
  CellValue,
  ColumnSummary,
  ColumnType,
  Dataset,
} from '../types'

/** 셀 값을 숫자로 변환 시도. 불가하면 null. */
function toNumber(value: CellValue): number | null {
  if (value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  // 천단위 콤마 제거 후 파싱 (예: "1,234.5")
  const cleaned = value.replace(/,/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/**
 * 컬럼의 타입을 추론한다. 결측을 제외한 값 중 80% 이상이 숫자로
 * 변환되면 numeric, 아니면 categorical 로 본다.
 */
export function inferColumnType(values: CellValue[]): ColumnType {
  let nonMissing = 0
  let numericCount = 0
  for (const v of values) {
    if (v === null) continue
    nonMissing += 1
    if (toNumber(v) !== null) numericCount += 1
  }
  if (nonMissing === 0) return 'categorical'
  return numericCount / nonMissing >= 0.8 ? 'numeric' : 'categorical'
}

/** 정렬된 숫자 배열에서 선형보간 분위수를 계산한다 (0 <= p <= 1). */
function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  if (sorted.length === 1) return sorted[0]
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  const frac = idx - lo
  return sorted[lo] * (1 - frac) + sorted[hi] * frac
}

function summarizeNumeric(column: string, values: CellValue[]): ColumnSummary {
  const nums: number[] = []
  let missing = 0
  for (const v of values) {
    const n = toNumber(v)
    if (n === null) missing += 1
    else nums.push(n)
  }
  const count = nums.length
  if (count === 0) {
    return {
      type: 'numeric',
      column,
      count: 0,
      missing,
      mean: NaN,
      std: NaN,
      min: NaN,
      q1: NaN,
      median: NaN,
      q3: NaN,
      max: NaN,
    }
  }
  const sorted = [...nums].sort((a, b) => a - b)
  const sum = nums.reduce((acc, n) => acc + n, 0)
  const mean = sum / count
  // 표본 표준편차 (n-1). 값이 하나면 0.
  const variance =
    count > 1
      ? nums.reduce((acc, n) => acc + (n - mean) ** 2, 0) / (count - 1)
      : 0
  return {
    type: 'numeric',
    column,
    count,
    missing,
    mean,
    std: Math.sqrt(variance),
    min: sorted[0],
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q3: quantile(sorted, 0.75),
    max: sorted[count - 1],
  }
}

function summarizeCategorical(
  column: string,
  values: CellValue[],
): ColumnSummary {
  const freq = new Map<string, number>()
  let missing = 0
  let count = 0
  for (const v of values) {
    if (v === null) {
      missing += 1
      continue
    }
    count += 1
    const key = String(v)
    freq.set(key, (freq.get(key) ?? 0) + 1)
  }
  let top = ''
  let topFreq = 0
  for (const [key, f] of freq) {
    if (f > topFreq) {
      top = key
      topFreq = f
    }
  }
  return {
    type: 'categorical',
    column,
    count,
    missing,
    unique: freq.size,
    top,
    topFreq,
  }
}

/** 데이터셋의 모든 컬럼에 대한 요약 통계를 계산한다. */
export function summarizeDataset(dataset: Dataset): ColumnSummary[] {
  return dataset.columns.map((column) => {
    const values = dataset.rows.map((row) => row[column] ?? null)
    const type = inferColumnType(values)
    return type === 'numeric'
      ? summarizeNumeric(column, values)
      : summarizeCategorical(column, values)
  })
}

/** 표시용 숫자 포맷. 큰 수/작은 수를 적절히 반올림한다. */
export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Number.isInteger(n)) return n.toLocaleString('en-US')
  const abs = Math.abs(n)
  if (abs !== 0 && (abs < 0.001 || abs >= 1e9)) {
    return n.toExponential(2)
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 })
}
