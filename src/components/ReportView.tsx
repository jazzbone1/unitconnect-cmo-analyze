import { useEffect, useState } from 'react'
import {
  computeElecCost,
  computeProfit,
  defaultReport,
  opexMonthlyTotal,
  opexPerKwh,
  newOpexRow,
  newRecommendRow,
  type ElecCostInput,
  type ElecGroup,
  type ReportModel,
} from '../lib/report'
import { Fragment } from 'react'

interface ReportViewProps {
  model: ReportModel
  setModel: React.Dispatch<React.SetStateAction<ReportModel>>
  /** 앞 단계(요금구조·정산·단지정보) 값을 다시 끌어와 채우는 시드 생성기 */
  autoSeed?: () => ReportModel
  /** 요금분석 '고지서 실측 입력'에 값이 있어 모자분리 실효원가가 실측 기반인지 */
  billMeasured?: boolean
}

/* ---------- 포맷 ---------- */
/** 천단위 콤마 + 소수 유지 */
const numFmt = (v: number, maxFrac = 6) =>
  Number.isFinite(v)
    ? v.toLocaleString('en-US', { maximumFractionDigits: maxFrac })
    : ''
const won1 = (v: number) =>
  `${v.toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}원`
const manwon = (v: number) =>
  `약 ${Math.round(v / 10000).toLocaleString()}만원`
const signManwon = (v: number) =>
  `${v >= 0 ? '+' : '-'}약 ${Math.abs(Math.round(v / 10000)).toLocaleString()}만원`

/* ---------- 입력 셀 ---------- */
/**
 * 바로 수정 가능한 숫자 입력. 제어형 number 입력은 매 키 입력마다
 * 재포맷돼 편집이 어려우므로, 포커스 중에는 입력 문자열(text)을 유지하고
 * 포커스 해제 시에만 모델값을 표시한다.
 */
function NumInput({
  value,
  onChange,
  suffix,
  width = 90,
  fit,
  linked,
  nullable,
  onNull,
  placeholder,
}: {
  value: number
  onChange: (v: number) => void
  suffix?: string
  width?: number
  /** 값 길이에 맞춰 입력칸 폭을 콘텐츠에 밀착(숫자 간격 벌어짐·정렬 어긋남 방지) */
  fit?: boolean
  /** 앞 단계 자동 연동 값이면 음영 표시 */
  linked?: boolean
  /** 빈 값 허용(빈 값 시 onNull 호출) */
  nullable?: boolean
  onNull?: () => void
  placeholder?: string
}) {
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState('')
  // 편집 중엔 원본 텍스트, 비활성 시 천단위 콤마 표시
  const rawText = Number.isFinite(value) && value !== 0 ? String(value) : ''
  const shownText =
    Number.isFinite(value) && value !== 0 ? numFmt(value) : ''
  // fit 모드: 표시 문자열 길이에 맞춰 size로 폭을 콘텐츠에 밀착(HTML size 속성).
  const shownLen = (focused ? text : shownText || placeholder || '').length
  const fitSize = Math.max(2, shownLen + (focused ? 1 : 0))
  return (
    <span className={`num-input${fit ? ' num-input--fit' : ''}`}>
      <input
        className={`cell-input${linked ? ' cell-input--linked' : ''}`}
        type="text"
        inputMode="decimal"
        style={fit ? undefined : { width }}
        size={fit ? fitSize : undefined}
        title={linked ? '앞 단계 자동 연동 값' : undefined}
        placeholder={placeholder}
        value={focused ? text : shownText}
        onFocus={() => {
          setText(rawText)
          setFocused(true)
        }}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9.]/g, '')
          setText(raw)
          if (raw === '' || raw === '.') {
            if (nullable && onNull) onNull()
            else onChange(0)
            return
          }
          const n = Number(raw)
          if (Number.isFinite(n)) onChange(n)
        }}
      />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </span>
  )
}

function TextInput({
  value,
  onChange,
  wide,
  linked,
}: {
  value: string
  onChange: (v: string) => void
  wide?: boolean
  /** 앞 단계 자동 연동 값이면 음영 표시 */
  linked?: boolean
}) {
  return (
    <input
      className={`cell-input cell-input--rtext${wide ? ' cell-input--rwide' : ''}${
        linked ? ' cell-input--linked' : ''
      }`}
      type="text"
      style={{ width: wide ? '100%' : undefined }}
      title={linked ? '앞 단계 자동 연동 값' : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export default function ReportView({
  model,
  setModel,
  autoSeed,
  billMeasured,
}: ReportViewProps) {
  /* ---------- 섹션 포함 여부(체크) ---------- */
  const secOn = (k: string) => model.visible?.[k] !== false
  const toggleSec = (k: string) =>
    setModel((m) => ({
      ...m,
      visible: { ...(m.visible ?? {}), [k]: !(m.visible?.[k] !== false) },
    }))

  /* ---------- 앞 단계 값 자동 반영 ---------- */
  function autoFill() {
    if (!autoSeed) return
    if (
      !window.confirm(
        '앞 단계(요금구조·정산·단지정보)에서 끌어올 수 있는 항목을 다시 불러옵니다.\n개요·유형별 실적·월별 추이·전기원가(계약전력/월사용량/실효원가)·현행요금이 덮어써집니다.\n(운영비 항목·해결방안 서술·포함 체크는 유지)',
      )
    )
      return
    const s = autoSeed()
    setModel((m) => ({
      ...m,
      siteName: s.siteName || m.siteName,
      overview: s.overview,
      perType: s.perType,
      monthly: s.monthly,
      opexBaseKwh: s.opexBaseKwh,
      groupA: {
        ...m.groupA,
        contractKw: s.groupA.contractKw,
        monthlyKwh: s.groupA.monthlyKwh,
        lv1Override: s.groupA.lv1Override,
        currentRate: s.groupA.currentRate,
      },
      groupB: {
        ...m.groupB,
        contractKw: s.groupB.contractKw,
        currentRate: s.groupB.currentRate,
        standbyKwh: s.groupB.standbyKwh,
      },
      // 종류별 그룹: 자동연동 필드만 갱신, 직접입력(전력량요금·계약전력·Lv1 등)은 보존
      elecGroups: (s.elecGroups ?? []).map((sg) => {
        const prev = (m.elecGroups ?? []).find((g) => g.id === sg.id)
        return prev
          ? {
              ...prev,
              name: sg.name,
              kw: sg.kw,
              count: sg.count,
              separated: sg.separated,
              monthlyKwh: sg.monthlyKwh,
              currentRate: sg.currentRate,
              standbyKwh: sg.standbyKwh,
            }
          : sg
      }),
    }))
  }

  /* ---------- 섹션 제목 + 포함 체크 ---------- */
  function SecHead({
    k,
    tag = 'h3',
    label,
    editable,
  }: {
    k: string
    tag?: 'h3' | 'h4'
    label: string
    /** 제목을 직접 수정 가능하게 (secTitle에 저장) */
    editable?: boolean
  }) {
    const title = model.secTitle?.[k] ?? label
    const on = secOn(k)
    // 미체크(제외) 섹션은 제목까지 인쇄에서 숨김(화면에서는 체크박스로 재선택 가능)
    return (
      <div className={`report-sec-head${on ? '' : ' no-print'}`}>
        <label className="report-sec-toggle no-print" title="보고서 포함 여부">
          <input
            type="checkbox"
            checked={secOn(k)}
            onChange={() => toggleSec(k)}
          />
        </label>
        {editable ? (
          <input
            className={`cell-input report-sec-title-input${
              tag === 'h4' ? ' report-sec-title-input--h4' : ''
            }`}
            type="text"
            value={title}
            onChange={(e) =>
              setModel((m) => ({
                ...m,
                secTitle: { ...(m.secTitle ?? {}), [k]: e.target.value },
              }))
            }
          />
        ) : tag === 'h3' ? (
          <h3 className="subsection__title">{title}</h3>
        ) : (
          <h4 className="report-block__title">{title}</h4>
        )}
      </div>
    )
  }
  // 이전에 저장된 보고서에 Part3 필드가 없으면 기본값으로 보강(기존 편집 보존)
  useEffect(() => {
    setModel((m) => {
      if (m.premise !== undefined && m.compare && m.autonomy && m.cpo && m.cmo)
        return m
      const d = defaultReport()
      return {
        ...m,
        premise: m.premise ?? d.premise,
        autonomy: m.autonomy ?? d.autonomy,
        cpo: m.cpo ?? d.cpo,
        cmo: m.cmo ?? d.cmo,
        compare: m.compare ?? d.compare,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const opexRate = opexPerKwh(model.opex, model.opexBaseKwh)
  const opexMonth = opexMonthlyTotal(model.opex)

  const groups = model.elecGroups ?? []
  const groupKey = (id: string) => `elec:${id}`
  // 권고안 최소 인상안 = 해당 종류의 Lv2 손익분기(2-4 하한선과 동일 값) 자동 산출.
  //  라벨의 정격(kW)으로 전기원가 그룹을 매칭, 없으면 빈 문자열.
  const lv2ForLabel = (label: string): string => {
    const m = label.match(/(\d+(?:\.\d+)?)\s*kW/i)
    if (!m) return ''
    const kw = Number(m[1])
    const g = (model.elecGroups ?? []).find((x) => x.kw === kw)
    if (!g) return ''
    const lv2 = computeProfit(
      { ...g, vatDeduct: model.vatDeduct },
      opexPerKwh(model.opex, model.opexBaseKwh),
    ).lv2
    return lv2 > 0 ? `${Math.round(lv2).toLocaleString()}원/kWh 이상` : ''
  }
  const groupTitle2 = (g: ElecGroup, i: number) =>
    (model.secTitle?.[groupKey(g.id)] ?? `${i + 1}. ${g.name} 전기원가`).replace(
      /^\s*\d+[-.]\d*\.?\s*/,
      '',
    )
  function updElecGroup(id: string, patch: Partial<ElecCostInput>) {
    setModel((m) => ({
      ...m,
      elecGroups: (m.elecGroups ?? []).map((g) =>
        g.id === id ? { ...g, ...patch } : g,
      ),
    }))
  }
  function updList<K extends keyof ReportModel>(
    key: K,
    id: string,
    patch: Record<string, unknown>,
  ) {
    setModel((m) => ({
      ...m,
      [key]: (m[key] as { id: string }[]).map((r) =>
        r.id === id ? { ...r, ...patch } : r,
      ),
    }))
  }
  // 표 헤더명(사용자 편집) — secTitle 맵에 키별로 저장. 미설정 시 기본 라벨.
  const colTitle = (k: string, def: string) => model.secTitle?.[k] ?? def
  const setColTitle = (k: string, v: string) =>
    setModel((m) => ({ ...m, secTitle: { ...(m.secTitle ?? {}), [k]: v } }))
  // 편집 가능한 표 헤더 셀
  const colHead = (k: string, def: string) => (
    <th>
      <input
        className="cell-input report-colhead-input"
        type="text"
        value={colTitle(k, def)}
        onChange={(e) => setColTitle(k, e.target.value)}
      />
    </th>
  )

  /* ---------- 실효 전기원가 산출 블록 ---------- */
  function ElecCostBlock({ group, sub }: { group: ElecGroup; sub: string }) {
    const g = { ...group, vatDeduct: model.vatDeduct, billMode: false }
    const upd = (patch: Partial<ElecCostInput>) => updElecGroup(group.id, patch)
    const r = computeElecCost(g)
    const p = computeProfit(g, opexRate)
    // 모자분리 종류는 요금구조 탭에서 계약전력·월사용량·실효원가 연동
    const linkA = g.separated !== false
    // 모자분리 적용 여부: 미적용이면 계약전력 기반 기본요금(B) 없음
    const sep = g.separated !== false
    // '고지서 실측 항목' 기능은 제거됨 — 항상 조립식 산출 사용.
    const billMode = false
    return (
      <div className="report-block">
        <p className="report-block__sub">{sub}</p>
        <label className="toggle report-moja no-print">
          <input
            type="checkbox"
            checked={sep}
            onChange={(e) => upd({ separated: e.target.checked })}
          />
          <span>
            모자분리 적용 (계약전력 기반 기본요금 별도 부과) — 미체크 시 아파트
            기존 계약(공용부)으로 기본요금 없음
          </span>
        </label>
        {!sep && !billMode && (
          <label className="toggle report-moja no-print">
            <input
              type="checkbox"
              checked={g.apartmentBaseAlloc === true}
              onChange={(e) => upd({ apartmentBaseAlloc: e.target.checked })}
            />
            <span>
              공용부 기본요금 배분 — (B)를 <b>적정계약전력(요금구조①) × 기본단가
              (아파트 요금분석) ÷ 월사용량</b>으로 자동 계산
            </span>
          </label>
        )}

        <div className="table-scroll">
          <table className="data-table report-table report-table--calc">
            <thead>
              <tr>
                <th>산출 단계</th>
                <th>금액</th>
                <th>비고</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="col-name">(A) 시간대·계절 가중 전력량요금</td>
                <td>
                  <NumInput
                    value={g.powerRate}
                    onChange={(v) => upd({ powerRate: v })}
                    suffix="원/kWh"
                    fit
                    linked
                  />
                </td>
                <td className="cell--muted">
                  <span className="no-print">
                    {sep
                      ? '전기차 충전전력 자가소비용 TOU 단가 (아파트 요금분석 TOU 비중 반영)'
                      : '아파트 요금분석 계약형태·누진구간 전력량요금 단가 연동'}
                  </span>
                </td>
              </tr>
              <tr>
                <td className="col-name">(B) kWh당 기본요금 환산</td>
                <td>
                  {sep || g.apartmentBaseAlloc === true
                    ? `${won1(r.baseCharge)}/kWh`
                    : '없음'}
                </td>
                {sep ? (
                  <td className="cell--muted">
                    <NumInput
                      value={g.contractKw}
                      onChange={(v) => upd({ contractKw: v })}
                      suffix="kW ×"
                      fit
                      linked={linkA}
                    />{' '}
                    <NumInput
                      value={g.baseUnitPrice}
                      onChange={(v) => upd({ baseUnitPrice: v })}
                      suffix="원 ÷"
                      fit
                    />{' '}
                    <NumInput
                      value={g.monthlyKwh}
                      onChange={(v) => upd({ monthlyKwh: v })}
                      suffix="kWh"
                      fit
                      linked={linkA}
                    />
                  </td>
                ) : g.apartmentBaseAlloc === true ? (
                  <td className="cell--muted">
                    공용부 배분: 적정계약전력{' '}
                    <NumInput
                      value={g.contractKw}
                      onChange={(v) => upd({ contractKw: v })}
                      suffix="kW ×"
                      fit
                      linked
                    />{' '}
                    기본단가{' '}
                    {r.baseUnitReversed ? (
                      <b>{Math.round(r.baseUnitUsed).toLocaleString()}원</b>
                    ) : (
                      <NumInput
                        value={g.baseUnitPrice}
                        onChange={(v) => upd({ baseUnitPrice: v })}
                        suffix="원"
                        fit
                        linked
                      />
                    )}{' '}
                    ÷{' '}
                    <NumInput
                      value={g.monthlyKwh}
                      onChange={(v) => upd({ monthlyKwh: v })}
                      suffix="kWh"
                      fit
                      linked={linkA}
                    />
                    {/* 고지서 역산: 있으면 기본단가 = 기본요금 ÷ 계약전력, 없으면 표준/누진 */}
                    <div className="report-reverse no-print">
                      고지서 역산: 기본요금{' '}
                      <NumInput
                        value={g.billBase ?? 0}
                        onChange={(v) => upd({ billBase: v })}
                        suffix="원 ÷"
                        width={96}
                      />{' '}
                      계약전력{' '}
                      <NumInput
                        value={g.billContractKw ?? 0}
                        onChange={(v) => upd({ billContractKw: v })}
                        suffix="kW"
                        width={70}
                      />{' '}
                      {r.baseUnitReversed ? (
                        <span className="cell--up">
                          → 기본단가 {Math.round(r.baseUnitUsed).toLocaleString()}
                          원/kW (고지서 역산 적용)
                        </span>
                      ) : (
                        <span>→ 미입력 시 표준/누진 기본단가 사용</span>
                      )}
                    </div>
                    {!r.baseUnitReversed && g.baseUnitPrice <= 0 && (
                      <div
                        className="no-print"
                        style={{ color: 'var(--warn, #b45309)' }}
                      >
                        기본단가 0 — 아파트 요금분석에서 계약종별·누진 단계(주택용)
                        또는 계약전력(일반용)을 설정하거나, 위 고지서 역산에
                        기본요금·계약전력을 입력하세요.
                      </div>
                    )}
                  </td>
                ) : (
                  <td className="cell--muted">
                    모자분리 미적용 — 공용부 기존 계약에 포함, 추가 기본요금 없음
                    · 월 사용량{' '}
                    <NumInput
                      value={g.monthlyKwh}
                      onChange={(v) => upd({ monthlyKwh: v })}
                      suffix="kWh"
                      width={80}
                      linked={linkA}
                    />
                  </td>
                )}
              </tr>
              <tr className="row--sub">
                <td className="col-name">소계 (A)+(B)</td>
                <td>{won1(r.subtotal)}/kWh</td>
                <td></td>
              </tr>
              <tr>
                <td className="col-name">+ 기후환경요금</td>
                <td>
                  <NumInput
                    value={g.climateFee}
                    onChange={(v) => upd({ climateFee: v })}
                    suffix="원"
                    fit
                  />
                </td>
                <td className="cell--muted">고시값</td>
              </tr>
              <tr>
                <td className="col-name">× 부가세·기금</td>
                <td>
                  <span style={{ whiteSpace: 'nowrap' }}>
                    ×{' '}
                    <NumInput
                      value={g.taxMultiplier}
                      onChange={(v) => upd({ taxMultiplier: v })}
                      fit
                    />
                  </span>
                </td>
                <td className="cell--muted">
                  {model.vatDeduct
                    ? `부가세 공제 → 적용 배수 ${(g.taxMultiplier - 0.1).toFixed(3)} (기금만)`
                    : '부가세 10% + 기금 2.7% = 1.127'}
                </td>
              </tr>
              <tr className="row--total">
                <td className="col-name">★ 실효 전기원가 (Lv1)</td>
                <td className="cell--strong">
                  <NumInput
                    value={g.lv1Override ?? 0}
                    onChange={(v) => upd({ lv1Override: v })}
                    suffix="원/kWh"
                    fit
                    linked={linkA}
                    nullable
                    onNull={() => upd({ lv1Override: null })}
                    placeholder={r.computedLv1.toFixed(1)}
                  />
                </td>
                <td className="cell--muted">
                  <span className="no-print">
                    {sep && g.lv1Override != null ? (
                      <>
                        {billMeasured
                          ? '요금분석 고지서 실측 실효원가 자동 반영'
                          : '요금구조 추정 실효원가 자동 반영'}{' '}
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => upd({ lv1Override: null })}
                        >
                          자동계산으로
                        </button>
                      </>
                    ) : r.overridden ? (
                      <>
                        직접입력 (계산값 {r.computedLv1.toFixed(1)}원){' '}
                        <button
                          type="button"
                          className="link-button"
                          onClick={() => upd({ lv1Override: null })}
                        >
                          자동계산으로
                        </button>
                      </>
                    ) : (
                      '비우면 자동 계산값 사용'
                    )}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 현행 월간 손익 (자동 반영) */}
        <h5 className="report-block__subtitle">
          현행 월간 손익 ({Math.round(g.monthlyKwh).toLocaleString()} kWh/월)
        </h5>
        <div className="table-scroll">
          <table className="data-table report-table report-table--calc">
            <thead>
              <tr>
                <th>구분</th>
                <th>kWh당</th>
                <th>월 간</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="col-name">
                  매출 (현행 부과요금)
                  {model.vatDeduct && (
                    <span className="cell--muted" style={{ fontWeight: 400 }}>
                      {' '}· 부가세 제외 {won1(p.revenuePerKwh)}
                    </span>
                  )}
                </td>
                <td>
                  <NumInput
                    value={g.currentRate}
                    onChange={(v) => upd({ currentRate: v })}
                    suffix="원"
                    fit
                    linked
                  />
                </td>
                <td>{manwon(p.revenueMonth)}</td>
              </tr>
              <tr>
                <td className="col-name">− 전기원가 (Lv1)</td>
                <td>{won1(p.elecPerKwh)}</td>
                <td>{manwon(p.elecMonth)}</td>
              </tr>
              <tr className="row--sub">
                <td className="col-name">= 전기 마진</td>
                <td className={p.marginPerKwh >= 0 ? 'cell--up' : 'cell--down'}>
                  {p.marginPerKwh >= 0 ? '+' : ''}
                  {won1(p.marginPerKwh)}
                </td>
                <td>{signManwon(p.marginMonth)}</td>
              </tr>
              <tr>
                <td className="col-name">− 최소 운영비 (점검·CS·보험·수선)</td>
                <td>{won1(p.opexPerKwh)}</td>
                <td>{manwon(p.opexMonth)}</td>
              </tr>
              {!sep && (
                <>
                  <tr>
                    <td className="col-name">
                      − 대기전력 (공용전기세 부과 손실분)
                    </td>
                    <td>{won1(p.standbyPerKwh)}</td>
                    <td>{manwon(p.standbyLossMonth)}</td>
                  </tr>
                  <tr className="row--detail">
                    <td className="col-name" colSpan={3}>
                      <span className="report-detail-line">
                        월{' '}
                        <NumInput
                          value={g.standbyKwh ?? 0}
                          onChange={(v) => upd({ standbyKwh: v })}
                          suffix="kWh"
                          fit
                          linked
                        />{' '}
                        × 아파트 요금제{' '}
                        <NumInput
                          value={g.standbyRate ?? 0}
                          onChange={(v) => upd({ standbyRate: v })}
                          suffix="원/kWh"
                          fit
                          linked
                        />
                      </span>
                    </td>
                  </tr>
                </>
              )}
              <tr className="row--total">
                <td className="col-name">= 월 순손익</td>
                <td className={p.netPerKwh >= 0 ? 'cell--up' : 'cell--down'}>
                  {won1(p.netPerKwh)}
                </td>
                <td className={p.netMonth >= 0 ? 'cell--up' : 'cell--down'}>
                  {signManwon(p.netMonth)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  /* ---------- 요금 하한선 분석 ---------- */
  function LowerBound({ group, title }: { group: ElecGroup; title: string }) {
    const g = { ...group, vatDeduct: model.vatDeduct }
    const p = computeProfit(g, opexRate)
    return (
      <div className="report-block">
        <h5 className="report-block__subtitle">{title}</h5>
        <div className="table-scroll">
          <table className="data-table report-table report-table--calc">
            <thead>
              <tr>
                <th>구분</th>
                <th>단가 (원/kWh)</th>
                <th>의미</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="col-name">Lv1 전기원가</td>
                <td className="cell--strong">{won1(p.elecPerKwh)}</td>
                <td className="cell--muted">이 이하 = 전기요금 적자</td>
              </tr>
              <tr>
                <td className="col-name">Lv2 손익분기 (전기+운영+수선)</td>
                <td className="cell--strong">{won1(p.lv2)}</td>
                <td className="cell--muted">이 이하 = 운영비·수선비 포함 적자</td>
              </tr>
              <tr>
                <td className="col-name">현행 평균 부과 요금</td>
                <td>{won1(g.currentRate)}</td>
                <td
                  className={
                    g.currentRate >= p.lv2
                      ? 'cell--up'
                      : g.currentRate >= p.elecPerKwh
                        ? 'cell--muted'
                        : 'cell--down'
                  }
                >
                  {g.currentRate >= p.lv2
                    ? '손익분기 이상'
                    : g.currentRate >= p.elecPerKwh
                      ? '전기원가 이상, 손익분기 이하'
                      : '전기원가 이하 (적자)'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="app app--wide report-root">
      <header className="app__header app__header--left report-topbar">
        <div>
          <h1>CMO 컨설팅 보고서</h1>
          <p className="app__subtitle">
            문서 형식의 보고서입니다. <b>실효 전기원가 산출</b>과{' '}
            <b>운영비 내역</b>의 금액을 수정하면 <b>현행 월간 손익</b>과{' '}
            <b>요금 하한선 분석</b>에 자동 반영됩니다.
          </p>
          <p className="report-legend no-print">
            <span className="report-legend__chip" /> 음영 칸 = 앞 단계(요금구조·정산·단지정보)
            <b>자동 연동</b> 값 · 그 외 칸은 직접 입력.
            <b>「🔄 앞 단계 값 자동 반영」</b>으로 음영 칸을 최신값으로 갱신합니다.
          </p>
        </div>
        <div className="report-topbar__actions no-print">
          {autoSeed && (
            <button
              type="button"
              className="btn-secondary report-autofill-btn"
              onClick={autoFill}
            >
              🔄 앞 단계 값 자동 반영
            </button>
          )}
          <button
            type="button"
            className="btn-cta report-pdf-btn"
            onClick={() => window.print()}
          >
            🖨 PDF 출력
          </button>
        </div>
      </header>

      <main className="app__main">
        {/* 표지 (PDF 첫 페이지) */}
        <section className="card report-cover-card">
          <div className="report-cover">
            <span className="report-cover__brand">UNITCONNECT</span>
            <TextInput
              value={model.siteName}
              onChange={(v) => setModel((m) => ({ ...m, siteName: v }))}
              wide
              linked
            />
            <p className="report-cover__doctype">
              전기차 충전 인프라 컨설팅 보고서
            </p>
            <div className="report-cover__meta">
              <label>
                분석 기간{' '}
                <TextInput
                  value={model.period}
                  onChange={(v) => setModel((m) => ({ ...m, period: v }))}
                />
              </label>
              <span className="report-cover__sep">|</span>
              <label>
                보고일{' '}
                <TextInput
                  value={model.reportDate}
                  onChange={(v) => setModel((m) => ({ ...m, reportDate: v }))}
                />
              </label>
            </div>
            <div className="report-cover__conf">UNITCONNECT | Confidential</div>
          </div>
        </section>

        {/* Part 1 */}
        {(secOn('1-1') || secOn('1-2') || secOn('1-3')) && (
        <section className="card">
          <h2>Part 1. 충전 인프라 현황</h2>

          {SecHead({ k: '1-1', label: '1-1. 단지 개요' })}
          {secOn('1-1') && (
          <>
          <div className="table-scroll">
            <table className="data-table report-table">
              <thead>
                <tr>
                  <th>항목</th>
                  <th>수치</th>
                  <th>비고</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {model.overview.map((row) => (
                  <tr key={row.id}>
                    <td className="col-name">
                      <TextInput
                        value={row.label}
                        onChange={(v) => updList('overview', row.id, { label: v })}
                      />
                    </td>
                    <td>
                      <TextInput
                        value={row.value}
                        onChange={(v) => updList('overview', row.id, { value: v })}
                        linked={['세대수', '충전기', '현행 요금'].includes(row.label)}
                      />
                    </td>
                    <td>
                      <TextInput
                        value={row.note}
                        onChange={(v) => updList('overview', row.id, { note: v })}
                        wide
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="link-button link-button--danger no-print"
                        onClick={() =>
                          setModel((m) => ({
                            ...m,
                            overview: m.overview.filter((r) => r.id !== row.id),
                          }))
                        }
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="link-button no-print"
            onClick={() =>
              setModel((m) => ({
                ...m,
                overview: [
                  ...m.overview,
                  { id: `ov${Date.now().toString(36)}`, label: '', value: '', note: '' },
                ],
              }))
            }
          >
            + 항목 추가
          </button>
          </>
          )}

          {SecHead({ k: '1-2', label: '1-2. 충전기 유형별 실적' })}
          {secOn('1-2') && (
          <div className="table-scroll">
            <table className="data-table report-table">
              <thead>
                <tr>
                  {colHead('pt.type', '유형')}
                  {colHead('pt.count', '대수')}
                  {colHead('pt.kwh', '충전량(년)')}
                  {colHead('pt.monthly', '충전량(월)')}
                  {colHead('pt.perUnit', '대당 충전량(월)')}
                  {colHead('pt.util', '이용률(월)')}
                </tr>
              </thead>
              <tbody>
                {model.perType.map((row) => (
                  <tr key={row.id}>
                    <td className="col-name">{row.type}</td>
                    {(
                      ['count', 'kwh', 'monthlyKwh', 'perUnit', 'util'] as const
                    ).map((k) => (
                      <td key={k}>
                        <TextInput
                          value={row[k] ?? ''}
                          onChange={(v) => updList('perType', row.id, { [k]: v })}
                          linked
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          {SecHead({ k: '1-3', label: '1-3. 월별 충전 추이' })}
          {secOn('1-3') && (
          <div className="table-scroll">
            <table className="data-table report-table">
              <thead>
                <tr>
                  <th>월</th>
                  <th>충전량(kWh)</th>
                  <th>매출(원)</th>
                  <th>전월비</th>
                </tr>
              </thead>
              <tbody>
                {model.monthly.map((row) => (
                  <tr key={row.id}>
                    {(['month', 'kwh', 'revenue', 'note'] as const).map((k) => (
                      <td key={k} className={k === 'month' ? 'col-name' : ''}>
                        <TextInput
                          value={row[k]}
                          onChange={(v) => updList('monthly', row.id, { [k]: v })}
                          linked={k !== 'note'}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </section>
        )}

        {/* Part 2 */}
        {(groups.some((g) => secOn(groupKey(g.id))) ||
          secOn('2-opex') ||
          secOn('2-lb') ||
          secOn('2-rec')) && (
        <section className="card">
          <h2>Part 2. 문제점 — 전기요금 구조 및 운영비</h2>

          <label className="toggle report-moja no-print">
            <input
              type="checkbox"
              checked={model.vatDeduct === true}
              onChange={(e) =>
                setModel((m) => ({ ...m, vatDeduct: e.target.checked }))
              }
            />
            <span>
              <b>위탁운영(부가세 공제) 기준으로 보기</b> — 사업자는 매입 부가세를
              공제받으므로 <b>전기원가·매출을 부가세 제외 기준</b>으로 환산해 실질
              마진을 표시합니다. 미체크 시 현행(부가세 포함) 기준.
            </span>
          </label>
          {model.vatDeduct && (
            <p className="report-vat-note">
              부가세 공제 기준 적용 중: 실효원가 배수 −0.10(기금만), 매출 ÷1.10.
              (요금구조 seed 실효원가는 이미 부가세 제외)
            </p>
          )}

          {/* 등록 충전기 종류별 전기원가 분석 */}
          {groups.map((g, i) => (
            <Fragment key={g.id}>
              {SecHead({
                k: groupKey(g.id),
                tag: 'h4',
                label: `2-${i + 1}. ${g.name} 전기원가${
                  g.separated !== false ? ' (모자분리)' : ' (공용부)'
                }`,
                editable: true,
              })}
              {secOn(groupKey(g.id)) &&
                ElecCostBlock({
                  group: g,
                  sub:
                    g.separated !== false
                      ? '모자분리 적용 · 계약전력 기반 기본요금 부과'
                      : '모자분리 미적용 · 공용부 전기세 부과 (기본요금 없음)',
                })}
            </Fragment>
          ))}

          {/* 운영비 내역 */}
          {SecHead({
            k: '2-opex',
            tag: 'h4',
            label: `2-${groups.length + 1}. 운영비 내역 (예상)`,
          })}
          {secOn('2-opex') && (
          <div className="report-block">
            <div className="table-scroll">
              <table className="data-table report-table report-table--opex">
                <thead>
                  <tr>
                    <th>구분</th>
                    <th>연 비용</th>
                    <th>월 비용</th>
                    <th>비고</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {model.opex.map((row) => (
                    <tr key={row.id}>
                      <td className="col-name">
                        <TextInput
                          value={row.name}
                          onChange={(v) => updList('opex', row.id, { name: v })}
                        />
                      </td>
                      <td>
                        <NumInput
                          value={row.yearCost}
                          onChange={(v) => updList('opex', row.id, { yearCost: v })}
                          suffix="원"
                          width={110}
                          linked={!row.name.includes('CS')}
                        />
                      </td>
                      <td>{manwon(row.yearCost / 12)}</td>
                      <td>
                        <TextInput
                          value={row.note}
                          onChange={(v) => updList('opex', row.id, { note: v })}
                          wide
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="link-button link-button--danger"
                          onClick={() =>
                            setModel((m) => ({
                              ...m,
                              opex: m.opex.filter((r) => r.id !== row.id),
                            }))
                          }
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr className="row--total">
                    <td className="col-name">합계</td>
                    <td>{manwon(opexMonth * 12)}</td>
                    <td>{manwon(opexMonth)}</td>
                    <td className="cell--muted">
                      <span className="report-detail-line">
                        ÷{' '}
                        <NumInput
                          value={model.opexBaseKwh}
                          onChange={(v) =>
                            setModel((m) => ({ ...m, opexBaseKwh: v }))
                          }
                          suffix="kWh"
                          fit
                          linked
                        />{' '}
                        = <b>{won1(opexRate)}/kWh</b>
                      </span>
                    </td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <button
              type="button"
              className="link-button"
              onClick={() =>
                setModel((m) => ({ ...m, opex: [...m.opex, newOpexRow()] }))
              }
            >
              + 운영비 항목 추가
            </button>
          </div>
          )}

          {/* 요금 하한선 분석 — 종류별 (각 종류 체크 여부 연동) */}
          {SecHead({
            k: '2-lb',
            tag: 'h4',
            label: `2-${groups.length + 2}. 요금 하한선 분석`,
          })}
          {secOn('2-lb') &&
            groups.map((g, i) =>
              secOn(groupKey(g.id)) ? (
                <Fragment key={g.id}>
                  {LowerBound({ group: g, title: groupTitle2(g, i) })}
                </Fragment>
              ) : null,
            )}

          {/* 충전요금 인상 권고안 */}
          {SecHead({
            k: '2-rec',
            tag: 'h4',
            label: `2-${groups.length + 3}. 충전요금 인상 권고안`,
          })}
          {secOn('2-rec') && (
          <div className="report-block">
            <div className="table-scroll">
              <table className="data-table report-table">
                <thead>
                  <tr>
                    <th>구분</th>
                    <th>현행 요금</th>
                    <th>최소 인상안</th>
                    <th>비고</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {model.recommend.map((row) => (
                    <tr key={row.id}>
                      <td className="col-name">
                        <TextInput
                          value={row.label}
                          onChange={(v) =>
                            updList('recommend', row.id, { label: v })
                          }
                        />
                      </td>
                      <td>
                        <TextInput
                          value={row.current}
                          onChange={(v) =>
                            updList('recommend', row.id, { current: v })
                          }
                          linked
                        />
                      </td>
                      <td>
                        {lv2ForLabel(row.label) ? (
                          <span
                            className="report-auto-value"
                            title="Lv2 손익분기 자동 반영(요금 하한선 분석)"
                          >
                            {lv2ForLabel(row.label)}
                          </span>
                        ) : (
                          <TextInput
                            value={row.proposed ?? ''}
                            onChange={(v) =>
                              updList('recommend', row.id, { proposed: v })
                            }
                          />
                        )}
                      </td>
                      <td>
                        <TextInput
                          value={row.note}
                          onChange={(v) =>
                            updList('recommend', row.id, { note: v })
                          }
                          wide
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="link-button link-button--danger no-print"
                          onClick={() =>
                            setModel((m) => ({
                              ...m,
                              recommend: m.recommend.filter(
                                (r) => r.id !== row.id,
                              ),
                            }))
                          }
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              className="link-button no-print"
              onClick={() =>
                setModel((m) => ({
                  ...m,
                  recommend: [...m.recommend, newRecommendRow()],
                }))
              }
            >
              + 권고 항목 추가
            </button>
          </div>
          )}
        </section>
        )}

        {/* Part 3 */}
        {(secOn('3-0') || secOn('3-1') || secOn('3-2') || secOn('3-3') || secOn('3-4')) && (
        <section className="card">
          <h2>Part 3. 해결 방안</h2>
          {SecHead({ k: '3-0', tag: 'h4', label: '3-0. 공통 전제' })}
          {secOn('3-0') && (
          <div className="report-premise">
            <textarea
              className="report-textarea"
              value={model.premise ?? ''}
              onChange={(e) =>
                setModel((m) => ({ ...m, premise: e.target.value }))
              }
              rows={2}
            />
          </div>
          )}

          {SecHead({ k: '3-1', tag: 'h4', label: '3-1. 방안 ① 자치운영 — 고려사항' })}
          {secOn('3-1') && (
          <div className="report-block">
            <div className="table-scroll">
              <table className="data-table report-table">
                <thead>
                  <tr>
                    <th>영역</th>
                    <th>상세</th>
                  </tr>
                </thead>
                <tbody>
                  {(model.autonomy ?? []).map((row) => (
                    <tr key={row.id}>
                      <td className="col-name">
                        <TextInput
                          value={row.area}
                          onChange={(v) => updList('autonomy', row.id, { area: v })}
                        />
                      </td>
                      <td>
                        <TextInput
                          value={row.detail}
                          onChange={(v) =>
                            updList('autonomy', row.id, { detail: v })
                          }
                          wide
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}

          {SecHead({ k: '3-2', tag: 'h4', label: '3-2. 방안 ② CPO 위탁' })}
          {secOn('3-2') && (
          <div className="report-block">
            <div className="table-scroll">
              <table className="data-table report-table">
                <thead>
                  <tr>
                    <th>항목</th>
                    <th>내용</th>
                  </tr>
                </thead>
                <tbody>
                  {(model.cpo ?? []).map((row) => (
                    <tr key={row.id}>
                      <td className="col-name">
                        <TextInput
                          value={row.label}
                          onChange={(v) => updList('cpo', row.id, { label: v })}
                        />
                      </td>
                      <td>
                        <TextInput
                          value={row.content}
                          onChange={(v) => updList('cpo', row.id, { content: v })}
                          wide
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}

          {SecHead({ k: '3-3', tag: 'h4', label: '3-3. 방안 ③ CMO 위탁운영 (UNITCONNECT)' })}
          {secOn('3-3') && (
          <div className="report-block">
            <div className="table-scroll">
              <table className="data-table report-table">
                <thead>
                  <tr>
                    <th>항목</th>
                    <th>내용</th>
                  </tr>
                </thead>
                <tbody>
                  {(model.cmo ?? []).map((row) => (
                    <tr key={row.id}>
                      <td className="col-name">
                        <TextInput
                          value={row.label}
                          onChange={(v) => updList('cmo', row.id, { label: v })}
                        />
                      </td>
                      <td>
                        <TextInput
                          value={row.content}
                          onChange={(v) => updList('cmo', row.id, { content: v })}
                          wide
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}

          {SecHead({ k: '3-4', tag: 'h4', label: '3-4. 3가지 방안 비교' })}
          {secOn('3-4') && (
          <div className="report-block">
            <div className="table-scroll">
              <table className="data-table report-table">
                <thead>
                  <tr>
                    <th>비교 항목</th>
                    <th>자치운영</th>
                    <th>CPO 위탁</th>
                    <th>CMO (UC)</th>
                  </tr>
                </thead>
                <tbody>
                  {(model.compare ?? []).map((row) => (
                    <tr key={row.id}>
                      <td className="col-name">{row.item}</td>
                      {(['self', 'cpo', 'cmo'] as const).map((k) => (
                        <td key={k}>
                          <TextInput
                            value={row[k]}
                            onChange={(v) => updList('compare', row.id, { [k]: v })}
                            wide
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          )}
        </section>
        )}
      </main>
    </div>
  )
}
