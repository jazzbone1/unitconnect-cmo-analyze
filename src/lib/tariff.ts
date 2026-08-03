// 요금 구조 분석 — 한전 고압 TOU 요금제(선택 I~IV) 기반 실효 전기원가 산출.
// 가중단가 = Σ(TOU비중 × 계절가중 × 요금), 계절가중 = 봄가을5·여름3·겨울4 / 12.
// 실효원가 = ROUND((가중단가 + 기후 + 연료 + 기본요금kWh) × (1+VAT+기금), 2).

export interface SeasonRates {
  /** 봄가을 (원/kWh) */
  spring: number
  /** 여름 */
  summer: number
  /** 겨울 */
  winter: number
}

export interface TariffPlan {
  id: string
  name: string
  note: string
  /** TOU 요금제(선택 I~III): 경/중/최대 부하별 계절요금 */
  tou?: { light: SeasonRates; mid: SeasonRates; peak: SeasonRates }
  /** 단일요금제(선택 IV): 전체시간 계절요금 */
  flat?: SeasonRates
}

/** 계절 월수 가중치 (봄가을 5 · 여름 3 · 겨울 4, 합 12) */
export const SEASON_MONTHS = { spring: 5, summer: 3, winter: 4 }

/** 한전 고압 TOU 요금표 (2025.01 시행, 원/kWh) */
export const TARIFF_PLANS: TariffPlan[] = [
  {
    id: 'I',
    name: '선택I',
    note: '가동률 200h 이하 유리',
    tou: {
      light: { spring: 80.2, summer: 89.8, winter: 99.4 },
      mid: { spring: 91, summer: 129.9, winter: 118.4 },
      peak: { spring: 94.9, summer: 151.2, winter: 132.4 },
    },
  },
  {
    id: 'II',
    name: '선택II',
    note: '가동률 200~500h 유리',
    tou: {
      light: { spring: 80.2, summer: 78.2, winter: 95.2 },
      mid: { spring: 91, summer: 113, winter: 105.5 },
      peak: { spring: 94.9, summer: 198.6, winter: 172.4 },
    },
  },
  {
    id: 'III',
    name: '선택III',
    note: '가동률 500h 이상 유리',
    tou: {
      light: { spring: 80.2, summer: 84.5, winter: 103.6 },
      mid: { spring: 91, summer: 111.9, winter: 104.5 },
      peak: { spring: 94.9, summer: 174, winter: 151.6 },
    },
  },
  {
    id: 'IV',
    name: '선택IV',
    note: '시간대 구분 없음',
    flat: { spring: 91, summer: 137.4, winter: 127.7 },
  },
]

export interface TariffInputs {
  /** TOU 비중 — 경부하 */
  touLight: number
  /** TOU 비중 — 중간부하 */
  touMid: number
  /** TOU 비중 — 최대부하 */
  touPeak: number
  /** 기본요금 단가 (원/kW/월) — 선택별 미지정 시 공통값 */
  baseUnitPrice: number
  /** 선택별 기본요금 단가 (원/kW/월). 없으면 baseUnitPrice 사용 */
  baseUnitByPlan?: Record<string, number>
  /** (구) 계약전력 (kW) — 하위호환. 신규는 installedKw×contractRatio 사용 */
  contractKw: number
  /** 총 설비용량 (kW) */
  installedKw?: number
  /** 계약전력 비율(수용률) — 계약전력 = 설비용량 × 비율 */
  contractRatio?: number
  /** 월 총 충전량 (kWh) */
  monthlyKwh: number
  /** 기후환경요금 (원/kWh) */
  climate: number
  /** 연료비조정액 (원/kWh) */
  fuel: number
  /** 전력산업기반기금율 (예: 0.027) */
  fundRate: number
  /** 부가세율 (VAT 제외 원칙이면 0) */
  vatRate: number
  /** 현재 가중평균 충전요금 (원/kWh) — 마진 여유 비교용 */
  currentRate: number
  /** 운영비 (원/kWh) — 운영손익분기 계산용 (선택) */
  opexPerKwh: number
  /** 수동 요금제 선택 (0~3), 없으면 자동(최저) */
  manualPlan?: number | null
  /** 적정 계약전력 판정 기준 목표 부하율 (예: 0.20 = 20%) */
  targetLoadFactor?: number
  /** 계약전력 안전 마진 (예: 0.15 = 추정 피크 +15%) */
  contractMargin?: number
  /** 설비 기반 추정용 예상 동시충전율 (예: 0.40 = 설비의 40% 동시가동) */
  expectedDemandFactor?: number
  /** 고지서 실측 입력 (참고용, 다른 계산에 자동반영 안 함) */
  bill?: BillInputs
}

export interface TariffPlanResult {
  id: string
  name: string
  note: string
  /** 전력량요금 가중단가 (원/kWh) */
  weighted: number
  /** 이 선택의 기본요금 단가 (원/kW) */
  baseUnit: number
  /** 이 선택의 kWh당 기본요금 환산 */
  baseKwh: number
  /** 실효 전기원가 (원/kWh) */
  effCost: number
  /** 운영손익분기 요금 (원/kWh) */
  breakeven: number
  /** 최저(자동선택 대상)인지 — 실효원가 최저 */
  isMin: boolean
}

export interface TariffResult {
  plans: TariffPlanResult[]
  /** 적용 계약전력 (kW) = 설비용량 × 비율 */
  contractKw: number
  /** 선택된 요금제의 kWh당 기본요금 환산 */
  baseKwh: number
  /** 선택된 요금제 인덱스 */
  selectedIdx: number
  selected: TariffPlanResult
  /** 운영 마진 여유 = 현재요금 − 운영손익분기 */
  marginRoom: number
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** 계절 가중 평균 (봄가을5·여름3·겨울4 / 12) */
export function seasonAvg(r: SeasonRates): number {
  const { spring, summer, winter } = SEASON_MONTHS
  return (r.spring * spring + r.summer * summer + r.winter * winter) / 12
}

/** 적용 계약전력: 설비용량×비율(신규) 또는 구 contractKw(하위호환) */
export function effectiveContractKw(i: TariffInputs): number {
  if (i.installedKw != null)
    return i.installedKw * (i.contractRatio != null ? i.contractRatio : 1)
  return i.contractKw
}

export function computeTariff(i: TariffInputs): TariffResult {
  const contractKw = effectiveContractKw(i)

  const raw = TARIFF_PLANS.map((p) => {
    const weighted = p.flat
      ? seasonAvg(p.flat)
      : i.touLight * seasonAvg(p.tou!.light) +
        i.touMid * seasonAvg(p.tou!.mid) +
        i.touPeak * seasonAvg(p.tou!.peak)
    // 선택별 기본요금 단가 (없으면 공통값)
    const baseUnit = i.baseUnitByPlan?.[p.id] ?? i.baseUnitPrice
    const baseKwh = i.monthlyKwh > 0 ? (contractKw * baseUnit) / i.monthlyKwh : 0
    const effCost = round2(
      (weighted + i.climate + i.fuel + baseKwh) * (1 + i.vatRate + i.fundRate),
    )
    const breakeven = round2(effCost + (i.opexPerKwh || 0))
    return {
      id: p.id,
      name: p.name,
      note: p.note,
      weighted,
      baseUnit,
      baseKwh,
      effCost,
      breakeven,
    }
  })

  // 최적 선택 = 실효원가(기본요금 포함) 최저
  const minEff = Math.min(...raw.map((r) => r.effCost))
  const plans: TariffPlanResult[] = raw.map((r) => ({
    ...r,
    isMin: r.effCost === minEff,
  }))

  const autoIdx = plans.findIndex((p) => p.isMin)
  const selectedIdx =
    i.manualPlan != null && i.manualPlan >= 0 && i.manualPlan < plans.length
      ? i.manualPlan
      : autoIdx
  const selected = plans[selectedIdx]
  const marginRoom = i.currentRate - selected.breakeven

  return {
    plans,
    contractKw,
    baseKwh: selected.baseKwh,
    selectedIdx,
    selected,
    marginRoom,
  }
}

/** 기본값 (문서 예시 기준, 모두 편집 가능) */
export function defaultTariff(): TariffInputs {
  return {
    touLight: 0.5693,
    touMid: 0.1664,
    touPeak: 0.2643,
    baseUnitPrice: 2580,
    baseUnitByPlan: { I: 2580, II: 2580, III: 2580, IV: 2580 },
    contractKw: 0,
    installedKw: 0,
    contractRatio: 1,
    monthlyKwh: 0,
    climate: 9,
    fuel: 5,
    fundRate: 0.027,
    vatRate: 0,
    currentRate: 249,
    opexPerKwh: 0,
    manualPlan: null,
    targetLoadFactor: 0.18, // EV 아파트 충전 실측 대역(15~20%) 기준값
    contractMargin: 0.15, // 추정 최대수요전력 + 15% 여유
    expectedDemandFactor: 0.4, // 설비 기반 추정용 예상 동시충전율
  }
}

/** 월 시간수 (24h × 30d) */
export const HOURS_PER_MONTH = 24 * 30

/** 부하율 = 월충전량 ÷ (계약전력 × 720) */
export function loadFactor(contractKw: number, monthlyKwh: number): number {
  return contractKw > 0 && monthlyKwh > 0
    ? monthlyKwh / (contractKw * HOURS_PER_MONTH)
    : 0
}

/**
 * 고지서 실측 입력 — 청구내역을 그대로 넣어 실효원가를 직접 산출한다.
 * (추정 없이 실측이 곧 결과. 다른 분석/항목에는 자동 반영하지 않음)
 */
export interface BillInputs {
  basic: number // 기본요금
  energy: number // 전력량요금
  climate: number // 기후환경요금
  fuel: number // 연료비조정액
  powerFactor: number // 역률요금 (감액이면 음수)
  vat: number // 부가가치세
  fund: number // 전력기금
  round: number // 원단위절사 (보통 음수)
  usageKwh: number // 사용량 (kWh)
  contractKw: number // 계약전력 (고지서 표기, kW)
  /** 이 계약에 해당하는 충전기 설비용량 (kW) — 선택 입력 */
  installedKw?: number
}

export interface BillResult {
  supply: number // 전기요금계 (VAT·기금 제외)
  total: number // 당월요금계 (전부 포함)
  effExclVat: number // 실효원가 (VAT·기금 제외) 원/kWh
  effInclVat: number // 실효원가 (전부 포함) 원/kWh
  loadFactor: number // 부하율
  properContractKw: number // 참고 적정 계약전력 (기준 부하율 18%)
  /** 수용률 = 계약전력 ÷ 설비용량 (설비용량 입력 시) */
  demandFactor: number | null
  /** 계약초과 리스크: 없음/낮음/있음/미상 */
  overRisk: '없음' | '낮음' | '있음' | '미상'
  perKwh: {
    basic: number
    energy: number
    climate: number
    fuel: number
    powerFactor: number
  }
}

export function computeBill(b: BillInputs): BillResult {
  const supply = b.basic + b.energy + b.climate + b.fuel + b.powerFactor
  const total = supply + b.vat + b.fund + b.round
  const q = b.usageKwh
  const per = (x: number) => (q > 0 ? x / q : 0)
  const properContractKw = q > 0 ? q / (0.18 * HOURS_PER_MONTH) : 0
  const installed = b.installedKw ?? 0
  const demandFactor =
    installed > 0 && b.contractKw > 0 ? b.contractKw / installed : null

  // 계약초과 리스크: 이론 최대 피크 ≤ 설비용량
  //  - 계약전력 ≥ 설비용량 → 초과 불가(없음)
  //  - 계약전력 ≥ 추정 피크(사용량 기반) → 낮음
  //  - 그 외 → 있음
  let overRisk: BillResult['overRisk'] = '미상'
  if (installed > 0 && b.contractKw > 0) {
    if (b.contractKw >= installed) overRisk = '없음'
    else if (b.contractKw >= properContractKw) overRisk = '낮음'
    else overRisk = '있음'
  }

  return {
    supply,
    total,
    effExclVat: per(supply),
    effInclVat: per(total),
    loadFactor: loadFactor(b.contractKw, q),
    properContractKw,
    demandFactor,
    overRisk,
    perKwh: {
      basic: per(b.basic),
      energy: per(b.energy),
      climate: per(b.climate),
      fuel: per(b.fuel),
      powerFactor: per(b.powerFactor),
    },
  }
}

export function defaultBill(): BillInputs {
  return {
    basic: 0,
    energy: 0,
    climate: 0,
    fuel: 0,
    powerFactor: 0,
    vat: 0,
    fund: 0,
    round: 0,
    usageKwh: 0,
    contractKw: 0,
  }
}
