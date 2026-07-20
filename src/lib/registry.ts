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

// 저장 시 제거할 개인정보 컬럼 (차량번호는 중복제거용으로 유지)
function isStorePiiCol(column: string): boolean {
  const n = norm(column)
  if (n === '동' || n === '호' || n === '세대' || n === '세대주') return true
  return [
    '사용자',
    '성명',
    '이름',
    '고객명',
    '건물',
    '연락처',
    '전화',
    '휴대',
    '주민',
    '스마트',
    'email',
    '이메일',
    '메일',
  ].some((p) => n.includes(p))
}

// 테스트/서비스 계정을 나타내는 값 패턴
const TEST_PATTERN = /test|costel|코스텔/i

/**
 * 명부를 저장/업로드용으로 개인정보 제거한다.
 *  1) test/costel 행 제거 (이름·건물명 값이 필요하므로 컬럼 제거 전에 수행)
 *  2) 개인정보 컬럼(이름·건물·동·호·전화·스마트카드·이메일) 제거
 * 차량번호·차종·번호 등은 중복제거·집계용으로 유지한다.
 */
export function sanitizeRegistry(dataset: Dataset): Dataset {
  const keep = dataset.columns.filter((c) => !isStorePiiCol(c))
  const rows = dataset.rows
    .filter((r) => !isTestRow(r))
    .map((r) => {
      const o: Record<string, CellValue> = {}
      for (const c of keep) o[c] = r[c] ?? null
      return o
    })
  return { ...dataset, columns: keep, rows }
}

// 분석 표시에서 숨길 컬럼 판별
// (동·호·스마트키(카드)·전화·사용자명·건물명·차량번호·이메일)
function isHiddenCol(column: string): boolean {
  const n = norm(column)
  if (n === '동' || n === '호') return true
  if (n.includes('스마트') || n.includes('전화')) return true
  if (n.includes('사용자') || n.includes('건물')) return true
  if (n.includes('차량번호')) return true
  if (n.includes('email') || n.includes('이메일') || n.includes('메일')) return true
  return false
}

/** 자유 입력된 차종 문자열을 대표 명칭으로 통합한다. (best-effort) */
export function canonicalVehicle(raw: unknown): string {
  if (raw == null) return '(미상)'
  const orig = String(raw).trim()
  if (orig === '') return '(미상)'
  let n = orig.toLowerCase().replace(/\s+/g, '')
  // 표기 통일
  n = n
    .replace(/tesla|태슬라/g, '테슬라')
    .replace(/모텔/g, '모델')
    .replace(/model/g, '모델')
    .replace(/benz|mercedes/g, '벤츠')
    .replace(/porsche|포르셰|포르세/g, '포르쉐')

  const rules: [RegExp, string][] = [
    // 테슬라 모델
    [/^(테슬라모델y|모델y|테슬라y)$/, '테슬라 모델Y'],
    [/^(테슬라모델3|모델3|테슬라3)$/, '테슬라 모델3'],
    [/^(테슬라모델x|모델x)$/, '테슬라 모델X'],
    [/^(테슬라모델s|모델s)$/, '테슬라 모델S'],
    [/테슬라/, '테슬라'],
    // 현대·기아·제네시스
    [/아이오닉9/, '아이오닉9'],
    [/아이오닉6/, '아이오닉6'],
    [/아이오닉5/, '아이오닉5'],
    [/아이오닉/, '아이오닉'],
    [/ev9/, 'EV9'],
    [/ev6/, 'EV6'],
    [/ev4/, 'EV4'],
    [/ev3/, 'EV3'],
    [/캐스퍼|케스퍼/, '캐스퍼'],
    [/코나/, '코나'],
    [/gv60/, 'GV60'],
    [/gv70/, 'GV70'],
    [/쏘울/, '쏘울'],
    // BMW
    [/bmw|bmx|ix[0-9]|^x[0-9]|^i[0-9]$|530e|740e/, 'BMW'],
    // 벤츠
    [/벤츠|eq[abe]|glc|gle|e클래스|^e[0-9]|e300/, '벤츠'],
    // 포르쉐
    [/포르쉐|타이칸/, '포르쉐'],
    // 기타 브랜드
    [/byd/, 'BYD'],
    [/폴스타|폴스/, '폴스타'],
    [/볼보|^c40$|^xc[0-9]/, '볼보'],
    [/아우디|q4etron|q4/, '아우디'],
    [/렉서스|nx450/, '렉서스'],
    [/토레스/, '토레스'],
    [/미니|mini/, '미니'],
    [/푸조|e208/, '푸조'],
    [/레인지로버|레인지/, '레인지로버'],
    [/봉고/, '봉고'],
    [/세보|쉐보레/, '쉐보레'],
    [/id4|id\.4/, '폭스바겐 ID.4'],
  ]
  for (const [re, name] of rules) {
    if (re.test(n)) return name
  }
  return orig
}

export interface VehicleTypeCount {
  type: string
  count: number
  /** 이 대표 명칭으로 통합된 원본 입력 명칭들 (대수 내림차순) */
  variants: { name: string; count: number }[]
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

  // 차종별 대수 (자유 입력 명칭을 대표 명칭으로 통합)
  // 각 대표 명칭으로 합쳐진 원본 입력 명칭도 함께 집계한다.
  const typeMap = new Map<string, number>()
  const variantMap = new Map<string, Map<string, number>>()
  if (typeCol) {
    for (const row of cleaned) {
      const t = canonicalVehicle(row[typeCol])
      typeMap.set(t, (typeMap.get(t) ?? 0) + 1)
      const raw = row[typeCol] == null ? '(미상)' : String(row[typeCol]).trim() || '(미상)'
      if (!variantMap.has(t)) variantMap.set(t, new Map())
      const vm = variantMap.get(t)!
      vm.set(raw, (vm.get(raw) ?? 0) + 1)
    }
  }
  const byVehicleType = [...typeMap.entries()]
    .map(([type, count]) => ({
      type,
      count,
      variants: [...(variantMap.get(type) ?? new Map()).entries()]
        .map(([name, c]) => ({ name, count: c as number }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => a.type.localeCompare(b.type, 'ko'))

  // 표시 컬럼 = 개인정보 제외 + 통합차종 컬럼 추가
  const baseColumns = allColumns.filter((c) => !isHiddenCol(c))
  const displayColumns = typeCol
    ? [...baseColumns, '통합차종']
    : baseColumns
  const rows = cleaned.map((r) => {
    const o: Record<string, CellValue> = {}
    for (const c of baseColumns) o[c] = r[c] ?? null
    if (typeCol) o['통합차종'] = canonicalVehicle(r[typeCol])
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
