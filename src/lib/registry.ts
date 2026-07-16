import type { CellValue, Dataset } from '../types'

/** 공백 제거 + 소문자화 */
function norm(s: string): string {
  return s.replace(/\s/g, '').toLowerCase()
}

/** 이름에 needle 중 하나라도 포함하는 첫 컬럼을 찾는다. */
function findCol(columns: string[], needles: string[]): string | null {
  for (const col of columns) {
    const c = norm(col)
    if (needles.some((n) => c.includes(norm(n)))) return col
  }
  return null
}

/** 차량번호 컬럼이 있으면 이용자(차량 등록) 명부로 본다. */
export function detectRegistry(dataset: Dataset): boolean {
  return findCol(dataset.columns, ['차량번호', '차량 번호', '차번']) !== null
}

// 테스트/서비스 계정을 나타내는 값 패턴
const TEST_PATTERN = /test|costel|코스텔/i

// 분석 표시에서 숨길 컬럼 판별 (동·호·스마트키(카드)·전화)
function isHiddenCol(column: string): boolean {
  const n = norm(column)
  if (n === '동' || n === '호') return true
  return n.includes('스마트') || n.includes('전화')
}

export interface VehicleTypeCount {
  type: string
  count: number
}

export interface RegistryResult {
  /** 표시용 컬럼 (개인정보 숨김 적용) */
  displayColumns: string[]
  /** 정제·중복제거된 행 (표시용 컬럼만) */
  rows: Record<string, CellValue>[]
  /** 전체 등록 인원 (정제 후 행 수) */
  totalPeople: number
  /** 등록 차량 수 (고유 차량번호 수) */
  totalVehicles: number
  /** 제거된 test/costel 행 수 */
  removedTest: number
  /** 제거된 중복 차량 행 수 */
  removedDup: number
  /** 차종별 대수 (내림차순) */
  byVehicleType: VehicleTypeCount[]
  /** 합쳐진 원본 파일 수 */
  sourceCount: number
}

/** 여러 컬럼 집합의 합집합(첫 등장 순서 보존) */
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

/** 행의 어느 셀이든 test/costel 값을 포함하면 테스트 계정으로 본다. */
function isTestRow(row: Record<string, CellValue>): boolean {
  for (const v of Object.values(row)) {
    if (v != null && TEST_PATTERN.test(String(v))) return true
  }
  return false
}

/**
 * 이용자 명부 파일들을 합쳐 정제한다.
 *  1) test/costel 행 제거
 *  2) 차량번호 기준 중복 제거 (첫 건만 유지)
 *  3) 분석 표시용으로 동·호·스마트키·전화 컬럼 숨김
 */
export function computeRegistry(datasets: Dataset[]): RegistryResult {
  const allColumns = unionColumns(datasets)
  const vehicleCol = findCol(allColumns, ['차량번호', '차량 번호', '차번'])
  const typeCol = findCol(allColumns, ['차종', '차량종류', '모델'])

  // 모든 파일의 행을 합친다.
  const combined: Record<string, CellValue>[] = []
  for (const ds of datasets) {
    for (const r of ds.rows) {
      const row: Record<string, CellValue> = {}
      for (const c of allColumns) row[c] = c in r ? r[c] : null
      combined.push(row)
    }
  }

  let removedTest = 0
  let removedDup = 0
  const seen = new Set<string>()
  const cleaned: Record<string, CellValue>[] = []

  for (const row of combined) {
    if (isTestRow(row)) {
      removedTest += 1
      continue
    }
    const rawV = vehicleCol ? row[vehicleCol] : null
    const key = rawV != null ? String(rawV).replace(/\s/g, '') : ''
    if (key !== '') {
      if (seen.has(key)) {
        removedDup += 1
        continue
      }
      seen.add(key)
    }
    cleaned.push(row)
  }

  // 차종별 대수
  const typeMap = new Map<string, number>()
  if (typeCol) {
    for (const row of cleaned) {
      const v = row[typeCol]
      const t = v == null || String(v).trim() === '' ? '(미상)' : String(v).trim()
      typeMap.set(t, (typeMap.get(t) ?? 0) + 1)
    }
  }
  const byVehicleType = [...typeMap.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)

  const displayColumns = allColumns.filter((c) => !isHiddenCol(c))
  const rows = cleaned.map((r) => {
    const o: Record<string, CellValue> = {}
    for (const c of displayColumns) o[c] = r[c] ?? null
    return o
  })

  return {
    displayColumns,
    rows,
    totalPeople: cleaned.length,
    totalVehicles: seen.size,
    removedTest,
    removedDup,
    byVehicleType,
    sourceCount: datasets.length,
  }
}

/** 정제 결과를 Excel 호환 CSV 문자열(UTF-8 BOM)로 만든다. */
export function registryToCsv(result: RegistryResult): string {
  const esc = (v: CellValue) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = result.displayColumns.map(esc).join(',')
  const lines = result.rows.map((r) =>
    result.displayColumns.map((c) => esc(r[c] ?? null)).join(','),
  )
  return '﻿' + [header, ...lines].join('\r\n')
}
