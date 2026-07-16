import { useMemo, useRef, useState } from 'react'
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
  { type: 'range', label: '전체 기간' },
  { type: 'unknown', label: '기타 (기간 미인식)' },
]

function cloneDefault(): SettlementConfig {
  return {
    hours: DEFAULT_CONFIG.hours,
    chargers: DEFAULT_CONFIG.chargers.map((c) => ({ ...c })),
  }
}

/** 충전기 종류 설정 편집기 */
function ChargerEditor({
  config,
  setConfig,
}: {
  config: SettlementConfig
  setConfig: (c: SettlementConfig) => void
}) {
  const idSeq = useRef(0)

  function updateCharger(id: string, patch: Partial<ChargerType>) {
    setConfig({
      ...config,
      chargers: config.chargers.map((c) =>
        c.id === id ? { ...c, ...patch } : c,
      ),
    })
  }
  function addCharger() {
    idSeq.current += 1
    const nc: ChargerType = {
      id: `new${idSeq.current}`,
      name: '',
      kw: 0,
      rate: 0,
      count: 0,
    }
    setConfig({ ...config, chargers: [...config.chargers, nc] })
  }
  function removeCharger(id: string) {
    setConfig({ ...config, chargers: config.chargers.filter((c) => c.id !== id) })
  }

  return (
    <div className="var-panel">
      <div className="var-group">
        <h3 className="subsection__title">충전기 종류 (요금·수량)</h3>
        <div className="table-scroll">
          <table className="data-table charger-table">
            <thead>
              <tr>
                <th>종류명</th>
                <th>정격(kW)</th>
                <th>요금(원/kWh)</th>
                <th>수량(기)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {config.chargers.map((c) => (
                <tr key={c.id}>
                  <td>
                    <input
                      className="cell-input cell-input--text"
                      value={c.name}
                      placeholder="예: 100kW"
                      onChange={(e) => updateCharger(c.id, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="cell-input"
                      type="number"
                      min={0}
                      value={c.kw}
                      onChange={(e) =>
                        updateCharger(c.id, { kw: Number(e.target.value) || 0 })
                      }
                    />
                  </td>
                  <td>
                    <input
                      className="cell-input"
                      type="number"
                      min={0}
                      value={c.rate}
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
                      value={c.count}
                      onChange={(e) =>
                        updateCharger(c.id, { count: Number(e.target.value) || 0 })
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="remove-button"
                      aria-label={`${c.name || '충전기'} 삭제`}
                      onClick={() => removeCharger(c.id)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="var-actions">
          <button type="button" className="link-button" onClick={addCharger}>
            + 충전기 종류 추가
          </button>
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
            기본값으로 되돌리기
          </button>
        </div>
      </div>
    </div>
  )
}

/** 한 기간 유형(월간/연간/전체)에 대한 비교표 */
function ComparisonSection({
  label,
  rows,
  chargers,
}: {
  label: string
  rows: SettlementMetrics[]
  chargers: ChargerType[]
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
                  <td>{m.users.toLocaleString()}</td>
                  <td>{formatNumber(m.usageTotal)}</td>
                  {chargers.map((c) => (
                    <td key={`u-${c.id}`}>
                      {m.splittable
                        ? formatNumber(typeById.get(c.id)?.usage ?? 0)
                        : '—'}
                    </td>
                  ))}
                  <td>{formatNumber(Math.round(m.amountCalc))}</td>
                  <td>{formatNumber(m.utilTotal)}</td>
                  {chargers.map((c) => (
                    <td key={`r-${c.id}`}>
                      {m.splittable
                        ? formatNumber(typeById.get(c.id)?.utilization ?? 0)
                        : '—'}
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
 * 충전기 정산 전용 분석. 요금·충전기 구성을 변수로 입력하면
 * 사용자별 사용량을 요금으로 역산해 종류별로 분리하고,
 * 월간/연간/전체 기간으로 나누어 비교한다.
 */
export default function SettlementAnalysis({ files }: SettlementAnalysisProps) {
  const [config, setConfig] = useState<SettlementConfig>(cloneDefault)

  const metrics = useMemo(() => computeAll(files, config), [files, config])

  const anyUnsplittable = metrics.some((m) => !m.splittable)

  return (
    <section className="card settlement">
      <div className="card__header">
        <div>
          <h2>충전기 정산 분석</h2>
          <p className="group-range">
            요금·충전기 구성을 바꾸면 사용금액·종류별 사용량·이용률이 즉시 다시
            계산됩니다.
          </p>
        </div>
        <span className="badge">{metrics.length}개 파일</span>
      </div>

      <ChargerEditor config={config} setConfig={setConfig} />

      {config.chargers.length > 2 && anyUnsplittable && (
        <p className="status status--error">
          충전기 종류가 3개 이상이면 (총 사용량·사용금액)만으로는 종류별 사용량을
          나눌 수 없습니다. 파일에 <b>종류별 사용량 컬럼</b>(예: "7kW사용량",
          "100kW사용량")이 있으면 자동으로 사용합니다. 없으면 종류별 값은 —로
          표시됩니다.
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
            chargers={config.chargers}
          />
        )
      })}

      <p className="table-note">
        종류가 2개일 때 사용량 분리: 높은요금 종류 사용량 = (사용금액 −
        사용량×낮은요금) ÷ (요금 차이). 이용률은 월 기준이며 전체 기간·연간
        파일은 개월 수로 환산합니다. 개인정보(사용자명·건물명·동·호)는 표시하지
        않습니다.
      </p>
    </section>
  )
}
