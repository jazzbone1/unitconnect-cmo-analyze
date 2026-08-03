import {
  computeTariff,
  TARIFF_PLANS,
  type TariffInputs,
} from '../lib/tariff'
import { formatNumber } from '../lib/stats'

interface Props {
  inputs: TariffInputs
  setInputs: (i: TariffInputs) => void
}

function NumField({
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
      <span className="var-field__label">{label}</span>
      <span className="var-field__input">
        <input
          className="cell-input"
          type="number"
          step={step}
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
        {unit && <span className="var-field__unit">{unit}</span>}
      </span>
    </label>
  )
}

export default function TariffAnalysis({ inputs, setInputs }: Props) {
  const set = (patch: Partial<TariffInputs>) => setInputs({ ...inputs, ...patch })
  const r = computeTariff(inputs)
  const touSum = inputs.touLight + inputs.touMid + inputs.touPeak

  return (
    <section className="card settlement">
      <div className="card__header">
        <div>
          <h2>요금 구조 분석 · 한전 고압 TOU</h2>
          <p className="group-range">
            TOU 비중·계약전력·월충전량으로 선택 I~IV 실효 전기원가를 산출하고
            최저 요금제를 자동 선택합니다.
          </p>
        </div>
      </div>

      {/* 변수 입력 */}
      <div className="var-panel">
        <h3 className="subsection__title">① 변수 입력</h3>
        <div className="var-row">
          <NumField label="TOU 경부하 비중" step={0.0001} value={inputs.touLight} onChange={(v) => set({ touLight: v })} />
          <NumField label="TOU 중간부하 비중" step={0.0001} value={inputs.touMid} onChange={(v) => set({ touMid: v })} />
          <NumField label="TOU 최대부하 비중" step={0.0001} value={inputs.touPeak} onChange={(v) => set({ touPeak: v })} />
          <label className="var-field">
            <span className="var-field__label">합계 검증</span>
            <span className={`var-field__input ${Math.abs(touSum - 1) < 1e-6 ? 'ok' : 'warn'}`}>
              {(touSum * 100).toFixed(1)}% {Math.abs(touSum - 1) < 1e-6 ? '✓' : '⚠ 100% 아님'}
            </span>
          </label>
        </div>
        <div className="var-row">
          <NumField label="기본요금 단가" unit="원/kW·월" value={inputs.baseUnitPrice} onChange={(v) => set({ baseUnitPrice: v })} />
          <NumField label="계약전력" unit="kW" value={inputs.contractKw} onChange={(v) => set({ contractKw: v })} />
          <NumField label="월 총 충전량" unit="kWh/월" value={inputs.monthlyKwh} onChange={(v) => set({ monthlyKwh: v })} />
        </div>
        <div className="var-row">
          <NumField label="기후환경요금" unit="원/kWh" value={inputs.climate} onChange={(v) => set({ climate: v })} />
          <NumField label="연료비조정액" unit="원/kWh" value={inputs.fuel} onChange={(v) => set({ fuel: v })} />
          <NumField label="기금율" step={0.001} value={inputs.fundRate} onChange={(v) => set({ fundRate: v })} />
          <NumField label="부가세율" step={0.01} value={inputs.vatRate} onChange={(v) => set({ vatRate: v })} />
        </div>
        <div className="var-row">
          <NumField label="현재 가중평균 요금" unit="원/kWh" value={inputs.currentRate} onChange={(v) => set({ currentRate: v })} />
          <NumField label="운영비 (손익분기용)" unit="원/kWh" value={inputs.opexPerKwh} onChange={(v) => set({ opexPerKwh: v })} />
          <label className="var-field">
            <span className="var-field__label">kWh당 기본요금(자동)</span>
            <span className="var-field__input">{formatNumber(r.baseKwh)} 원/kWh</span>
          </label>
        </div>
      </div>

      {/* 요금제 비교 */}
      <div className="subsection">
        <h3 className="subsection__title">② 요금제 비교 및 자동 선택</h3>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>선택</th>
                <th>요금제</th>
                <th>가중단가</th>
                <th>실효원가</th>
                <th>운영손익분기</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              {r.plans.map((p, idx) => (
                <tr key={p.id} className={idx === r.selectedIdx ? 'row--total' : ''}>
                  <td>
                    <input
                      type="radio"
                      name="tariff-plan"
                      checked={idx === r.selectedIdx}
                      onChange={() => set({ manualPlan: idx })}
                      aria-label={`${p.name} 선택`}
                    />
                  </td>
                  <td className="col-name">{p.name}</td>
                  <td>{formatNumber(p.weighted)}</td>
                  <td className="cell--strong">{formatNumber(p.effCost)}</td>
                  <td>{formatNumber(p.breakeven)}</td>
                  <td className="cell--muted">
                    {p.isMin ? '◀ 최저' : ''} {TARIFF_PLANS[idx].note}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="table-note">
          자동 선택: 가중단가 최저 요금제. 라디오로 수동 지정 가능.{' '}
          {inputs.manualPlan != null && (
            <button type="button" className="link-button" onClick={() => set({ manualPlan: null })}>
              자동선택으로
            </button>
          )}
        </p>
      </div>

      {/* 요금 구조 요약 */}
      <div className="subsection">
        <h3 className="subsection__title">③ 요금 구조 (선택: {r.selected.name})</h3>
        <div className="overview">
          <div className="stat">
            <span className="stat__value">{formatNumber(r.selected.effCost)}</span>
            <span className="stat__label">실효 전기원가 (원/kWh)</span>
          </div>
          <div className="stat">
            <span className="stat__value">{formatNumber(r.selected.breakeven)}</span>
            <span className="stat__label">운영손익분기 요금 (원/kWh)</span>
          </div>
          <div className="stat">
            <span className="stat__value">{formatNumber(inputs.currentRate)}</span>
            <span className="stat__label">현재 가중평균 요금</span>
          </div>
          <div className="stat">
            <span className={`stat__value ${r.marginRoom >= 0 ? 'cell--up' : 'cell--down'}`}>
              {formatNumber(r.marginRoom)}
            </span>
            <span className="stat__label">운영 마진 여유 (원/kWh)</span>
          </div>
        </div>
      </div>
    </section>
  )
}
