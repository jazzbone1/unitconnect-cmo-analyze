import { useState } from 'react'
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
import { recognizeBill } from '../lib/billOcr'
import { formatNumber } from '../lib/stats'
import Dropzone from './Dropzone'

interface Props {
  inputs: TariffInputs
  setInputs: (i: TariffInputs) => void
  /** 사업성 분석 월 사용량 합산치 (자동 반영 기본값) */
  autoMonthlyKwh?: number
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

export default function TariffAnalysis({
  inputs,
  setInputs,
  autoMonthlyKwh,
}: Props) {
  const set = (patch: Partial<TariffInputs>) => setInputs({ ...inputs, ...patch })
  const monthlyOverridden =
    inputs.monthlyKwhOverride != null &&
    Number.isFinite(inputs.monthlyKwhOverride)
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
  const margin = inputs.contractMargin ?? 0.15
  // 추정 최대수요전력 (부하율 기반)
  const peakKw =
    targetLF > 0 && inputs.monthlyKwh > 0
      ? inputs.monthlyKwh / (targetLF * HOURS_PER_MONTH)
      : 0
  // 적정 계약전력 = 추정 피크 + 안전 마진
  const properKw = peakKw * (1 + margin)
  // 전체 설비용량 기준 계약전력 비율(수용률)
  const installedKwMain = inputs.installedKw ?? inputs.contractKw
  const currentRatio = installedKwMain > 0 ? r.contractKw / installedKwMain : 0
  const properRatio = installedKwMain > 0 ? properKw / installedKwMain : 0
  // 설비 기반 추정 (예상 동시충전율)
  const demandF = inputs.expectedDemandFactor ?? 0.4
  const peakCapKw = installedKwMain * demandF
  const properCapKw = peakCapKw * (1 + margin)
  const properCapRatio = installedKwMain > 0 ? properCapKw / installedKwMain : 0
  // 고지서 실측 입력 (독립 계산)
  const bill = inputs.bill ?? defaultBill()
  const br = computeBill(bill)
  // ③ 고지서 실측(부하율·수용률) 기반 전체 설비 예측
  const measuredDemand =
    (bill.installedKw ?? 0) > 0 && bill.contractKw > 0
      ? bill.contractKw / (bill.installedKw as number)
      : null
  // 실측 부하율 = 요금적용전력(기본요금÷단가) 기준 (br에서 계산)
  const measuredLoad =
    bill.usageKwh > 0 && br.appliedKw > 0 ? br.loadFactor : null
  // 실측 부하율을 전체 월충전량에 적용 → 추정 최대수요전력 (부하율 반영)
  const predictedPeakByLoad =
    measuredLoad != null && measuredLoad > 0 && inputs.monthlyKwh > 0
      ? inputs.monthlyKwh / (measuredLoad * HOURS_PER_MONTH)
      : null
  // ③ 적정 계약전력 = 부하율 기반 추정 피크 × (1+마진)
  const predictedContractKw =
    predictedPeakByLoad != null ? predictedPeakByLoad * (1 + margin) : null
  const predictedContractRatio =
    predictedContractKw != null && installedKwMain > 0
      ? predictedContractKw / installedKwMain
      : null
  // (참고) 수용률 기반 = 전체 설비 × 실측 수용률
  const capByDemand =
    measuredDemand != null ? installedKwMain * measuredDemand : null

  // 권장 적정 계약전력: ③ 실측 우선, 없으면 ①②중 보수적(큰 값)
  const recommendKw =
    predictedContractKw != null
      ? predictedContractKw
      : Math.max(properKw, properCapKw)
  const recommendBasis =
    predictedContractKw != null ? '③ 실측' : '①② 보수적'
  const recommendPeak = recommendKw / (1 + margin)
  // 판정: 권장 피크 미만 → 과소(초과위험), 권장×1.1 초과 → 과대
  const verdict =
    recommendPeak > 0 && r.contractKw < recommendPeak
      ? '과소'
      : recommendKw > 0 && r.contractKw > recommendKw * 1.1
        ? '과대'
        : '적정'
  const baseSaving = Math.max(0, r.contractKw - recommendKw) * sel.baseUnit

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

  const setBill = (patch: Partial<BillInputs>) =>
    set({ bill: { ...bill, ...patch } })
  const billLoaded = bill.usageKwh > 0
  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrMsg, setOcrMsg] = useState<string | null>(null)

  async function handleBillFile(files: File[]) {
    const file = files[0]
    if (!file) return
    setOcrBusy(true)
    setOcrMsg('인식 중… (이미지는 최초 1회 언어팩 다운로드로 시간이 걸릴 수 있습니다)')
    try {
      const { fields, recognized, missing, source } = await recognizeBill(file)
      set({ bill: { ...bill, ...fields } })
      setOcrMsg(
        `${source === 'pdf' ? 'PDF' : '이미지'} 인식 완료 — 자동 입력: ${
          recognized.length ? recognized.join(', ') : '없음'
        }${missing.length ? ` · 직접 입력 필요: ${missing.join(', ')}` : ''}`,
      )
    } catch {
      setOcrMsg('인식에 실패했습니다. 값을 직접 입력해주세요.')
    } finally {
      setOcrBusy(false)
    }
  }

  const touGuideReady = inputs.monthlyKwh > 0 && r.contractKw > 0

  return (
    <section className="card settlement">
      {/* 우측 고정 가이드 — 필요한 값이 있을 때만 표기 */}
      {(touGuideReady || billLoaded) && (
        <aside className="guide-rail" aria-label="계약전력 가이드">
          {touGuideReady && (
            <div className="guide-rail__card">
              <div className="guide-rail__title">📐 계약전력 가이드</div>
              <ul className="guide-rail__list">
                <li>
                  부하율 <b className={lf < 0.1 ? 'cell--down' : ''}>{(lf * 100).toFixed(1)}%</b>
                </li>
                <li>현재 계약전력 <b>{formatNumber(r.contractKw)} kW ({(currentRatio * 100).toFixed(0)}%)</b></li>
                <li>적정 계약전력 <b>{formatNumber(properKw)} kW ({(properRatio * 100).toFixed(0)}%)</b></li>
                <li>
                  판정{' '}
                  <b className={verdict === '적정' ? 'cell--up' : 'cell--down'}>
                    계약전력 {verdict}
                  </b>
                </li>
              </ul>
            </div>
          )}
          {billLoaded && (
            <div className="guide-rail__card">
              <div className="guide-rail__title">🧾 고지서 실측</div>
              <ul className="guide-rail__list">
                <li>실효원가 <b>{formatNumber(br.effInclVat)} 원</b></li>
                <li>부하율 <b>{(br.loadFactor * 100).toFixed(1)}%</b></li>
                <li>요금적용전력 <b>{formatNumber(br.appliedKw)} kW</b></li>
                {br.demandFactor != null && (
                  <li>
                    수용률 <b>{(br.demandFactor * 100).toFixed(0)}%</b> · 초과{' '}
                    <b className={br.overRisk === '있음' ? 'cell--down' : br.overRisk === '없음' ? 'cell--up' : ''}>
                      {br.overRisk}
                    </b>
                  </li>
                )}
              </ul>
            </div>
          )}
        </aside>
      )}

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
          <NumField
            label="계약전력 비율(수용률)"
            step={0.05}
            value={+(inputs.contractRatio ?? 1).toFixed(4)}
            onChange={(v) => set({ contractRatio: v })}
          />
          <NumField
            label="계약전력(직접입력)"
            unit="kW"
            value={+r.contractKw.toFixed(1)}
            onChange={(v) =>
              set({
                contractRatio:
                  installedKwMain > 0 ? v / installedKwMain : inputs.contractRatio ?? 1,
              })
            }
          />
          <label className="var-field">
            <span className="var-field__label">월 총 충전량</span>
            <span className="var-field__input">
              <input
                className="cell-input"
                type="number"
                value={Number.isFinite(inputs.monthlyKwh) ? inputs.monthlyKwh : ''}
                onChange={(e) =>
                  set({ monthlyKwhOverride: Number(e.target.value) || 0 })
                }
              />
              <span className="var-field__unit">kWh/월</span>
            </span>
            <span className="var-field__std">
              {monthlyOverridden ? (
                <>
                  직접입력 ·{' '}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => set({ monthlyKwhOverride: null })}
                  >
                    사업성 월사용량({formatNumber(autoMonthlyKwh ?? 0)})으로
                  </button>
                </>
              ) : (
                `사업성 월사용량 자동 반영 (${formatNumber(autoMonthlyKwh ?? 0)} kWh)`
              )}
            </span>
          </label>
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
            <NumField
              label="예상 동시충전율"
              unit="설비 대비"
              step={0.05}
              value={demandF}
              onChange={(v) => set({ expectedDemandFactor: v })}
            />
            <NumField
              label="안전 마진"
              unit="0.10~0.20"
              step={0.05}
              value={margin}
              onChange={(v) => set({ contractMargin: v })}
            />
            <label className="var-field">
              <span className="var-field__label">현재 계약전력(비율)</span>
              <span className="var-field__input">
                {formatNumber(r.contractKw)} kW ({(currentRatio * 100).toFixed(0)}%)
              </span>
            </label>
            <label className="var-field">
              <span className="var-field__label">판정({recommendBasis} 기준)</span>
              <span className={`var-field__input ${verdict === '적정' ? 'ok' : 'warn'}`}>
                계약전력 {verdict}
              </span>
            </label>
          </div>
        </div>

        {/* 두 기준 병기 */}
        <div className="table-scroll">
          <table className="data-table report-table">
            <thead>
              <tr>
                <th>추정 기준</th>
                <th>추정 최대수요전력</th>
                <th>적정 계약전력(+마진 {(margin * 100).toFixed(0)}%)</th>
                <th>적정 계약전력 비율(설비 대비)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="col-name">
                  ① 실사용량 기반 (부하율 {(targetLF * 100).toFixed(0)}%)
                </td>
                <td>{formatNumber(peakKw)} kW</td>
                <td className="cell--strong">{formatNumber(properKw)} kW</td>
                <td>{(properRatio * 100).toFixed(0)}%</td>
              </tr>
              <tr>
                <td className="col-name">
                  ② 설비 기반 (동시충전율 {(demandF * 100).toFixed(0)}%)
                </td>
                <td>{formatNumber(peakCapKw)} kW</td>
                <td className="cell--strong">{formatNumber(properCapKw)} kW</td>
                <td>{(properCapRatio * 100).toFixed(0)}%</td>
              </tr>
              {predictedContractKw != null && (
                <tr>
                  <td className="col-name">
                    ③ 고지서 실측 기반 (부하율 {(measuredLoad! * 100).toFixed(1)}%
                    {measuredDemand != null && `, 수용률 ${(measuredDemand * 100).toFixed(0)}%`})
                  </td>
                  <td>{formatNumber(predictedPeakByLoad!)} kW</td>
                  <td className="cell--strong">{formatNumber(predictedContractKw)} kW</td>
                  <td>{((predictedContractRatio ?? 0) * 100).toFixed(0)}%</td>
                </tr>
              )}
              <tr className="row--total">
                <td className="col-name">
                  권장 {predictedContractKw != null ? '(③ 실측 우선)' : '(보수적 = 큰 값)'}
                </td>
                <td>—</td>
                <td className="cell--strong">
                  {formatNumber(
                    predictedContractKw != null
                      ? predictedContractKw
                      : Math.max(properKw, properCapKw),
                  )}{' '}
                  kW
                </td>
                <td>
                  {(
                    ((predictedContractKw != null
                      ? predictedContractKw
                      : Math.max(properKw, properCapKw)) /
                      (installedKwMain || 1)) *
                    100
                  ).toFixed(0)}
                  %
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="table-note">
          <b>① 실사용량 기반</b> = 월 충전량 ÷ (기준 부하율 × 720) × (1+마진) —{' '}
          <b>현재 실제 사용 패턴</b> 기준 추정 피크. <b>② 설비 기반</b> = 전체
          설비용량({formatNumber(installedKwMain)}kW) × 예상 동시충전율 × (1+마진)
          — <b>잠재 최대(동시충전)</b> 기준. 계약전력은{' '}
          <b>보수적으로 둘 중 큰 값 이상</b>으로 두어야 초과 위험이 없습니다.
          {predictedContractKw != null ? (
            <>
              {' '}
              <b>③ 고지서 실측 기반(부하율 기준)</b>: ㉮ 추정 최대수요전력 = 전체
              월충전량({formatNumber(inputs.monthlyKwh)}kWh) ÷ (<b>실측 부하율
              {` ${(measuredLoad! * 100).toFixed(1)}%`}</b> × 720) ={' '}
              <b>{formatNumber(predictedPeakByLoad!)}kW</b>. ㉯ 적정 계약전력 = ㉮ ×
              (1+마진 {(margin * 100).toFixed(0)}%) ={' '}
              <b>{formatNumber(predictedContractKw)}kW</b>.
              {capByDemand != null && (
                <>
                  {' '}
                  (참고: 수용률 {(measuredDemand! * 100).toFixed(0)}% 기반 =
                  전체설비×수용률 = {formatNumber(capByDemand)}kW — 이보다 부하율
                  기반이 실사용에 더 부합)
                </>
              )}{' '}
              실측값이 있으면 가정치(①②)보다 <b>③을 우선</b> 권장합니다.
            </>
          ) : (
            ' ③ 고지서 실측 기반은 아래 ⑦ 고지서 패널에 계약전력·사용량을 입력하면 자동 표시됩니다.'
          )}
          {' '}
          <b>판정 기준</b>: 현재 계약전력({formatNumber(r.contractKw)}kW)을{' '}
          <b>권장 적정 계약전력({formatNumber(recommendKw)}kW · {recommendBasis})</b>과
          비교합니다. 권장 피크({formatNumber(recommendPeak)}kW) 미만이면 과소,
          권장의 110%({formatNumber(recommendKw * 1.1)}kW) 초과면 과대입니다.
          {verdict === '과대' && (
            <>
              {' '}
              현재 계약전력이 권장보다{' '}
              <b>{formatNumber(r.contractKw - recommendKw)} kW 큼</b> → 기본요금 월 약{' '}
              <b>{formatNumber(Math.round(baseSaving))}원</b> 절감 여지.
            </>
          )}
          {verdict === '과소' &&
            ' 현재 계약전력이 권장 피크보다 낮음 → 계약초과(위약) 위험 점검 필요.'}
          {verdict === '적정' && ' 현재 계약전력이 권장 범위에 부합합니다.'}
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
          한전 청구서를 <b>업로드하면 자동 인식</b>됩니다(PDF·JPG·PNG). 인식하지
          못한 값만 직접 입력하세요. 이 값은 <b>다른 분석·항목에 자동 반영되지
          않으며</b>, 한 현장에 모자분리/미적용이 섞인 경우를 위해{' '}
          <b>계약전력 가이드</b>만 제공합니다.
        </p>
        <Dropzone
          onFiles={handleBillFile}
          disabled={ocrBusy}
          multiple={false}
          compact
          icon="🧾"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/*"
          title="청구서 파일을 끌어다 놓거나 클릭해서 선택 (PDF·JPG·PNG)"
          hint="PDF는 텍스트 추출, 이미지는 OCR로 자동 인식합니다"
        />
        {ocrMsg && (
          <p className={`status ${ocrBusy ? 'status--info' : 'status--ok'}`}>
            {ocrBusy ? '⏳ ' : '✓ '}
            {ocrMsg}
          </p>
        )}
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
            <NumField label="기본요금 단가" unit="원/kW" value={bill.baseUnit ?? 2580} onChange={(v) => setBill({ baseUnit: v })} />
            <NumField label="설비용량(이 계약)" unit="kW·선택" value={bill.installedKw ?? 0} onChange={(v) => setBill({ installedKw: v })} />
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
            <div className="bill-guide">
              <div className="bill-guide__title">📐 계약전력 가이드 (참고)</div>
              <div className="overview">
                <div className="stat">
                  <span className={`stat__value ${br.loadFactor < 0.1 ? 'cell--down' : ''}`}>
                    {(br.loadFactor * 100).toFixed(1)}%
                  </span>
                  <span className="stat__label">현재 부하율</span>
                </div>
                <div className="stat">
                  <span className="stat__value">{formatNumber(bill.contractKw)} kW</span>
                  <span className="stat__label">고지서 계약전력</span>
                </div>
                <div className="stat">
                  <span className="stat__value cell--strong">
                    {formatNumber(br.appliedKw)} kW
                  </span>
                  <span className="stat__label">요금적용전력(기본요금÷단가)</span>
                </div>
                <div className="stat">
                  <span
                    className={`stat__value ${
                      bill.contractKw > br.properContractKw * 1.15
                        ? 'cell--down'
                        : bill.contractKw < br.properContractKw * 0.85
                          ? 'cell--down'
                          : 'cell--up'
                    }`}
                  >
                    {bill.contractKw > br.properContractKw * 1.15
                      ? '여유 큼'
                      : bill.contractKw < br.properContractKw * 0.85
                        ? '부족'
                        : '적정'}
                  </span>
                  <span className="stat__label">판정(요금적용전력 기준)</span>
                </div>
                {br.demandFactor != null && (
                  <>
                    <div className="stat">
                      <span className="stat__value">
                        {(br.demandFactor * 100).toFixed(0)}%
                      </span>
                      <span className="stat__label">수용률(계약÷설비)</span>
                    </div>
                    <div className="stat">
                      <span
                        className={`stat__value ${
                          br.overRisk === '있음'
                            ? 'cell--down'
                            : br.overRisk === '없음'
                              ? 'cell--up'
                              : ''
                        }`}
                      >
                        초과 {br.overRisk}
                      </span>
                      <span className="stat__label">계약초과 리스크</span>
                    </div>
                  </>
                )}
              </div>
              <p className="table-note">
                <b>요금적용전력 = 기본요금 {formatNumber(bill.basic)}원 ÷ 기본단가{' '}
                {formatNumber(bill.baseUnit ?? 2580)}원 = {formatNumber(br.appliedKw)}kW</b>{' '}
                (기본요금이 실제 부과된 전력). 부하율 = 사용량 ÷ (요금적용전력 × 720)
                = <b>{(br.loadFactor * 100).toFixed(1)}%</b>.{' '}
                {bill.contractKw > br.appliedKw * 1.15
                  ? '계약전력이 요금적용전력보다 큼 → 계약전력 여유(초과 위험 낮음).'
                  : bill.contractKw < br.appliedKw * 0.85
                    ? '계약전력이 요금적용전력보다 낮음 → 계약초과(위약금) 위험 점검 필요.'
                    : '계약전력이 요금적용전력에 부합합니다.'}{' '}
                {br.demandFactor != null && (
                  <>
                    설비용량 {formatNumber(bill.installedKw ?? 0)}kW 대비 수용률{' '}
                    {(br.demandFactor * 100).toFixed(0)}%.{' '}
                    {br.overRisk === '없음'
                      ? '계약전력 ≥ 설비용량 → 전량 동시가동해도 초과 불가(안전, 단 기본요금 과다 가능).'
                      : br.overRisk === '낮음'
                        ? '계약전력이 추정 피크 이상 → 일상 초과 위험 낮음(단, 전량 동시 시 초과 가능).'
                        : '계약전력이 추정 피크보다 낮음 → 계약초과(위약금·기본요금 상승) 위험 있음.'}{' '}
                  </>
                )}
                이 가이드는 <b>이 고지서(계약) 부분에만</b> 해당하며 다른 분석에
                반영되지 않습니다.
              </p>
            </div>
          </>
        ) : (
          <p className="table-note">사용량을 입력하면 실효원가와 계약전력 가이드가 표시됩니다.</p>
        )}
      </div>
    </section>
  )
}
