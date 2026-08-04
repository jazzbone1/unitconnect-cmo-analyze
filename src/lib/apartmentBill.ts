// 아파트 전기요금 고지서 분석.
//  - 계약 형태(주택용 누진 / 일반용 TOU 등)에 따라 기본료 + 구간별 부과 요금으로 정리.
//  - 고지서 OCR(billOcr.recognizeBill)로 요약 금액을 자동 인식하고,
//    구간별 사용량은 계약 형태 프리셋 + 누진 자동배분으로 구성한다.

import type { SeasonRates } from './tariff'
import { SEASON_MONTHS } from './tariff'

let seq = 0
const rid = () => `apt${(seq++).toString(36)}${Math.max(1, seq).toString(36)}`

/** 계절 선택 (연간=가중 평균) */
export type Season = 'annual' | 'spring' | 'summer' | 'winter'

export const SEASON_LABELS: Record<Season, string> = {
  annual: '연간(계절 가중)',
  spring: '봄·가을',
  summer: '여름(7·8월)',
  winter: '겨울(11~2월)',
}

/** 계절 가중 평균 (봄가을5·여름3·겨울4 / 12) */
export function seasonWeightedUnit(u: SeasonRates): number {
  const { spring, summer, winter } = SEASON_MONTHS
  return (
    (u.spring * spring + u.summer * summer + u.winter * winter) /
    (spring + summer + winter)
  )
}

/** 구간의 해당 계절 단가 */
export function effUnit(t: RateTier, season: Season): number {
  if (t.units)
    return season === 'annual' ? seasonWeightedUnit(t.units) : t.units[season]
  return t.unit
}

/** 구간의 해당 계절 누진 상한(주택용). 하계는 확대, 연간은 월수 가중 */
export function effCap(t: RateTier, season: Season): number | null {
  if (t.caps) {
    const { normal, summer } = t.caps
    if (season === 'summer') return summer
    if (season === 'annual') {
      if (normal == null || summer == null) return null
      // 하계 2개월 / 그 외 10개월 가중
      return (normal * 10 + summer * 2) / 12
    }
    return normal // 봄가을·겨울 = 기타계절
  }
  return t.cap
}

/** 계약 종별 */
export type ContractType =
  | 'housing_low' // 주택용 저압
  | 'housing_high' // 주택용 고압(아파트 종합계약 세대)
  | 'general_low' // 일반용(을) 저압
  | 'general_high' // 일반용(을) 고압A

export const CONTRACT_LABELS: Record<ContractType, string> = {
  housing_low: '주택용 저압 (누진 3단계)',
  housing_high: '주택용 고압 (누진 3단계·아파트)',
  general_low: '일반용(을) 저압 (계약전력·TOU)',
  general_high: '일반용(을) 고압A (계약전력·TOU)',
}

/** 부과 구간 (누진 단계 또는 TOU 시간대) */
export interface RateTier {
  id: string
  /** 구간명 (예: '1단계 0~200kWh', '경부하') */
  name: string
  /** 이 구간 사용량 (kWh) */
  kwh: number
  /** 단가 (원/kWh) */
  unit: number
  /** 누진 상한(kWh). 누진 자동배분에 사용. 무제한이면 null */
  cap: number | null
  /** 이 단계 도달 시 적용되는 기본요금 (원). 누진 기본요금용, 없으면 무시 */
  base?: number
  /** TOU 시간대 사용량 비율(0~1). 총 사용량 자동배분에 사용 */
  ratio?: number
  /** 계절별 단가 (봄가을/여름/겨울). 있으면 계절 가중/선택에 사용 */
  units?: SeasonRates
  /** 계절별 누진 상한 (기타계절/하계). 주택용 하계 확대 반영 */
  caps?: { normal: number | null; summer: number | null }
}

export interface ApartmentBillInputs {
  contractType: ContractType
  /** 계약전력 (kW) — 일반용 기본요금 산정 */
  contractKw: number
  /** 기본요금 (원) — 고지서/직접 */
  baseCharge: number
  /** 부과 구간 (누진/TOU) */
  tiers: RateTier[]
  /** 기후환경요금 (원) */
  climate: number
  /** 연료비조정액 (원) */
  fuel: number
  /** 부가가치세 (원) */
  vat: number
  /** 전력산업기반기금 (원) */
  fund: number
  /** 원단위 절사 (원, 보통 음수) */
  round: number
  /** 고지서 표기 총 사용량 (kWh) — 참고/누진 자동배분 기준 */
  usageKwh: number
  /** 계절 기준 (annual=연간 가중, 또는 특정 계절) */
  season: Season
  /** 가구수(세대수) — 아파트 종합계약 세대별 누진 산정 */
  households: number
  /** 세대별 누진 적용 여부 (주택용 종합계약). true면 세대평균에 누진 적용 후 ×세대수 */
  perHousehold: boolean
}

/** 선택 계절에 맞춰 각 구간의 단가·누진상한을 설정한다. */
export function applySeasonTiers(
  tiers: RateTier[],
  season: Season,
): RateTier[] {
  return tiers.map((t) => ({
    ...t,
    unit: Math.round(effUnit(t, season) * 10) / 10,
    cap: effCap(t, season),
  }))
}

/** 계약 종별 기본 구간 프리셋 (2024 기준 근사값, 편집 가능) */
export function tierPreset(type: ContractType): {
  baseCharge: number
  contractKw: number
  tiers: RateTier[]
} {
  switch (type) {
    case 'housing_low': {
      // 주택용 단가는 계절 무관, 하계(7·8월) 누진 구간 확대(200→300, 200→150)
      const u = (v: number): SeasonRates => ({ spring: v, summer: v, winter: v })
      return {
        baseCharge: 910,
        contractKw: 0,
        tiers: [
          mkTier('1단계 (0~200 / 하계 0~300)', 120.0, u(120.0), { normal: 200, summer: 300 }, 910),
          mkTier('2단계 (201~400 / 하계 301~450)', 214.6, u(214.6), { normal: 200, summer: 150 }, 1600),
          mkTier('3단계 (400 초과 / 하계 450 초과)', 307.3, u(307.3), { normal: null, summer: null }, 7300),
        ],
      }
    }
    case 'housing_high': {
      const u = (v: number): SeasonRates => ({ spring: v, summer: v, winter: v })
      return {
        baseCharge: 730,
        contractKw: 0,
        tiers: [
          mkTier('1단계 (0~200 / 하계 0~300)', 105.0, u(105.0), { normal: 200, summer: 300 }, 730),
          mkTier('2단계 (201~400 / 하계 301~450)', 174.0, u(174.0), { normal: 200, summer: 150 }, 1260),
          mkTier('3단계 (400 초과 / 하계 450 초과)', 242.3, u(242.3), { normal: null, summer: null }, 6060),
        ],
      }
    }
    case 'general_low':
      // 일반용(을) 저압 근사 — 계절 TOU (봄가을/여름/겨울)
      return {
        baseCharge: 0,
        contractKw: 0,
        tiers: [
          mkTouTier('경부하', { spring: 80.2, summer: 89.8, winter: 99.4 }, APT_TOU_RATIO.light),
          mkTouTier('중간부하', { spring: 91, summer: 129.9, winter: 118.4 }, APT_TOU_RATIO.mid),
          mkTouTier('최대부하', { spring: 94.9, summer: 151.2, winter: 132.4 }, APT_TOU_RATIO.peak),
        ],
      }
    case 'general_high':
    default:
      // 일반용(을) 고압A 선택II 근사 — 계절 TOU
      return {
        baseCharge: 0,
        contractKw: 0,
        tiers: [
          mkTouTier('경부하', { spring: 80.2, summer: 78.2, winter: 95.2 }, APT_TOU_RATIO.light),
          mkTouTier('중간부하', { spring: 91, summer: 113, winter: 105.5 }, APT_TOU_RATIO.mid),
          mkTouTier('최대부하', { spring: 94.9, summer: 198.6, winter: 172.4 }, APT_TOU_RATIO.peak),
        ],
      }
  }
}

/** 누진 단계 tier 생성 (연간 가중 단가·상한을 기본값으로) */
function mkTier(
  name: string,
  unit: number,
  units: SeasonRates,
  caps: { normal: number | null; summer: number | null },
  base: number,
): RateTier {
  const capAnnual =
    caps.normal == null || caps.summer == null
      ? null
      : Math.round(((caps.normal * 10 + caps.summer * 2) / 12) * 10) / 10
  return { id: rid(), name, kwh: 0, unit, cap: capAnnual, base, units, caps }
}

/** TOU tier 생성 (연간 가중 단가를 기본값으로) */
function mkTouTier(name: string, units: SeasonRates, ratio: number): RateTier {
  return {
    id: rid(),
    name,
    kwh: 0,
    unit: Math.round(seasonWeightedUnit(units) * 10) / 10,
    cap: null,
    ratio,
    units,
  }
}

/** 아파트 일반적 TOU 시간대 사용 비율 기본값 (경/중/최대) */
export const APT_TOU_RATIO = { light: 0.3, mid: 0.4, peak: 0.3 }

/** TOU 비율(ratio)이 있는 구간에 총 사용량을 비율대로 배분한다. */
export function distributeByRatio(
  tiers: RateTier[],
  totalKwh: number,
): RateTier[] {
  const sum = tiers.reduce((a, t) => a + (t.ratio ?? 0), 0)
  if (sum <= 0) return tiers
  return tiers.map((t) => ({
    ...t,
    kwh: Math.round((totalKwh * (t.ratio ?? 0)) / sum),
  }))
}

/** 주택용 등 누진(cap이 있는) 구간에 총 사용량을 자동 배분한다. */
export function distributeProgressive(
  tiers: RateTier[],
  totalKwh: number,
): RateTier[] {
  let remain = totalKwh
  return tiers.map((t) => {
    if (t.cap == null) {
      const k = Math.max(0, remain)
      remain = 0
      return { ...t, kwh: Math.round(k) }
    }
    const k = Math.max(0, Math.min(remain, t.cap))
    remain -= k
    return { ...t, kwh: Math.round(k) }
  })
}

/** 누진 기본요금: 사용량이 도달한 최상위 단계의 기본요금. 단계 기본요금이 없으면 null */
export function reachedBaseCharge(tiers: RateTier[]): number | null {
  let base: number | null = null
  for (const t of tiers) {
    if ((t.kwh || 0) > 0 && t.base != null) base = t.base
  }
  // 사용량이 전혀 없으면 1단계 기본요금
  if (base == null) {
    const first = tiers.find((t) => t.base != null)
    base = first?.base ?? null
  }
  return base
}

export interface TierResult extends RateTier {
  /** 구간 세대당 사용량 (kWh) — perHousehold일 때 세대평균, 아니면 전체 */
  kwhPerHh: number
  /** 구간 총 사용량 (kWh) = 세대당 × 세대수 */
  kwhTotal: number
  /** 구간 총 부과 금액 (원) = 세대당 사용량 × 단가 × 세대수 */
  amount: number
}

export interface ApartmentBillResult {
  tiers: TierResult[]
  /** 세대별 누진 적용 여부 */
  perHousehold: boolean
  /** 적용 세대수 (perHousehold 아니면 1) */
  hh: number
  /** 세대당 평균 사용량 (kWh) */
  perHhKwh: number
  /** 구간 총 사용량 합계 (kWh) */
  tierKwh: number
  /** 전력량요금 합계 (원) */
  energyTotal: number
  /** 기본료 (원) */
  baseCharge: number
  /** 공급가액(기본+전력량+기후+연료) (원) */
  supply: number
  /** 청구금액(부가세·기금·절사 포함) (원) */
  total: number
  /** 유효단가(청구금액 기준) 원/kWh */
  effPerKwh: number
  /** 기본료 비중 (%) */
  baseShare: number
  /** 전력량요금 비중 (%) */
  energyShare: number
}

export function computeApartmentBill(
  i: ApartmentBillInputs,
): ApartmentBillResult {
  // 아파트 종합계약(주택용): 세대평균에 누진 적용 후 세대수를 곱한다.
  const hh = i.perHousehold && i.households > 0 ? i.households : 1
  const tiers: TierResult[] = i.tiers.map((t) => {
    const kwhPerHh = t.kwh || 0
    return {
      ...t,
      kwhPerHh,
      kwhTotal: kwhPerHh * hh,
      amount: kwhPerHh * (t.unit || 0) * hh,
    }
  })
  const perHhKwh = tiers.reduce((a, t) => a + t.kwhPerHh, 0)
  const tierKwh = tiers.reduce((a, t) => a + t.kwhTotal, 0)
  const energyTotal = tiers.reduce((a, t) => a + t.amount, 0)
  const supply = i.baseCharge + energyTotal + i.climate + i.fuel
  const total = supply + i.vat + i.fund + i.round
  const qty = tierKwh > 0 ? tierKwh : i.usageKwh
  const effPerKwh = qty > 0 ? total / qty : 0
  const denom = i.baseCharge + energyTotal
  return {
    tiers,
    perHousehold: i.perHousehold && i.households > 0,
    hh,
    perHhKwh,
    tierKwh,
    energyTotal,
    baseCharge: i.baseCharge,
    supply,
    total,
    effPerKwh,
    baseShare: denom > 0 ? (i.baseCharge / denom) * 100 : 0,
    energyShare: denom > 0 ? (energyTotal / denom) * 100 : 0,
  }
}

export function defaultApartmentBill(): ApartmentBillInputs {
  const p = tierPreset('general_high')
  return {
    contractType: 'general_high',
    contractKw: 0,
    baseCharge: 0,
    tiers: p.tiers,
    climate: 0,
    fuel: 0,
    vat: 0,
    fund: 0,
    round: 0,
    usageKwh: 0,
    season: 'annual',
    households: 0,
    perHousehold: false,
  }
}

export function newTier(): RateTier {
  return { id: rid(), name: '', kwh: 0, unit: 0, cap: null }
}

/** 일반용(을) 계약전력 기반 표준 기본요금 단가 (원/kW·월). */
export const STANDARD_BASE_UNIT: Partial<Record<ContractType, number>> = {
  general_low: 6490,
  general_high: 8320,
}

/**
 * 기본요금 단가(원/kW) 산정:
 *  - 고지서/값이 있으면 실측 = 기본요금 ÷ 계약전력 (계약형태 무관)
 *  - 없으면: 일반용만 표준 단가. 주택용은 기본요금이 원/세대(누진)이라 원/kW 표준이
 *    없으므로, 누진 단계 기본요금과 계약전력을 입력해 실측으로 산정해야 함(=0 반환).
 */
export function baseUnitPerKw(a: ApartmentBillInputs): {
  value: number
  source: 'measured' | 'standard' | 'none'
} {
  if (a.baseCharge > 0 && a.contractKw > 0)
    return { value: a.baseCharge / a.contractKw, source: 'measured' }
  const std = STANDARD_BASE_UNIT[a.contractType]
  if (std != null) return { value: std, source: 'standard' }
  return { value: 0, source: 'none' } // 주택용: 계약전력 입력 필요
}
