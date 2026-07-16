/** 사업성 분석(영업비 산정) 입력·계산 로직. CMO 영업비 산정 VER 1.1 재현. */

export interface OpexItem {
  id: string
  label: string
  /** 대당 월 비용 (원) */
  monthly: number
  /** 대당 월 운영비 합계에 포함 여부 */
  included: boolean
}

export interface FeasibilityInputs {
  /** 계약년수 (1~5) */
  years: number
  /** 충전단가 VAT 포함 (원/kWh) */
  rateVat: number
  // 종류별 이용률
  utilFast50: number
  utilSlow7: number
  utilSlow35: number
  utilSlow3: number
  // 종류별 대수
  countFast50: number
  countSlow7: number
  countSlow35: number
  countSlow3: number
  // 연차별 이용률 (7kW 환산) — 2~5년차
  yearUtil2: number
  yearUtil3: number
  yearUtil4: number
  yearUtil5: number
  /** 영업비 1대분 단가 (원/대) */
  bizFeePerUnit: number
  /** 모자분리 CAPEX (원/대) */
  mojaBunri: number
  /** 미니PC CAPEX (원/단지) */
  miniPc: number
  /** 대당 월 운영비 항목 */
  opex: OpexItem[]
}

// 고정 상수
export const ELEC_COST = 147 // 전기원가 (VAT 제외) 원/kWh
export const PG_RATE = 0.0235 // PG 수수료율

// 종류별 월 최대 충전량(kWh) = 정격 × 720시간
const MAX_MONTHLY = {
  fast50: 50 * 720, // 36000
  slow7: 7 * 720, // 5040
  slow35: 3.5 * 720, // 2520
  slow3: 3 * 720, // 2160
}

// 영업이익률 목표 테이블 (계약년수 1~5)
const TARGET_MARGIN_HIGH = [0.1136, 0.1526, 0.1712, 0.1841, 0.1941] // 단가 ≥ 244
const TARGET_MARGIN_LOW = [0.0775, 0.1181, 0.1376, 0.1509, 0.1613] // 단가 < 244

export const DEFAULT_OPEX: OpexItem[] = [
  { id: 'op1', label: '감리·정기·긴급점검 (현장인력 0.5명)', monthly: 1000, included: true },
  { id: 'op2', label: 'CS 운영 (야간) 1명', monthly: 1750, included: true },
  { id: 'op3', label: '원격모니터링+CS (주간) 1명', monthly: 1750, included: true },
  { id: 'op4', label: '보험 (손해배상책임 4,000원/대)', monthly: 4000 / 12, included: true },
  { id: 'op5', label: '대수선비 (소모품·충전기 교체)', monthly: 5000, included: true },
  { id: 'op6', label: '트러스테이 (CCTV)', monthly: 543, included: true },
  { id: 'op7', label: '영업배상책임보험 (2만원/대)', monthly: 20000 / 12, included: false },
]

/** 계약년수에 따른 영업비 1대분 기본 단가 (100,000 × 년수) */
export function defaultBizFee(years: number): number {
  const y = Math.max(1, Math.min(5, Math.round(years)))
  return y * 100000
}

export function DEFAULT_INPUTS(): FeasibilityInputs {
  return {
    years: 5,
    rateVat: 249,
    utilFast50: 0.0098,
    utilSlow7: 0.07,
    utilSlow35: 0.14,
    utilSlow3: 49 / 300, // ≈0.16333…
    countFast50: 0,
    countSlow7: 0,
    countSlow35: 0,
    countSlow3: 0,
    yearUtil2: 0.08,
    yearUtil3: 0.09,
    yearUtil4: 0.1,
    yearUtil5: 0.11,
    bizFeePerUnit: 500000,
    mojaBunri: 50000,
    miniPc: 800000,
    opex: DEFAULT_OPEX.map((o) => ({ ...o })),
  }
}

export interface FeasibilityResult {
  totalUnits: number
  rateExVat: number
  consentRatio: number
  slow7Ratio: number
  convFactor: number
  opexPerUnit: number
  baseMonthlyW: number
  yearlyW: number[] // 1~5년차
  sumW: number
  revenue: number
  pgFee: number
  elecCost: number
  grossProfit: number
  opsCost: number
  bizCost: number
  capex: number
  operatingProfit: number
  margin: number
  targetMargin: number
  verdict: '진행가능' | '진행불가' | '-'
}

export function computeFeasibility(inp: FeasibilityInputs): FeasibilityResult {
  const total =
    inp.countFast50 + inp.countSlow7 + inp.countSlow35 + inp.countSlow3
  const rateExVat = inp.rateVat / 1.1
  const consentRatio = total > 0 ? (inp.countSlow3 + inp.countSlow35) / total : 0
  const slow7Ratio = total > 0 ? inp.countSlow7 / total : 0
  const convFactor = consentRatio / 4 + slow7Ratio
  const opexPerUnit = inp.opex
    .filter((o) => o.included)
    .reduce((a, o) => a + o.monthly, 0)

  const base =
    inp.countFast50 * MAX_MONTHLY.fast50 * inp.utilFast50 +
    inp.countSlow7 * MAX_MONTHLY.slow7 * inp.utilSlow7 +
    inp.countSlow35 * MAX_MONTHLY.slow35 * inp.utilSlow35 +
    inp.countSlow3 * MAX_MONTHLY.slow3 * inp.utilSlow3

  const yearUtil = [inp.yearUtil2, inp.yearUtil3, inp.yearUtil4, inp.yearUtil5]
  const yearlyW: number[] = []
  for (let y = 1; y <= 5; y++) {
    if (y > inp.years) {
      yearlyW.push(0)
    } else if (y === 1) {
      yearlyW.push(base)
    } else {
      // 2~5년차: 7kW 환산 이용률 성장분 반영
      const yu = yearUtil[y - 2]
      yearlyW.push(base + MAX_MONTHLY.slow7 * (yu - inp.utilSlow7) * total)
    }
  }
  const sumW = yearlyW.reduce((a, w) => a + w, 0)

  const revenue = 12 * rateExVat * sumW
  const pgFee = -revenue * PG_RATE
  const elecCost = -12 * ELEC_COST * sumW
  const grossProfit = revenue + pgFee + elecCost
  const opsCost = -total * opexPerUnit * 3 * 4 * Math.min(inp.years, 5)
  const bizCost = -total * inp.bizFeePerUnit * convFactor
  const capex = -(total * inp.mojaBunri + inp.miniPc)
  const operatingProfit = grossProfit + opsCost + bizCost + capex
  const margin = revenue !== 0 ? operatingProfit / revenue : 0

  const yIdx = Math.max(1, Math.min(5, Math.round(inp.years))) - 1
  const targetMargin =
    inp.rateVat >= 244 ? TARGET_MARGIN_HIGH[yIdx] : TARGET_MARGIN_LOW[yIdx]

  const verdict: FeasibilityResult['verdict'] =
    revenue === 0 ? '-' : margin >= targetMargin ? '진행가능' : '진행불가'

  return {
    totalUnits: total,
    rateExVat,
    consentRatio,
    slow7Ratio,
    convFactor,
    opexPerUnit,
    baseMonthlyW: base,
    yearlyW,
    sumW,
    revenue,
    pgFee,
    elecCost,
    grossProfit,
    opsCost,
    bizCost,
    capex,
    operatingProfit,
    margin,
    targetMargin,
    verdict,
  }
}
