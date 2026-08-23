import { useMemo } from 'react'
import { usePersistentState } from '../lib/persist'
import type { FileEntry, Period } from '../types'
import {
  computeAll,
  type ChargerType,
  type SettlementConfig,
  type SettlementMetrics,
} from '../lib/settlement'
import { formatNumber } from '../lib/stats'
import type { SiteInfo } from './SiteInfoPanel'
import ComboChart from './ComboChart'

/** 큰 금액을 만/억 단위로 짧게 표기 */
function compactWon(v: number): string {
  if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억`
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만`
  return Math.round(v).toLocaleString()
}

/** 큰 kWh 값을 짧게 표기 */
function compactKwh(v: number): string {
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}만`
  return Math.round(v).toLocaleString()
}

/** 월별 이용자 추이 + 사용량/사용금액 그래프 (월간 데이터 전용) */
function MonthlyTrends({ rows }: { rows: SettlementMetrics[] }) {
  if (rows.length === 0) return null
  const chartData = rows.map((m) => ({
    label: m.periodLabel,
    bar: Math.round(m.amountCalc),
    line: Math.round(m.usageTotal),
  }))

  return (
    <>
      <div className="subsection">
        <h3 className="subsection__title">
          월별 이용자 추이 <span className="count-tag">{rows.length}개월</span>
        </h3>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>월</th>
                <th>이용자 수</th>
                <th>전월 대비 증가</th>
                <th>증가율</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m, i) => {
                const prev = i > 0 ? rows[i - 1] : null
                const inc = prev ? m.users - prev.users : null
                const rate =
                  prev && prev.users > 0
                    ? ((m.users - prev.users) / prev.users) * 100
                    : null
                const cls =
                  inc == null
                    ? 'cell--null'
                    : inc > 0
                      ? 'cell--up'
                      : inc < 0
                        ? 'cell--down'
                        : ''
                return (
                  <tr key={m.id}>
                    <td className="col-name">{m.periodLabel}</td>
                    <td>{m.users.toLocaleString()}</td>
                    <td className={cls}>
                      {inc == null
                        ? '—'
                        : `${inc > 0 ? '▲ +' : inc < 0 ? '▼ ' : ''}${inc.toLocaleString()}`}
                    </td>
                    <td className={cls}>
                      {rate == null
                        ? '—'
                        : `${rate >= 0 ? '+' : ''}${formatNumber(rate)}%`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="subsection">
        <h3 className="subsection__title">월별 사용금액 · 사용량</h3>
        <ComboChart
          data={chartData}
          barLabel="사용금액(원)"
          lineLabel="사용량(kWh)"
          barFormat={compactWon}
          lineFormat={compactKwh}
          barColor="#3B82F6"
          lineColor="#F59E0B"
        />
      </div>
    </>
  )
}

interface SettlementAnalysisProps {
  files: FileEntry[]
  config: SettlementConfig
  site: SiteInfo
  /** 종류별 자동 비례 배분 가중치(정격×대수×가정이용률). 3종류 이상 이용률 추정용. */
  autoWeights?: Record<string, number>
}

// 기간 유형별 표시 순서/라벨
const PERIOD_SECTIONS: { type: Period['type']; label: string }[] = [
  { type: 'month', label: '월간' },
  { type: 'year', label: '연간' },
  { type: 'total', label: '전체 기간' },
  { type: 'unknown', label: '기타 (기간 미인식)' },
]

/** 한 기간 유형(월간/연간/전체)에 대한 비교표 (읽기 전용) */
function ComparisonSection({
  label,
  rows,
  chargers,
  manual,
  onManual,
}: {
  label: string
  rows: SettlementMetrics[]
  chargers: ChargerType[]
  manual: Record<string, Record<string, number>>
  onManual: (fileId: string, typeId: string, v: number | null) => void
}) {
  return (
    <div className="subsection">
      <h3 className="subsection__title">
        {label} <span className="count-tag">{rows.length}건</span>
      </h3>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th rowSpan={2}>기간</th>
              <th rowSpan={2}>
                분석
                <br />
                개월수
              </th>
              <th rowSpan={2}>이용자</th>
              <th rowSpan={2}>
                총 사용량
                <br />
                (kWh)
              </th>
              {chargers.length > 0 && (
                <th className="group-head" colSpan={chargers.length}>
                  종류별 사용량 (kWh)
                </th>
              )}
              <th rowSpan={2}>
                사용금액
                <br />
                (원)
              </th>
              {chargers.length > 0 && (
                <th className="group-head" colSpan={chargers.length}>
                  종류별 사용금액 (원)
                </th>
              )}
              <th rowSpan={2}>
                전체
                <br />
                이용률(%)
              </th>
              {chargers.length > 0 && (
                <th className="group-head" colSpan={chargers.length}>
                  종류별 이용률 (%)
                </th>
              )}
              <th rowSpan={2}>
                사용량
                <br />
                증감률
              </th>
            </tr>
            <tr>
              {chargers.map((c, ci) => (
                <th
                  key={`uh-${c.id}`}
                  className={`type-col${ci === 0 ? ' group-start' : ''}`}
                >
                  {c.name}
                </th>
              ))}
              {chargers.map((c, ci) => (
                <th
                  key={`ah-${c.id}`}
                  className={`type-col${ci === 0 ? ' group-start' : ''}`}
                >
                  {c.name}
                </th>
              ))}
              {chargers.map((c, ci) => (
                <th
                  key={`rh-${c.id}`}
                  className={`type-col${ci === 0 ? ' group-start' : ''}`}
                >
                  {c.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((m, i) => {
              const prev = i > 0 ? rows[i - 1] : null
              const growth =
                prev && prev.usageTotal > 0
                  ? ((m.usageTotal - prev.usageTotal) / prev.usageTotal) * 100
                  : null
              const typeById = new Map(m.types.map((t) => [t.id, t]))
              return (
                <tr key={m.id}>
                  <td className="col-name" title={m.fileName}>
                    {m.periodLabel}
                  </td>
                  <td>{m.months}</td>
                  <td>{m.users.toLocaleString()}</td>
                  <td>{formatNumber(m.usageTotal)}</td>
                  {chargers.map((c, ci) => {
                    const manualV = manual[m.id]?.[c.id]
                    const isManual = manualV != null
                    return (
                      <td
                        key={`u-${c.id}`}
                        className={`type-col${ci === 0 ? ' group-start' : ''}`}
                      >
                        <input
                          className={`cell-input cell-input--usage${
                            isManual ? ' cell-input--linked' : ''
                          }`}
                          type="number"
                          title="직접 입력 시 자동/추정값을 덮어씁니다"
                          placeholder={
                            m.splitMode === 'none'
                              ? '직접 입력'
                              : formatNumber(
                                  Math.round(typeById.get(c.id)?.usage ?? 0),
                                )
                          }
                          value={isManual ? manualV : ''}
                          onChange={(e) =>
                            onManual(
                              m.id,
                              c.id,
                              e.target.value === ''
                                ? null
                                : Number(e.target.value),
                            )
                          }
                        />
                      </td>
                    )
                  })}
                  <td>{formatNumber(Math.round(m.amountCalc))}</td>
                  {chargers.map((c, ci) => (
                    <td
                      key={`a-${c.id}`}
                      className={`type-col${ci === 0 ? ' group-start' : ''}`}
                    >
                      {m.splitMode === 'none'
                        ? '—'
                        : formatNumber(Math.round(typeById.get(c.id)?.amount ?? 0))}
                    </td>
                  ))}
                  <td>{formatNumber(m.utilTotal)}</td>
                  {chargers.map((c, ci) => (
                    <td
                      key={`r-${c.id}`}
                      className={`type-col${ci === 0 ? ' group-start' : ''}`}
                    >
                      {m.splitMode === 'none'
                        ? '—'
                        : formatNumber(typeById.get(c.id)?.utilization ?? 0)}
                    </td>
                  ))}
                  <td
                    className={
                      growth == null
                        ? 'cell--null'
                        : growth >= 0
                          ? 'cell--up'
                          : 'cell--down'
                    }
                  >
                    {growth == null
                      ? '—'
                      : `${growth >= 0 ? '▲' : '▼'} ${formatNumber(Math.abs(growth))}%`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * 충전기 정산 전용 분석. 단지 정보 패널에서 입력한 충전기 수량·요금(config)이
 * 자동 적용되며, 결과 표는 읽기 전용이다.
 */
export default function SettlementAnalysis({
  files,
  config,
  site,
  autoWeights,
}: SettlementAnalysisProps) {
  // 종류별 사용량 수동 입력(파일별·종류별). 있으면 자동/추정값을 덮어쓴다.
  const [manualUsage, setManualUsage] = usePersistentState<
    Record<string, Record<string, number>>
  >(`settle.manualUsage.${site.name}`, {})
  const setManual = (fileId: string, typeId: string, v: number | null) =>
    setManualUsage((prev) => {
      const file = { ...(prev[fileId] ?? {}) }
      if (v == null || !Number.isFinite(v)) delete file[typeId]
      else file[typeId] = v
      const next = { ...prev, [fileId]: file }
      if (Object.keys(file).length === 0) delete next[fileId]
      return next
    })
  const metrics = useMemo(
    () => computeAll(files, config, {}, manualUsage, autoWeights),
    [files, config, manualUsage, autoWeights],
  )

  const visibleChargers = useMemo(
    () => config.chargers.filter((c) => c.count > 0),
    [config],
  )
  const anyNone = metrics.some((m) => m.splitMode === 'none')
  const anyEstimate = metrics.some((m) => m.splitMode === 'estimate')

  return (
    <section className="card settlement">
      <div className="card__header">
        <div>
          <h2>충전기 정산 분석{site.name ? ` · ${site.name}` : ''}</h2>
          <p className="group-range">
            {site.address ? `${site.address} · ` : ''}
            {site.households > 0
              ? `${site.households.toLocaleString()}세대 · `
              : ''}
            {metrics.length}개 파일
          </p>
        </div>
      </div>

      {anyEstimate && (
        <p className="status status--info">
          요금이 지정된 종류가 3개 이상이라 요금 역산으로는 나눌 수 없어,
          <b> 종류별 (정격×대수×표준 이용률[UC 기준]) 비중으로 총 사용량을 배분한
          추정치</b>로 표시합니다. (총량은 보존, 사업성 가정 이용률과 무관)
        </p>
      )}
      {anyNone && (
        <p className="status status--info">
          요금이 같거나 종류별 가중치가 없어 자동으로 나눌 수 없는 파일은 종류별
          사용량 칸에 <b>직접 입력</b>하면 이용률이 계산됩니다. (요금이 다른 2종류는
          요금 역산 자동 계산)
        </p>
      )}
      <p className="table-note">
        종류별 사용량 칸에 값을 직접 입력하면 자동/추정값을 덮어씁니다(음영 표시).
        비우면 다시 자동 계산.
      </p>

      {PERIOD_SECTIONS.map(({ type, label }) => {
        const rows = metrics.filter((m) => m.periodType === type)
        if (rows.length === 0) return null
        return (
          <ComparisonSection
            key={type}
            label={label}
            rows={rows}
            chargers={visibleChargers}
            manual={manualUsage}
            onManual={setManual}
          />
        )
      })}

      <MonthlyTrends
        rows={metrics.filter((m) => m.periodType === 'month')}
      />

      <p className="table-note">
        <b>이용률 = 사용량 ÷ (충전기 총용량 × 분석 개월수)</b>. 분석 개월수는
        파일명 기간으로 자동 계산됩니다(월간=1, 연간=12, 전체 기간은
        <code> 전체_202401~202506</code> 형태로 자동 산정). 종류별 분리: 요금이
        다른 2종은 요금 역산. 개인정보(사용자명·건물명·동·호)는 표시하지
        않습니다.
      </p>
    </section>
  )
}
