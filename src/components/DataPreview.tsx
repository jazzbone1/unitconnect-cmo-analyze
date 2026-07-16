import type { Dataset } from '../types'

interface DataPreviewProps {
  dataset: Dataset
  maxRows?: number
}

/** 데이터셋의 앞부분 몇 행을 표로 미리 보여준다. */
export default function DataPreview({ dataset, maxRows = 20 }: DataPreviewProps) {
  const previewRows = dataset.rows.slice(0, maxRows)
  return (
    <section className="card">
      <div className="card__header">
        <h2>데이터 미리보기</h2>
        <span className="badge">
          {dataset.rows.length.toLocaleString()}행 · {dataset.columns.length}열
        </span>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th className="rownum">#</th>
              {dataset.columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, i) => (
              <tr key={i}>
                <td className="rownum">{i + 1}</td>
                {dataset.columns.map((col) => {
                  const v = row[col]
                  return (
                    <td key={col} className={v === null ? 'cell--null' : ''}>
                      {v === null ? '—' : String(v)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dataset.rows.length > maxRows && (
        <p className="table-note">
          전체 {dataset.rows.length.toLocaleString()}행 중 상위 {maxRows}행만
          표시합니다.
        </p>
      )}
    </section>
  )
}
