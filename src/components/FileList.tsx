import type { FileEntry } from '../types'

interface FileListProps {
  files: FileEntry[]
  onRemove: (id: string) => void
  onClear: () => void
}

const PERIOD_TYPE_LABEL: Record<string, string> = {
  month: '월간',
  year: '연간',
  range: '기간',
  unknown: '미인식',
}

/** 업로드된 파일 목록과 각 파일의 분류 결과(카테고리·기간)를 보여준다. */
export default function FileList({ files, onRemove, onClear }: FileListProps) {
  if (files.length === 0) return null
  return (
    <section className="card">
      <div className="card__header">
        <h2>업로드한 파일 ({files.length})</h2>
        <button type="button" className="link-button" onClick={onClear}>
          모두 지우기
        </button>
      </div>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>파일명</th>
              <th>분류(카테고리)</th>
              <th>기간</th>
              <th>유형</th>
              <th>행</th>
              <th>열</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id}>
                <td className="col-name" title={f.dataset.fileName}>
                  {f.dataset.fileName}
                </td>
                <td className="col-name">{f.category}</td>
                <td>{f.period?.label ?? '—'}</td>
                <td>
                  <span className="type-pill">
                    {PERIOD_TYPE_LABEL[f.period?.type ?? 'unknown']}
                  </span>
                </td>
                <td>{f.dataset.rows.length.toLocaleString()}</td>
                <td>{f.dataset.columns.length}</td>
                <td>
                  <button
                    type="button"
                    className="remove-button"
                    aria-label={`${f.dataset.fileName} 제거`}
                    onClick={() => onRemove(f.id)}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
