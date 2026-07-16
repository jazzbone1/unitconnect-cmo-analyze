import type { SettlementConfig } from '../lib/settlement'
import {
  computeFeasibility,
  defaultBizFee,
  ELEC_COST,
  PG_RATE,
  type FeasibilityInputs,
} from '../lib/feasibility'
import { formatNumber } from '../lib/stats'

interface FeasibilityAnalysisProps {
  inputs: FeasibilityInputs
  setInputs: (i: FeasibilityInputs) => void
  config: SettlementConfig
}

/** 숫자 입력 필드 (라벨 + 단위) */
function Field({
  label,
  unit,
  value,
  onChange,
  step,
}: {
  label: string
  unit?: string
  value: number
  onChange: (v: number) => void
  step?: number
}) {
  return (
    <label className="var-field">
      <span className="var-field__label">
        {label}
        {unit && <span className="var-field__unit">{unit}</span>}
      </span>
      <input
        className="var-field__input"
        type="number"
        step={step}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
    </label>
  )
}

const won = (n: number) => `${formatNumber(Math.round(n))}원`

export default function FeasibilityAnalysis({
  inputs,
  setInputs,
  config,
}: FeasibilityAnalysisProps) {
  const r = computeFeasibility(inputs)
  const set = (patch: Partial<FeasibilityInputs>) =>
    setInputs({ ...inputs, ...patch })

  // 단지 정보의 충전기 수량을 불러온다 (50kW→급속, 7/3.5/3kW→완속)
  function pullFromSite() {
    const cnt = (kw: number) =>
      config.chargers.find((c) => c.kw === kw)?.count ?? 0
    set({
      countFast50: cnt(50),
      countSlow7: cnt(7),
      countSlow35: cnt(3.5),
      countSlow3: cnt(3),
    })
  }

  const chargerRows: {
    key: 'Fast50' | 'Slow7' | 'Slow35' | 'Slow3'
    label: string
  }[] = [
    { key: 'Fast50', label: '급속 50kW' },
    { key: 'Slow7', label: '완속 7kW' },
    { key: 'Slow35', label: '완속 3.5kW' },
    { key: 'Slow3', label: '완속(콘센트) 3kW' },
  ]

  const pnl: { label: string; value: number; strong?: boolean; minus?: boolean }[] = [
    { label: '매출 (VAT 제외)', value: r.revenue, strong: true },
    { label: '(−) PG 수수료', value: r.pgFee, minus: true },
    { label: '(−) 전기원가', value: r.elecCost, minus: true },
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

      {/* 판정 결과 요약 */}
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

      {/* ① 변수 입력 */}
      <div className="var-panel">
        <h3 className="subsection__title">① 변수 입력</h3>
        <div className="var-row">
          <Field
            label="계약년수"
            unit="년(1~5)"
            value={inputs.years}
            onChange={(v) => set({ years: v, bizFeePerUnit: defaultBizFee(v) })}
          />
          <Field
            label="충전단가(VAT 포함)"
            unit="원/kWh"
            value={inputs.rateVat}
            onChange={(v) => set({ rateVat: v })}
          />
        </div>

        <div className="subsection">
          <div className="site-edit-head">
            <h4 className="summary-block__title">
              충전기 종류별 대수 · 이용률
            </h4>
            <button type="button" className="link-button" onClick={pullFromSite}>
              단지 정보 대수 불러오기
            </button>
          </div>
          <div className="table-scroll">
            <table className="data-table charger-table">
              <thead>
                <tr>
                  <th>종류</th>
                  <th>대수</th>
                  <th>이용률(%)</th>
                </tr>
              </thead>
              <tbody>
                {chargerRows.map((row) => {
                  const countKey = (`count` + row.key) as keyof FeasibilityInputs
                  const utilKey = (`util` + row.key) as keyof FeasibilityInputs
                  return (
                    <tr key={row.key}>
                      <td className="col-name">{row.label}</td>
                      <td>
                        <input
                          className="cell-input"
                          type="number"
                          min={0}
                          value={(inputs[countKey] as number) || ''}
                          placeholder="0"
                          onChange={(e) =>
                            set({ [countKey]: Number(e.target.value) || 0 } as Partial<FeasibilityInputs>)
                          }
                        />
                      </td>
                      <td>
                        <input
                          className="cell-input"
                          type="number"
                          step={0.1}
                          value={+(((inputs[utilKey] as number) * 100).toFixed(4)) || ''}
                          placeholder="0"
                          onChange={(e) =>
                            set({ [utilKey]: (Number(e.target.value) || 0) / 100 } as Partial<FeasibilityInputs>)
                          }
                        />
                      </td>
                    </tr>
                  )
                })}
                <tr>
                  <td className="col-name">합계</td>
                  <td>{r.totalUnits.toLocaleString()}대</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="subsection">
          <h4 className="summary-block__title">
            연차별 이용률 (7kW 환산, 성장 예상)
          </h4>
          <div className="var-row">
            <Field label="2년차" unit="%" step={0.1} value={+(inputs.yearUtil2 * 100).toFixed(4)} onChange={(v) => set({ yearUtil2: v / 100 })} />
            <Field label="3년차" unit="%" step={0.1} value={+(inputs.yearUtil3 * 100).toFixed(4)} onChange={(v) => set({ yearUtil3: v / 100 })} />
            <Field label="4년차" unit="%" step={0.1} value={+(inputs.yearUtil4 * 100).toFixed(4)} onChange={(v) => set({ yearUtil4: v / 100 })} />
            <Field label="5년차" unit="%" step={0.1} value={+(inputs.yearUtil5 * 100).toFixed(4)} onChange={(v) => set({ yearUtil5: v / 100 })} />
          </div>
        </div>

        <div className="subsection">
          <h4 className="summary-block__title">영업비 · CAPEX</h4>
          <div className="var-row">
            <Field label="영업비 1대분 단가" unit="원/대" value={inputs.bizFeePerUnit} onChange={(v) => set({ bizFeePerUnit: v })} />
            <Field label="모자분리" unit="원/대" value={inputs.mojaBunri} onChange={(v) => set({ mojaBunri: v })} />
            <Field label="미니PC" unit="원/단지" value={inputs.miniPc} onChange={(v) => set({ miniPc: v })} />
          </div>
        </div>
      </div>

      {/* 대당 월 운영비 (OPEX) */}
      <div className="subsection">
        <h3 className="subsection__title">
          대당 월 운영비 (OPEX){' '}
          <span className="count-tag">합계 {won(r.opexPerUnit)}/대·월</span>
        </h3>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>항목</th>
                <th>월 비용(원/대)</th>
                <th>포함</th>
              </tr>
            </thead>
            <tbody>
              {inputs.opex.map((o, i) => (
                <tr key={o.id} className={o.included ? '' : 'row--off'}>
                  <td className="col-name">{o.label}</td>
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
                  <td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ③ P&L */}
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
          전기원가 {ELEC_COST}원/kWh · PG 수수료율 {(PG_RATE * 100).toFixed(2)}% ·
          누적 충전량(ΣW) {formatNumber(Math.round(r.sumW))} kWh · 영업비
          환산계수 {r.convFactor.toFixed(4)}. 사업성 판정: 영업이익률 ≥ 목표이면
          진행가능.
        </p>
      </div>
    </section>
  )
}
