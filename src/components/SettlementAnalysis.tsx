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

interface SiteInfo {
  name: string
  address: string
  households: number
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

/** 단지 정보 + 충전기 종류별 수량·요금 입력 패널 */
function SiteInfoPanel({
  site,
  setSite,
  config,
  setConfig,
}: {
  site: SiteInfo
  setSite: (s: SiteInfo) => void
  config: SettlementConfig
  setConfig: (c: SettlementConfig) => void
}) {
  const totalCount = config.chargers.reduce((acc, c) => acc + c.count, 0)

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
      <h3 className="subsection__title">단지 정보</h3>
      <div className="site-grid">
        <label className="var-field">
          <span className="var-field__label">단지명</span>
          <input
            className="var-field__input"
            type="text"
            value={site.name}
            placeholder="예: 흑석자이아파트"
            onChange={(e) => setSite({ ...site, name: e.target.value })}
          />
        </label>
        <label className="var-field">
          <span className="var-field__label">주소</span>
          <input
            className="var-field__input"
            type="text"
            value={site.address}
            placeholder="예: 서울시 동작구 …"
            onChange={(e) => setSite({ ...site, address: e.target.value })}
          />
        </label>
        <label className="var-field">
          <span className="var-field__label">세대수</span>
          <input
            className="var-field__input"
            type="number"
            min={0}
            value={site.households || ''}
            placeholder="0"
            onChange={(e) =>
              setSite({ ...site, households: Number(e.target.value) || 0 })
            }
          />
        </label>
        <div className="var-field">
          <span className="var-field__label">충전기 수량 (자동합계)</span>
          <div className="var-field__auto">{totalCount.toLocaleString()}기</div>
        </div>
      </div>

      <h3 className="subsection__title">충전기 종류별 수량·요금</h3>
      <div className="table-scroll">
        <table className="data-table charger-table">
          <thead>
            <tr>
              <th>충전기 종류</th>
              <th>수량(기)</th>
              <th>요금(원/kWh)</th>
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
                    value={c.count || ''}
                    onChange={(e) =>
                      updateCharger(c.id, { count: Number(e.target.value) || 0 })
                    }
                  />
                </td>
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
          수량·요금 모두 지우기
        </button>
      </div>
      <p className="var-hint">
        여기 입력한 단지 정보와 충전기 수량·요금이 아래 분석에 자동 적용됩니다.
        요금·수량은 현장마다 다르니 사용하는 종류만 입력하세요.
      </p>
    </div>
  )
}

/** 한 기간 유형(월간/연간/전체)에 대한 비교표 (읽기 전용) */
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
                  </td>
                  <td>{m.months}</td>
                  <td>{m.users.toLocaleString()}</td>
                  <td>{formatNumber(m.usageTotal)}</td>
                  {chargers.map((c) => (
                    <td key={`u-${c.id}`}>
                      {m.splitMode === 'none'
                        ? '—'
                        : formatNumber(typeById.get(c.id)?.usage ?? 0)}
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
 * 충전기 정산 전용 분석. 단지 정보 패널에 입력한 충전기 수량·요금이
 * 분석에 자동 적용되며, 결과 표는 읽기 전용이다.
 */
export default function SettlementAnalysis({ files }: SettlementAnalysisProps) {
  const [config, setConfig] = useState<SettlementConfig>(cloneDefault)
  const [site, setSite] = useState<SiteInfo>({
    name: '',
    address: '',
    households: 0,
  })

  const metrics = useMemo(() => computeAll(files, config), [files, config])

  const visibleChargers = useMemo(
    () => config.chargers.filter((c) => c.count > 0),
    [config],
  )
  const anyNone = metrics.some((m) => m.splitMode === 'none')

  return (
    <section className="card settlement">
      <div className="card__header">
        <div>
          <h2>충전기 정산 분석{site.name ? ` · ${site.name}` : ''}</h2>
          <p className="group-range">
            {site.address ? `${site.address} · ` : ''}
            {site.households > 0 ? `${site.households.toLocaleString()}세대 · ` : ''}
            {metrics.length}개 파일
          </p>
        </div>
      </div>

      <SiteInfoPanel
        site={site}
        setSite={setSite}
        config={config}
        setConfig={setConfig}
      />

      {anyNone && (
        <p className="status status--info">
          요금이 지정된 종류가 3개 이상이거나 요금이 같은 파일은 종류별
          사용량·이용률을 자동으로 나눌 수 없어 —로 표시됩니다. (요금이 다른
          2종류는 자동 계산)
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
          />
        )
      })}

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
