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

interface FeasibilityAnalysisProps {
  inputs: FeasibilityInputs
  setInputs: (i: FeasibilityInputs) => void
  config: SettlementConfig
  /** 모자분리 종류 월 대기전력량 (kWh) — 대기전력 탭 자동연동 */
  standbyMonthlyKwhSeparated?: number
  /** 전체 종류 월 대기전력량 (kWh) — 대기전력 탭 자동연동 */
  standbyMonthlyKwhAll?: number
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
  standbyMonthlyKwhSeparated = 0,
  standbyMonthlyKwhAll = 0,
}: FeasibilityAnalysisProps) {
  const set = (patch: Partial<FeasibilityInputs>) =>
    setInputs({ ...inputs, ...patch })

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
  const yearIdx = Math.max(1, Math.min(MAX_YEARS, Math.round(inputs.years))) - 1
  const appliedBizFee = bizFeeByYear[yearIdx] ?? defaultBizFee(inputs.years)

  // 대수는 단지 정보의 충전기 수량과 자동 연동 (읽기 전용)
  const countOf = (kw: number) =>
    config.chargers.find((c) => c.kw === kw)?.count ?? 0
  const eff: FeasibilityInputs = {
    ...inputs,
    countFast100: countOf(100),
    countFast50: countOf(50),
    countSlow7: countOf(7),
    countSlow35: countOf(3.5),
    countSlow3: countOf(3),
    standbyMonthlyKwhSeparated,
    standbyMonthlyKwhAll,
    // 영업비는 공통 기준표(계약년수별)에서 자동 적용
    bizFeePerUnit: appliedBizFee,
  }
  const r = computeFeasibility(eff)

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

      {/* 1. 영업이익 기준 (계약년수·단가에 따라 기준 변동) */}
      <div className="subsection">
        <h3 className="subsection__title">1. 영업이익 기준 (유닛커넥트 기준표)</h3>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>계약기간</th>
                <th>영업비 1대분(원/대) · 직접기입</th>
                <th>영업이익률 목표<br />(≥244원 · 249원)</th>
                <th>영업이익률 목표<br />(&lt;244원 · 239원)</th>
              </tr>
            </thead>
            <tbody>
              {PROFIT_STANDARD.map((row, i) => {
                const isYear = row.years === Math.max(1, Math.min(MAX_YEARS, Math.round(inputs.years)))
                const highActive = isYear && inputs.rateVat >= 244
                const lowActive = isYear && inputs.rateVat < 244
                return (
                  <tr key={row.years} className={isYear ? 'row--selected' : ''}>
                    <td className="col-name">{row.years}년</td>
                    <td>
                      <DecimalInput
                        className="cell-input"
                        value={bizFeeByYear[i] ?? 0}
                        onValue={(n) => setBizFeeAt(i, n)}
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
            영업비 1대분은 <b>모든 프로젝트 공통(일괄)</b>으로 적용됩니다. 계약년수(
            {Math.max(1, Math.min(MAX_YEARS, Math.round(inputs.years)))}년)에
            해당하는 값이 손익의 영업비로 자동 반영됩니다. (현재 적용:{' '}
            {formatNumber(appliedBizFee)}원 ·{' '}
            {inputs.rateVat >= 244 ? '249원 기준' : '239원 기준'})
          </span>
          <button
            type="button"
            className="btn-link"
            onClick={() => setBizFeeByYear(PROFIT_STANDARD.map((r) => r.bizFee))}
          >
            기본값 복원
          </button>
        </div>
      </div>

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
          <Field
            label="전기원가"
            unit="원/kWh·VAT제외"
            value={inputs.elecCostUnit ?? ELEC_COST}
            onChange={(v) => set({ elecCostUnit: v })}
            standard={`${ELEC_COST}원`}
          />
        </div>

        {/* 대기전력 전기원가 합산/구분 */}
        <div className="subsection standby-merge">
          <div className="standby-merge__head">
            <h4 className="summary-block__title">
              대기전력 전기원가 반영 (대기전력 탭 자동연동)
            </h4>
            <label className="toggle">
              <input
                type="checkbox"
                checked={inputs.includeStandby !== false}
                onChange={(e) => set({ includeStandby: e.target.checked })}
              />
              <span>사업성에 합산</span>
            </label>
          </div>
          <div className="var-row standby-merge__scope">
            <label className="radio">
              <input
                type="radio"
                name="standbyScope"
                checked={(inputs.standbyScope ?? 'separated') === 'separated'}
                onChange={() => set({ standbyScope: 'separated' })}
              />
              <span>모자분리 종류만 ({standbyMonthlyKwhSeparated.toLocaleString()} kWh/월)</span>
            </label>
            <label className="radio">
              <input
                type="radio"
                name="standbyScope"
                checked={inputs.standbyScope === 'all'}
                onChange={() => set({ standbyScope: 'all' })}
              />
              <span>전체 종류 ({standbyMonthlyKwhAll.toLocaleString()} kWh/월)</span>
            </label>
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
            {inputs.elecCostUnit ?? ELEC_COST}원/kWh)로 환산합니다. 합산 시
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
                  <th>종류</th>
                  <th>대수(자동)</th>
                  <th>이용률(%)</th>
                  <th>7kW 환산</th>
                  <th>UC 기준 이용률</th>
                  <th>종류별 요금(원/kWh)</th>
                </tr>
              </thead>
              <tbody>
                {chargerRows.map((row) => (
                  <tr key={row.kw}>
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
                    <td>
                      <DecimalInput
                        className="cell-input"
                        value={inputs[row.rateKey] as number}
                        placeholder={`전체 ${inputs.rateVat}`}
                        onValue={(n) =>
                          set({ [row.rateKey]: n } as Partial<FeasibilityInputs>)
                        }
                      />
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="col-name">합계</td>
                  <td>{r.totalUnits.toLocaleString()}대</td>
                  <td colSpan={4} />
                </tr>
              </tbody>
            </table>
          </div>
          <p className="var-hint">
            종류별 요금을 비우면 전체 충전단가({inputs.rateVat}원)를 사용합니다.
            종류별로 입력하면 에너지 비중으로 가중해 매출에 반영됩니다. · 전체
            이용률(7kW 환산) <b>{(r.overallUtil7kw * 100).toFixed(2)}%</b>{' '}
            (정격별 100/7·50/7·3.5/7·3/7 환산 반영)
          </p>
        </div>

        <div className="subsection">
          <h4 className="summary-block__title">
            연차별 이용률 (7kW 환산, 성장 예상)
          </h4>
          <div className="var-row">
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
            .
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
        </div>

        <div className="subsection">
          <h4 className="summary-block__title">영업비 · CAPEX</h4>
          <div className="var-row">
            <label className="var-field">
              <span className="var-field__label">
                영업비 1대분 단가
                <span className="var-field__unit">원/대 · 기준표 연동</span>
              </span>
              <div className="var-field__auto">{formatNumber(appliedBizFee)}</div>
              <span className="var-field__std">
                기준표(계약 {Math.round(inputs.years)}년)에서 일괄 적용
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
            </tbody>
          </table>
        </div>
        <p className="table-note">
          전기원가 {inputs.elecCostUnit ?? ELEC_COST}원/kWh · PG 수수료율{' '}
          {(PG_RATE * 100).toFixed(2)}% ·
          누적 충전량(ΣW) {formatNumber(Math.round(r.sumW))} kWh · 영업비
          환산계수 {r.convFactor.toFixed(4)}. 사업성 판정: 영업이익률 ≥ 목표이면
          진행가능.
        </p>
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
