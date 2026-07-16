import type { ColumnSummary } from '../types'
import { formatNumber } from '../lib/stats'

interface SummaryStatsProps {
  summaries: ColumnSummary[]
}

/** 숫자형 컬럼 요약 표 */
function NumericTable({ rows }: { rows: Extract<ColumnSummary, { type: 'numeric' }>[] }) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>컬럼</th>
            <th>개수</th>
            <th>결측</th>
            <th>평균</th>
            <th>표준편차</th>
            <th>최소</th>
            <th>25%</th>
            <th>중앙값</th>
            <th>75%</th>
            <th>최대</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.column}>
              <td className="col-name">{s.column}</td>
              <td>{s.count.toLocaleString()}</td>
              <td className={s.missing > 0 ? 'cell--warn' : ''}>
                {s.missing.toLocaleString()}
              </td>
              <td>{formatNumber(s.mean)}</td>
              <td>{formatNumber(s.std)}</td>
              <td>{formatNumber(s.min)}</td>
              <td>{formatNumber(s.q1)}</td>
              <td>{formatNumber(s.median)}</td>
              <td>{formatNumber(s.q3)}</td>
              <td>{formatNumber(s.max)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 범주형 컬럼 요약 표 */
function CategoricalTable({
  rows,
}: {
  rows: Extract<ColumnSummary, { type: 'categorical' }>[]
}) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>컬럼</th>
            <th>개수</th>
            <th>결측</th>
            <th>고유값</th>
            <th>최빈값</th>
            <th>최빈 빈도</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.column}>
              <td className="col-name">{s.column}</td>
              <td>{s.count.toLocaleString()}</td>
              <td className={s.missing > 0 ? 'cell--warn' : ''}>
                {s.missing.toLocaleString()}
              </td>
              <td>{s.unique.toLocaleString()}</td>
              <td className="col-name" title={s.top}>
                {s.top === '' ? '—' : s.top}
              </td>
              <td>{s.topFreq.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 컬럼별 요약 통계. 숫자형/범주형을 나누어 표시한다. (카드 없이 임베드용) */
export default function SummaryStats({ summaries }: SummaryStatsProps) {
  const numeric = summaries.filter(
    (s): s is Extract<ColumnSummary, { type: 'numeric' }> => s.type === 'numeric',
  )
  const categorical = summaries.filter(
    (s): s is Extract<ColumnSummary, { type: 'categorical' }> =>
      s.type === 'categorical',
  )

  return (
    <div className="summary-stats">
      {numeric.length > 0 && (
        <div className="summary-block">
          <h4 className="summary-block__title">숫자형 컬럼 ({numeric.length})</h4>
          <NumericTable rows={numeric} />
        </div>
      )}

      {categorical.length > 0 && (
        <div className="summary-block">
          <h4 className="summary-block__title">
            범주형 컬럼 ({categorical.length})
          </h4>
          <CategoricalTable rows={categorical} />
        </div>
      )}
    </div>
  )
}
