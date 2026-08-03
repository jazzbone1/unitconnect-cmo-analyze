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
  // 선택된 요금제 실효원가 산정 단계값
  const sel = r.selected
  const subtotalAB = sel.weighted + sel.baseKwh
  const preTax = subtotalAB + inputs.climate + inputs.fuel
  const taxMult = 1 + inputs.vatRate + inputs.fundRate

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
          <NumField
            label="기본요금 단가(일괄)"
            unit="원/kW·월"
            value={inputs.baseUnitPrice}
            onChange={(v) =>
              set({
                baseUnitPrice: v,
                baseUnitByPlan: { I: v, II: v, III: v, IV: v },
              })
            }
          />
          <NumField label="총 설비용량" unit="kW" value={inputs.installedKw ?? inputs.contractKw} onChange={(v) => set({ installedKw: v })} />
          <NumField label="계약전력 비율(수용률)" step={0.05} value={inputs.contractRatio ?? 1} onChange={(v) => set({ contractRatio: v })} />
          <label className="var-field">
            <span className="var-field__label">계약전력(자동)</span>
            <span className="var-field__input">{formatNumber(r.contractKw)} kW</span>
          </label>
          <NumField label="월 총 충전량" unit="kWh/월" value={inputs.monthlyKwh} onChange={(v) => set({ monthlyKwh: v })} />
        </div>
        <div className="var-row">
          <NumField label="기후환경요금" unit="원/kWh" value={inputs.climate} onChange={(v) => set({ climate: v })} />
          <NumField label="연료비조정액" unit="원/kWh" value={inputs.fuel} onChange={(v) => set({ fuel: v })} />
          <NumField label="기금율" step={0.001} value={inputs.fundRate} onChange={(v) => set({ fundRate: v })} />
          <label className="var-field">
            <span className="var-field__label">부가세(VAT)</span>
            <span className="var-field__input">
              <label className="sep-check">
                <input
                  type="checkbox"
                  checked={inputs.vatRate > 0}
                  onChange={(e) => set({ vatRate: e.target.checked ? 0.1 : 0 })}
                />
                <span>{inputs.vatRate > 0 ? '포함(10%)' : '제외'}</span>
              </label>
            </span>
          </label>
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
                <th>기본요금(원/kW)</th>
                <th>기본요금(원/kWh)</th>
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
                  <td>
                    <input
                      className="cell-input"
                      type="number"
                      style={{ width: 80 }}
                      value={inputs.baseUnitByPlan?.[p.id] ?? inputs.baseUnitPrice}
                      onChange={(e) =>
                        set({
                          baseUnitByPlan: {
                            ...(inputs.baseUnitByPlan ?? {}),
                            [p.id]: Number(e.target.value) || 0,
                          },
                        })
                      }
                    />
                  </td>
                  <td>{formatNumber(p.baseKwh)}</td>
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
          자동 선택: <b>실효원가 최저</b> 요금제(기본요금 포함). 선택별 기본요금
          단가를 다르게 입력하면 반영됩니다. 라디오로 수동 지정 가능.{' '}
          {inputs.manualPlan != null && (
            <button type="button" className="link-button" onClick={() => set({ manualPlan: null })}>
              자동선택으로
            </button>
          )}
        </p>
      </div>

      {/* 실효원가 산정 상세 */}
      <div className="subsection">
        <h3 className="subsection__title">
          ③ 실효 전기원가 산정 상세 (선택: {sel.name})
        </h3>
        <div className="table-scroll">
          <table className="data-table report-table">
            <thead>
              <tr>
                <th>산출 단계</th>
                <th>금액</th>
                <th>근거</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="col-name">(A) 전력량요금 (가중단가)</td>
                <td>{formatNumber(sel.weighted)} 원/kWh</td>
                <td className="cell--muted">
                  경 {inputs.touLight} · 중 {inputs.touMid} · 최 {inputs.touPeak}{' '}
                  × 계절가중(봄가을5·여름3·겨울4)
                </td>
              </tr>
              <tr>
                <td className="col-name">(B) kWh당 기본요금 환산</td>
                <td>{formatNumber(sel.baseKwh)} 원/kWh</td>
                <td className="cell--muted">
                  계약전력 {formatNumber(r.contractKw)}kW × {formatNumber(sel.baseUnit)}
                  원 ÷ {formatNumber(inputs.monthlyKwh)}kWh
                </td>
              </tr>
              <tr className="row--sub">
                <td className="col-name">소계 (A)+(B)</td>
                <td>{formatNumber(subtotalAB)} 원/kWh</td>
                <td></td>
              </tr>
              <tr>
                <td className="col-name">+ 기후환경요금</td>
                <td>+{formatNumber(inputs.climate)} 원/kWh</td>
                <td className="cell--muted">고시값</td>
              </tr>
              <tr>
                <td className="col-name">+ 연료비조정액</td>
                <td>+{formatNumber(inputs.fuel)} 원/kWh</td>
                <td className="cell--muted">분기별 조정 (상한 ±5)</td>
              </tr>
              <tr className="row--sub">
                <td className="col-name">소계 (부가세·기금 전)</td>
                <td>{formatNumber(preTax)} 원/kWh</td>
                <td></td>
              </tr>
              <tr>
                <td className="col-name">× 부가세·기금</td>
                <td>× {taxMult.toFixed(3)}</td>
                <td className="cell--muted">
                  부가세 {(inputs.vatRate * 100).toFixed(0)}% + 기금{' '}
                  {(inputs.fundRate * 100).toFixed(1)}%
                </td>
              </tr>
              <tr className="row--total">
                <td className="col-name">★ 실효 전기원가 (Lv1)</td>
                <td className="cell--strong">{formatNumber(sel.effCost)} 원/kWh</td>
                <td className="cell--muted">
                  운영손익분기 {formatNumber(sel.breakeven)} 원/kWh (+운영비)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* 요금 구조 요약 */}
      <div className="subsection">
        <h3 className="subsection__title">④ 요금 구조 (선택: {r.selected.name})</h3>
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
