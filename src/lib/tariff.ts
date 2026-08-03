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
  /** 기본요금 단가 (원/kW/월) */
  baseUnitPrice: number
  /** 계약전력 (kW) */
  contractKw: number
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
}

export interface TariffPlanResult {
  id: string
  name: string
  note: string
  /** 전력량요금 가중단가 (원/kWh) */
  weighted: number
  /** 실효 전기원가 (원/kWh) */
  effCost: number
  /** 운영손익분기 요금 (원/kWh) */
  breakeven: number
  /** 최저(자동선택 대상)인지 */
  isMin: boolean
}

export interface TariffResult {
  plans: TariffPlanResult[]
  /** kWh당 기본요금 환산 */
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

export function computeTariff(i: TariffInputs): TariffResult {
  const baseKwh =
    i.monthlyKwh > 0 ? (i.contractKw * i.baseUnitPrice) / i.monthlyKwh : 0

  const raw = TARIFF_PLANS.map((p) => {
    const weighted = p.flat
      ? seasonAvg(p.flat)
      : i.touLight * seasonAvg(p.tou!.light) +
        i.touMid * seasonAvg(p.tou!.mid) +
        i.touPeak * seasonAvg(p.tou!.peak)
    const effCost = round2(
      (weighted + i.climate + i.fuel + baseKwh) * (1 + i.vatRate + i.fundRate),
    )
    const breakeven = round2(effCost + (i.opexPerKwh || 0))
    return { id: p.id, name: p.name, note: p.note, weighted, effCost, breakeven }
  })

  const minWeighted = Math.min(...raw.map((r) => r.weighted))
  const plans: TariffPlanResult[] = raw.map((r) => ({
    ...r,
    isMin: r.weighted === minWeighted,
  }))

  const autoIdx = plans.findIndex((p) => p.isMin)
  const selectedIdx =
    i.manualPlan != null && i.manualPlan >= 0 && i.manualPlan < plans.length
      ? i.manualPlan
      : autoIdx
  const selected = plans[selectedIdx]
  const marginRoom = i.currentRate - selected.breakeven

  return { plans, baseKwh, selectedIdx, selected, marginRoom }
}

/** 기본값 (문서 예시 기준, 모두 편집 가능) */
export function defaultTariff(): TariffInputs {
  return {
    touLight: 0.5693,
    touMid: 0.1664,
    touPeak: 0.2643,
    baseUnitPrice: 2580,
    contractKw: 0,
    monthlyKwh: 0,
    climate: 9,
    fuel: 5,
    fundRate: 0.027,
    vatRate: 0,
    currentRate: 249,
    opexPerKwh: 0,
    manualPlan: null,
  }
}
