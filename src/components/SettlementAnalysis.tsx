import { useMemo, useState } from 'react'
import type { FileEntry } from '../types'
import {
  computeAll,
  DEFAULT_CONFIG,
  type RateConfig,
} from '../lib/settlement'
import { formatNumber } from '../lib/stats'

interface SettlementAnalysisProps {
  files: FileEntry[]
}

interface FieldDef {
  key: keyof RateConfig
  label: string
  unit: string
  hint?: string
}

const RATE_FIELDS: FieldDef[] = [
  { key: 'rate7', label: '7kW 요금', unit: '원/kWh', hint: '기본 200' },
  { key: 'rate50', label: '50kW 요금', unit: '원/kWh', hint: '기본 300' },
]
const CONFIG_FIELDS: FieldDef[] = [
  { key: 'count7', label: '7kW 수량', unit: '기', hint: '기본 20' },
  { key: 'count50', label: '50kW 수량', unit: '기', hint: '기본 3' },
  { key: 'hours', label: '월 가동시간', unit: '시간', hint: '기본 720' },
]

/** 숫자 입력 필드 */
function NumField({
  def,
  value,
  onChange,
}: {
  def: FieldDef
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="var-field">
      <span className="var-field__label">
        {def.label}
        <span className="var-field__unit">{def.unit}</span>
      </span>
      <input
        type="number"
        className="var-field__input"
        value={Number.isFinite(value) ? value : ''}
        min={0}
        onChange={(e) => {
          const n = Number(e.target.value)
          onChange(Number.isFinite(n) ? n : 0)
        }}
      />
      {def.hint && <span className="var-field__hint">{def.hint}</span>}
    </label>
  )
}

/**
 * 충전기 정산 전용 분석. 요금(7kW/50kW)과 충전기 구성을 변수로 입력하면
 * 사용자별 사용량을 요금으로 역산해 충전기별로 분리하고, 기간별로 비교한다.
 */
export default function SettlementAnalysis({ files }: SettlementAnalysisProps) {
  const [config, setConfig] = useState<RateConfig>(DEFAULT_CONFIG)

  const metrics = useMemo(() => computeAll(files, config), [files, config])

  const isDefault = useMemo(
    () =>
      (Object.keys(DEFAULT_CONFIG) as (keyof RateConfig)[]).every(
        (k) => config[k] === DEFAULT_CONFIG[k],
      ),
    [config],
  )

  function set(key: keyof RateConfig, v: number) {
    setConfig((c) => ({ ...c, [key]: v }))
  }

  const rateWarning = config.rate50 <= config.rate7

  return (
    <section className="card settlement">
      <div className="card__header">
        <div>
          <h2>충전기 정산 분석</h2>
          <p className="group-range">
            요금을 바꾸면 사용금액·충전기별 사용량·이용률이 즉시 다시 계산됩니다.
          </p>
        </div>
        <span className="badge">{metrics.length}개 기간</span>
      </div>

      {/* 변수 입력 패널 */}
      <div className="var-panel">
        <div className="var-group">
          <h3 className="subsection__title">요금제 (원/kWh)</h3>
          <div className="var-row">
            {RATE_FIELDS.map((f) => (
              <NumField key={f.key} def={f} value={config[f.key]} onChange={(v) => set(f.key, v)} />
            ))}
          </div>
        </div>
        <div className="var-group">
          <h3 className="subsection__title">충전기 구성 (이용률 계산)</h3>
          <div className="var-row">
            {CONFIG_FIELDS.map((f) => (
              <NumField key={f.key} def={f} value={config[f.key]} onChange={(v) => set(f.key, v)} />
            ))}
          </div>
        </div>
        {!isDefault && (
          <button
            type="button"
            className="link-button"
            onClick={() => setConfig(DEFAULT_CONFIG)}
          >
            기본값(200/300, 20기/3기/720)으로 되돌리기
          </button>
        )}
      </div>

      {rateWarning && (
        <p className="status status--error">
          50kW 요금이 7kW 요금보다 크지 않아 충전기별 사용량 분리를 계산할 수
          없습니다. 전량 7kW로 간주됩니다.
        </p>
      )}

      {/* 기간별 비교표 */}
      <div className="subsection">
        <h3 className="subsection__title">기간별 비교</h3>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>기간</th>
                <th>이용자 수</th>
                <th>총 사용량(kWh)</th>
                <th>7kW 사용량</th>
                <th>50kW 사용량</th>
                <th>사용금액(원)</th>
                <th>전체 이용률(%)</th>
                <th>사용량 증감률</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m, i) => {
                const prev = i > 0 ? metrics[i - 1] : null
                const growth =
                  prev && prev.usageTotal > 0
                    ? ((m.usageTotal - prev.usageTotal) / prev.usageTotal) * 100
                    : null
                return (
                  <tr key={m.id}>
                    <td className="col-name" title={m.fileName}>
                      {m.periodLabel}
                    </td>
                    <td>{m.users.toLocaleString()}</td>
                    <td>{formatNumber(m.usageTotal)}</td>
                    <td>{formatNumber(m.usage7)}</td>
                    <td>{formatNumber(m.usage50)}</td>
                    <td>{formatNumber(Math.round(m.amountCalc))}</td>
                    <td>{formatNumber(m.utilTotal)}</td>
                    <td className={growth == null ? 'cell--null' : growth >= 0 ? 'cell--up' : 'cell--down'}>
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
        <p className="table-note">
          충전기별 사용량 분리: 50kW사용량 = (사용금액 − 사용량×7kW요금) ÷
          (50kW요금 − 7kW요금), 7kW사용량 = 총 사용량 − 50kW사용량. 이용률은 월
          기준(범위·연간 파일은 개월수로 환산)입니다.
        </p>
      </div>
    </section>
  )
}
