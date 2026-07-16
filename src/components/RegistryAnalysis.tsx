import { useMemo } from 'react'
import type { FileEntry } from '../types'
import { computeRegistry, registryToCsv } from '../lib/registry'

interface RegistryAnalysisProps {
  files: FileEntry[]
}

/**
 * 이용자(차량 등록) 명부 분석. 여러 파일을 합쳐 test/costel 행 제거,
 * 차량번호 중복 제거 후 전체 인원수·차종별 대수를 보여준다.
 */
export default function RegistryAnalysis({ files }: RegistryAnalysisProps) {
  const result = useMemo(
    () => computeRegistry(files.map((f) => f.dataset)),
    [files],
  )

  function download() {
    const csv = registryToCsv(result)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '중복제거_이용자명부.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const previewRows = result.rows.slice(0, 20)

  return (
    <section className="card settlement">
      <div className="card__header">
        <div>
          <h2>이용자(차량 등록) 분석</h2>
          <p className="group-range">
            {result.sourceCount}개 파일을 합쳐 test/costel 행과 차량번호 중복을
            제거했습니다.
          </p>
        </div>
        <button type="button" className="link-button" onClick={download}>
          중복제거 명부 CSV 내려받기
        </button>
      </div>

      {/* 요약 타일 */}
      <div className="overview">
        <div className="stat">
          <span className="stat__value">
            {result.totalPeople.toLocaleString()}
          </span>
          <span className="stat__label">전체 등록 인원</span>
        </div>
        <div className="stat">
          <span className="stat__value">
            {result.totalVehicles.toLocaleString()}
          </span>
          <span className="stat__label">등록 차량 수(고유)</span>
        </div>
        <div className="stat">
          <span className="stat__value">
            {result.removedDup.toLocaleString()}
          </span>
          <span className="stat__label">제거된 중복 차량</span>
        </div>
        <div className="stat">
          <span className="stat__value">
            {result.removedTest.toLocaleString()}
          </span>
          <span className="stat__label">제거된 test/costel</span>
        </div>
      </div>

      {/* 차종별 대수 */}
      <div className="subsection">
        <h3 className="subsection__title">
          차종별 대수{' '}
          <span className="count-tag">{result.byVehicleType.length}종</span>
        </h3>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>차종</th>
                <th>대수</th>
                <th>비율</th>
              </tr>
            </thead>
            <tbody>
              {result.byVehicleType.map((v) => (
                <tr key={v.type}>
                  <td className="col-name">{v.type}</td>
                  <td>{v.count.toLocaleString()}</td>
                  <td>
                    {result.totalPeople > 0
                      ? ((v.count / result.totalPeople) * 100).toFixed(1)
                      : '0'}
                    %
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 정제 명부 미리보기 (개인정보 숨김) */}
      <div className="subsection">
        <h3 className="subsection__title">정제 명부 미리보기</h3>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th className="rownum">#</th>
                {result.displayColumns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => (
                <tr key={i}>
                  <td className="rownum">{i + 1}</td>
                  {result.displayColumns.map((c) => {
                    const v = row[c]
                    return (
                      <td key={c} className={v === null ? 'cell--null' : ''}>
                        {v === null ? '—' : String(v)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result.rows.length > previewRows.length && (
          <p className="table-note">
            전체 {result.rows.length.toLocaleString()}명 중 상위{' '}
            {previewRows.length}명만 표시합니다. 동·호·스마트카드·전화 정보는
            표시하지 않습니다.
          </p>
        )}
      </div>
    </section>
  )
}
