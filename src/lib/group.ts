import type {
  AggKind,
  CellValue,
  Dataset,
  FileEntry,
  FileGroup,
} from '../types'

/** 여러 데이터셋 컬럼의 합집합을 첫 등장 순서를 보존하며 만든다. */
function unionColumns(datasets: Dataset[]): string[] {
  const seen = new Set<string>()
  const cols: string[] = []
  for (const ds of datasets) {
    for (const c of ds.columns) {
      if (!seen.has(c)) {
        seen.add(c)
        cols.push(c)
      }
    }
  }
  return cols
}

/**
 * 그룹 내 파일들의 행을 이어붙여 통합 데이터셋을 만든다.
 * 컬럼은 합집합이며, 특정 파일에 없는 컬럼 값은 결측(null)으로 채운다.
 * 어느 파일에서 왔는지 추적할 수 있도록 "__파일" 컬럼을 앞에 추가한다.
 */
function combineFiles(category: string, files: FileEntry[]): Dataset {
  const datasets = files.map((f) => f.dataset)
  const dataCols = unionColumns(datasets)
  const SOURCE = '__파일'
  const columns = [SOURCE, ...dataCols]
  const rows: Record<string, CellValue>[] = []
  for (const f of files) {
    const label = f.period?.label ?? f.dataset.fileName
    for (const srcRow of f.dataset.rows) {
      const row: Record<string, CellValue> = { [SOURCE]: label }
      for (const c of dataCols) {
        row[c] = c in srcRow ? srcRow[c] : null
      }
      rows.push(row)
    }
  }
  return { columns, rows, fileName: category }
}

/** 파일 목록을 카테고리별로 그룹핑하고, 각 그룹의 통합 데이터셋을 만든다. */
export function groupFiles(files: FileEntry[]): FileGroup[] {
  const byCategory = new Map<string, FileEntry[]>()
  for (const f of files) {
    const list = byCategory.get(f.category) ?? []
    list.push(f)
    byCategory.set(f.category, list)
  }

  const groups: FileGroup[] = []
  for (const [category, list] of byCategory) {
    // 기간순 정렬. 기간 미인식(null)은 뒤로.
    const sorted = [...list].sort((a, b) => {
      const ka = a.period?.sortKey ?? Number.POSITIVE_INFINITY
      const kb = b.period?.sortKey ?? Number.POSITIVE_INFINITY
      if (ka !== kb) return ka - kb
      return a.dataset.fileName.localeCompare(b.dataset.fileName)
    })
    groups.push({
      category,
      files: sorted,
      columns: unionColumns(sorted.map((f) => f.dataset)),
      combined: combineFiles(category, sorted),
    })
  }

  // 파일 수가 많은 그룹을 먼저, 동수면 이름순
  groups.sort((a, b) => {
    if (b.files.length !== a.files.length) return b.files.length - a.files.length
    return a.category.localeCompare(b.category)
  })
  return groups
}

/** 셀 값을 숫자로 변환. 불가하면 null. (stats.ts와 동일 규칙) */
function toNumber(value: CellValue): number | null {
  if (value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const cleaned = value.replace(/,/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** 한 파일(행 배열)의 특정 컬럼을 주어진 방식으로 집계한다. */
export function aggregateColumn(
  rows: Record<string, CellValue>[],
  column: string,
  kind: AggKind,
): number | null {
  const nums: number[] = []
  for (const row of rows) {
    const n = toNumber(row[column] ?? null)
    if (n !== null) nums.push(n)
  }
  if (kind === 'count') return nums.length
  if (nums.length === 0) return null
  const sum = nums.reduce((acc, n) => acc + n, 0)
  return kind === 'sum' ? sum : sum / nums.length
}
