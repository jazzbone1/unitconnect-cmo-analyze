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

/** 원시 레코드 배열을 컬럼 순서를 보존한 Dataset으로 변환한다. */
function toDataset(
  records: Record<string, unknown>[],
  headerOrder: string[],
  fileName: string,
): Dataset {
  const columns = headerOrder.filter((c) => c !== '' && c != null)
  const rows = records.map((rec) => {
    const row: Record<string, CellValue> = {}
    for (const col of columns) {
      row[col] = normalizeCell(rec[col])
    }
    return row
  })
  return { columns, rows, fileName }
}

/** CSV 텍스트를 파싱한다. */
export function parseCsv(text: string, fileName: string): Dataset {
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    dynamicTyping: true,
  })
  if (result.errors.length > 0) {
    // 치명적이지 않은 에러는 콘솔에만 남기고 파싱 결과는 사용한다.
    console.warn('CSV 파싱 경고:', result.errors.slice(0, 5))
  }
  const headerOrder = result.meta.fields ?? []
  return toDataset(result.data, headerOrder, fileName)
}

/** Excel(xls/xlsx) 파일을 파싱한다. 첫 번째 시트를 사용한다. */
export function parseExcel(buffer: ArrayBuffer, fileName: string): Dataset {
  const wb = XLSX.read(buffer, { type: 'array' })
  const firstSheetName = wb.SheetNames[0]
  if (!firstSheetName) {
    throw new Error('Excel 파일에 시트가 없습니다.')
  }
  const sheet = wb.Sheets[firstSheetName]
  // defval:null 로 빈 셀을 명시적으로 채워 컬럼 정렬을 안정화한다.
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  })
  // 헤더 순서는 시트의 첫 행에서 직접 추출한다.
  const headerRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    range: 0,
  })
  const headerOrder = ((headerRows[0] as unknown[]) ?? []).map((h) =>
    h == null ? '' : String(h),
  )
  return toDataset(records, headerOrder, fileName)
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
