import { useMemo, useState } from 'react'
import Dropzone from './components/Dropzone'
import DataPreview from './components/DataPreview'
import SummaryStats from './components/SummaryStats'
import { parseFile } from './lib/parse'
import { summarizeDataset } from './lib/stats'
import type { Dataset } from './types'

export default function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const summaries = useMemo(
    () => (dataset ? summarizeDataset(dataset) : []),
    [dataset],
  )

  const overview = useMemo(() => {
    if (!dataset) return null
    let missingCells = 0
    for (const row of dataset.rows) {
      for (const col of dataset.columns) {
        if (row[col] === null) missingCells += 1
      }
    }
    const totalCells = dataset.rows.length * dataset.columns.length
    return {
      rows: dataset.rows.length,
      cols: dataset.columns.length,
      missingCells,
      missingPct: totalCells > 0 ? (missingCells / totalCells) * 100 : 0,
    }
  }, [dataset])

  async function handleFile(file: File) {
    setLoading(true)
    setError(null)
    try {
      const ds = await parseFile(file)
      if (ds.columns.length === 0 || ds.rows.length === 0) {
        throw new Error(
          '데이터를 읽지 못했습니다. 파일에 헤더와 데이터 행이 있는지 확인해주세요.',
        )
      }
      setDataset(ds)
    } catch (e) {
      setDataset(null)
      setError(e instanceof Error ? e.message : '파일 처리 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1>데이터 분석</h1>
        <p className="app__subtitle">
          CSV·Excel 파일을 올리면 브라우저에서 바로 요약 통계를 계산합니다.
          <br />
          데이터는 서버로 전송되지 않고 전부 브라우저 안에서만 처리됩니다.
        </p>
      </header>

      <main className="app__main">
        <Dropzone onFile={handleFile} disabled={loading} />

        {loading && <p className="status status--loading">분석 중…</p>}
        {error && (
          <p className="status status--error" role="alert">
            {error}
          </p>
        )}

        {dataset && overview && !loading && (
          <>
            <section className="overview">
              <div className="stat">
                <span className="stat__value">
                  {overview.rows.toLocaleString()}
                </span>
                <span className="stat__label">행</span>
              </div>
              <div className="stat">
                <span className="stat__value">{overview.cols}</span>
                <span className="stat__label">열</span>
              </div>
              <div className="stat">
                <span className="stat__value">
                  {overview.missingCells.toLocaleString()}
                </span>
                <span className="stat__label">
                  결측 셀 ({overview.missingPct.toFixed(1)}%)
                </span>
              </div>
              <div className="stat stat--file">
                <span className="stat__value stat__value--file" title={dataset.fileName}>
                  {dataset.fileName}
                </span>
                <span className="stat__label">파일</span>
              </div>
            </section>

            <SummaryStats summaries={summaries} />
            <DataPreview dataset={dataset} />
          </>
        )}
      </main>

      <footer className="app__footer">
        <p>모든 분석은 브라우저에서 처리됩니다 · 파일은 업로드되지 않습니다.</p>
      </footer>
    </div>
  )
}
