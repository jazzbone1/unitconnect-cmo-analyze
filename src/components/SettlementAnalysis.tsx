import { useMemo, useState } from 'react'
import type { FileEntry, Period } from '../types'
import {
  computeAll,
  DEFAULT_CONFIG,
  type ChargerType,
  type SettlementConfig,
  type SettlementMetrics,
} from '../lib/settlement'
import { formatNumber } from '../lib/stats'

interface SettlementAnalysisProps {
  files: FileEntry[]
}

// 기간 유형별 표시 순서/라벨
const PERIOD_SECTIONS: { type: Period['type']; label: string }[] = [
  { type: 'month', label: '월간' },
  { type: 'year', label: '연간' },
  { type: 'total', label: '전체 기간' },
  { type: 'unknown', label: '기타 (기간 미인식)' },
]

function cloneDefault(): SettlementConfig {
  return {
    hours: DEFAULT_CONFIG.hours,
    chargers: DEFAULT_CONFIG.chargers.map((c) => ({ ...c })),
  }
}

/** 충전기 종류 설정 편집기 — 5종 고정, 요금·수량만 입력 */
function ChargerEditor({
  config,
  setConfig,
}: {
  config: SettlementConfig
  setConfig: (c: SettlementConfig) => void
}) {
  function updateCharger(id: string, patch: Partial<ChargerType>) {
    setConfig({
      ...config,
      chargers: config.chargers.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    })
  }

  return (
    <div className="var-panel">
      <div className="var-group">
        <h3 className="subsection__title">충전기 종류별 요금·수량</h3>
        <div className="table-scroll">
          <table className="data-table charger-table">
            <thead>
              <tr>
                <th>충전기 종류</th>
                <th>요금(원/kWh)</th>
                <th>수량(기)</th>
              </tr>
            </thead>
            <tbody>
              {config.chargers.map((c) => (
                <tr key={c.id}>
                  <td className="col-name">{c.name}</td>
                  <td>
                    <input
                      className="cell-input"
                      type="number"
                      min={0}
                      placeholder="0"
                      value={c.rate || ''}
                      onChange={(e) =>
                        updateCharger(c.id, { rate: Number(e.target.value) || 0 })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="cell-input"
                      type="number"
                      min={0}
                      placeholder="0"
                      value={c.count || ''}
                      onChange={(e) =>
                        updateCharger(c.id, { count: Number(e.target.value) || 0 })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="var-actions">
          <label className="hours-field">
            월 가동시간(시간)
            <input
              className="cell-input"
              type="number"
              min={1}
              value={config.hours}
              onChange={(e) =>
                setConfig({ ...config, hours: Number(e.target.value) || 0 })
              }
            />
          </label>
          <button
            type="button"
            className="link-button"
            onClick={() => setConfig(cloneDefault())}
          >
            요금·수량 모두 지우기
          </button>
        </div>
        <p className="var-hint">
          요금은 현장마다 다릅니다. 사용하는 종류의 요금·수량만 입력하고, 없는
          종류는 0으로 두세요. (정격 kW는 종류명으로 고정)
        </p>
      </div>
    </div>
  )
}

/** 한 기간 유형(월간/연간/전체)에 대한 비교표 */
function ComparisonSection({
  label,
  rows,
  chargers,
  onMonths,
  onUsage,
}: {
  label: string
  rows: SettlementMetrics[]
  chargers: ChargerType[]
  onMonths: (id: string, months: number) => void
  onUsage: (fileId: string, chargerId: string, usage: number) => void
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
              <th>기간</th>
              <th>분석 개월수</th>
              <th>이용자 수</th>
              <th>총 사용량(kWh)</th>
              {chargers.map((c) => (
                <th key={`u-${c.id}`}>{c.name} 사용량</th>
              ))}
              <th>사용금액(원)</th>
              <th>전체 이용률(%)</th>
              {chargers.map((c) => (
                <th key={`r-${c.id}`}>{c.name} 이용률(%)</th>
              ))}
              <th>사용량 증감률</th>
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
                    {!m.splittable && (
                      <span className="warn-mark" title="종류별 사용량 분리 불가">
                        *
                      </span>
                    )}
                  </td>
                  <td>
                    <input
                      className="cell-input cell-input--sm"
                      type="number"
                      min={1}
                      value={m.months}
                      onChange={(e) =>
                        onMonths(m.id, Number(e.target.value) || 1)
                      }
                    />
                  </td>
                  <td>{m.users.toLocaleString()}</td>
                  <td>{formatNumber(m.usageTotal)}</td>
                  {chargers.map((c) => (
                    <td key={`u-${c.id}`}>
                      {m.splitMode === 'auto' ? (
                        formatNumber(typeById.get(c.id)?.usage ?? 0)
                      ) : (
                        <input
                          className="cell-input cell-input--usage"
                          type="number"
                          min={0}
                          placeholder="직접 입력"
                          value={
                            m.splitMode === 'manual'
                              ? (typeById.get(c.id)?.usage ?? 0)
                              : ''
                          }
                          onChange={(e) =>
                            onUsage(m.id, c.id, Number(e.target.value) || 0)
                          }
                        />
                      )}
                    </td>
                  ))}
                  <td>{formatNumber(Math.round(m.amountCalc))}</td>
                  <td>{formatNumber(m.utilTotal)}</td>
                  {chargers.map((c) => (
                    <td key={`r-${c.id}`}>
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
 * 충전기 정산 전용 분석. 종류별 요금·수량을 입력하면 사용자별 사용량을
 * 요금으로 역산해 종류별로 분리하고, 월간/연간/전체 기간으로 나누어 비교한다.
 */
export default function SettlementAnalysis({ files }: SettlementAnalysisProps) {
  const [config, setConfig] = useState<SettlementConfig>(cloneDefault)
  // 파일별 분석 개월수 오버라이드 (전체 기간 등 기간 미정 파일에 사용)
  const [monthsById, setMonthsById] = useState<Record<string, number>>({})
  // 파일별·종류별 사용량 직접 입력 (파일에 종류별 컬럼이 없을 때)
  const [manualUsage, setManualUsage] = useState<
    Record<string, Record<string, number>>
  >({})

  const metrics = useMemo(
    () => computeAll(files, config, monthsById, manualUsage),
    [files, config, monthsById, manualUsage],
  )

  function setMonths(id: string, months: number) {
    setMonthsById((prev) => ({ ...prev, [id]: months }))
  }
  function setUsage(fileId: string, chargerId: string, usage: number) {
    setManualUsage((prev) => ({
      ...prev,
      [fileId]: { ...(prev[fileId] ?? {}), [chargerId]: usage },
    }))
  }

  // 비교표에는 수량이 지정된(현장에 존재하는) 종류만 컬럼으로 표시
  const visibleChargers = useMemo(
    () => config.chargers.filter((c) => c.count > 0),
    [config],
  )
  const anyUnsplittable = metrics.some((m) => !m.splittable)

  return (
    <section className="card settlement">
      <div className="card__header">
        <div>
          <h2>충전기 정산 분석</h2>
          <p className="group-range">
            종류별 요금·수량을 바꾸면 사용금액·종류별 사용량·이용률이 즉시 다시
            계산됩니다.
          </p>
        </div>
        <span className="badge">{metrics.length}개 파일</span>
      </div>

      <ChargerEditor config={config} setConfig={setConfig} />

      {anyUnsplittable && (
        <p className="status status--info">
          종류가 3개 이상이거나 요금이 같아 자동 분리가 안 되는 파일은, 표의{' '}
          <b>종류별 사용량 칸에 값을 직접 입력</b>하면 종류별 이용률이
          계산됩니다. (요금이 다른 2종류는 자동 역산됩니다.)
        </p>
      )}

      {PERIOD_SECTIONS.map(({ type, label }) => {
        const rows = metrics.filter((m) => m.periodType === type)
        if (rows.length === 0) return null
        return (
          <ComparisonSection
            key={type}
            label={label}
            rows={rows}
            chargers={visibleChargers}
            onMonths={setMonths}
            onUsage={setUsage}
          />
        )
      })}

      <p className="table-note">
        <b>이용률 = 사용량 ÷ (충전기 총용량 × 분석 개월수)</b>입니다. 월간=1개월,
        연간·범위 파일은 파일명 기간으로 개월수를 자동 계산하며, 전체 기간처럼
        기간이 정해지지 않은 파일은 <b>분석 개월수</b> 칸에서 직접 입력하세요.
        종류별 분리: 요금 지정 1종은 전량 배정, 요금이 다른 2종은 요금 역산.
        개인정보(사용자명·건물명·동·호)는 표시하지 않습니다.
      </p>
    </section>
  )
}
