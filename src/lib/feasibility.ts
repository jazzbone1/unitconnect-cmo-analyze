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
  /** 전체(공통) 충전단가 VAT 포함 (원/kWh) */
  rateVat: number
  // 종류별 충전단가 VAT 포함 (0이면 전체 단가 사용)
  rateFast100: number
  rateFast50: number
  rateSlow7: number
  rateSlow35: number
  rateSlow3: number
  // 종류별 이용률
  utilFast100: number
  utilFast50: number
  utilSlow7: number
  utilSlow35: number
  utilSlow3: number
  // 종류별 대수
  countFast100: number
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
  /** 영업비 차감/대 (충전단가 하락 검토용) */
  bizFeeDiscount: number
  /** 영업이익 포기율 (0~1) */
  profitGiveupRate: number
  /** 모자분리 CAPEX (원/대) */
  mojaBunri: number
  /** 미니PC CAPEX (원/단지) */
  miniPc: number
  /** 기본 대당 월 운영비 항목 */
  opex: OpexItem[]
  /** 추가 대당 월 운영비 항목 (사용자 추가) */
  opexExtra: OpexItem[]
}

// 고정 상수
export const ELEC_COST = 147 // 전기원가 (VAT 제외) 원/kWh
export const PG_RATE = 0.0235 // PG 수수료율

// 종류별 월 최대 충전량(kWh) = 정격 × 720시간
const MAX_MONTHLY = {
  fast100: 100 * 720, // 72000
  fast50: 50 * 720, // 36000
  slow7: 7 * 720, // 5040
  slow35: 3.5 * 720, // 2520
  slow3: 3 * 720, // 2160
}

// 영업이익률 목표 테이블 (계약년수 1~5)
const TARGET_MARGIN_HIGH = [0.1136, 0.1526, 0.1712, 0.1841, 0.1941] // 단가 ≥ 244
const TARGET_MARGIN_LOW = [0.0775, 0.1181, 0.1376, 0.1509, 0.1613] // 단가 < 244

// 기본 대당 월 운영비 항목 (유닛커넥트 기준)
export const DEFAULT_OPEX: OpexItem[] = [
  { id: 'op1', label: '감리·정기·긴급점검 (현장인력 0.5명)', monthly: 1000, included: true },
  { id: 'op2', label: 'CS 운영 (야간) 1명', monthly: 1750, included: true },
  { id: 'op3', label: '원격모니터링+CS (주간) 1명', monthly: 1750, included: true },
  { id: 'op4', label: '보험 (손해배상책임 4,000원/대)', monthly: 4000 / 12, included: true },
  { id: 'op5', label: '대수선비 (소모품·충전기 교체)', monthly: 5000, included: true },
  { id: 'op6', label: '트러스테이 (CCTV)', monthly: 543, included: true },
]

/** 계약년수에 따른 영업비 1대분 기본 단가 (100,000 × 년수) */
export function defaultBizFee(years: number): number {
  const y = Math.max(1, Math.min(5, Math.round(years)))
  return y * 100000
}

/** 「1. 영업이익 기준」 테이블 (계약기간별 영업비·영업이익률 목표) */
export const PROFIT_STANDARD = [
  { years: 1, bizFee: 100000, marginHigh: 0.1136, marginLow: 0.0775 },
  { years: 2, bizFee: 200000, marginHigh: 0.1526, marginLow: 0.1181 },
  { years: 3, bizFee: 300000, marginHigh: 0.1712, marginLow: 0.1376 },
  { years: 4, bizFee: 400000, marginHigh: 0.1841, marginLow: 0.1509 },
  { years: 5, bizFee: 500000, marginHigh: 0.1941, marginLow: 0.1613 },
]

/** 충전단가 유닛커넥트 기준: 244원 이상이면 249, 미만이면 239 */
export function standardRate(rateVat: number): number {
  return rateVat >= 244 ? 249 : 239
}

/** 유닛커넥트 기준(변경금지) 표준값 */
export const STD = {
  utilFast100: 0.0098,
  utilFast50: 0.0098,
  utilSlow7: 0.07,
  utilSlow35: 0.14,
  utilSlow3: 49 / 300,
  yearUtil2: 0.08,
  yearUtil3: 0.09,
  yearUtil4: 0.1,
  yearUtil5: 0.11,
  mojaBunri: 50000,
  miniPc: 800000,
}

/** 계약년수·단가 기준 영업이익률 목표 */
export function standardTargetMargin(years: number, rateVat: number): number {
  const idx = Math.max(1, Math.min(5, Math.round(years))) - 1
  return rateVat >= 244
    ? PROFIT_STANDARD[idx].marginHigh
    : PROFIT_STANDARD[idx].marginLow
}

export function DEFAULT_INPUTS(): FeasibilityInputs {
  return {
    years: 5,
    rateVat: 249,
    rateFast100: 0,
    rateFast50: 0,
    rateSlow7: 0,
    rateSlow35: 0,
    rateSlow3: 0,
    utilFast100: 0.0098,
    utilFast50: 0.0098,
    utilSlow7: 0.07,
    utilSlow35: 0.14,
    utilSlow3: 49 / 300, // ≈0.16333…
    countFast100: 0,
    countFast50: 0,
    countSlow7: 0,
    countSlow35: 0,
    countSlow3: 0,
    yearUtil2: 0.08,
    yearUtil3: 0.09,
    yearUtil4: 0.1,
    yearUtil5: 0.11,
    bizFeePerUnit: 500000,
    bizFeeDiscount: 0,
    profitGiveupRate: 0.01,
    mojaBunri: 50000,
    miniPc: 800000,
    opex: DEFAULT_OPEX.map((o) => ({ ...o })),
    opexExtra: [
      { id: 'ex1', label: '영업배상책임보험 (2만원/대)', monthly: 20000 / 12, included: false },
    ],
  }
}

export interface FeasibilityResult {
  totalUnits: number
  rateExVat: number
  consentRatio: number
  slow7Ratio: number
  convFactor: number
  /** 전체 이용률 (7kW 환산) */
  overallUtil7kw: number
  opexPerUnit: number
  opexBasic: number
  opexExtra: number
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
  /** 영업이익률=목표 달성 충전단가 (VAT포함), 달성불가 시 null */
  targetRate: number | null
  // ③ 영업비 차감 → 충전단가 인하
  savings: number // 영업비 절감액 (총)
  priceCutMargin: number | null // 영업이익률 유지 기준 인하폭
  rateAfterMargin: number | null // 인하 후 단가
  priceCutProfit: number | null // 영업이익 유지 기준 인하폭
  rateAfterProfit: number | null
  // ④ 영업이익 포기율 기반
  giveupAmount: number // 영업이익 포기 금액
  marginAfterGiveup: number // 영업이익률 − 포기율
  priceCutGiveup: number | null
  rateAfterGiveup: number | null
}

export function computeFeasibility(inp: FeasibilityInputs): FeasibilityResult {
  const c100 = inp.countFast100 ?? 0
  const total =
    c100 + inp.countFast50 + inp.countSlow7 + inp.countSlow35 + inp.countSlow3
  // 콘센트(3·3.5kW)만 대분 환산, 급속·초급속(50·100kW)은 0 대분
  const consentRatio = total > 0 ? (inp.countSlow3 + inp.countSlow35) / total : 0
  const slow7Ratio = total > 0 ? inp.countSlow7 / total : 0
  const convFactor = consentRatio / 4 + slow7Ratio
  const sumIncluded = (arr: OpexItem[]) =>
    arr.filter((o) => o.included).reduce((a, o) => a + o.monthly, 0)
  const opexBasic = sumIncluded(inp.opex)
  const opexExtra = sumIncluded(inp.opexExtra ?? [])
  const opexPerUnit = opexBasic + opexExtra

  // 종류별 월 기본 에너지(kWh)
  const e100 = c100 * MAX_MONTHLY.fast100 * (inp.utilFast100 ?? 0)
  const eFast = inp.countFast50 * MAX_MONTHLY.fast50 * inp.utilFast50
  const e7 = inp.countSlow7 * MAX_MONTHLY.slow7 * inp.utilSlow7
  const e35 = inp.countSlow35 * MAX_MONTHLY.slow35 * inp.utilSlow35
  const e3 = inp.countSlow3 * MAX_MONTHLY.slow3 * inp.utilSlow3
  const base = e100 + eFast + e7 + e35 + e3

  // 전체 이용률 (7kW 환산) = Σ(대수×이용률×정격/7) / 총대수
  const overallUtil7kw =
    total > 0
      ? (c100 * (inp.utilFast100 ?? 0) * (100 / 7) +
          inp.countFast50 * inp.utilFast50 * (50 / 7) +
          inp.countSlow7 * inp.utilSlow7 +
          inp.countSlow35 * inp.utilSlow35 * (3.5 / 7) +
          inp.countSlow3 * inp.utilSlow3 * (3 / 7)) /
        total
      : 0

  // 종류별 요금(0이면 전체 단가). 에너지 가중 평균으로 실효 단가 산출.
  const eff = (r: number) => (r > 0 ? r : inp.rateVat)
  const avgVat =
    base > 0
      ? (e100 * eff(inp.rateFast100 ?? 0) +
          eFast * eff(inp.rateFast50) +
          e7 * eff(inp.rateSlow7) +
          e35 * eff(inp.rateSlow35) +
          e3 * eff(inp.rateSlow3)) /
        base
      : inp.rateVat
  const rateExVat = avgVat / 1.1

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

  // 영업이익률과 목표를 소수점 한 자리(0.1%)까지 반올림해 비교한다.
  // 표시상 동일(예: 19.41% = 19.41%)한데 미세 소수 차이로 진행불가가 되는
  // 문제를 막기 위함 — 한 자리까지 같으면 진행가능으로 본다.
  const roundPct1 = (x: number) => Math.round(x * 1000) / 1000
  const verdict: FeasibilityResult['verdict'] =
    revenue === 0
      ? '-'
      : roundPct1(margin) >= roundPct1(targetMargin)
        ? '진행가능'
        : '진행불가'

  // VAT포함 단가로 환원하는 공통 분모 (1.1 배 포함)
  const priceCut = (numerator: number, marginAdj: number): number | null => {
    const denom = 12 * sumW * (1 - PG_RATE - marginAdj)
    if (denom <= 0) return null
    return (numerator / denom) * 1.1
  }

  // 목표 달성 충전단가
  const fixedCosts = -(elecCost + opsCost + bizCost + capex)
  const targetRate = (() => {
    const denom = 12 * sumW * (1 - PG_RATE - targetMargin)
    return denom <= 0 ? null : (fixedCosts / denom) * 1.1
  })()

  // ③ 영업비 차감 → 충전단가 인하
  const savings = (inp.bizFeeDiscount ?? 0) * convFactor * total
  const priceCutMargin = priceCut(savings, margin) // 영업이익률 유지
  const priceCutProfit = priceCut(savings, 0) // 영업이익(절대액) 유지
  const rateAfterMargin =
    priceCutMargin == null ? null : inp.rateVat - priceCutMargin
  const rateAfterProfit =
    priceCutProfit == null ? null : inp.rateVat - priceCutProfit

  // ④ 영업이익 포기율 기반
  const giveupRate = inp.profitGiveupRate ?? 0
  const giveupAmount = giveupRate * revenue
  const marginAfterGiveup = margin - giveupRate
  const priceCutGiveup = priceCut(giveupAmount, marginAfterGiveup)
  const rateAfterGiveup =
    priceCutGiveup == null ? null : inp.rateVat - priceCutGiveup

  return {
    totalUnits: total,
    rateExVat,
    consentRatio,
    slow7Ratio,
    convFactor,
    overallUtil7kw,
    opexPerUnit,
    opexBasic,
    opexExtra,
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
    targetRate,
    savings,
    priceCutMargin,
    rateAfterMargin,
    priceCutProfit,
    rateAfterProfit,
    giveupAmount,
    marginAfterGiveup,
    priceCutGiveup,
    rateAfterGiveup,
  }
}
