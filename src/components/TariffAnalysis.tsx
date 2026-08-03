import {
  computeTariff,
  computeBill,
  defaultBill,
  loadFactor,
  HOURS_PER_MONTH,
  TARIFF_PLANS,
  type TariffInputs,
  type BillInputs,
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

  // 부하율 및 적정 계약전력 판정
  const lf = loadFactor(r.contractKw, inputs.monthlyKwh)
  const targetLF = inputs.targetLoadFactor ?? 0.2
  const properKw =
    targetLF > 0 && inputs.monthlyKwh > 0
      ? inputs.monthlyKwh / (targetLF * HOURS_PER_MONTH)
      : 0
  const ratio = properKw > 0 ? r.contractKw / properKw : 0
  const verdict =
    ratio > 1.15 ? '과대' : ratio < 0.85 ? '과소' : '적정'
  const baseSaving = Math.max(0, r.contractKw - properKw) * sel.baseUnit

  // 계절별 가중단가 (선택 요금제 기준)
  const selPlan = TARIFF_PLANS[r.selectedIdx]
  const seasonRate = (key: 'spring' | 'summer' | 'winter') => {
    if (selPlan.flat) return selPlan.flat[key]
    const t = selPlan.tou!
    return (
      inputs.touLight * t.light[key] +
      inputs.touMid * t.mid[key] +
      inputs.touPeak * t.peak[key]
    )
  }
  const springR = seasonRate('spring')
  const summerR = seasonRate('summer')
  const winterR = seasonRate('winter')

  // 고지서 실측 입력 (독립 계산, 자동반영 안 함)
  const bill = inputs.bill ?? defaultBill()
  const br = computeBill(bill)
  const setBill = (patch: Partial<BillInputs>) =>
    set({ bill: { ...bill, ...patch } })
  const billLoaded = bill.usageKwh > 0

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
          <label className="var-field">
            <span className="var-field__label">총 설비용량(자동)</span>
            <span className="var-field__input">
              {formatNumber(inputs.installedKw ?? inputs.contractKw)} kW
            </span>
          </label>
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
          <label className="var-field">
            <span className="var-field__label">부하율(자동)</span>
            <span className={`var-field__input ${lf > 0 && lf < 0.1 ? 'warn' : lf >= 0.15 ? 'ok' : ''}`}>
              {(lf * 100).toFixed(1)}%
            </span>
          </label>
        </div>
      </div>

      {/* 부하율 및 적정 계약전력 판정 */}
      <div className="subsection">
        <h3 className="subsection__title">② 부하율 · 적정 계약전력 판정</h3>
        <div className="var-panel">
          <div className="var-row">
            <label className="var-field">
              <span className="var-field__label">현재 부하율</span>
              <span className={`var-field__input ${lf < 0.1 ? 'warn' : lf >= 0.15 ? 'ok' : ''}`}>
                {(lf * 100).toFixed(1)}%
              </span>
            </label>
            <NumField
              label="기준 부하율(EV 실측)"
              unit="0.15~0.20"
              step={0.01}
              value={targetLF}
              onChange={(v) => set({ targetLoadFactor: v })}
            />
            <label className="var-field">
              <span className="var-field__label">현재 계약전력</span>
              <span className="var-field__input">{formatNumber(r.contractKw)} kW</span>
            </label>
            <label className="var-field">
              <span className="var-field__label">적정 계약전력</span>
              <span className="var-field__input cell--strong">{formatNumber(properKw)} kW</span>
            </label>
            <label className="var-field">
              <span className="var-field__label">판정</span>
              <span className={`var-field__input ${verdict === '적정' ? 'ok' : 'warn'}`}>
                계약전력 {verdict}
              </span>
            </label>
          </div>
        </div>
        <p className="table-note">
          <b>부하율 = 월 충전량 ÷ (계약전력 × 720h)</b> = 평균부하 ÷ 최대부하.
          부하율은 <b>사용 패턴이 정하는 결과값</b>이지 임의로 높이는 목표가
          아닙니다. 적정 계약전력은 <b>실제 최대수요전력</b>에 맞춰야 하며, 이를
          추정할 때 EV 아파트 충전 <b>실측 부하율(대략 15~20%)</b>를 씁니다.{' '}
          <b>적정 계약전력 = 월 충전량 ÷ (기준 부하율 × 720)</b> ={' '}
          {formatNumber(inputs.monthlyKwh)} ÷ ({targetLF} × 720) ={' '}
          <b>{formatNumber(properKw)} kW</b>.
          {targetLF > 0.4 && (
            <>
              {' '}
              <span className="warn">
                ⚠ 기준 부하율 {(targetLF * 100).toFixed(0)}%는 EV 충전에서
                비현실적으로 높습니다(부하가 24시간 평탄하다는 가정). 실측
                15~20%를 권장합니다.
              </span>
            </>
          )}
          {verdict === '과대' && (
            <>
              {' '}
              → 현재 계약전력이 적정보다{' '}
              <b>{formatNumber(r.contractKw - properKw)} kW 큼</b>. 기본요금 월 약{' '}
              <b>{formatNumber(Math.round(baseSaving))}원</b> 절감 여지(계약전력을
              실측 최대수요전력으로 낮출 경우).
            </>
          )}
          {verdict === '적정' && ' → 현재 계약전력이 추정 최대수요전력에 부합합니다.'}
          {verdict === '과소' &&
            ' → 계약전력이 추정 피크보다 낮음. 계약초과(위약) 위험이 있으니 실측 피크를 확인하세요.'}
        </p>
      </div>

      {/* 계절 판정 상세 */}
      <div className="subsection">
        <h3 className="subsection__title">③ 계절 구분 · 계절별 가중단가 (선택: {sel.name})</h3>
        <div className="table-scroll">
          <table className="data-table report-table">
            <thead>
              <tr>
                <th>계절</th>
                <th>해당 월</th>
                <th>월 수(가중)</th>
                <th>전력량요금(원/kWh)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="col-name">봄가을철</td>
                <td>3·4·5·9·10월</td>
                <td>5 / 12</td>
                <td>{formatNumber(springR)}</td>
              </tr>
              <tr>
                <td className="col-name">여름철</td>
                <td>6·7·8월</td>
                <td>3 / 12</td>
                <td>{formatNumber(summerR)}</td>
              </tr>
              <tr>
                <td className="col-name">겨울철</td>
                <td>11·12·1·2월</td>
                <td>4 / 12</td>
                <td>{formatNumber(winterR)}</td>
              </tr>
              <tr className="row--total">
                <td className="col-name">가중단가 (A)</td>
                <td>연 12개월</td>
                <td>—</td>
                <td className="cell--strong">
                  {formatNumber((springR * 5 + summerR * 3 + winterR * 4) / 12)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="table-note">
          한전 공식 계절 구분(여름 6~8월·봄가을 3~5·9~10월·겨울 11~2월)에 따라{' '}
          <b>월 수 5·3·4로 가중평균</b>합니다. 특정 월 청구서는 그 달이 속한
          계절 단가만 적용됩니다(예: 4월 = 봄가을 {formatNumber(springR)}원).
        </p>
      </div>

      {/* 요금제 비교 */}
      <div className="subsection">
        <h3 className="subsection__title">④ 요금제 비교 및 자동 선택</h3>
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
          ⑤ 실효 전기원가 산정 상세 (선택: {sel.name})
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
        <h3 className="subsection__title">⑥ 요금 구조 (선택: {r.selected.name})</h3>
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

      {/* 고지서 실측 입력 (독립·참고) */}
      <div className="subsection bill-panel">
        <h3 className="subsection__title">⑦ 고지서 실측 입력 (참고 · 자동반영 안 함)</h3>
        <p className="bill-panel__desc">
          한전 청구서의 <b>청구내역</b>을 그대로 넣으면 추정 없이 실효원가가
          바로 나옵니다. 이 값은 <b>다른 분석·항목에 자동 반영되지 않으며</b>,
          한 현장에 모자분리/미적용이 섞인 경우를 위해 <b>계약전력 가이드</b>만
          제공합니다.
        </p>
        <div className="var-panel">
          <div className="var-row">
            <NumField label="기본요금" unit="원" value={bill.basic} onChange={(v) => setBill({ basic: v })} />
            <NumField label="전력량요금" unit="원" value={bill.energy} onChange={(v) => setBill({ energy: v })} />
            <NumField label="기후환경요금" unit="원" value={bill.climate} onChange={(v) => setBill({ climate: v })} />
            <NumField label="연료비조정액" unit="원" value={bill.fuel} onChange={(v) => setBill({ fuel: v })} />
            <NumField label="역률요금" unit="원" value={bill.powerFactor} onChange={(v) => setBill({ powerFactor: v })} />
          </div>
          <div className="var-row">
            <NumField label="부가가치세" unit="원" value={bill.vat} onChange={(v) => setBill({ vat: v })} />
            <NumField label="전력기금" unit="원" value={bill.fund} onChange={(v) => setBill({ fund: v })} />
            <NumField label="원단위절사" unit="원" value={bill.round} onChange={(v) => setBill({ round: v })} />
            <NumField label="사용량" unit="kWh" value={bill.usageKwh} onChange={(v) => setBill({ usageKwh: v })} />
            <NumField label="계약전력(고지서)" unit="kW" value={bill.contractKw} onChange={(v) => setBill({ contractKw: v })} />
          </div>
        </div>

        {billLoaded ? (
          <>
            <div className="overview">
              <div className="stat">
                <span className="stat__value">{formatNumber(br.effExclVat)}</span>
                <span className="stat__label">실효 전기원가 (VAT 제외)</span>
              </div>
              <div className="stat">
                <span className="stat__value">{formatNumber(br.effInclVat)}</span>
                <span className="stat__label">실효 전기원가 (전부 포함)</span>
              </div>
              <div className="stat">
                <span className="stat__value">{formatNumber(Math.round(br.total))}</span>
                <span className="stat__label">당월요금계 (원)</span>
              </div>
              <div className="stat">
                <span className={`stat__value ${br.loadFactor < 0.1 ? 'cell--down' : ''}`}>
                  {(br.loadFactor * 100).toFixed(1)}%
                </span>
                <span className="stat__label">부하율</span>
              </div>
            </div>
            <div className="table-scroll">
              <table className="data-table report-table">
                <thead>
                  <tr>
                    <th>항목</th>
                    <th>금액(원)</th>
                    <th>원/kWh</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td className="col-name">기본요금</td><td>{formatNumber(bill.basic)}</td><td>{formatNumber(br.perKwh.basic)}</td></tr>
                  <tr><td className="col-name">전력량요금</td><td>{formatNumber(bill.energy)}</td><td>{formatNumber(br.perKwh.energy)}</td></tr>
                  <tr><td className="col-name">기후환경요금</td><td>{formatNumber(bill.climate)}</td><td>{formatNumber(br.perKwh.climate)}</td></tr>
                  <tr><td className="col-name">연료비조정액</td><td>{formatNumber(bill.fuel)}</td><td>{formatNumber(br.perKwh.fuel)}</td></tr>
                  <tr><td className="col-name">역률요금</td><td>{formatNumber(bill.powerFactor)}</td><td>{formatNumber(br.perKwh.powerFactor)}</td></tr>
                  <tr className="row--sub"><td className="col-name">전기요금계(VAT 제외)</td><td>{formatNumber(Math.round(br.supply))}</td><td className="cell--strong">{formatNumber(br.effExclVat)}</td></tr>
                  <tr className="row--total"><td className="col-name">당월요금계(포함)</td><td>{formatNumber(Math.round(br.total))}</td><td className="cell--strong">{formatNumber(br.effInclVat)}</td></tr>
                </tbody>
              </table>
            </div>
            <p className="table-note">
              <b>계약전력 가이드</b> (참고): 부하율 {(br.loadFactor * 100).toFixed(1)}% ·
              고지서 계약전력 {formatNumber(bill.contractKw)}kW · 실측 부하율 18% 기준
              적정 계약전력 ≈ <b>{formatNumber(br.properContractKw)}kW</b>.{' '}
              {bill.contractKw > br.properContractKw * 1.15
                ? '→ 계약전력이 추정 피크 대비 여유가 큼(기본요금 절감 여지). 단, 아래 초과 리스크 유의.'
                : bill.contractKw < br.properContractKw * 0.85
                  ? '→ 계약전력이 추정 피크보다 낮음. 계약초과(위약) 위험 점검 필요.'
                  : '→ 계약전력이 추정 피크에 부합.'}
            </p>
          </>
        ) : (
          <p className="table-note">사용량을 입력하면 실효원가와 계약전력 가이드가 표시됩니다.</p>
        )}
      </div>
    </section>
  )
}
