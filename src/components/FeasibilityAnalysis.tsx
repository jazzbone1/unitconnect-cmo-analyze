import type { SettlementConfig } from '../lib/settlement'
import {
  computeFeasibility,
  defaultBizFee,
  standardRate,
  STD,
  PROFIT_STANDARD,
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

function Field({
  label,
  unit,
  value,
  onChange,
  step,
  standard,
}: {
  label: string
  unit?: string
  value: number
  onChange: (v: number) => void
  step?: number
  /** 유닛커넥트 기준(변경금지) 표시값 */
  standard?: string
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
}: FeasibilityAnalysisProps) {
  const set = (patch: Partial<FeasibilityInputs>) =>
    setInputs({ ...inputs, ...patch })

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
  }
  const r = computeFeasibility(eff)

  const chargerRows: {
    kw: number
    label: string
    utilKey: keyof FeasibilityInputs
    rateKey: keyof FeasibilityInputs
  }[] = [
    { kw: 100, label: '초급속 100kW', utilKey: 'utilFast100', rateKey: 'rateFast100' },
    { kw: 50, label: '급속 50kW', utilKey: 'utilFast50', rateKey: 'rateFast50' },
    { kw: 7, label: '완속 7kW', utilKey: 'utilSlow7', rateKey: 'rateSlow7' },
    { kw: 3.5, label: '완속 3.5kW', utilKey: 'utilSlow35', rateKey: 'rateSlow35' },
    { kw: 3, label: '완속(콘센트) 3kW', utilKey: 'utilSlow3', rateKey: 'rateSlow3' },
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
                <th>영업비 1대분(원/대)</th>
                <th>영업이익률 목표<br />(≥244원 · 249원)</th>
                <th>영업이익률 목표<br />(&lt;244원 · 239원)</th>
              </tr>
            </thead>
            <tbody>
              {PROFIT_STANDARD.map((row) => {
                const isYear = row.years === Math.max(1, Math.min(5, Math.round(inputs.years)))
                const highActive = isYear && inputs.rateVat >= 244
                const lowActive = isYear && inputs.rateVat < 244
                return (
                  <tr key={row.years} className={isYear ? 'row--selected' : ''}>
                    <td className="col-name">{row.years}년</td>
                    <td>{formatNumber(row.bizFee)}</td>
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
        <p className="table-note">
          계약년수·충전단가에 따라 영업비 1대분 단가와 영업이익률 목표가 위
          기준표에서 자동 결정됩니다. (현재: {Math.max(1, Math.min(5, Math.round(inputs.years)))}년 ·{' '}
          {inputs.rateVat >= 244 ? '249원 기준' : '239원 기준'})
        </p>
      </div>

      <div className="var-panel">
        <h3 className="subsection__title">① 변수 입력 (좌: 직접 기입 / 우: UC 기준)</h3>
        <div className="var-row">
          <Field
            label="계약년수"
            unit="년(1~5)"
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
                      <input
                        className="cell-input"
                        type="number"
                        step={0.1}
                        value={+(((inputs[row.utilKey] as number) * 100).toFixed(4)) || ''}
                        placeholder="0"
                        onChange={(e) =>
                          set({ [row.utilKey]: (Number(e.target.value) || 0) / 100 } as Partial<FeasibilityInputs>)
                        }
                      />
                    </td>
                    <td className="std-cell">
                      {((STD[row.utilKey as keyof typeof STD] as number) * 100).toFixed(2)}%
                    </td>
                    <td>
                      <input
                        className="cell-input"
                        type="number"
                        min={0}
                        value={(inputs[row.rateKey] as number) || ''}
                        placeholder={`전체 ${inputs.rateVat}`}
                        onChange={(e) =>
                          set({ [row.rateKey]: Number(e.target.value) || 0 } as Partial<FeasibilityInputs>)
                        }
                      />
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="col-name">합계</td>
                  <td>{r.totalUnits.toLocaleString()}대</td>
                  <td colSpan={3} />
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
            <Field label="2년차" unit="%" step={0.1} value={+(inputs.yearUtil2 * 100).toFixed(4)} onChange={(v) => set({ yearUtil2: v / 100 })} standard={`${(STD.yearUtil2 * 100).toFixed(0)}%`} />
            <Field label="3년차" unit="%" step={0.1} value={+(inputs.yearUtil3 * 100).toFixed(4)} onChange={(v) => set({ yearUtil3: v / 100 })} standard={`${(STD.yearUtil3 * 100).toFixed(0)}%`} />
            <Field label="4년차" unit="%" step={0.1} value={+(inputs.yearUtil4 * 100).toFixed(4)} onChange={(v) => set({ yearUtil4: v / 100 })} standard={`${(STD.yearUtil4 * 100).toFixed(0)}%`} />
            <Field label="5년차" unit="%" step={0.1} value={+(inputs.yearUtil5 * 100).toFixed(4)} onChange={(v) => set({ yearUtil5: v / 100 })} standard={`${(STD.yearUtil5 * 100).toFixed(0)}%`} />
          </div>
        </div>

        <div className="subsection">
          <h4 className="summary-block__title">영업비 · CAPEX</h4>
          <div className="var-row">
            <Field label="영업비 1대분 단가" unit="원/대" value={inputs.bizFeePerUnit} onChange={(v) => set({ bizFeePerUnit: v })} standard={`${formatNumber(defaultBizFee(inputs.years))}원`} />
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
          전기원가 {ELEC_COST}원/kWh · PG 수수료율 {(PG_RATE * 100).toFixed(2)}% ·
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
            step={0.1}
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
