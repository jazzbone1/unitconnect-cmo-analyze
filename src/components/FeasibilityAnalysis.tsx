import { useState } from 'react'
import { usePersistentState } from '../lib/persist'
import type { SettlementConfig } from '../lib/settlement'
import {
  computeFeasibility,
  defaultBizFee,
  standardRate,
  STD,
  PROFIT_STANDARD,
  ELEC_COST,
  PG_RATE,
  MAX_YEARS,
  type FeasibilityInputs,
} from '../lib/feasibility'
import { formatNumber } from '../lib/stats'
import AiPanel from './AiPanel'

interface FeasibilityAnalysisProps {
  inputs: FeasibilityInputs
  setInputs: (i: FeasibilityInputs) => void
  config: SettlementConfig
  /** 종류 제외(체크박스) 토글용 — 설정(config)에 excluded 반영 */
  setConfig?: (c: SettlementConfig) => void
  /** 모자분리 종류 월 대기전력량 (kWh) — 대기전력 탭 자동연동 */
  standbyMonthlyKwhSeparated?: number
  /** 전체 종류 월 대기전력량 (kWh) — 대기전력 탭 자동연동 */
  standbyMonthlyKwhAll?: number
  /** 요금 구조 탭 실효 전기원가 (원/kWh·VAT제외) — 자동 반영 기본값 */
  autoElecCost?: number
  /** 연차별 전기원가 모델 (계약전력 가정에 따라 실효원가 연차 변화) */
  elecYearModel?: {
    monthlyKwh: number
    contractKw: number
    effCost: number
    loadFactor: number
  }[]
  /** 프로젝트별 영업비 1대분(계약년수별) override. 값>0인 칸만 적용, 나머지는 전체 기준값. */
  projectBizFee?: number[]
  /** 프로젝트별 영업비 저장 콜백 */
  setProjectBizFee?: (arr: number[]) => void
}

/**
 * 소수점 입력이 온전히 되는 숫자 입력.
 * 제어형 number 입력은 매 키 입력마다 값을 재포맷하기 때문에
 * "0.0"처럼 소수를 입력하는 중간 단계에서 0으로 리셋되어
 * 0.05 같은 소수 둘째 자리 이하 값을 끝까지 입력할 수 없다.
 * 포커스 중에는 사용자가 친 문자열(text)을 그대로 유지하고,
 * 포커스가 없을 때만 모델 값을 문자열로 표시해 이 문제를 해결한다.
 */
function DecimalInput({
  className,
  value,
  onValue,
  placeholder,
}: {
  className?: string
  value: number
  onValue: (n: number) => void
  placeholder?: string
}) {
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState('')
  const modelText = Number.isFinite(value) && value !== 0 ? String(value) : ''
  return (
    <input
      className={className}
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      value={focused ? text : modelText}
      onFocus={() => {
        setText(modelText)
        setFocused(true)
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        // 숫자와 소수점만 허용
        const raw = e.target.value.replace(/[^0-9.]/g, '')
        setText(raw)
        if (raw === '' || raw === '.') {
          onValue(0)
          return
        }
        const n = Number(raw)
        if (Number.isFinite(n)) onValue(n)
      }}
    />
  )
}

function Field({
  label,
  unit,
  value,
  onChange,
  standard,
}: {
  label: string
  unit?: string
  value: number
  onChange: (v: number) => void
  step?: number | string
  /** 유닛커넥트 기준(변경금지) 표시값 */
  standard?: string
}) {
  return (
    <label className="var-field">
      <span className="var-field__label">
        {label}
        {unit && <span className="var-field__unit">{unit}</span>}
      </span>
      <DecimalInput
        className="var-field__input"
        value={value}
        onValue={onChange}
      />
      {standard !== undefined && (
        <span className="var-field__std">UC 기준 {standard}</span>
      )}
    </label>
  )
}

const won = (n: number) => `${formatNumber(Math.round(n))}원`
const rateStr = (v: number | null) =>
  v == null ? '산정불가' : `${formatNumber(Math.round(v))}원`

export default function FeasibilityAnalysis({
  inputs,
  setInputs,
  config,
  setConfig,
  standbyMonthlyKwhSeparated = 0,
  standbyMonthlyKwhAll = 0,
  autoElecCost,
  elecYearModel,
  projectBizFee,
  setProjectBizFee,
}: FeasibilityAnalysisProps) {
  const set = (patch: Partial<FeasibilityInputs>) =>
    setInputs({ ...inputs, ...patch })
  // 종류 제외 토글: 해당 kw 충전기의 excluded 플래그를 뒤집는다.
  const toggleExcluded = (kw: number, excluded: boolean) => {
    if (!setConfig) return
    setConfig({
      ...config,
      chargers: config.chargers.map((c) =>
        c.kw === kw ? { ...c, excluded } : c,
      ),
    })
  }
  const isExcluded = (kw: number) =>
    config.chargers.find((c) => c.kw === kw)?.excluded === true
  // 연차별 실효원가 배열(부하율 고정 모델). override 사용 시 단일값 우선.
  const useYearModel =
    !!elecYearModel && elecYearModel.length > 0 && !inputs.elecCostOverride
  const elecByYear = useYearModel
    ? elecYearModel!.map((m) => m.effCost)
    : undefined

  // 전기원가: override 있으면 우선, 없으면 요금구조 실효원가 자동 반영(없으면 147)
  const hasElecOverride =
    inputs.elecCostOverride != null && Number.isFinite(inputs.elecCostOverride)
  const autoElec =
    autoElecCost != null && Number.isFinite(autoElecCost) ? autoElecCost : ELEC_COST
  const effElecCost = hasElecOverride
    ? (inputs.elecCostOverride as number)
    : autoElec

  // 영업비 1대분(계약년수별) — 전 프로젝트 공통(일괄) 설정, 직접 기입 가능
  const [bizFeeByYear, setBizFeeByYear] = usePersistentState<number[]>(
    'feasibility.bizFeeByYear',
    PROFIT_STANDARD.map((r) => r.bizFee),
  )
  const setBizFeeAt = (idx: number, v: number) =>
    setBizFeeByYear((prev) => {
      const next = [...prev]
      next[idx] = v
      return next
    })
  const setProjectBizFeeAt = (idx: number, v: number) => {
    if (!setProjectBizFee) return
    const next = [...(projectBizFee ?? [])]
    while (next.length < MAX_YEARS) next.push(0)
    next[idx] = v
    setProjectBizFee(next)
  }
  const yearIdx = Math.max(1, Math.min(MAX_YEARS, Math.round(inputs.years))) - 1
  // 영업비 1대분 결정 순서(값>0 만 유효):
  //  1) 프로젝트별 개별 기준표(projectBizFee) → 2) 전체 기준값(bizFeeByYear) → 3) 기본값
  const projBizAt = (i: number) =>
    projectBizFee && projectBizFee[i] > 0 ? projectBizFee[i] : undefined
  const globalBizAt = (i: number) =>
    bizFeeByYear[i] > 0 ? bizFeeByYear[i] : undefined
  const standardBizFee =
    projBizAt(yearIdx) ?? globalBizAt(yearIdx) ?? defaultBizFee(inputs.years)
  // '영업비 1대분 단가' 단일 override — 빈 값(0)은 override 아님(기준표로 fallback).
  const hasBizFeeOverride =
    inputs.bizFeeOverride != null &&
    Number.isFinite(inputs.bizFeeOverride) &&
    (inputs.bizFeeOverride as number) > 0
  const appliedBizFee = hasBizFeeOverride
    ? (inputs.bizFeeOverride as number)
    : standardBizFee
  // 전체 기준값 관리 창(모달) 표시 여부.
  const [showBizStd, setShowBizStd] = useState(false)

  // 대수·요금은 단지 정보의 '충전기 종류별 수량·요금'과 자동 연동 (읽기 전용).
  //  제외(excluded) 종류는 대수 0으로 취급하여 사업성 전체에서 빠진다.
  const countOf = (kw: number) => {
    const c = config.chargers.find((c) => c.kw === kw)
    return c && !c.excluded ? c.count : 0
  }
  const rateOf = (kw: number) =>
    config.chargers.find((c) => c.kw === kw)?.rate ?? 0
  // 종류별 요금 override: 사업성 표에서 직접 기입한 값(inputs.rateXxx)이 있으면 우선.
  const rateKeyOf = (kw: number): keyof FeasibilityInputs =>
    kw === 100
      ? 'rateFast100'
      : kw === 50
        ? 'rateFast50'
        : kw === 7
          ? 'rateSlow7'
          : kw === 3.5
            ? 'rateSlow35'
            : 'rateSlow3'
  const overrideRateOf = (kw: number) =>
    (inputs[rateKeyOf(kw)] as number) ?? 0
  // 자동 기본값(placeholder 표시용): 종류별 수량·요금 표의 값, 없으면 전체 충전단가.
  const autoRateOf = (kw: number) => (rateOf(kw) > 0 ? rateOf(kw) : inputs.rateVat)
  // 실제 적용 요금: override(>0) 우선, 없으면 표 요금(0이면 computeFeasibility가 전체단가 적용).
  const resolveRate = (kw: number) =>
    overrideRateOf(kw) > 0 ? overrideRateOf(kw) : rateOf(kw)
  const eff: FeasibilityInputs = {
    ...inputs,
    countFast100: countOf(100),
    countFast50: countOf(50),
    countSlow7: countOf(7),
    countSlow35: countOf(3.5),
    countSlow3: countOf(3),
    // 충전 요금: 직접 기입(override) 우선, 없으면 '충전기 종류별 수량 요금' 표의
    //  값 자동 반영(0이면 전체 충전단가 사용).
    rateFast100: resolveRate(100),
    rateFast50: resolveRate(50),
    rateSlow7: resolveRate(7),
    rateSlow35: resolveRate(3.5),
    rateSlow3: resolveRate(3),
    standbyMonthlyKwhSeparated,
    standbyMonthlyKwhAll,
    // 대기전력 전기원가는 항상 사업성에 합산(토글 제거).
    includeStandby: true,
    // 사업 기준 전 충전기 모자분리 예정 → 대기전력 범위는 '전체 종류'로 고정.
    standbyScope: 'all',
    // 영업비는 공통 기준표(계약년수별)에서 자동 적용
    bizFeePerUnit: appliedBizFee,
    // 전기원가는 요금구조 실효원가 자동반영(또는 override)
    elecCostUnit: effElecCost,
  }
  const r = computeFeasibility(eff, elecByYear)

  // 목표 영업이익률 직접입력 → 목표달성 충전단가 자동계산
  // 최초값은 UC 기준 목표이익률(r.targetMargin, %)로 시작
  const [customMarginPct, setCustomMarginPct] = useState<string>('')
  const customMargin =
    customMarginPct.trim() === ''
      ? r.targetMargin
      : (parseFloat(customMarginPct) || 0) / 100
  const customTargetRate = (() => {
    const denom = 12 * r.sumW * (1 - PG_RATE - customMargin)
    return denom <= 0 ? null : (r.fixedCosts / denom) * 1.1
  })()

  const chargerRows: {
    kw: number
    label: string
    utilKey: keyof FeasibilityInputs
    rateKey: keyof FeasibilityInputs
  }[] = [
    { kw: 100, label: '급속 100kW', utilKey: 'utilFast100', rateKey: 'rateFast100' },
    { kw: 50, label: '급속 50kW', utilKey: 'utilFast50', rateKey: 'rateFast50' },
    { kw: 7, label: '완속 7kW', utilKey: 'utilSlow7', rateKey: 'rateSlow7' },
    { kw: 3.5, label: '완속 3.5kW', utilKey: 'utilSlow35', rateKey: 'rateSlow35' },
    { kw: 3, label: '완속(콘센트) 3kW', utilKey: 'utilSlow3', rateKey: 'rateSlow3' },
  ]

  // 종류별 목표 달성 충전단가:
  //  전기원가는 사용량 비례, 운영·영업·CAPEX는 대당 균등 배분 후 그 종류 사용량으로 나눔.
  //  종류별 단가를 사용량 가중하면 전체 목표단가와 일치.
  const perTypeTarget = (margin: number) => {
    const yearsN = Math.max(1, Math.min(MAX_YEARS, Math.round(inputs.years)))
    const sevenByYearT = [
      inputs.utilSlow7,
      inputs.yearUtil2,
      inputs.yearUtil3,
      inputs.yearUtil4,
      inputs.yearUtil5,
      inputs.yearUtil6 ?? 0.12,
      inputs.yearUtil7 ?? 0.13,
    ]
    const elecFixed = -(r.elecCost + r.standbyCost) // 전기(+대기) 총원가, 양수
    const nonElecFixed = -(r.opsCost + r.bizCost + r.capex) // 운영·영업·capex, 양수
    const denomF = 1 - PG_RATE - margin
    return chargerRows.map((row) => {
      const count = countOf(row.kw)
      let Et = 0 // Σ 월사용량(연차 합) — sumW의 종류별 몫
      for (let y = 0; y < yearsN; y++) {
        const uy =
          (inputs[row.utilKey] as number) +
          (sevenByYearT[y] - inputs.utilSlow7) * (7 / row.kw)
        Et += uy * row.kw * 720 * count
      }
      const energyShare = r.sumW > 0 ? Et / r.sumW : 0
      const countShare = r.totalUnits > 0 ? count / r.totalUnits : 0
      const Ft = elecFixed * energyShare + nonElecFixed * countShare
      const totalKwh = 12 * Et
      const target =
        totalKwh > 0 && denomF > 0 ? (Ft / (totalKwh * denomF)) * 1.1 : null
      return { row, count, totalKwh, target }
    })
  }

  // ── 연간 상세 P&L (연차별 매출·전기원가·영업현금흐름) ──
  //  운영비·대기전력은 연차 균등, 매출·충전전기원가는 연차별 사용량(yearlyW)에 비례.
  //  영업현금흐름(cf) = 매출총이익 + 운영비 (영업비·CAPEX 제외 → 회수기간 산정용).
  const yearsN = Math.max(1, Math.min(MAX_YEARS, Math.round(inputs.years)))
  const opsPerYear = r.opsCost / yearsN
  const standbyPerYear = r.standbyCost / yearsN
  const perYearRows = Array.from({ length: yearsN }, (_, y) => {
    const W = r.yearlyW[y] ?? 0
    const rev = 12 * r.rateExVat * W
    const pg = -rev * PG_RATE
    const eu = elecByYear && elecByYear[y] != null ? elecByYear[y] : effElecCost
    const elecCharge = -12 * eu * W
    const gross = rev + pg + elecCharge + standbyPerYear
    const cf = gross + opsPerYear
    return { year: y + 1, rev, pg, elec: elecCharge + standbyPerYear, gross, ops: opsPerYear, cf }
  })

  // ── CAPEX(영업비 포함) 회수기간 ──
  //  투자액 = CAPEX + 영업비(총). 연간 영업현금흐름 누적이 투자액에 도달하는 시점(년).
  const investment = -(r.capex + r.bizCost)
  const payback = (() => {
    if (investment <= 0) return { text: '즉시 회수', reached: true }
    let cum = 0
    for (const row of perYearRows) {
      if (row.cf <= 0) continue
      if (cum + row.cf >= investment) {
        const frac = row.year - 1 + (investment - cum) / row.cf
        return { text: `${frac.toFixed(1)}년`, reached: true }
      }
      cum += row.cf
    }
    const avgCf = yearsN > 0 ? cum / yearsN : 0
    if (avgCf > 0)
      return {
        text: `${yearsN}년 내 미회수 (약 ${(investment / avgCf).toFixed(1)}년)`,
        reached: false,
      }
    return { text: '회수 불가', reached: false }
  })()

  // ── 충전기별 손익 상세 ──
  //  전기원가는 사용량 비례, 운영비·CAPEX는 대당 균등, 영업비는 대분 환산(콘센트 1/4·
  //  7kW 1·급속 0) 비중으로 배분. 매출은 종류별 요금 × 계약기간 사용량.
  const sevenByYearC = [
    inputs.utilSlow7,
    inputs.yearUtil2,
    inputs.yearUtil3,
    inputs.yearUtil4,
    inputs.yearUtil5,
    inputs.yearUtil6 ?? 0.12,
    inputs.yearUtil7 ?? 0.13,
  ]
  const bizWeightOf = (kw: number) => (kw <= 3.5 ? 0.25 : kw === 7 ? 1 : 0)
  const bizWeightTotal = chargerRows.reduce(
    (a, row) => a + countOf(row.kw) * bizWeightOf(row.kw),
    0,
  )
  const perChargerRows = chargerRows
    .map((row) => {
      const count = countOf(row.kw)
      let Et = 0 // Σ 월사용량(연차 합)
      for (let y = 0; y < yearsN; y++) {
        const uy =
          (inputs[row.utilKey] as number) +
          (sevenByYearC[y] - inputs.utilSlow7) * (7 / row.kw)
        Et += uy * row.kw * 720 * count
      }
      const energyShare = r.sumW > 0 ? Et / r.sumW : 0
      const countShare = r.totalUnits > 0 ? count / r.totalUnits : 0
      const rateEx =
        resolveRate(row.kw) > 0 ? resolveRate(row.kw) / 1.1 : r.rateExVat
      const rev = 12 * Et * rateEx
      const pg = -rev * PG_RATE
      const elec = (r.elecCost + r.standbyCost) * energyShare
      const ops = r.opsCost * countShare
      const biz =
        bizWeightTotal > 0
          ? r.bizCost * ((count * bizWeightOf(row.kw)) / bizWeightTotal)
          : 0
      const capex = -(count * inputs.mojaBunri + inputs.miniPc * countShare)
      const op = rev + pg + elec + ops + biz + capex
      return {
        label: row.label,
        count,
        rev,
        elec: elec + pg,
        ops,
        biz,
        capex,
        op,
        margin: rev !== 0 ? op / rev : 0,
      }
    })
    .filter((x) => x.count > 0)

  const pnl: { label: string; value: number; strong?: boolean; minus?: boolean }[] = [
    { label: '매출 (VAT 제외)', value: r.revenue, strong: true },
    { label: '(−) PG 수수료', value: r.pgFee, minus: true },
    { label: '(−) 전기원가 (충전)', value: r.elecCost, minus: true },
    {
      label: `(−) 전기원가 (대기전력${r.standbyIncluded ? '' : ', 미합산'})`,
      value: r.standbyCost,
      minus: true,
    },
    { label: '매출총이익', value: r.grossProfit, strong: true },
    { label: '(−) 현장 운영비', value: r.opsCost, minus: true },
    { label: '(−) 영업비 (총)', value: r.bizCost, minus: true },
    { label: '(−) CAPEX', value: r.capex, minus: true },
    { label: '영업이익', value: r.operatingProfit, strong: true },
  ]

  return (
    <section className="card settlement">
      <div className="card__header">
        <h2>사업성 분석 · 영업비 산정</h2>
        <span className="badge">계약 {inputs.years}년 기준</span>
      </div>

      <div className="verdict-row">
        <div
          className={`verdict-badge ${
            r.verdict === '진행가능'
              ? 'verdict-badge--ok'
              : r.verdict === '진행불가'
                ? 'verdict-badge--no'
                : ''
          }`}
        >
          {r.verdict}
        </div>
        <div className="stat">
          <span className="stat__value">{(r.margin * 100).toFixed(2)}%</span>
          <span className="stat__label">영업이익률</span>
        </div>
        <div className="stat">
          <span className="stat__value">
            {(r.targetMargin * 100).toFixed(2)}%
          </span>
          <span className="stat__label">영업이익률 목표</span>
        </div>
        <div className="stat">
          <span className="stat__value">{won(r.operatingProfit)}</span>
          <span className="stat__label">영업이익 ({inputs.years}년)</span>
        </div>
      </div>

      {/* AI 사업성 총평 */}
      <AiPanel
        kind="summary"
        label="AI 사업성 총평 생성"
        getData={() => ({
          계약연수: inputs.years,
          판정: r.verdict,
          영업이익률: `${(r.margin * 100).toFixed(2)}%`,
          영업이익률목표: `${(r.targetMargin * 100).toFixed(2)}%`,
          영업이익_계약기간: Math.round(r.operatingProfit),
          회수기간: payback.text,
          전기원가_원kWh: Number(effElecCost.toFixed(1)),
          손익_계약기간: {
            매출: Math.round(r.revenue),
            PG수수료: Math.round(r.pgFee),
            전기원가_충전: Math.round(r.elecCost),
            전기원가_대기전력: Math.round(r.standbyCost),
            현장운영비: Math.round(r.opsCost),
            영업비: Math.round(r.bizCost),
            CAPEX: Math.round(r.capex),
          },
          충전기종류별: chargerRows
            .filter((row) => countOf(row.kw) > 0)
            .map((row) => ({
              종류: row.label,
              대수: countOf(row.kw),
              이용률: `${((inputs[row.utilKey] as number) * 100).toFixed(2)}%`,
              요금_원kWh: resolveRate(row.kw) || inputs.rateVat,
              월사용량_kWh: Math.round(
                (inputs[row.utilKey] as number) * row.kw * 720 * countOf(row.kw),
              ),
            })),
          충전기별손익: perChargerRows.map((row) => ({
            종류: row.label,
            대수: row.count,
            영업이익: Math.round(row.op),
            이익률: `${(row.margin * 100).toFixed(2)}%`,
          })),
        })}
      />

      {/* 1. 영업이익 기준 (계약년수·단가에 따라 기준 변동) */}
      <div className="subsection">
        <div className="subsection__head">
          <h3 className="subsection__title">1. 영업이익 기준 (영업비 · 프로젝트별)</h3>
          <button
            type="button"
            className="btn-standard"
            onClick={() => setShowBizStd(true)}
          >
            ⚙ 전체 기준값 관리
          </button>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>계약기간</th>
                <th>영업비 1대분(원/대) · 프로젝트별</th>
                <th>영업이익률 목표<br />(≥244원 · 249원)</th>
                <th>영업이익률 목표<br />(&lt;244원 · 239원)</th>
              </tr>
            </thead>
            <tbody>
              {PROFIT_STANDARD.map((row, i) => {
                const isYear = row.years === Math.max(1, Math.min(MAX_YEARS, Math.round(inputs.years)))
                const highActive = isYear && inputs.rateVat >= 244
                const lowActive = isYear && inputs.rateVat < 244
                const globalVal = globalBizAt(i) ?? defaultBizFee(row.years)
                return (
                  <tr key={row.years} className={isYear ? 'row--selected' : ''}>
                    <td className="col-name">{row.years}년</td>
                    <td>
                      <DecimalInput
                        className="cell-input"
                        value={projectBizFee?.[i] ?? 0}
                        onValue={(n) => setProjectBizFeeAt(i, n)}
                        placeholder={`기준값 ${formatNumber(globalVal)}`}
                      />
                    </td>
                    <td className={highActive ? 'cell--up' : ''}>
                      {(row.marginHigh * 100).toFixed(2)}%
                    </td>
                    <td className={lowActive ? 'cell--up' : ''}>
                      {(row.marginLow * 100).toFixed(2)}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="table-note table-note--row">
          <span>
            영업비 1대분은 <b>프로젝트별로 저장</b>됩니다. <b>0 또는 빈 칸</b>은{' '}
            <b>전체 기준값</b>(우측 상단 <b>⚙ 전체 기준값 관리</b>에서 설정)이 자동
            적용됩니다. 프로젝트 개별 금액을 넣으려면 <b>0보다 큰 값</b>을
            입력하세요. 계약년수(
            {Math.max(1, Math.min(MAX_YEARS, Math.round(inputs.years)))}년)에
            해당하는 값이 손익의 영업비로 반영됩니다. (현재 적용:{' '}
            {formatNumber(appliedBizFee)}원 ·{' '}
            {inputs.rateVat >= 244 ? '249원 기준' : '239원 기준'})
          </span>
          {projectBizFee && projectBizFee.some((v) => v > 0) && setProjectBizFee && (
            <button
              type="button"
              className="btn-link"
              onClick={() => setProjectBizFee([])}
            >
              프로젝트값 지우기(기준값 사용)
            </button>
          )}
        </div>
      </div>

      {showBizStd && (
        <div
          className="biz-modal__backdrop"
          onClick={() => setShowBizStd(false)}
        >
          <div
            className="biz-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="biz-modal__head">
              <h3>영업비 전체 기준값 관리</h3>
              <button
                type="button"
                className="biz-modal__x"
                aria-label="닫기"
                onClick={() => setShowBizStd(false)}
              >
                ✕
              </button>
            </div>
            <p className="biz-modal__desc">
              여기서 설정한 값은 <b>모든 현장의 기본 영업비 기준값</b>입니다. 각
              프로젝트에서 영업비를 따로 기입하지 않은 계약연수에는 이 값이
              적용됩니다.
            </p>
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>계약기간</th>
                    <th>영업비 1대분(원/대) · 기준값</th>
                  </tr>
                </thead>
                <tbody>
                  {PROFIT_STANDARD.map((row, i) => (
                    <tr key={row.years}>
                      <td className="col-name">{row.years}년</td>
                      <td>
                        <DecimalInput
                          className="cell-input"
                          value={bizFeeByYear[i] ?? 0}
                          onValue={(n) => setBizFeeAt(i, n)}
                          placeholder={`${formatNumber(defaultBizFee(row.years))}`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="biz-modal__foot">
              <button
                type="button"
                className="btn-link"
                onClick={() =>
                  setBizFeeByYear(PROFIT_STANDARD.map((r) => r.bizFee))
                }
              >
                기본값 복원
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setShowBizStd(false)}
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="var-panel">
        <h3 className="subsection__title">① 변수 입력 (좌: 직접 기입 / 우: UC 기준)</h3>
        <div className="var-row">
          <Field
            label="계약년수"
            unit="년(1~7)"
            value={inputs.years}
            onChange={(v) => set({ years: v })}
          />
          <Field
            label="충전단가 (전체)"
            unit="원/kWh·VAT포함"
            value={inputs.rateVat}
            onChange={(v) => set({ rateVat: v })}
            standard={`${standardRate(inputs.rateVat)}원`}
          />
          <label className="var-field">
            <span className="var-field__label">
              전기원가
              <span className="var-field__unit">원/kWh·VAT제외</span>
            </span>
            <DecimalInput
              className="var-field__input"
              value={effElecCost}
              onValue={(v) => set({ elecCostOverride: v })}
            />
            <span className="var-field__std">
              {hasElecOverride ? (
                <>
                  직접입력 ·{' '}
                  <button
                    type="button"
                    className="btn-link"
                    onClick={() => set({ elecCostOverride: null })}
                  >
                    요금구조({autoElec.toFixed(1)}원)로 되돌리기
                  </button>
                </>
              ) : (
                `요금구조 실효원가 자동 반영 (${autoElec.toFixed(1)}원)`
              )}
            </span>
          </label>
        </div>

        {/* 대기전력 전기원가 합산/구분 */}
        <div className="subsection standby-merge">
          <div className="standby-merge__head">
            <h4 className="summary-block__title">
              대기전력 전기원가 반영 (대기전력 탭 자동연동 · 항상 합산)
            </h4>
          </div>
          <div className="var-row standby-merge__scope">
            <span className="hint hint--tight">
              범위: <b>전체 종류</b> ({standbyMonthlyKwhAll.toLocaleString()} kWh/월)
              — 사업 기준 전 충전기 모자분리 예정이라 전체 종류 대기전력을 합산합니다.
            </span>
          </div>
          <div className="table-scroll">
            <table className="data-table">
              <tbody>
                <tr>
                  <td className="col-name">충전 전기원가 (구분)</td>
                  <td className="cell--num">{won(r.elecCost)}</td>
                </tr>
                <tr>
                  <td className="col-name">
                    대기전력 전기원가 (계약 {Math.min(inputs.years, MAX_YEARS)}년 ·{' '}
                    {Math.round(r.standbyKwhTotal).toLocaleString()} kWh)
                    {r.standbyIncluded ? '' : ' · 미합산'}
                  </td>
                  <td className="cell--num">{won(r.elecCostTotal - r.elecCost)}</td>
                </tr>
                <tr className="row--total">
                  <td className="col-name">전기원가 합계 (충전+대기)</td>
                  <td className="cell--num cell--strong">{won(r.elecCostTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="hint hint--tight">
            모자분리 계약 충전기는 전용 계량기가 24시간 가동되어 대기전력도
            운영사 부담입니다. 대기전력량(kWh)은 대기전력 탭의 대당 대기전력(W)
            설정을 그대로 사용하고, 단가는 위 사업성 전기원가(
            {effElecCost.toFixed(1)}원/kWh)로 환산합니다. 합산 시
            손익·목표달성 충전단가에 반영됩니다.
          </p>
        </div>

        <div className="subsection">
          <h4 className="summary-block__title">
            충전기 종류별 (대수는 단지 정보에서 자동 연동)
          </h4>
          <div className="table-scroll">
            <table className="data-table charger-table">
              <thead>
                <tr>
                  <th title="체크 해제 시 사업성·전기원가 등 모든 분석에서 제외">
                    포함
                  </th>
                  <th>종류</th>
                  <th>대수(자동)</th>
                  <th>이용률(%)</th>
                  <th>7kW 환산</th>
                  <th>UC 기준 이용률</th>
                  <th>종류별 요금(원/kWh)</th>
                  <th>월 사용량(kWh)</th>
                  <th>연 사용량(kWh)</th>
                </tr>
              </thead>
              <tbody>
                {chargerRows.map((row) => {
                  const cfgCount =
                    config.chargers.find((c) => c.kw === row.kw)?.count ?? 0
                  const excluded = isExcluded(row.kw)
                  return (
                  <tr
                    key={row.kw}
                    className={excluded ? 'row--excluded' : undefined}
                  >
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={!excluded}
                        disabled={cfgCount <= 0 || !setConfig}
                        title={
                          excluded
                            ? '분석에서 제외됨 — 체크 시 포함'
                            : '분석에 포함됨 — 해제 시 제외'
                        }
                        onChange={(e) =>
                          toggleExcluded(row.kw, !e.target.checked)
                        }
                      />
                    </td>
                    <td className="col-name">{row.label}</td>
                    <td>{countOf(row.kw).toLocaleString()}</td>
                    <td>
                      <DecimalInput
                        className="cell-input"
                        value={+(((inputs[row.utilKey] as number) * 100).toFixed(6))}
                        placeholder="0"
                        onValue={(n) =>
                          set({ [row.utilKey]: n / 100 } as Partial<FeasibilityInputs>)
                        }
                      />
                    </td>
                    <td className="std-cell" title="이용률 × (정격 ÷ 7)">
                      {((inputs[row.utilKey] as number) * (row.kw / 7) * 100).toFixed(2)}%
                    </td>
                    <td className="std-cell">
                      {((STD[row.utilKey as keyof typeof STD] as number) * 100).toFixed(2)}%
                    </td>
                    <td
                      title="기본값은 '충전기 종류별 수량 요금' 표(미입력 시 전체 충전단가)를 따라가며, 직접 기입하면 그 값이 우선 적용됩니다"
                    >
                      <DecimalInput
                        className="cell-input"
                        value={overrideRateOf(row.kw)}
                        placeholder={formatNumber(autoRateOf(row.kw))}
                        onValue={(n) =>
                          set({ [row.rateKey]: n } as Partial<FeasibilityInputs>)
                        }
                      />
                    </td>
                    <td className="std-cell" title="이용률 × 정격 × 720h × 대수">
                      {formatNumber(
                        Math.round(
                          (inputs[row.utilKey] as number) *
                            row.kw *
                            720 *
                            countOf(row.kw),
                        ),
                      )}
                    </td>
                    <td className="std-cell" title="월 사용량 × 12">
                      {formatNumber(
                        Math.round(
                          (inputs[row.utilKey] as number) *
                            row.kw *
                            720 *
                            12 *
                            countOf(row.kw),
                        ),
                      )}
                    </td>
                  </tr>
                  )
                })}
                <tr>
                  <td />
                  <td className="col-name">합계</td>
                  <td>{r.totalUnits.toLocaleString()}대</td>
                  <td colSpan={4} />
                  <td className="cell--strong">
                    {formatNumber(
                      Math.round(
                        chargerRows.reduce(
                          (a, row) =>
                            a +
                            (inputs[row.utilKey] as number) *
                              row.kw *
                              720 *
                              countOf(row.kw),
                          0,
                        ),
                      ),
                    )}
                  </td>
                  <td className="cell--strong">
                    {formatNumber(
                      Math.round(
                        chargerRows.reduce(
                          (a, row) =>
                            a +
                            (inputs[row.utilKey] as number) *
                              row.kw *
                              720 *
                              12 *
                              countOf(row.kw),
                          0,
                        ),
                      ),
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="var-hint">
            종류별 요금은 기본적으로 <b>'충전기 종류별 수량 요금' 표</b>를
            따라갑니다 (미입력 종류는 전체 충전단가 {inputs.rateVat}원). 칸에{' '}
            <b>직접 기입하면 그 값이 우선 적용</b>되고, 비우면 다시 자동값으로
            돌아갑니다. 종류별 요금은 에너지 비중으로 가중해 매출에 반영됩니다. ·
            전체
            이용률(7kW 환산) <b>{(r.overallUtil7kw * 100).toFixed(2)}%</b>{' '}
            (정격별 100/7·50/7·3.5/7·3/7 환산 반영) · <b>월 사용량</b> = 이용률 ×
            정격(kW) × 720h × 대수 (연 사용량 = ×12)
          </p>
        </div>

        <div className="subsection">
          <div className="standby-merge__head">
            <h4 className="summary-block__title">
              연차별 이용률 (7kW 환산, 성장 예상)
            </h4>
            <button
              type="button"
              className="btn-secondary"
              title="완속 7kW 이용률 기준 매년 1%p 상승 (상한: 25% 또는 현재 7kW 이용률 중 큰 값 — 넘지 않음)"
              onClick={() => {
                const base = inputs.utilSlow7
                // 상한: 현재 7kW 이용률이 25% 초과면 현재값을 넘지 않게,
                //  25% 이하면 25%까지만 성장.
                const cap = Math.max(base, 0.25)
                const grow = (n: number) => Math.min(base + n * 0.01, cap)
                set({
                  yearUtil2: grow(1),
                  yearUtil3: grow(2),
                  yearUtil4: grow(3),
                  yearUtil5: grow(4),
                  yearUtil6: grow(5),
                  yearUtil7: grow(6),
                })
              }}
            >
              연 성장률 1%p 반영
            </button>
          </div>
          <div className="var-row var-row--oneline">
            <Field label="2년차" unit="%" step="any" value={+(inputs.yearUtil2 * 100).toFixed(4)} onChange={(v) => set({ yearUtil2: v / 100 })} standard={`${(STD.yearUtil2 * 100).toFixed(0)}%`} />
            <Field label="3년차" unit="%" step="any" value={+(inputs.yearUtil3 * 100).toFixed(4)} onChange={(v) => set({ yearUtil3: v / 100 })} standard={`${(STD.yearUtil3 * 100).toFixed(0)}%`} />
            <Field label="4년차" unit="%" step="any" value={+(inputs.yearUtil4 * 100).toFixed(4)} onChange={(v) => set({ yearUtil4: v / 100 })} standard={`${(STD.yearUtil4 * 100).toFixed(0)}%`} />
            <Field label="5년차" unit="%" step="any" value={+(inputs.yearUtil5 * 100).toFixed(4)} onChange={(v) => set({ yearUtil5: v / 100 })} standard={`${(STD.yearUtil5 * 100).toFixed(0)}%`} />
            <Field label="6년차" unit="%" step="any" value={+(((inputs.yearUtil6 ?? 0.12) * 100).toFixed(4))} onChange={(v) => set({ yearUtil6: v / 100 })} standard={`${((STD.yearUtil6 ?? 0.12) * 100).toFixed(0)}%`} />
            <Field label="7년차" unit="%" step="any" value={+(((inputs.yearUtil7 ?? 0.13) * 100).toFixed(4))} onChange={(v) => set({ yearUtil7: v / 100 })} standard={`${((STD.yearUtil7 ?? 0.13) * 100).toFixed(0)}%`} />
          </div>
          <p className="var-hint">
            연차 값은 <b>완속 7kW 이용률</b> 기준입니다. 7kW의 증가분(%p)을{' '}
            <b>7kW 환산(×7÷정격)</b>해 각 종류에 반영합니다. 예: 7kW{' '}
            {(inputs.utilSlow7 * 100).toFixed(1)}% → 2년차{' '}
            {(inputs.yearUtil2 * 100).toFixed(1)}% 이면{' '}
            <b>+{((inputs.yearUtil2 - inputs.utilSlow7) * 100).toFixed(1)}%p</b>{' '}
            상승 → 3kW는 +
            {((inputs.yearUtil2 - inputs.utilSlow7) * (7 / 3) * 100).toFixed(2)}%p
            (= 증가분×7/3) → {(inputs.utilSlow3 * 100).toFixed(2)}% →{' '}
            <b>
              {(
                (inputs.utilSlow3 +
                  (inputs.yearUtil2 - inputs.utilSlow7) * (7 / 3)) *
                100
              ).toFixed(2)}
              %
            </b>
            . <b>[연 성장률 1%p 반영]</b>은 7kW 기준 상한{' '}
            <b>{(Math.max(inputs.utilSlow7, 0.25) * 100).toFixed(1)}%</b>
            (25% 또는 현재 이용률 중 큰 값)를 넘지 않습니다.
          </p>
          {/* 종류별·연차별 이용률 표 */}
          <div className="table-scroll" style={{ marginTop: '0.75rem' }}>
            <table className="data-table charger-table">
              <thead>
                <tr>
                  <th>종류</th>
                  {Array.from(
                    { length: Math.max(1, Math.min(7, Math.round(inputs.years))) },
                    (_, i) => (
                      <th key={i}>{i + 1}년차</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {chargerRows.map((row) => {
                  const sevenByYear = [
                    inputs.utilSlow7,
                    inputs.yearUtil2,
                    inputs.yearUtil3,
                    inputs.yearUtil4,
                    inputs.yearUtil5,
                    inputs.yearUtil6 ?? 0.12,
                    inputs.yearUtil7 ?? 0.13,
                  ]
                  return (
                    <tr key={row.kw}>
                      <td className="col-name">{row.label}</td>
                      {Array.from(
                        {
                          length: Math.max(
                            1,
                            Math.min(7, Math.round(inputs.years)),
                          ),
                        },
                        (_, yi) => {
                          const u =
                            (inputs[row.utilKey] as number) +
                            (sevenByYear[yi] - inputs.utilSlow7) * (7 / row.kw)
                          return <td key={yi}>{(u * 100).toFixed(2)}%</td>
                        },
                      )}
                    </tr>
                  )
                })}
                <tr className="row--total">
                  <td className="col-name">전체 (7kW 환산)</td>
                  {Array.from(
                    { length: Math.max(1, Math.min(7, Math.round(inputs.years))) },
                    (_, yi) => {
                      const fleet =
                        r.yearlyW[0] > 0
                          ? r.overallUtil7kw * (r.yearlyW[yi] / r.yearlyW[0])
                          : 0
                      return (
                        <td key={yi} className="cell--strong">
                          {(fleet * 100).toFixed(2)}%
                        </td>
                      )
                    },
                  )}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="var-hint">
            각 종류의 연차 이용률 = 1년차 이용률 + (연차 7kW − 1년차 7kW) × (7 ÷
            정격). 계약년수({Math.round(inputs.years)}년)까지 표시합니다.
          </p>

          {/* 종류별·연차별 연 사용량 표 */}
          <h5 className="report-block__subtitle" style={{ marginTop: '0.75rem' }}>
            1~7년차 종류별 연 사용량 (kWh)
          </h5>
          <div className="table-scroll">
            <table className="data-table charger-table">
              <thead>
                <tr>
                  <th>종류</th>
                  {Array.from(
                    { length: Math.max(1, Math.min(7, Math.round(inputs.years))) },
                    (_, i) => (
                      <th key={i}>{i + 1}년차</th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {chargerRows.map((row) => {
                  const sevenByYear = [
                    inputs.utilSlow7,
                    inputs.yearUtil2,
                    inputs.yearUtil3,
                    inputs.yearUtil4,
                    inputs.yearUtil5,
                    inputs.yearUtil6 ?? 0.12,
                    inputs.yearUtil7 ?? 0.13,
                  ]
                  const cnt = countOf(row.kw)
                  return (
                    <tr key={row.kw}>
                      <td className="col-name">{row.label}</td>
                      {Array.from(
                        {
                          length: Math.max(
                            1,
                            Math.min(7, Math.round(inputs.years)),
                          ),
                        },
                        (_, yi) => {
                          const u =
                            (inputs[row.utilKey] as number) +
                            (sevenByYear[yi] - inputs.utilSlow7) * (7 / row.kw)
                          const annual = u * row.kw * 720 * 12 * cnt
                          return (
                            <td key={yi}>
                              {formatNumber(Math.round(annual))}
                            </td>
                          )
                        },
                      )}
                    </tr>
                  )
                })}
                <tr className="row--total">
                  <td className="col-name">전체 합계</td>
                  {Array.from(
                    { length: Math.max(1, Math.min(7, Math.round(inputs.years))) },
                    (_, yi) => (
                      <td key={yi} className="cell--strong">
                        {formatNumber(Math.round((r.yearlyW[yi] ?? 0) * 12))}
                      </td>
                    ),
                  )}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="var-hint">
            연 사용량 = 연차 이용률 × 정격(kW) × 720h × 12 × 대수. 전체 합계는
            사업성 계산의 연차 사용량과 동일합니다.
          </p>

          {/* 연차별 전기원가 모델 (부하율 고정) */}
          {useYearModel && (
            <>
              <div
                className="standby-merge__head"
                style={{ marginTop: '0.75rem' }}
              >
                <h5 className="report-block__subtitle" style={{ margin: 0 }}>
                  연차별 전기원가 모델 (요금구조 연동)
                </h5>
                <div className="var-row standby-merge__scope">
                  <label className="radio">
                    <input
                      type="radio"
                      name="elecYearMode"
                      checked={(inputs.elecYearMode ?? 'demandFixed') === 'demandFixed'}
                      onChange={() => set({ elecYearMode: 'demandFixed' })}
                    />
                    <span>수용률·계약전력 고정 (부하율↑·실효원가↓)</span>
                  </label>
                  <label className="radio">
                    <input
                      type="radio"
                      name="elecYearMode"
                      checked={inputs.elecYearMode === 'loadFactorFixed'}
                      onChange={() => set({ elecYearMode: 'loadFactorFixed' })}
                    />
                    <span>부하율 고정 (계약전력 증설·실효원가 일정)</span>
                  </label>
                </div>
              </div>
              <div className="table-scroll">
                <table className="data-table charger-table">
                  <thead>
                    <tr>
                      <th>구분</th>
                      {elecYearModel!
                        .slice(
                          0,
                          Math.max(1, Math.min(7, Math.round(inputs.years))),
                        )
                        .map((_, i) => (
                          <th key={i}>{i + 1}년차</th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="col-name">계약전력(kW)</td>
                      {elecYearModel!
                        .slice(
                          0,
                          Math.max(1, Math.min(7, Math.round(inputs.years))),
                        )
                        .map((m, i) => (
                          <td key={i}>{formatNumber(Math.round(m.contractKw))}</td>
                        ))}
                    </tr>
                    <tr>
                      <td className="col-name">부하율(%)</td>
                      {elecYearModel!
                        .slice(
                          0,
                          Math.max(1, Math.min(7, Math.round(inputs.years))),
                        )
                        .map((m, i) => (
                          <td
                            key={i}
                            className={m.loadFactor > 1 ? 'cell--down' : ''}
                            title={
                              m.loadFactor > 1
                                ? '부하율 100% 초과 — 계약전력 초과(증설 필요)'
                                : undefined
                            }
                          >
                            {(m.loadFactor * 100).toFixed(1)}%
                          </td>
                        ))}
                    </tr>
                    <tr>
                      <td className="col-name">월 충전량(kWh)</td>
                      {elecYearModel!
                        .slice(
                          0,
                          Math.max(1, Math.min(7, Math.round(inputs.years))),
                        )
                        .map((m, i) => (
                          <td key={i}>{formatNumber(Math.round(m.monthlyKwh))}</td>
                        ))}
                    </tr>
                    <tr>
                      <td className="col-name">연 충전량(kWh)</td>
                      {elecYearModel!
                        .slice(
                          0,
                          Math.max(1, Math.min(7, Math.round(inputs.years))),
                        )
                        .map((m, i) => (
                          <td key={i}>
                            {formatNumber(Math.round(m.monthlyKwh * 12))}
                          </td>
                        ))}
                    </tr>
                    <tr className="row--sub">
                      <td className="col-name">실효원가(원/kWh)</td>
                      {elecYearModel!
                        .slice(
                          0,
                          Math.max(1, Math.min(7, Math.round(inputs.years))),
                        )
                        .map((m, i) => (
                          <td key={i} className="cell--strong">
                            {m.effCost.toFixed(1)}
                          </td>
                        ))}
                    </tr>
                    <tr className="row--total">
                      <td className="col-name">연 전기원가(원)</td>
                      {elecYearModel!
                        .slice(
                          0,
                          Math.max(1, Math.min(7, Math.round(inputs.years))),
                        )
                        .map((m, i) => (
                          <td key={i} className="cell--strong">
                            {formatNumber(Math.round(m.effCost * m.monthlyKwh * 12))}
                          </td>
                        ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="var-hint">
                <b>부하율 = 이용률 ÷ 수용률(동시충전율)</b>. ·{' '}
                <b>수용률·계약전력 고정</b>: 피크(계약전력)를 유지 → 이용률↑ 시
                사용량만 늘어 <b>부하율 상승·실효원가(원/kWh) 하락</b> (부하율 100%
                초과 시 계약전력 증설 필요). ·{' '}
                <b>부하율 고정</b>: 계약전력을 충전량 비례로 증설 → 실효원가 거의
                일정하나 계약전력·기본요금 총액이 매년 증가. 각 연차 실효원가가
                손익에 개별 반영됩니다. 전기원가 직접입력(override) 시 이 모델 대신
                단일값이 적용됩니다.
              </p>
            </>
          )}
        </div>

        <div className="subsection">
          <h4 className="summary-block__title">영업비 · CAPEX</h4>
          <div className="var-row">
            <label className="var-field">
              <span className="var-field__label">
                영업비 1대분 단가
                <span className="var-field__unit">원/대</span>
              </span>
              <DecimalInput
                className="var-field__input"
                value={appliedBizFee}
                onValue={(n) => set({ bizFeeOverride: n })}
              />
              <span className="var-field__std">
                {hasBizFeeOverride ? (
                  <>
                    프로젝트 개별값 적용 중 ·{' '}
                    <button
                      type="button"
                      className="btn-link"
                      onClick={() => set({ bizFeeOverride: null })}
                    >
                      기준표({formatNumber(standardBizFee)}원)로 되돌리기
                    </button>
                  </>
                ) : (
                  `기준표(계약 ${Math.round(inputs.years)}년) ${formatNumber(standardBizFee)}원 일괄 적용`
                )}
              </span>
            </label>
            <Field label="모자분리" unit="원/대" value={inputs.mojaBunri} onChange={(v) => set({ mojaBunri: v })} standard={`${formatNumber(STD.mojaBunri)}원`} />
            <Field label="미니PC" unit="원/단지" value={inputs.miniPc} onChange={(v) => set({ miniPc: v })} standard={`${formatNumber(STD.miniPc)}원`} />
          </div>
        </div>
      </div>

      <div className="var-panel">
        <h3 className="subsection__title">
          대당 월 운영비 (OPEX){' '}
          <span className="count-tag">
            기본 {won(r.opexBasic)} + 추가 {won(r.opexExtra)} = {won(r.opexPerUnit)}/대·월
          </span>
        </h3>

        <h4 className="summary-block__title">
          기본 운영비 <span className="count-tag">합계 {won(r.opexBasic)}</span>
        </h4>
        <div className="table-scroll">
          <table className="data-table opex-table">
            <colgroup>
              <col />
              <col className="opex-col-cost" />
              <col className="opex-col-inc" />
              <col className="opex-col-del" />
            </colgroup>
            <thead>
              <tr>
                <th>항목</th>
                <th>월 비용(원/대)</th>
                <th>포함</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inputs.opex.map((o, i) => (
                <tr key={o.id} className={o.included ? '' : 'row--off'}>
                  <td>
                    <span className="opex-label-static">{o.label}</span>
                  </td>
                  <td>
                    <input
                      className="cell-input"
                      type="number"
                      min={0}
                      value={Math.round(o.monthly) || ''}
                      onChange={(e) => {
                        const opex = inputs.opex.map((x, j) =>
                          j === i ? { ...x, monthly: Number(e.target.value) || 0 } : x,
                        )
                        set({ opex })
                      }}
                    />
                  </td>
                  <td className="opex-inc-cell">
                    <input
                      type="checkbox"
                      checked={o.included}
                      onChange={(e) => {
                        const opex = inputs.opex.map((x, j) =>
                          j === i ? { ...x, included: e.target.checked } : x,
                        )
                        set({ opex })
                      }}
                    />
                  </td>
                  <td />
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className="summary-block__title" style={{ marginTop: '1rem' }}>
          추가 운영비 <span className="count-tag">합계 {won(r.opexExtra)}</span>
        </h4>
        <div className="table-scroll">
          <table className="data-table opex-table">
            <colgroup>
              <col />
              <col className="opex-col-cost" />
              <col className="opex-col-inc" />
              <col className="opex-col-del" />
            </colgroup>
            <thead>
              <tr>
                <th>항목</th>
                <th>월 비용(원/대)</th>
                <th>포함</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {inputs.opexExtra.map((o, i) => (
                <tr key={o.id} className={o.included ? '' : 'row--off'}>
                  <td>
                    <input
                      className="cell-input opex-label-input"
                      type="text"
                      value={o.label}
                      placeholder="항목명"
                      onChange={(e) => {
                        const opexExtra = inputs.opexExtra.map((x, j) =>
                          j === i ? { ...x, label: e.target.value } : x,
                        )
                        set({ opexExtra })
                      }}
                    />
                  </td>
                  <td>
                    <input
                      className="cell-input"
                      type="number"
                      min={0}
                      value={Math.round(o.monthly) || ''}
                      onChange={(e) => {
                        const opexExtra = inputs.opexExtra.map((x, j) =>
                          j === i ? { ...x, monthly: Number(e.target.value) || 0 } : x,
                        )
                        set({ opexExtra })
                      }}
                    />
                  </td>
                  <td className="opex-inc-cell">
                    <input
                      type="checkbox"
                      checked={o.included}
                      onChange={(e) => {
                        const opexExtra = inputs.opexExtra.map((x, j) =>
                          j === i ? { ...x, included: e.target.checked } : x,
                        )
                        set({ opexExtra })
                      }}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="remove-button"
                      aria-label="항목 삭제"
                      onClick={() =>
                        set({
                          opexExtra: inputs.opexExtra.filter((_, j) => j !== i),
                        })
                      }
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="link-button"
          onClick={() =>
            set({
              opexExtra: [
                ...inputs.opexExtra,
                { id: 'ex' + Date.now(), label: '', monthly: 0, included: true },
              ],
            })
          }
        >
          + 추가 항목
        </button>
      </div>

      <div className="subsection">
        <h3 className="subsection__title">
          사업 전체 손익 (P&amp;L · {inputs.years}년)
        </h3>
        <div className="table-scroll">
          <table className="data-table pnl-table">
            <tbody>
              {pnl.map((row) => (
                <tr key={row.label} className={row.strong ? 'row--strong' : ''}>
                  <td className="col-name">{row.label}</td>
                  <td className={row.minus ? 'cell--down' : ''}>{won(row.value)}</td>
                </tr>
              ))}
              <tr className="row--strong">
                <td className="col-name">영업이익률</td>
                <td>{(r.margin * 100).toFixed(2)}%</td>
              </tr>
              <tr className="row--strong">
                <td
                  className="col-name"
                  title="투자액(CAPEX + 영업비 총액)을 연간 영업현금흐름(매출총이익 − 현장 운영비)으로 회수하는 데 걸리는 기간"
                >
                  CAPEX·영업비 회수기간
                </td>
                <td className={payback.reached ? '' : 'cell--down'}>
                  {payback.text}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="table-note">
          전기원가 {effElecCost.toFixed(1)}원/kWh · PG 수수료율{' '}
          {(PG_RATE * 100).toFixed(2)}% ·
          누적 충전량(ΣW) {formatNumber(Math.round(r.sumW))} kWh · 영업비
          환산계수 {r.convFactor.toFixed(4)}. 사업성 판정: 영업이익률 ≥ 목표이면
          진행가능. · 회수기간 투자액 = CAPEX {won(-r.capex)} + 영업비{' '}
          {won(-r.bizCost)} = {won(investment)}.
        </p>

        {/* 충전기별 손익 상세 (항상 표시) */}
        <h4 className="subsection__subtitle">충전기별 손익 상세</h4>
        <div className="table-scroll">
            <table className="data-table pnl-table">
              <thead>
                <tr>
                  <th>종류</th>
                  <th>대수</th>
                  <th>매출</th>
                  <th>전기원가(+PG)</th>
                  <th>운영비</th>
                  <th>영업비</th>
                  <th>CAPEX</th>
                  <th>영업이익</th>
                  <th>이익률</th>
                </tr>
              </thead>
              <tbody>
                {perChargerRows.map((row) => (
                  <tr key={row.label}>
                    <td className="col-name">{row.label}</td>
                    <td>{row.count.toLocaleString()}대</td>
                    <td>{won(row.rev)}</td>
                    <td className="cell--down">{won(row.elec)}</td>
                    <td className="cell--down">{won(row.ops)}</td>
                    <td className="cell--down">{won(row.biz)}</td>
                    <td className="cell--down">{won(row.capex)}</td>
                    <td className={row.op >= 0 ? '' : 'cell--down'}>
                      {won(row.op)}
                    </td>
                    <td>{(row.margin * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="table-note">
              전기원가·대기전력은 사용량 비례, 운영비·CAPEX는 대당 균등, 영업비는
              대분 환산(콘센트·3.5kW 1/4대분 · 7kW 1대분 · 급속 0) 비중으로
              배분한 값입니다. (전기원가 칸은 PG 수수료 포함)
            </p>
        </div>

        {/* 연간 손익 상세 (항상 표시) */}
        <h4 className="subsection__subtitle">연간 손익 상세</h4>
        <div className="table-scroll">
            <table className="data-table pnl-table">
              <thead>
                <tr>
                  <th>연차</th>
                  <th>매출</th>
                  <th>전기원가(+PG)</th>
                  <th>매출총이익</th>
                  <th>현장 운영비</th>
                  <th>영업현금흐름</th>
                  <th>누적 현금흐름</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let cum = 0
                  return perYearRows.map((row) => {
                    cum += row.cf
                    const crossed = cum >= investment
                    return (
                      <tr key={row.year}>
                        <td className="col-name">{row.year}년차</td>
                        <td>{won(row.rev)}</td>
                        <td className="cell--down">{won(row.elec + row.pg)}</td>
                        <td>{won(row.gross)}</td>
                        <td className="cell--down">{won(row.ops)}</td>
                        <td className={row.cf >= 0 ? '' : 'cell--down'}>
                          {won(row.cf)}
                        </td>
                        <td className={crossed ? 'cell--up' : ''}>
                          {won(cum)}
                        </td>
                      </tr>
                    )
                  })
                })()}
              </tbody>
            </table>
            <p className="table-note">
              영업현금흐름 = 매출총이익 − 현장 운영비 (영업비·CAPEX 제외). 누적
              현금흐름이 투자액 {won(investment)}에 도달하는 시점이 회수기간이며,
              도달한 연차는 <b>초록색</b>으로 표시됩니다. 매출·충전 전기원가는
              연차별 이용률(사용량) 증가를 반영합니다.
            </p>
        </div>
      </div>

      {/* 목표 달성 충전단가 */}
      <div className="subsection">
        <h3 className="subsection__title">목표 영업이익률 달성 충전단가</h3>
        <div className="target-box">
          <div className="target-row">
            <span>영업이익률 목표</span>
            <b>{(r.targetMargin * 100).toFixed(2)} %</b>
          </div>
          <div className="target-row">
            <span>목표 달성 충전 단가</span>
            <b>
              {r.targetRate == null
                ? '달성불가'
                : `${formatNumber(Math.round(r.targetRate))} 원/kWh`}
            </b>
          </div>
        </div>

        {/* 영업이익률 직접입력 → 목표달성 충전단가 자동계산 */}
        <div className="target-box target-box--calc">
          <div className="target-row">
            <label className="target-input">
              <span>영업이익률 직접입력</span>
              <span className="target-input__field">
                <input
                  type="number"
                  step="0.1"
                  inputMode="decimal"
                  value={customMarginPct}
                  placeholder={(r.targetMargin * 100).toFixed(2)}
                  onChange={(e) => setCustomMarginPct(e.target.value)}
                />
                <em>%</em>
              </span>
            </label>
          </div>
          <div className="target-row">
            <span>목표 달성 충전 단가</span>
            <b>
              {customTargetRate == null
                ? '달성불가'
                : `${formatNumber(Math.round(customTargetRate))} 원/kWh`}
            </b>
          </div>
          <p className="hint hint--tight">
            입력 없으면 UC 기준 목표이익률(
            {(r.targetMargin * 100).toFixed(2)}%)로 계산됩니다. 단가 = 고정비 ÷
            {'{'}12·연사용량·(1−PG−목표이익률){'}'} × 1.1(VAT).
          </p>
        </div>

        {/* 종류별 목표 달성 충전단가 */}
        <h4 className="summary-block__title" style={{ marginTop: '0.75rem' }}>
          충전기 종류별 목표 달성 충전단가
        </h4>
        <div className="table-scroll">
          <table className="data-table charger-table">
            <thead>
              <tr>
                <th>종류</th>
                <th>대수</th>
                <th>계약기간 총 사용량(kWh)</th>
                <th>목표 달성 단가(원/kWh)</th>
              </tr>
            </thead>
            <tbody>
              {perTypeTarget(
                customMarginPct.trim() === '' ? r.targetMargin : customMargin,
              )
                .filter((t) => t.count > 0)
                .map((t) => (
                  <tr key={t.row.kw}>
                    <td className="col-name">{t.row.label}</td>
                    <td>{t.count.toLocaleString()}</td>
                    <td>{formatNumber(Math.round(t.totalKwh))}</td>
                    <td className="cell--strong">
                      {t.target == null
                        ? '달성불가'
                        : `${formatNumber(Math.round(t.target))} 원/kWh`}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="hint hint--tight">
          종류별 배분: 전기원가는 사용량 비례, 운영·영업·CAPEX는 대당 균등
          배분해 그 종류의 사용량으로 나눕니다. 사용량이 적은 완속은 대당
          고정비 부담이 커 목표 단가가 높고, 사용량이 큰 급속은 낮습니다. 종류별
          단가를 사용량 가중 평균하면 위 전체 목표 단가와 일치합니다. (목표이익률{' '}
          {(
            (customMarginPct.trim() === '' ? r.targetMargin : customMargin) * 100
          ).toFixed(2)}
          % 기준)
        </p>
      </div>

      {/* ③ 영업비 차감 → 충전단가 인하 */}
      <div className="var-panel">
        <h3 className="subsection__title">③ 영업비 차감 → 충전단가 인하 검토</h3>
        <div className="var-row">
          <Field
            label="영업비 차감/대"
            unit="원/대(1대분)"
            value={inputs.bizFeeDiscount}
            onChange={(v) => set({ bizFeeDiscount: v })}
          />
          <div className="var-field">
            <span className="var-field__label">영업비 절감액(총)</span>
            <div className="var-field__auto">{won(r.savings)}</div>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>기준</th>
                <th>단가 인하폭(원/kWh)</th>
                <th>인하 후 충전단가(원/kWh)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="col-name">영업이익률 유지</td>
                <td>{rateStr(r.priceCutMargin)}</td>
                <td className="cell--up">{rateStr(r.rateAfterMargin)}</td>
              </tr>
              <tr>
                <td className="col-name">영업이익(절대액) 유지</td>
                <td>{rateStr(r.priceCutProfit)}</td>
                <td className="cell--up">{rateStr(r.rateAfterProfit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="table-note">
          영업비 차감분을 충전단가 인하로 환원. 영업이익률 유지 기준은 목표
          수익률을 지키는 범위, 영업이익(절대액) 유지 기준은 이익 총액을 지키는
          범위입니다.
        </p>
      </div>

      {/* ④ 영업이익 포기율 기반 단가 인하 */}
      <div className="var-panel">
        <h3 className="subsection__title">④ 영업이익 포기율 기반 단가 인하</h3>
        <div className="var-row">
          <Field
            label="영업이익 포기율"
            unit="%"
            step="any"
            value={+(inputs.profitGiveupRate * 100).toFixed(4)}
            onChange={(v) => set({ profitGiveupRate: (v || 0) / 100 })}
          />
          <div className="var-field">
            <span className="var-field__label">영업이익 포기 금액</span>
            <div className="var-field__auto">{won(r.giveupAmount)}</div>
          </div>
          <div className="var-field">
            <span className="var-field__label">포기 후 목표 영업이익률</span>
            <div className="var-field__auto">
              {(r.marginAfterGiveup * 100).toFixed(2)}%
            </div>
          </div>
        </div>
        <p className="scenario-line">
          단가 인하폭 <b>{rateStr(r.priceCutGiveup)}</b> → 인하 후 충전단가{' '}
          <b className="cell--up">{rateStr(r.rateAfterGiveup)}</b>{' '}
          <span className="var-field__unit">원/kWh · VAT포함</span>
        </p>
      </div>
    </section>
  )
}
