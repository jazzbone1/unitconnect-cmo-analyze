import { useMemo } from 'react'
import type { AggKind, FileGroup } from '../types'
import { aggregateColumn } from '../lib/group'
import { inferColumnType, formatNumber } from '../lib/stats'

interface ComparisonTableProps {
  group: FileGroup
  aggKind: AggKind
}

const AGG_LABEL: Record<AggKind, string> = {
  sum: '합계',
  mean: '평균',
  count: '개수',
}

/**
 * 그룹 내 기간별 비교 표. 행 = 기간(파일), 열 = 숫자형 컬럼.
 * 각 셀은 해당 파일의 컬럼 값을 선택한 방식(합계/평균/개수)으로 집계한 값.
 */
export default function ComparisonTable({ group, aggKind }: ComparisonTableProps) {
  const numericCols = useMemo(() => {
    return group.columns.filter((col) => {
      const values = group.combined.rows.map((r) => r[col] ?? null)
      return inferColumnType(values) === 'numeric'
    })
  }, [group])

  if (numericCols.length === 0) {
    return (
      <p className="table-note">
        숫자형 컬럼이 없어 기간 비교표를 만들 수 없습니다.
      </p>
    )
  }

  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>기간</th>
            <th>행 수</th>
            {numericCols.map((col) => (
              <th key={col}>
                {col}
                <span className="agg-tag">{AGG_LABEL[aggKind]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {group.files.map((f) => (
            <tr key={f.id}>
              <td className="col-name" title={f.dataset.fileName}>
                {f.period?.label ?? f.dataset.fileName}
              </td>
              <td>{f.dataset.rows.length.toLocaleString()}</td>
              {numericCols.map((col) => {
                const v = aggregateColumn(f.dataset.rows, col, aggKind)
                return (
                  <td key={col} className={v === null ? 'cell--null' : ''}>
                    {v === null ? '—' : formatNumber(v)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
