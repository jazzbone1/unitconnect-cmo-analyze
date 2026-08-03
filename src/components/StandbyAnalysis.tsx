import type { ChargerType } from '../lib/settlement'
import {
  computeStandby,
  DEFAULT_STANDBY_W,
  type StandbyInputs,
} from '../lib/standby'
import { formatNumber } from '../lib/stats'

interface Props {
  chargers: ChargerType[]
  inputs: StandbyInputs
  setInputs: (i: StandbyInputs) => void
  /** 요금 구조에서 산출된 실효 전기원가 (원/kWh) */
  effCost: number
}

export default function StandbyAnalysis({
  chargers,
  inputs,
  setInputs,
  effCost,
}: Props) {
  const r = computeStandby(chargers, inputs, effCost)
  const setWatt = (id: string, w: number) =>
    setInputs({ ...inputs, watt: { ...inputs.watt, [id]: w } })

  return (
    <section className="card settlement">
      <div className="card__header">
        <div>
          <h2>대기전력 분석 · EPA 기준</h2>
          <p className="group-range">
            충전기 유형별 대기전력(W) × 대수 → 월 대기전력량·비용. 대수는 충전기
            설정과 자동 연동됩니다.
          </p>
        </div>
      </div>

      <div className="var-panel">
        <div className="var-row">
          <label className="var-field">
            <span className="var-field__label">적용 전기단가</span>
            <span className="var-field__input">
              <input
                className="cell-input"
                type="number"
                placeholder={effCost.toFixed(2)}
                value={inputs.elecCostOverride ?? ''}
                onChange={(e) =>
                  setInputs({
                    ...inputs,
                    elecCostOverride:
                      e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
              <span className="var-field__unit">원/kWh</span>
            </span>
          </label>
          <label className="var-field">
            <span className="var-field__label">실효 전기원가(요금구조)</span>
            <span className="var-field__input">{formatNumber(effCost)} 원/kWh</span>
          </label>
        </div>
        <p className="var-hint">
          적용 전기단가를 비우면 요금 구조 분석의 실효 전기원가를 사용합니다.
          월 대기전력량 = 대수 × W × 24h × 30d ÷ 1000.
        </p>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>충전기 유형</th>
              <th>대수(자동)</th>
              <th>대당 대기전력(W)</th>
              <th>월 대기전력량(kWh)</th>
              <th>월 비용(원)</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.map((row) => (
              <tr key={row.id}>
                <td className="col-name">{row.name}</td>
                <td>{row.count.toLocaleString()}</td>
                <td>
                  <input
                    className="cell-input"
                    type="number"
                    style={{ width: 80 }}
                    value={inputs.watt[row.id] ?? DEFAULT_STANDBY_W[row.id] ?? 0}
                    onChange={(e) => setWatt(row.id, Number(e.target.value) || 0)}
                  />
                </td>
                <td>{formatNumber(row.monthlyKwh)}</td>
                <td>{formatNumber(Math.round(row.monthlyCost))}</td>
              </tr>
            ))}
            <tr className="row--total">
              <td className="col-name">합계</td>
              <td>{r.totalCount.toLocaleString()}</td>
              <td>—</td>
              <td>{formatNumber(r.totalKwh)}</td>
              <td>{formatNumber(Math.round(r.totalCost))}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="overview">
        <div className="stat">
          <span className="stat__value">{formatNumber(Math.round(r.totalCost))}</span>
          <span className="stat__label">월 대기전력 비용 (원)</span>
        </div>
        <div className="stat">
          <span className="stat__value">{formatNumber(Math.round(r.annualCost))}</span>
          <span className="stat__label">연간 환산 (원)</span>
        </div>
        <div className="stat">
          <span className="stat__value">{formatNumber(r.perUnitMonthly)}</span>
          <span className="stat__label">대당 월비용 (원/대)</span>
        </div>
        <div className="stat">
          <span className="stat__value">{formatNumber(r.totalKwh)}</span>
          <span className="stat__label">월 대기전력량 (kWh)</span>
        </div>
      </div>

      <p className="table-note">
        EPA Energy Star 공인 중간값 기준(급속 50/100kW 85W, 완속 7/3.5kW 5W, 3kW
        3W). 값은 현장별로 수정 가능합니다. 대당 월비용은 운영비의 대기전력
        항목으로 활용됩니다.
      </p>
    </section>
  )
}
