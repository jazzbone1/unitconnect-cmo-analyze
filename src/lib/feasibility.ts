/** 사업성 분석(영업비 산정) 입력·계산 로직. CMO 영업비 산정 VER 1.1 재현. */

export interface OpexItem {
  id: string
  label: string
  /** 대당 월 비용 (원) */
  monthly: number
  /** 대당 월 운영비 합계에 포함 여부 */
  included: boolean
}

/** 추가 CAPEX 항목 (일회성). 단위: 대당 or 단지당. */
export interface CapexItem {
  id: string
  label: string
  /** 금액 (원) */
  amount: number
  /** 'unit'=원/대(대수 곱), 'site'=원/단지(1회) */
  unit: 'unit' | 'site'
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
  /**
   * 이용률 분산 계수(0~1). 설치 예정 충전기가 있으면 전체 수요를
   * (위차 적용 + 설치 예정) 충전기가 나눠 가지므로, 위차 적용 충전기의
   * 대당 이용률이 이 계수만큼 희석된다. 미지정 시 1(희석 없음).
   */
  utilShareFactor?: number
  // 종류별 대수
  countFast100: number
  countFast50: number
  countSlow7: number
  countSlow35: number
  countSlow3: number
  // 연차별 이용률 (7kW 환산) — 2~7년차
  yearUtil2: number
  yearUtil3: number
  yearUtil4: number
  yearUtil5: number
  yearUtil6?: number
  yearUtil7?: number
  /** 전기원가 (VAT 제외) 원/kWh — 기본 147, 수정 가능 */
  elecCostUnit?: number
  /** 전기원가 직접입력(override). null/미설정 시 요금구조 실효원가 자동 반영 */
  elecCostOverride?: number | null
  /**
   * 연차별 전기원가 모델의 계약전력 가정.
   * 'demandFixed'(기본): 수용률·계약전력 고정 → 이용률↑ 시 부하율 상승·실효원가 하락.
   * 'loadFactorFixed': 부하율 고정 → 계약전력을 충전량 비례로 증설·실효원가 일정.
   */
  elecYearMode?: 'demandFixed' | 'loadFactorFixed'
  /** 대기전력 전기원가를 사업성에 합산할지 여부 (기본 true) */
  includeStandby?: boolean
  /** 대기전력 반영 범위: 'separated'=모자분리 종류만(기본), 'all'=전체 종류 */
  standbyScope?: 'separated' | 'all'
  /** 모자분리 종류 월 대기전력량 (kWh) — 대기전력 탭에서 자동 주입 */
  standbyMonthlyKwhSeparated?: number
  /** 전체 종류 월 대기전력량 (kWh) — 대기전력 탭에서 자동 주입 */
  standbyMonthlyKwhAll?: number
  /** 영업비 1대분 단가 (원/대) */
  bizFeePerUnit: number
  /** 영업비 1대분 프로젝트별 override (원/대). null/미설정 시 공통 기준표 값 사용 */
  bizFeeOverride?: number | null
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
  /** 추가 CAPEX 항목 (사용자 추가, 일회성) */
  capexExtra?: CapexItem[]
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

// 영업이익률 목표 테이블 (계약년수 1~7)
// 6·7년차는 잠정적으로 5년차 값을 사용(추후 공식 기준값 수령 시 교체)
const TARGET_MARGIN_HIGH = [0.1136, 0.1526, 0.1712, 0.1841, 0.1941, 0.1941, 0.1941] // 단가 ≥ 244
const TARGET_MARGIN_LOW = [0.0775, 0.1181, 0.1376, 0.1509, 0.1613, 0.1613, 0.1613] // 단가 < 244
/** 지원하는 최대 계약년수 */
export const MAX_YEARS = 7

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
  const y = Math.max(1, Math.min(MAX_YEARS, Math.round(years)))
  return y * 100000
}

/** 「1. 영업이익 기준」 테이블 (계약기간별 영업비·영업이익률 목표) */
export const PROFIT_STANDARD = [
  { years: 1, bizFee: 100000, marginHigh: 0.1136, marginLow: 0.0775 },
  { years: 2, bizFee: 200000, marginHigh: 0.1526, marginLow: 0.1181 },
  { years: 3, bizFee: 300000, marginHigh: 0.1712, marginLow: 0.1376 },
  { years: 4, bizFee: 400000, marginHigh: 0.1841, marginLow: 0.1509 },
  { years: 5, bizFee: 500000, marginHigh: 0.1941, marginLow: 0.1613 },
  // 6·7년차: 잠정적으로 5년차 목표 영업이익률 사용
  { years: 6, bizFee: 600000, marginHigh: 0.1941, marginLow: 0.1613 },
  { years: 7, bizFee: 700000, marginHigh: 0.1941, marginLow: 0.1613 },
]

/** 충전단가 유닛커넥트 기준: 244원 이상이면 249, 미만이면 239 */
export function standardRate(rateVat: number): number {
  return rateVat >= 244 ? 249 : 239
}

/** 유닛커넥트 기준(변경금지) 표준값 */
export const STD = {
  utilFast100: 0.0049, // 7% × 7/100 (7kW 환산) = 50kW(0.98%)의 절반
  utilFast50: 0.0098,
  utilSlow7: 0.07,
  utilSlow35: 0.14,
  utilSlow3: 49 / 300,
  yearUtil2: 0.08,
  yearUtil3: 0.09,
  yearUtil4: 0.1,
  yearUtil5: 0.11,
  yearUtil6: 0.12,
  yearUtil7: 0.13,
  mojaBunri: 50000,
  miniPc: 800000,
}

/** 사업성 종류별 표준 이용률(기준값)을 관리하는 키(전역 공통·설정 탭). */
export const STD_UTIL_KEY = 'unitconnect.ui.feasibility.utilStandard'
/** 표준 이용률 기준값의 종류 키(소수=fraction, 0.07=7%). */
export type StdUtil = {
  utilFast100: number
  utilFast50: number
  utilSlow7: number
  utilSlow35: number
  utilSlow3: number
}
/** 기본(코드) 표준 이용률. */
export function defaultStdUtil(): StdUtil {
  return {
    utilFast100: STD.utilFast100,
    utilFast50: STD.utilFast50,
    utilSlow7: STD.utilSlow7,
    utilSlow35: STD.utilSlow35,
    utilSlow3: STD.utilSlow3,
  }
}
/**
 * 관리 중인 표준 이용률(설정 탭에서 저장 → localStorage 미러) 로드.
 * 서버 전역값이 앱 부팅 시 이 키로 미러링된다. 값이 없으면 코드 기본값.
 */
export function loadStdUtil(): StdUtil {
  const base = defaultStdUtil()
  try {
    const raw =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(STD_UTIL_KEY)
        : null
    const o = raw ? JSON.parse(raw) : null
    if (o && typeof o === 'object') {
      for (const k of Object.keys(base) as (keyof StdUtil)[]) {
        const v = Number((o as Record<string, unknown>)[k])
        if (Number.isFinite(v)) base[k] = v
      }
    }
  } catch {
    /* 무시 → 기본값 */
  }
  return base
}

/** 계약년수·단가 기준 영업이익률 목표 */
export function standardTargetMargin(years: number, rateVat: number): number {
  const idx = Math.max(1, Math.min(MAX_YEARS, Math.round(years))) - 1
  return rateVat >= 244
    ? PROFIT_STANDARD[idx].marginHigh
    : PROFIT_STANDARD[idx].marginLow
}

export function DEFAULT_INPUTS(): FeasibilityInputs {
  const su = loadStdUtil() // 관리 중인 표준 이용률 기준값(설정 탭)
  return {
    years: 5,
    rateVat: 249,
    rateFast100: 0,
    rateFast50: 0,
    rateSlow7: 0,
    rateSlow35: 0,
    rateSlow3: 0,
    utilFast100: su.utilFast100,
    utilFast50: su.utilFast50,
    utilSlow7: su.utilSlow7,
    utilSlow35: su.utilSlow35,
    utilSlow3: su.utilSlow3,
    countFast100: 0,
    countFast50: 0,
    countSlow7: 0,
    countSlow35: 0,
    countSlow3: 0,
    yearUtil2: 0.08,
    yearUtil3: 0.09,
    yearUtil4: 0.1,
    yearUtil5: 0.11,
    yearUtil6: 0.12,
    yearUtil7: 0.13,
    elecCostUnit: ELEC_COST,
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
  yearlyW: number[] // 1~7년차
  sumW: number
  revenue: number
  pgFee: number
  /** 충전 전기원가 (부호 음수) — 대기전력 제외분(구분) */
  elecCost: number
  /** 대기전력 전기원가 (부호 음수) — 합산 시 반영, 미합산 시 표시용 */
  standbyCost: number
  /** 대기전력을 사업성에 합산했는지 여부 */
  standbyIncluded: boolean
  /** 월 대기전력량 (kWh) — 적용 범위 기준 */
  standbyMonthlyKwh: number
  /** 계약기간 총 대기전력량 (kWh) */
  standbyKwhTotal: number
  /** 전기원가 합계 (충전+대기, 부호 음수) — 합산 관점 */
  elecCostTotal: number
  grossProfit: number
  opsCost: number
  bizCost: number
  capex: number
  /** 추가 CAPEX 합계 (부호 양수, 표시용) */
  capexExtra: number
  operatingProfit: number
  margin: number
  targetMargin: number
  verdict: '진행가능' | '진행불가' | '-'
  /** 영업이익률=목표 달성 충전단가 (VAT포함), 달성불가 시 null */
  targetRate: number | null
  /** 고정비 합계(전기·운영·영업·capex, 부호 양수) — 임의 목표이익률 역산용 */
  fixedCosts: number
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

export function computeFeasibility(
  inp: FeasibilityInputs,
  /** 연차별 실효 전기원가(원/kWh, VAT제외). 지정 시 연차별로 전기원가 적용 */
  elecByYear?: number[],
): FeasibilityResult {
  const c100 = inp.countFast100 ?? 0
  const total =
    c100 + inp.countFast50 + inp.countSlow7 + inp.countSlow35 + inp.countSlow3
  // 이용률 분산 계수: 설치 예정 충전기로 인한 대당 이용률 희석(0~1, 기본 1)
  const share =
    Number.isFinite(inp.utilShareFactor) && (inp.utilShareFactor as number) > 0
      ? (inp.utilShareFactor as number)
      : 1
  // 희석 반영 이용률(종류별)
  const uF100 = (inp.utilFast100 ?? 0) * share
  const uF50 = inp.utilFast50 * share
  const u7 = inp.utilSlow7 * share
  const u35 = inp.utilSlow35 * share
  const u3 = inp.utilSlow3 * share
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
  const e100 = c100 * MAX_MONTHLY.fast100 * uF100
  const eFast = inp.countFast50 * MAX_MONTHLY.fast50 * uF50
  const e7 = inp.countSlow7 * MAX_MONTHLY.slow7 * u7
  const e35 = inp.countSlow35 * MAX_MONTHLY.slow35 * u35
  const e3 = inp.countSlow3 * MAX_MONTHLY.slow3 * u3
  const base = e100 + eFast + e7 + e35 + e3

  // 전체 이용률 (7kW 환산) = Σ(대수×이용률×정격/7) / 총대수
  const overallUtil7kw =
    total > 0
      ? (c100 * uF100 * (100 / 7) +
          inp.countFast50 * uF50 * (50 / 7) +
          inp.countSlow7 * u7 +
          inp.countSlow35 * u35 * (3.5 / 7) +
          inp.countSlow3 * u3 * (3 / 7)) /
        total
      : 0

  const eff = (r: number) => (r > 0 ? r : inp.rateVat)
  // 연차별 이용률도 동일 분산 계수 적용
  const yearUtil = [
    inp.yearUtil2,
    inp.yearUtil3,
    inp.yearUtil4,
    inp.yearUtil5,
    inp.yearUtil6 ?? 0.12,
    inp.yearUtil7 ?? 0.13,
  ].map((u) => u * share)
  const yearlyW: number[] = []
  for (let y = 1; y <= MAX_YEARS; y++) {
    if (y > inp.years) {
      yearlyW.push(0)
    } else if (y === 1) {
      yearlyW.push(base)
    } else {
      // 2~7년차: 완속 7kW 이용률 증가분(%p)을 7kW 환산으로 전 종류에 반영
      //   7kW 증가분 = 연차 이용률 − 7kW 이용률 (%p, 7kW 기준)
      //   대당 증가 에너지 = 5,040kWh × 증가분 (모든 종류 동일)
      //   → 각 종류의 자체 이용률은 증가분 × (7 ÷ 정격) %p 만큼 상승
      const yu = yearUtil[y - 2]
      yearlyW.push(base + MAX_MONTHLY.slow7 * (yu - u7) * total)
    }
  }
  const sumW = yearlyW.reduce((a, w) => a + w, 0)

  // 종류별 요금(0이면 전체 단가) → 실효 단가(VAT포함).
  //  연차 성장으로 종류별 에너지 비중이 해마다 달라지므로, 1년차가 아닌 '전 기간
  //  (계약기간 합)' 종류별 에너지로 가중 평균해야 매출이 종류별 목표단가 산정과
  //  정합한다. (종류별 목표단가를 그대로 입력하면 목표이익률에 정확히 도달)
  const typeCells = [
    { e1: e100, count: c100, rate: eff(inp.rateFast100 ?? 0) },
    { e1: eFast, count: inp.countFast50, rate: eff(inp.rateFast50) },
    { e1: e7, count: inp.countSlow7, rate: eff(inp.rateSlow7) },
    { e1: e35, count: inp.countSlow35, rate: eff(inp.rateSlow35) },
    { e1: e3, count: inp.countSlow3, rate: eff(inp.rateSlow3) },
  ]
  let sumEt = 0
  let sumEtRate = 0
  for (const t of typeCells) {
    let et = 0
    for (let y = 1; y <= MAX_YEARS; y++) {
      if (y > inp.years) continue
      const yu = y === 1 ? u7 : yearUtil[y - 2]
      et += t.e1 + MAX_MONTHLY.slow7 * (yu - u7) * t.count
    }
    sumEt += et
    sumEtRate += et * t.rate
  }
  const avgVat = sumEt > 0 ? sumEtRate / sumEt : inp.rateVat
  const rateExVat = avgVat / 1.1

  const revenue = 12 * rateExVat * sumW
  const pgFee = -revenue * PG_RATE
  const elecUnit =
    inp.elecCostUnit != null && Number.isFinite(inp.elecCostUnit)
      ? inp.elecCostUnit
      : ELEC_COST
  // 연차별 실효원가가 주어지면 연차별로 (그 해 원가 × 그 해 사용량), 아니면 단일 원가
  const elecCost =
    elecByYear && elecByYear.length
      ? -12 *
        yearlyW.reduce(
          (acc, w, i) => acc + (elecByYear[i] ?? elecUnit) * w,
          0,
        )
      : -12 * elecUnit * sumW
  // 대기전력 전기원가 — 모자분리 종류(기본)만, 계약기간 전체(월 kWh × 12 × 년수)
  const contractYears = Math.min(inp.years, MAX_YEARS)
  const standbyMonthlyKwh =
    (inp.standbyScope === 'all'
      ? inp.standbyMonthlyKwhAll
      : inp.standbyMonthlyKwhSeparated) ?? 0
  const standbyKwhTotal = standbyMonthlyKwh * 12 * contractYears
  const standbyIncluded = inp.includeStandby !== false // 기본 합산
  const standbyCostFull = -elecUnit * standbyKwhTotal // 대기전력 비용(항상 계산)
  const standbyCost = standbyIncluded ? standbyCostFull : 0 // 손익 반영분
  const elecCostTotal = elecCost + standbyCostFull // 합산 관점(충전+대기), 토글 무관
  const grossProfit = revenue + pgFee + elecCost + standbyCost
  const opsCost = -total * opexPerUnit * 3 * 4 * Math.min(inp.years, MAX_YEARS)
  const bizCost = -total * inp.bizFeePerUnit * convFactor
  // 추가 CAPEX 항목: 단위(대당/단지당) 반영해 합산.
  const capexExtra = (inp.capexExtra ?? [])
    .filter((c) => c.included)
    .reduce((a, c) => a + c.amount * (c.unit === 'site' ? 1 : total), 0)
  const capex = -(total * inp.mojaBunri + inp.miniPc + capexExtra)
  const operatingProfit = grossProfit + opsCost + bizCost + capex
  const margin = revenue !== 0 ? operatingProfit / revenue : 0

  const yIdx = Math.max(1, Math.min(MAX_YEARS, Math.round(inp.years))) - 1
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
  const fixedCosts = -(elecCost + standbyCost + opsCost + bizCost + capex)
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
    standbyCost,
    standbyIncluded,
    standbyMonthlyKwh,
    standbyKwhTotal,
    elecCostTotal,
    grossProfit,
    opsCost,
    bizCost,
    capex,
    capexExtra,
    operatingProfit,
    margin,
    targetMargin,
    verdict,
    targetRate,
    fixedCosts,
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
