// 대기전력 분석 — EPA Energy Star 기준 충전기 유형별 대기전력(W).
// 월 kWh = 대수 × W × 24h × 30d ÷ 1000, 월 비용 = 월 kWh × 실효 전기원가.

import type { ChargerType } from './settlement'

/** 충전기 유형(id)별 EPA 기준 대당 대기전력 (W) */
export const DEFAULT_STANDBY_W: Record<string, number> = {
  c3: 3, // 완속 3kW (OCPP 없음)
  c35: 5, // 완속 3.5kW
  c7: 5, // 완속 7kW
  c50: 85, // 급속 50kW (EPA DC EVSE 중간값)
  c100: 85, // 급속 100kW
}

export interface StandbyInputs {
  /** 유형(id)별 대당 대기전력 (W) — 편집 가능 */
  watt: Record<string, number>
  /** 적용 전기단가 직접입력 (원/kWh). 없으면 요금 구조의 실효원가 사용 */
  elecCostOverride?: number | null
}

export interface StandbyRow {
  id: string
  name: string
  count: number
  watt: number
  /** 월 대기전력량 (kWh) */
  monthlyKwh: number
  /** 월 비용 (원) */
  monthlyCost: number
}

export interface StandbyResult {
  rows: StandbyRow[]
  totalCount: number
  totalKwh: number
  totalCost: number
  annualKwh: number
  annualCost: number
  /** 대당 월비용 (원) = 월비용합 ÷ 전체대수 */
  perUnitMonthly: number
  /** 계산에 사용한 전기단가 (원/kWh) */
  elecCost: number
}

/** 720 = 24h × 30d */
const HOURS_PER_MONTH = 24 * 30

export function computeStandby(
  chargers: ChargerType[],
  inputs: StandbyInputs,
  effCost: number,
): StandbyResult {
  const elecCost =
    inputs.elecCostOverride != null && Number.isFinite(inputs.elecCostOverride)
      ? inputs.elecCostOverride
      : effCost

  const rows: StandbyRow[] = chargers.map((c) => {
    const watt = inputs.watt[c.id] ?? DEFAULT_STANDBY_W[c.id] ?? 0
    const count = c.count || 0
    const monthlyKwh = (count * watt * HOURS_PER_MONTH) / 1000
    return {
      id: c.id,
      name: c.name,
      count,
      watt,
      monthlyKwh,
      monthlyCost: monthlyKwh * elecCost,
    }
  })

  const totalCount = rows.reduce((a, r) => a + r.count, 0)
  const totalKwh = rows.reduce((a, r) => a + r.monthlyKwh, 0)
  const totalCost = rows.reduce((a, r) => a + r.monthlyCost, 0)

  return {
    rows,
    totalCount,
    totalKwh,
    totalCost,
    annualKwh: totalKwh * 12,
    annualCost: totalCost * 12,
    perUnitMonthly: totalCount > 0 ? totalCost / totalCount : 0,
    elecCost,
  }
}

export function defaultStandby(): StandbyInputs {
  return { watt: { ...DEFAULT_STANDBY_W }, elecCostOverride: null }
}
