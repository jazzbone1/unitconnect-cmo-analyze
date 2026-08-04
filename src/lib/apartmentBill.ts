// 아파트 전기요금 고지서 분석.
//  - 계약 형태(주택용 누진 / 일반용 TOU 등)에 따라 기본료 + 구간별 부과 요금으로 정리.
//  - 고지서 OCR(billOcr.recognizeBill)로 요약 금액을 자동 인식하고,
//    구간별 사용량은 계약 형태 프리셋 + 누진 자동배분으로 구성한다.

let seq = 0
const rid = () => `apt${(seq++).toString(36)}${Math.max(1, seq).toString(36)}`

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
}

/** 계약 종별 기본 구간 프리셋 (2024 기준 근사값, 편집 가능) */
export function tierPreset(type: ContractType): {
  baseCharge: number
  contractKw: number
  tiers: RateTier[]
} {
  switch (type) {
    case 'housing_low':
      return {
        baseCharge: 910,
        contractKw: 0,
        tiers: [
          { id: rid(), name: '1단계 (0~200kWh)', kwh: 0, unit: 120.0, cap: 200, base: 910 },
          { id: rid(), name: '2단계 (201~400kWh)', kwh: 0, unit: 214.6, cap: 200, base: 1600 },
          { id: rid(), name: '3단계 (400kWh 초과)', kwh: 0, unit: 307.3, cap: null, base: 7300 },
        ],
      }
    case 'housing_high':
      return {
        baseCharge: 730,
        contractKw: 0,
        tiers: [
          { id: rid(), name: '1단계 (0~200kWh)', kwh: 0, unit: 105.0, cap: 200, base: 730 },
          { id: rid(), name: '2단계 (201~400kWh)', kwh: 0, unit: 174.0, cap: 200, base: 1260 },
          { id: rid(), name: '3단계 (400kWh 초과)', kwh: 0, unit: 242.3, cap: null, base: 6060 },
        ],
      }
    case 'general_low':
      return {
        baseCharge: 0,
        contractKw: 0,
        tiers: [
          { id: rid(), name: '경부하', kwh: 0, unit: 92.0, cap: null, ratio: APT_TOU_RATIO.light },
          { id: rid(), name: '중간부하', kwh: 0, unit: 120.0, cap: null, ratio: APT_TOU_RATIO.mid },
          { id: rid(), name: '최대부하', kwh: 0, unit: 150.0, cap: null, ratio: APT_TOU_RATIO.peak },
        ],
      }
    case 'general_high':
    default:
      return {
        baseCharge: 0,
        contractKw: 0,
        tiers: [
          { id: rid(), name: '경부하', kwh: 0, unit: 86.9, cap: null, ratio: APT_TOU_RATIO.light },
          { id: rid(), name: '중간부하', kwh: 0, unit: 112.0, cap: null, ratio: APT_TOU_RATIO.mid },
          { id: rid(), name: '최대부하', kwh: 0, unit: 141.0, cap: null, ratio: APT_TOU_RATIO.peak },
        ],
      }
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
  /** 구간 부과 금액 = 사용량 × 단가 */
  amount: number
}

export interface ApartmentBillResult {
  tiers: TierResult[]
  /** 구간 사용량 합계 (kWh) */
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
  const tiers: TierResult[] = i.tiers.map((t) => ({
    ...t,
    amount: (t.kwh || 0) * (t.unit || 0),
  }))
  const tierKwh = tiers.reduce((a, t) => a + (t.kwh || 0), 0)
  const energyTotal = tiers.reduce((a, t) => a + t.amount, 0)
  const supply = i.baseCharge + energyTotal + i.climate + i.fuel
  const total = supply + i.vat + i.fund + i.round
  const qty = tierKwh > 0 ? tierKwh : i.usageKwh
  const effPerKwh = qty > 0 ? total / qty : 0
  const denom = i.baseCharge + energyTotal
  return {
    tiers,
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
  }
}

export function newTier(): RateTier {
  return { id: rid(), name: '', kwh: 0, unit: 0, cap: null }
}
