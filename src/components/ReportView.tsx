import {
  computeElecCost,
  computeProfit,
  opexMonthlyTotal,
  opexPerKwh,
  newOpexRow,
  type ElecCostInput,
  type ReportModel,
} from '../lib/report'

interface ReportViewProps {
  model: ReportModel
  setModel: React.Dispatch<React.SetStateAction<ReportModel>>
}

/* ---------- 포맷 ---------- */
const won1 = (v: number) => `${v.toFixed(1)}원`
const manwon = (v: number) =>
  `약 ${Math.round(v / 10000).toLocaleString()}만원`
const signManwon = (v: number) =>
  `${v >= 0 ? '+' : '-'}약 ${Math.abs(Math.round(v / 10000)).toLocaleString()}만원`

/* ---------- 입력 셀 ---------- */
function NumInput({
  value,
  onChange,
  suffix,
  width = 90,
}: {
  value: number
  onChange: (v: number) => void
  suffix?: string
  width?: number
}) {
  return (
    <span className="num-input">
      <input
        className="cell-input"
        type="number"
        style={{ width }}
        value={Number.isFinite(value) ? value : ''}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
      />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </span>
  )
}

function TextInput({
  value,
  onChange,
  wide,
}: {
  value: string
  onChange: (v: string) => void
  wide?: boolean
}) {
  return (
    <input
      className="cell-input"
      type="text"
      style={{ width: wide ? '100%' : 140 }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

export default function ReportView({ model, setModel }: ReportViewProps) {
  const opexRate = opexPerKwh(model.opex, model.opexBaseKwh)
  const opexMonth = opexMonthlyTotal(model.opex)

  function updGroup(key: 'groupA' | 'groupB', patch: Partial<ElecCostInput>) {
    setModel((m) => ({ ...m, [key]: { ...m[key], ...patch } }))
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

  /* ---------- 실효 전기원가 산출 블록 ---------- */
  function ElecCostBlock({
    which,
    title,
    sub,
  }: {
    which: 'groupA' | 'groupB'
    title: string
    sub: string
  }) {
    const g = model[which]
    const r = computeElecCost(g)
    const p = computeProfit(g, opexRate)
    return (
      <div className="report-block">
        <h4 className="report-block__title">{title}</h4>
        <p className="report-block__sub">{sub}</p>

        <div className="table-scroll">
          <table className="data-table report-table">
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
                    onChange={(v) => updGroup(which, { powerRate: v })}
                    suffix="원/kWh"
                  />
                </td>
                <td className="cell--muted">사용 패턴에 따라 변동</td>
              </tr>
              <tr>
                <td className="col-name">(B) kWh당 기본요금 환산</td>
                <td>{won1(r.baseCharge)}/kWh</td>
                <td className="cell--muted">
                  <NumInput
                    value={g.contractKw}
                    onChange={(v) => updGroup(which, { contractKw: v })}
                    suffix="kW ×"
                    width={70}
                  />{' '}
                  <NumInput
                    value={g.baseUnitPrice}
                    onChange={(v) => updGroup(which, { baseUnitPrice: v })}
                    suffix="원 ÷"
                    width={70}
                  />{' '}
                  <NumInput
                    value={g.monthlyKwh}
                    onChange={(v) => updGroup(which, { monthlyKwh: v })}
                    suffix="kWh"
                    width={80}
                  />
                </td>
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
                    onChange={(v) => updGroup(which, { climateFee: v })}
                    suffix="원"
                  />
                </td>
                <td className="cell--muted">고시값</td>
              </tr>
              <tr>
                <td className="col-name">× 부가세·기금</td>
                <td>
                  ×
                  <NumInput
                    value={g.taxMultiplier}
                    onChange={(v) => updGroup(which, { taxMultiplier: v })}
                    width={70}
                  />
                </td>
                <td className="cell--muted">부가세 10% + 기금 2.7% = 1.127</td>
              </tr>
              <tr className="row--total">
                <td className="col-name">★ 실효 전기원가 (Lv1)</td>
                <td className="cell--strong">{won1(r.lv1)}/kWh</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 현행 월간 손익 (자동 반영) */}
        <h5 className="report-block__subtitle">
          현행 월간 손익 ({Math.round(g.monthlyKwh).toLocaleString()} kWh/월)
        </h5>
        <div className="table-scroll">
          <table className="data-table report-table">
            <thead>
              <tr>
                <th>구분</th>
                <th>kWh당</th>
                <th>월 간</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="col-name">매출 (현행 부과요금)</td>
                <td>
                  <NumInput
                    value={g.currentRate}
                    onChange={(v) => updGroup(which, { currentRate: v })}
                    suffix="원"
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
  function LowerBound({
    which,
    title,
  }: {
    which: 'groupA' | 'groupB'
    title: string
  }) {
    const g = model[which]
    const p = computeProfit(g, opexRate)
    return (
      <div className="report-block">
        <h5 className="report-block__subtitle">{title}</h5>
        <div className="table-scroll">
          <table className="data-table report-table">
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
    <div className="app app--wide">
      <header className="app__header app__header--left">
        <h1>CMO 컨설팅 보고서</h1>
        <p className="app__subtitle">
          문서 형식의 보고서입니다. <b>실효 전기원가 산출</b>과{' '}
          <b>운영비 내역</b>의 금액을 수정하면 <b>현행 월간 손익</b>과{' '}
          <b>요금 하한선 분석</b>에 자동 반영됩니다.
        </p>
      </header>

      <main className="app__main">
        {/* 표지 */}
        <section className="card">
          <div className="report-cover">
            <span className="report-cover__brand">UNITCONNECT</span>
            <TextInput
              value={model.siteName}
              onChange={(v) => setModel((m) => ({ ...m, siteName: v }))}
              wide
            />
            <div className="report-cover__meta">
              <label>
                분석 기간{' '}
                <TextInput
                  value={model.period}
                  onChange={(v) => setModel((m) => ({ ...m, period: v }))}
                />
              </label>
              <label>
                보고일{' '}
                <TextInput
                  value={model.reportDate}
                  onChange={(v) => setModel((m) => ({ ...m, reportDate: v }))}
                />
              </label>
            </div>
          </div>
        </section>

        {/* Part 1 */}
        <section className="card">
          <h2>Part 1. 충전 인프라 현황</h2>

          <h3 className="subsection__title">1-1. 단지 개요</h3>
          <div className="table-scroll">
            <table className="data-table report-table">
              <thead>
                <tr>
                  <th>항목</th>
                  <th>수치</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {model.overview.map((row) => (
                  <tr key={row.id}>
                    <td className="col-name">{row.label}</td>
                    <td>
                      <TextInput
                        value={row.value}
                        onChange={(v) => updList('overview', row.id, { value: v })}
                      />
                    </td>
                    <td>
                      <TextInput
                        value={row.note}
                        onChange={(v) => updList('overview', row.id, { note: v })}
                        wide
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="subsection__title">1-2. 충전기 유형별 실적</h3>
          <div className="table-scroll">
            <table className="data-table report-table">
              <thead>
                <tr>
                  <th>유형</th>
                  <th>대수</th>
                  <th>충전량</th>
                  <th>매출</th>
                  <th>대당 월 충전량</th>
                </tr>
              </thead>
              <tbody>
                {model.perType.map((row) => (
                  <tr key={row.id}>
                    <td className="col-name">{row.type}</td>
                    {(['count', 'kwh', 'revenue', 'perUnit'] as const).map((k) => (
                      <td key={k}>
                        <TextInput
                          value={row[k]}
                          onChange={(v) => updList('perType', row.id, { [k]: v })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="subsection__title">1-3. 월별 충전 추이</h3>
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
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Part 2 */}
        <section className="card">
          <h2>Part 2. 문제점 — 전기요금 구조 및 운영비</h2>

          <ElecCostBlock
            which="groupA"
            title="2-1. 모자분리 충전기 (7kW 완속 · DC 급속)"
            sub="일반용(을) 고압 요금 · 모자분리 적용"
          />
          <ElecCostBlock
            which="groupB"
            title="2-2. 모자분리 미적용 충전기 (3kW 완속, 공용부 부과)"
            sub="주택용 전력 · 공용부 전기세 부과 (이용률 추정 기반)"
          />

          {/* 운영비 내역 */}
          <div className="report-block">
            <h4 className="report-block__title">2-3. 운영비 내역 (예상)</h4>
            <div className="table-scroll">
              <table className="data-table report-table">
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
                      ÷{' '}
                      <NumInput
                        value={model.opexBaseKwh}
                        onChange={(v) =>
                          setModel((m) => ({ ...m, opexBaseKwh: v }))
                        }
                        suffix="kWh"
                        width={90}
                      />{' '}
                      = <b>{won1(opexRate)}/kWh</b>
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

          {/* 요금 하한선 분석 (자동 반영) */}
          <LowerBound
            which="groupA"
            title="요금 하한선 분석 — 모자분리 충전기 (7kW · DC)"
          />
          <LowerBound
            which="groupB"
            title="요금 하한선 분석 — 모자분리 미적용 (3kW)"
          />

          {/* 충전요금 인상 권고안 */}
          <div className="report-block">
            <h4 className="report-block__title">충전요금 인상 권고안</h4>
            <div className="table-scroll">
              <table className="data-table report-table">
                <thead>
                  <tr>
                    <th>구분</th>
                    <th>현행 요금</th>
                    <th>최소 인상안</th>
                    <th>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {model.recommend.map((row) => (
                    <tr key={row.id}>
                      <td className="col-name">{row.label}</td>
                      {(['current', 'proposed', 'note'] as const).map((k) => (
                        <td key={k}>
                          <TextInput
                            value={row[k]}
                            onChange={(v) =>
                              updList('recommend', row.id, { [k]: v })
                            }
                            wide={k === 'note'}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
