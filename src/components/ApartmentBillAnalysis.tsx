import { useState } from 'react'
import {
  computeApartmentBill,
  tierPreset,
  distributeProgressive,
  distributeByRatio,
  applySeasonTiers,
  reachedBaseCharge,
  baseUnitPerKw,
  newTier,
  CONTRACT_LABELS,
  SEASON_LABELS,
  type ApartmentBillInputs,
  type ContractType,
  type Season,
} from '../lib/apartmentBill'
import { recognizeBill } from '../lib/billOcr'
import { formatNumber } from '../lib/stats'
import Dropzone from './Dropzone'

interface Props {
  inputs: ApartmentBillInputs
  setInputs: (i: ApartmentBillInputs) => void
}

const won = (v: number) => `${formatNumber(Math.round(v))}원`

/** 숫자 입력 (편집 중 원본 유지, 표시 시 콤마) */
function NumCell({
  value,
  onChange,
  width = 100,
  suffix,
}: {
  value: number
  onChange: (v: number) => void
  width?: number
  suffix?: string
}) {
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState('')
  const raw = Number.isFinite(value) && value !== 0 ? String(value) : ''
  const shown =
    Number.isFinite(value) && value !== 0
      ? value.toLocaleString('en-US', { maximumFractionDigits: 6 })
      : ''
  return (
    <span className="num-input">
      <input
        className="cell-input"
        type="text"
        inputMode="decimal"
        style={{ width }}
        value={focused ? text : shown}
        onFocus={() => {
          setText(raw)
          setFocused(true)
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const v = e.target.value.replace(/[^0-9.]/g, '')
          setText(v)
          onChange(v === '' || v === '.' ? 0 : Number(v) || 0)
        }}
      />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </span>
  )
}

export default function ApartmentBillAnalysis({ inputs, setInputs }: Props) {
  const set = (patch: Partial<ApartmentBillInputs>) =>
    setInputs({ ...inputs, ...patch })
  const r = computeApartmentBill(inputs)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string>('')

  async function handleFile(files: File[]) {
    const file = files[0]
    if (!file) return
    setLoading(true)
    setMsg('')
    try {
      const { fields, recognized, missing, contractType } =
        await recognizeBill(file)
      const usage = fields.usageKwh ?? inputs.usageKwh
      // 계약종별이 인식되면 그 프리셋 구간을, 아니면 기존 구간을 사용
      const ct = (contractType as ContractType) || inputs.contractType
      const perHh = ct.startsWith('housing')
      const baseTiers =
        contractType && contractType !== inputs.contractType
          ? applySeasonTiers(tierPreset(ct).tiers, inputs.season)
          : inputs.tiers
      // 계약 형태에 맞춰 인식된 사용량을 구간에 자동배분(주택용은 세대평균 기준)
      const { tiers, baseCharge } = distribute(
        baseTiers,
        usage,
        perHh,
        inputs.households,
      )
      set({
        contractType: ct,
        perHousehold: perHh,
        baseCharge: fields.basic ?? baseCharge ?? inputs.baseCharge,
        climate: fields.climate ?? inputs.climate,
        fuel: fields.fuel ?? inputs.fuel,
        vat: fields.vat ?? inputs.vat,
        fund: fields.fund ?? inputs.fund,
        round: fields.round ?? inputs.round,
        usageKwh: usage,
        contractKw: fields.contractKw ?? inputs.contractKw,
        tiers,
      })
      setMsg(
        `인식됨: ${recognized.join(', ') || '없음'}` +
          (missing.length ? ` · 미인식(직접 입력): ${missing.join(', ')}` : ''),
      )
    } catch {
      setMsg('고지서 인식에 실패했습니다. 값을 직접 입력해 주세요.')
    } finally {
      setLoading(false)
    }
  }

  const isProgressive = inputs.tiers.some((t) => t.cap != null)
  const isTou = inputs.tiers.some((t) => t.ratio != null)
  const hhFactor =
    inputs.perHousehold && inputs.households > 0 ? inputs.households : 1
  // 현재 기본요금과 일치하는 누진 단계 index (없으면 -1=직접입력)
  const selectedTierIdx = inputs.tiers.findIndex(
    (t) =>
      t.base != null &&
      Math.round(t.base * hhFactor) === Math.round(inputs.baseCharge),
  )
  function selectTier(idx: number) {
    if (idx < 0) return
    const t = inputs.tiers[idx]
    if (t?.base != null) set({ baseCharge: Math.round(t.base * hhFactor) })
  }

  // 계약 형태에 맞춰 사용량을 구간에 자동 배분 + 주택용 누진 기본요금 반영.
  //  세대별 누진(perHousehold)이면 세대평균에 누진 적용, 기본요금은 세대당×세대수.
  function distribute(
    tiers: typeof inputs.tiers,
    usage: number,
    perHh: boolean,
    hh: number,
  ) {
    if (tiers.some((t) => t.cap != null)) {
      const hhN = perHh && hh > 0 ? hh : 1
      const next = distributeProgressive(tiers, usage / hhN) // 세대평균 기준
      const base = reachedBaseCharge(next)
      return {
        tiers: next,
        baseCharge: base != null ? Math.round(base * hhN) : null,
      }
    }
    if (tiers.some((t) => t.ratio != null)) {
      return { tiers: distributeByRatio(tiers, usage), baseCharge: null }
    }
    return { tiers, baseCharge: null }
  }

  function applyPreset(type: ContractType) {
    const p = tierPreset(type)
    // 주택용(누진)은 세대별 누진 기본 적용, 일반용은 해제
    const perHh = type.startsWith('housing')
    const seasoned = applySeasonTiers(p.tiers, inputs.season)
    const { tiers, baseCharge } = distribute(
      seasoned,
      inputs.usageKwh,
      perHh,
      inputs.households,
    )
    set({
      contractType: type,
      perHousehold: perHh,
      tiers,
      baseCharge: baseCharge ?? p.baseCharge,
    })
  }

  function applySeason(season: Season) {
    const seasoned = applySeasonTiers(inputs.tiers, season)
    const { tiers, baseCharge } = distribute(
      seasoned,
      inputs.usageKwh,
      inputs.perHousehold,
      inputs.households,
    )
    set({ season, tiers, baseCharge: baseCharge ?? inputs.baseCharge })
  }

  function reDistribute(patch: Partial<ApartmentBillInputs>) {
    const next = { ...inputs, ...patch }
    const { tiers, baseCharge } = distribute(
      next.tiers,
      next.usageKwh,
      next.perHousehold,
      next.households,
    )
    set({ ...patch, tiers, baseCharge: baseCharge ?? next.baseCharge })
  }

  function setUsage(v: number) {
    reDistribute({ usageKwh: v })
  }

  return (
    <section className="card settlement">
      <div className="card__header">
        <h2>아파트 요금 분석 (고지서)</h2>
      </div>

      <Dropzone
        onFiles={handleFile}
        disabled={loading}
        icon="🧾"
        title={loading ? '고지서 인식 중…' : '전기요금 고지서 끌어다 놓기 또는 클릭'}
        hint="PDF · JPG · PNG 자동 인식 (기본요금·전력량요금·기후·연료·부가세·기금·사용량·계약전력). 못 찾은 값은 직접 입력."
        accept=".pdf,.jpg,.jpeg,.png"
        multiple={false}
      />
      {msg && <p className="status status--info">{msg}</p>}

      {/* 계약 형태 */}
      <div className="var-panel">
        <h3 className="subsection__title">① 계약 형태</h3>
        <div className="var-row">
          <label className="var-field">
            <span className="var-field__label">계약 종별</span>
            <select
              className="cell-input"
              style={{ width: 260, textAlign: 'left' }}
              value={inputs.contractType}
              onChange={(e) => applyPreset(e.target.value as ContractType)}
            >
              {(Object.keys(CONTRACT_LABELS) as ContractType[]).map((t) => (
                <option key={t} value={t}>
                  {CONTRACT_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="var-field">
            <span className="var-field__label">계절 기준</span>
            <select
              className="cell-input"
              style={{ width: 160, textAlign: 'left' }}
              value={inputs.season}
              onChange={(e) => applySeason(e.target.value as Season)}
            >
              {(Object.keys(SEASON_LABELS) as Season[]).map((s) => (
                <option key={s} value={s}>
                  {SEASON_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="var-field">
            <span className="var-field__label">
              계약전력<span className="var-field__unit">kW</span>
            </span>
            <NumCell
              value={inputs.contractKw}
              onChange={(v) => set({ contractKw: v })}
            />
          </label>
          <label className="var-field">
            <span className="var-field__label">
              총 사용량<span className="var-field__unit">kWh</span>
            </span>
            <NumCell value={inputs.usageKwh} onChange={setUsage} />
          </label>
          <label className="var-field">
            <span className="var-field__label">
              가구수(세대)<span className="var-field__unit">세대</span>
            </span>
            <NumCell
              value={inputs.households}
              onChange={(v) => reDistribute({ households: v })}
            />
          </label>
          {(isProgressive || isTou) && (
            <button
              type="button"
              className="btn-secondary"
              style={{ alignSelf: 'flex-end' }}
              onClick={() => setUsage(inputs.usageKwh)}
            >
              {isProgressive ? '사용량 누진 자동배분' : '시간대 비율 자동배분'}
            </button>
          )}
        </div>
        {isProgressive && (
          <div className="var-row" style={{ marginTop: '0.4rem' }}>
            <label className="toggle">
              <input
                type="checkbox"
                checked={inputs.perHousehold}
                onChange={(e) =>
                  reDistribute({ perHousehold: e.target.checked })
                }
              />
              <span>
                세대별 누진 적용 (아파트 종합계약) — 총 사용량을 가구수로 나눈
                세대평균에 누진 적용 후 ×세대수
              </span>
            </label>
            {inputs.perHousehold && inputs.households > 0 && (
              <span className="var-field__std" style={{ alignSelf: 'center' }}>
                세대당 평균 {formatNumber(Math.round(r.perHhKwh))} kWh (총{' '}
                {formatNumber(inputs.usageKwh)} ÷ {inputs.households}세대)
              </span>
            )}
          </div>
        )}
      </div>

      {/* 기본료 */}
      <div className="subsection">
        <h3 className="subsection__title">② 기본료</h3>
        <div className="target-box">
          {isProgressive && (
            <div className="target-row">
              <span>누진 단계 선택</span>
              <span>
                <select
                  className="cell-input"
                  style={{ width: 300, textAlign: 'left' }}
                  value={selectedTierIdx}
                  onChange={(e) => selectTier(Number(e.target.value))}
                >
                  <option value={-1}>직접 입력 / 사용량 자동</option>
                  {inputs.tiers.map((t, i) =>
                    t.base != null ? (
                      <option key={t.id} value={i}>
                        {t.name} · 세대당 기본 {formatNumber(t.base)}원
                        {hhFactor > 1 ? ` × ${hhFactor}세대` : ''}
                      </option>
                    ) : null,
                  )}
                </select>
              </span>
            </div>
          )}
          <div className="target-row">
            <span>기본요금</span>
            <b>
              <NumCell
                value={inputs.baseCharge}
                onChange={(v) => set({ baseCharge: v })}
                width={130}
                suffix="원"
              />
            </b>
          </div>
          <div className="target-row">
            <span>→ 기본단가 (원/kW · 보고서 연동)</span>
            <b>
              {(() => {
                const bu = baseUnitPerKw(inputs)
                if (bu.source === 'tier')
                  return bu.value > 0
                    ? `${formatNumber(Math.round(bu.value))} 원/kW (누진 단계 세대당 기본료 기준)`
                    : '누진 단계를 선택하세요'
                if (bu.source === 'measured')
                  return `${formatNumber(Math.round(bu.value))} 원/kW (실측: ${formatNumber(inputs.baseCharge)} ÷ ${formatNumber(inputs.contractKw)}kW)`
                if (bu.source === 'standard')
                  return `${formatNumber(bu.value)} 원/kW (계약종별 표준)`
                return '고지서 기본요금·계약전력 입력 필요'
              })()}
            </b>
          </div>
          <p className="hint hint--tight">
            {isProgressive
              ? `주택용 누진: 위에서 단계를 선택하면 그 단계의 세대당 기본요금${hhFactor > 1 ? ` × 세대수(${inputs.households})` : ''}가 기본요금으로 적용됩니다. 사용량을 넣으면 도달 단계로 자동 선택되며, 직접 수정도 가능합니다.`
              : '일반용은 계약전력 × 기본단가(원/kW)로 부과됩니다. 고지서 기본요금을 입력하세요.'}
          </p>
        </div>
      </div>

      {/* 구간별 부과 요금 */}
      <div className="subsection">
        <h3 className="subsection__title">③ 구간별 부과 요금</h3>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>구간</th>
                <th>{r.perHousehold ? '세대당 사용량(kWh)' : '사용량(kWh)'}</th>
                <th>단가(원/kWh)</th>
                <th>
                  부과 금액(원){r.perHousehold ? ' (×세대수)' : ''}
                </th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {r.tiers.map((t, i) => (
                <tr key={t.id}>
                  <td className="col-name">
                    <input
                      className="cell-input cell-input--rtext"
                      style={{ width: 160, textAlign: 'left' }}
                      type="text"
                      value={t.name}
                      onChange={(e) =>
                        set({
                          tiers: inputs.tiers.map((x, xi) =>
                            xi === i ? { ...x, name: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </td>
                  <td>
                    <NumCell
                      value={t.kwh}
                      onChange={(v) =>
                        set({
                          tiers: inputs.tiers.map((x, xi) =>
                            xi === i ? { ...x, kwh: v } : x,
                          ),
                        })
                      }
                    />
                  </td>
                  <td>
                    <NumCell
                      value={t.unit}
                      onChange={(v) =>
                        set({
                          tiers: inputs.tiers.map((x, xi) =>
                            xi === i ? { ...x, unit: v } : x,
                          ),
                        })
                      }
                    />
                  </td>
                  <td className="cell--strong">{won(t.amount)}</td>
                  <td>
                    <button
                      type="button"
                      className="link-button link-button--danger"
                      onClick={() =>
                        set({ tiers: inputs.tiers.filter((_, xi) => xi !== i) })
                      }
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="row--total">
                <td className="col-name">
                  전력량요금 합계{r.perHousehold ? ` (총 ${formatNumber(r.tierKwh)}kWh)` : ''}
                </td>
                <td>
                  {r.perHousehold
                    ? `${formatNumber(Math.round(r.perHhKwh))} (세대당)`
                    : formatNumber(r.tierKwh)}
                </td>
                <td />
                <td className="cell--strong">{won(r.energyTotal)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="link-button"
          onClick={() => set({ tiers: [...inputs.tiers, newTier()] })}
        >
          + 구간 추가
        </button>
        <p className="hint hint--tight">
          {isProgressive
            ? '주택용 누진: 총 사용량을 단계 순서로 채워 각 단계 단가로 부과합니다. 하계(7·8월)는 누진 구간이 확대(0~300 / 301~450)됩니다.'
            : isTou
              ? '일반용 TOU: 아파트 일반 사용 비율(경부하 30% · 중간부하 40% · 최대부하 30%)로 총 사용량을 자동 배분합니다.'
              : '구간별 사용량 × 단가로 부과 금액이 계산됩니다.'}{' '}
          단가·구간은{' '}
          <b>{SEASON_LABELS[inputs.season]}</b> 기준입니다
          {inputs.season === 'annual'
            ? ' (봄가을 5 · 여름 3 · 겨울 4개월 가중 평균)'
            : ''}
          . 계절 기준을 바꾸면 그 계절 단가·구간으로 재계산됩니다. 아래 ④에서
          청구금액·유효단가(원/kWh)를 확인하세요.
        </p>
      </div>

      {/* 기타 요금 + 합계 */}
      <div className="var-panel">
        <h3 className="subsection__title">④ 기타 요금 · 청구 합계</h3>
        <div className="var-row">
          <label className="var-field">
            <span className="var-field__label">
              기후환경요금<span className="var-field__unit">원</span>
            </span>
            <NumCell value={inputs.climate} onChange={(v) => set({ climate: v })} />
          </label>
          <label className="var-field">
            <span className="var-field__label">
              연료비조정액<span className="var-field__unit">원</span>
            </span>
            <NumCell value={inputs.fuel} onChange={(v) => set({ fuel: v })} />
          </label>
          <label className="var-field">
            <span className="var-field__label">
              부가가치세<span className="var-field__unit">원</span>
            </span>
            <NumCell value={inputs.vat} onChange={(v) => set({ vat: v })} />
          </label>
          <label className="var-field">
            <span className="var-field__label">
              전력기금<span className="var-field__unit">원</span>
            </span>
            <NumCell value={inputs.fund} onChange={(v) => set({ fund: v })} />
          </label>
          <label className="var-field">
            <span className="var-field__label">
              원단위 절사<span className="var-field__unit">원</span>
            </span>
            <NumCell value={inputs.round} onChange={(v) => set({ round: v })} />
          </label>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <tbody>
              <tr>
                <td className="col-name">기본료</td>
                <td className="cell--num">{won(r.baseCharge)}</td>
                <td className="cell--muted">{r.baseShare.toFixed(1)}%</td>
              </tr>
              <tr>
                <td className="col-name">전력량요금 (구간 합)</td>
                <td className="cell--num">{won(r.energyTotal)}</td>
                <td className="cell--muted">{r.energyShare.toFixed(1)}%</td>
              </tr>
              <tr>
                <td className="col-name">기후환경 + 연료비</td>
                <td className="cell--num">{won(inputs.climate + inputs.fuel)}</td>
                <td />
              </tr>
              <tr className="row--sub">
                <td className="col-name">공급가액 소계</td>
                <td className="cell--num cell--strong">{won(r.supply)}</td>
                <td />
              </tr>
              <tr>
                <td className="col-name">부가세 + 기금 + 절사</td>
                <td className="cell--num">
                  {won(inputs.vat + inputs.fund + inputs.round)}
                </td>
                <td />
              </tr>
              <tr className="row--total">
                <td className="col-name">청구금액 합계</td>
                <td className="cell--num cell--strong">{won(r.total)}</td>
                <td />
              </tr>
              <tr className="row--total">
                <td className="col-name">유효단가 (청구금액 ÷ 사용량)</td>
                <td className="cell--num cell--strong">
                  {r.effPerKwh > 0 ? `${r.effPerKwh.toFixed(1)} 원/kWh` : '—'}
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <p className="table-note">
          계약 형태에 따라 기본료와 구간별(누진 단계 또는 TOU 시간대) 부과 요금으로
          정리합니다. 단가·기본요금은 계약 종별 프리셋(근사값)이며 고지서 값으로
          수정하세요. 개인정보는 저장·표시하지 않습니다.
        </p>
      </div>
    </section>
  )
}
