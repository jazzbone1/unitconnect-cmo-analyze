import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { CellValue, Dataset } from '../types'

/** 빈 문자열/공백/undefined를 결측(null)으로 정규화한다. */
function normalizeCell(value: unknown): CellValue {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const s = String(value).trim()
  if (s === '') return null
  return s
}

/** 셀을 문자열로 (공백 제거) */
function cellText(v: unknown): string {
  return v == null ? '' : String(v).trim()
}

/** 값이 숫자(또는 숫자 형태 문자열)인지 */
function isNumericLike(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v)
  if (typeof v === 'string') {
    const s = v.replace(/,/g, '').trim()
    return s !== '' && Number.isFinite(Number(s))
  }
  return false
}

// 헤더 행에 흔히 등장하는 키워드(도메인 특화) — 감지 정확도 향상용
const HEADER_KEYWORDS = [
  '번호',
  '사용자',
  '건물',
  '동',
  '호',
  '사용횟수',
  '사용량',
  '사용금액',
  '금액',
  '차량',
  '차종',
  '스마트',
  '전화',
  '이메일',
  'email',
  'id',
  '일시',
  '일자',
  '날짜',
  '충전',
  '이름',
  '명',
  '세대',
  '주소',
]

/**
 * 헤더 행 위치를 자동 감지한다.
 * 상단에 "설치구역/검색기간" 같은 메타 행이 있어도 실제 헤더 행을 찾는다.
 * 규칙: 앞쪽 여러 행 중 (열 개수 많고 · 텍스트 위주 · 헤더 키워드 포함 · 숫자 적음)
 * 점수가 가장 높은 행을 헤더로 본다.
 */
function detectHeaderRow(aoa: unknown[][]): number {
  const N = Math.min(aoa.length, 25)
  let best = 0
  let bestScore = -Infinity
  for (let i = 0; i < N; i++) {
    const cells = aoa[i] ?? []
    const nonEmpty = cells.map(cellText).filter((s) => s !== '')
    if (nonEmpty.length < 2) continue
    const numeric = nonEmpty.filter((s) => isNumericLike(s)).length
    const textual = nonEmpty.length - numeric
    const kw = nonEmpty.filter((s) => {
      const low = s.toLowerCase()
      return HEADER_KEYWORDS.some((k) => low.includes(k))
    }).length
    // 너비 + 텍스트 위주 + 키워드 가점 − 숫자 감점
    const score = nonEmpty.length + textual * 0.5 + kw * 4 - numeric * 1.5
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}

/** 2차원 배열(행렬)을 헤더 자동 감지 후 Dataset으로 변환한다. */
function aoaToDataset(aoa: unknown[][], fileName: string): Dataset {
  const headerIdx = detectHeaderRow(aoa)
  const headerCells = (aoa[headerIdx] ?? []).map(cellText)

  // 헤더 이름(빈 칸 제외, 중복은 접미사) + 원본 열 인덱스 매핑
  const columns: string[] = []
  const colIndex: number[] = []
  const seen = new Map<string, number>()
  headerCells.forEach((name, idx) => {
    if (name === '') return
    let col = name
    const prev = seen.get(name)
    if (prev) {
      const n = prev + 1
      seen.set(name, n)
      col = `${name} (${n})`
    } else {
      seen.set(name, 1)
    }
    columns.push(col)
    colIndex.push(idx)
  })

  const rows: Record<string, CellValue>[] = []
  for (let r = headerIdx + 1; r < aoa.length; r++) {
    const cells = aoa[r] ?? []
    // 전 칸이 비어있으면 건너뛴다.
    if (colIndex.every((ci) => cellText(cells[ci]) === '')) continue
    const row: Record<string, CellValue> = {}
    columns.forEach((col, k) => {
      row[col] = normalizeCell(cells[colIndex[k]])
    })
    rows.push(row)
  }
  return { columns, rows, fileName }
}

/** CSV 텍스트를 파싱한다. (헤더 위치 자동 감지) */
export function parseCsv(text: string, fileName: string): Dataset {
  const result = Papa.parse<unknown[]>(text, {
    header: false,
    skipEmptyLines: 'greedy',
    dynamicTyping: true,
  })
  if (result.errors.length > 0) {
    console.warn('CSV 파싱 경고:', result.errors.slice(0, 5))
  }
  return aoaToDataset(result.data as unknown[][], fileName)
}

/** Excel(xls/xlsx) 파일을 파싱한다. 첫 번째 시트를 사용한다. (헤더 위치 자동 감지) */
export function parseExcel(buffer: ArrayBuffer, fileName: string): Dataset {
  const wb = XLSX.read(buffer, { type: 'array' })
  const firstSheetName = wb.SheetNames[0]
  if (!firstSheetName) {
    throw new Error('Excel 파일에 시트가 없습니다.')
  }
  const sheet = wb.Sheets[firstSheetName]
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: false,
  })
  return aoaToDataset(aoa, fileName)
}

/** 파일 확장자에 따라 적절한 파서를 선택해 Dataset을 반환한다. */
export async function parseFile(file: File): Promise<Dataset> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = await file.text()
    return parseCsv(text, file.name)
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buffer = await file.arrayBuffer()
    return parseExcel(buffer, file.name)
  }
  throw new Error(
    '지원하지 않는 파일 형식입니다. CSV 또는 Excel(.xlsx, .xls) 파일을 올려주세요.',
  )
}
