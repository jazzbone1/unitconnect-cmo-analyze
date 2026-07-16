import { useState } from 'react'
import type { CellValue, Dataset, FileEntry } from '../types'

interface FileListProps {
  files: FileEntry[]
  onRemove: (id: string) => void
  onClear: () => void
}

const PERIOD_TYPE_LABEL: Record<string, string> = {
  month: '월간',
  year: '연간',
  total: '전체 기간',
  unknown: '미인식',
}

/** 한 셀 값을 CSV용으로 이스케이프 */
function csvCell(v: CellValue): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 데이터셋을 CSV 문자열로 변환 (엑셀 한글 대응 BOM 포함) */
function datasetToCsv(ds: Dataset): string {
  const header = ds.columns.map(csvCell).join(',')
  const body = ds.rows
    .map((r) => ds.columns.map((c) => csvCell(r[c] ?? null)).join(','))
    .join('\n')
  return '﻿' + header + '\n' + body
}

function downloadFile(f: FileEntry) {
  const csv = datasetToCsv(f.dataset)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const base = f.dataset.fileName.replace(/\.(csv|xlsx?|xls)$/i, '')
  a.href = url
  a.download = `${base}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

/** 업로드된 파일 목록과 각 파일의 분류 결과(카테고리·기간)를 보여준다. */
export default function FileList({ files, onRemove, onClear }: FileListProps) {
  const [open, setOpen] = useState(false)
  if (files.length === 0) return null
  return (
    <section className="card">
      <div className="card__header">
        <button
          type="button"
          className="filelist-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className="filelist-caret">{open ? '▼' : '▶'}</span>
          업로드한 파일 ({files.length})
        </button>
        {open && (
          <button type="button" className="link-button" onClick={onClear}>
            모두 지우기
          </button>
        )}
      </div>

      {open && (
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
                  <td className="filelist-actions">
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => downloadFile(f)}
                    >
                      다운로드
                    </button>
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
      )}
    </section>
  )
}
