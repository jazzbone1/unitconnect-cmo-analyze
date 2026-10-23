import type { Dataset } from '../types'

/**
 * 코스텔 충전내역관리 프로그램 내보내기(거래 단위 로그) 어댑터.
 *
 * 기존 정산 형식(세대별 월 사용량이 미리 집계된 CSV)과 달리, 코스텔 충전내역은
 * 충전 '건별' 로그다(시작일시·충전량(kWh)·비용(원)·충전기구분(AC/DC/SOCKET)·동호).
 * 이 모듈은 코스텔 파일을 감지하고, 충전기 구분/모델로 종류(kW)를 추정한다.
 * 실제 월별 집계는 settlement.ts의 computeCostelFile 에서 수행한다.
 */

/** 공백 제거 + 소문자화 정규화 */
function norm(s: string): string {
  return s.replace(/\s/g, '').toLowerCase()
}

/** 이름에 needle 중 하나라도 포함하는 첫 컬럼을 찾는다. */
export function findCostelCol(
  columns: string[],
  needles: string[],
): string | null {
  for (const col of columns) {
    const c = norm(col)
    if (needles.some((n) => c.includes(norm(n)))) return col
  }
  return null
}

/** 코스텔 충전내역(거래 단위) 데이터셋인지 판별한다. */
export function detectCostel(dataset: Dataset): boolean {
  const cols = dataset.columns
  const hasEnergy = findCostelCol(cols, ['충전량', 'charging_energy']) !== null
  const hasType = findCostelCol(cols, ['충전기구분', 'charger_type']) !== null
  const hasStart = findCostelCol(cols, ['시작일시', 'charging_start']) !== null
  return hasEnergy && hasType && hasStart
}

/** 거래 로그의 주요 컬럼명 매핑(한글 우선, 없으면 원본 영문). */
export interface CostelCols {
  energy: string | null
  cost: string | null
  type: string | null
  model: string | null
  start: string | null
  dong: string | null
  noncharge: string | null
}
export function costelCols(dataset: Dataset): CostelCols {
  const c = dataset.columns
  return {
    energy: findCostelCol(c, ['충전량', 'charging_energy']),
    cost: findCostelCol(c, ['비용', 'payment_fee', 'charging_cost']),
    type: findCostelCol(c, ['충전기구분', 'charger_type']),
    model: findCostelCol(c, ['충전기모델', 'charger_model', 'model']),
    start: findCostelCol(c, ['시작일시', 'charging_start']),
    dong: findCostelCol(c, ['동호', 'customer_dong']),
    noncharge: findCostelCol(c, ['미충전', 'non_start_charging']),
  }
}

/**
 * 충전기 구분(AC/DC/SOCKET)과 모델코드로 종류(kW)를 추정한다.
 *  - SOCKET/콘센트 → 3kW (콘센트형 표준)
 *  - AC/완속 → 모델에 3.5 힌트 있으면 3.5kW, 아니면 7kW
 *  - DC/급속 → 모델에 100/200 힌트 있으면 100kW, 아니면 50kW
 * 앱의 고정 5종(3/3.5/7/50/100) 범위로 anchor 되어, 추정 실패해도
 * 구분 기준 안전한 기본값으로 수렴한다.
 */
export function chargerKwFromModelType(
  model: string | null | undefined,
  type: string | null | undefined,
): number {
  const t = norm(String(type ?? ''))
  const m = norm(String(model ?? ''))
  const isSocket = t.includes('socket') || t.includes('콘센트')
  const isDC = t.includes('dc') || t.includes('급속')
  const isAC = t.includes('ac') || t.includes('완속')
  if (isSocket) return 3
  if (isDC) {
    if (m.includes('200') || m.includes('100')) return 100
    return 50
  }
  if (isAC) {
    if (m.includes('3.5') || m.includes('35')) return 3.5
    return 7
  }
  // 구분 불명: 모델 숫자 힌트로 최후 추정
  if (m.includes('100') || m.includes('50')) return 50
  if (m.includes('3.5')) return 3.5
  return 7
}

/** 시작일시 문자열에서 'YYYY-MM' 과 정렬키(YYYYMM01)를 뽑는다. 실패 시 null. */
export function monthKeyOf(
  value: unknown,
): { ym: string; sortKey: number } | null {
  const s = String(value ?? '').trim()
  const m = s.match(/(\d{4})[-./](\d{1,2})/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  if (!(y >= 2000 && mo >= 1 && mo <= 12)) return null
  const ym = `${y}-${String(mo).padStart(2, '0')}`
  return { ym, sortKey: y * 10000 + mo * 100 + 1 }
}

/** 테스트/더미 세대(동호) 판별 — 999동·1234동 등 명백한 테스트값 제외용. */
export function isTestDong(dong: unknown): boolean {
  const s = String(dong ?? '').replace(/\s/g, '')
  if (s === '') return true
  return /999|1234/.test(s)
}
