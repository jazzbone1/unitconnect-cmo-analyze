import { useMemo, useState } from 'react'
import Dropzone from './components/Dropzone'
import FileList from './components/FileList'
import GroupSection from './components/GroupSection'
import SettlementAnalysis from './components/SettlementAnalysis'
import { parseFile } from './lib/parse'
import { parseFileName } from './lib/parseName'
import { groupFiles } from './lib/group'
import { detectSettlement } from './lib/settlement'
import { stripPii } from './lib/privacy'
import type { AggKind, FileEntry } from './types'

const AGG_OPTIONS: { value: AggKind; label: string }[] = [
  { value: 'sum', label: '합계' },
  { value: 'mean', label: '평균' },
  { value: 'count', label: '개수' },
]

let idCounter = 0
function nextId(): string {
  idCounter += 1
  return `f${idCounter}`
}

export default function App() {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [aggKind, setAggKind] = useState<AggKind>('sum')

  const settlementFiles = useMemo(
    () => files.filter((f) => detectSettlement(f.dataset)),
    [files],
  )
  const genericFiles = useMemo(
    () => files.filter((f) => !detectSettlement(f.dataset)),
    [files],
  )
  const groups = useMemo(() => groupFiles(genericFiles), [genericFiles])

  async function handleFiles(incoming: File[]) {
    setLoading(true)
    setErrors([])
    const newErrors: string[] = []
    const parsed: FileEntry[] = []
    for (const file of incoming) {
      try {
        const raw = await parseFile(file)
        if (raw.columns.length === 0 || raw.rows.length === 0) {
          throw new Error('헤더 또는 데이터 행이 없습니다.')
        }
        // 개인정보(사용자명·건물명·동·호 등) 컬럼은 분석·표시에서 제외
        const dataset = stripPii(raw)
        const { category, period } = parseFileName(file.name)
        parsed.push({ id: nextId(), dataset, category, period })
      } catch (e) {
        newErrors.push(
          `${file.name}: ${e instanceof Error ? e.message : '처리 실패'}`,
        )
      }
    }
    setFiles((prev) => [...prev, ...parsed])
    setErrors(newErrors)
    setLoading(false)
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id))
  }

  function clearAll() {
    setFiles([])
    setErrors([])
  }

  const hasData = files.length > 0

  return (
    <div className="app">
      <header className="app__header">
        <h1>데이터 분석</h1>
        <p className="app__subtitle">
          여러 CSV·Excel 파일을 올리면 <b>파일명의 날짜를 기준으로 자동 분류</b>하고
          그룹별로 기간을 비교·취합해 요약 통계를 계산합니다.
          <br />
          데이터는 서버로 전송되지 않고 전부 브라우저 안에서만 처리됩니다.
        </p>
      </header>

      <main className="app__main">
        <Dropzone onFiles={handleFiles} disabled={loading} />

        {loading && <p className="status status--loading">분석 중…</p>}
        {errors.length > 0 && (
          <div className="status status--error" role="alert">
            <strong>일부 파일을 읽지 못했습니다:</strong>
            <ul className="error-list">
              {errors.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          </div>
        )}

        {hasData && (
          <>
            <FileList files={files} onRemove={removeFile} onClear={clearAll} />

            {settlementFiles.length > 0 && (
              <SettlementAnalysis files={settlementFiles} />
            )}

            {groups.length > 0 && (
              <div className="toolbar">
                <div className="overview-inline">
                  <span>
                    기타 데이터 <b>{groups.length}</b>개 그룹
                  </span>
                </div>
                <div className="agg-toggle" role="group" aria-label="집계 방식">
                  <span className="agg-toggle__label">비교 집계</span>
                  {AGG_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`agg-toggle__btn${
                        aggKind === opt.value ? ' agg-toggle__btn--active' : ''
                      }`}
                      onClick={() => setAggKind(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {groups.map((group) => (
              <GroupSection key={group.category} group={group} aggKind={aggKind} />
            ))}
          </>
        )}
      </main>

      <footer className="app__footer">
        <p>모든 분석은 브라우저에서 처리됩니다 · 파일은 업로드되지 않습니다.</p>
      </footer>
    </div>
  )
}
