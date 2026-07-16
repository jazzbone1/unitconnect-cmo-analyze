import { Fragment, useState } from 'react'
import { registryToCsv, type RegistryResult } from '../lib/registry'

interface RegistryAnalysisProps {
  result: RegistryResult
}

/**
 * 이용자(차량 등록) 명부 분석 표시. 사전에 계산된 결과(정제·중복제거)를
 * 받아 전체 인원수·차종별 대수·정제 명부를 보여준다.
 */
export default function RegistryAnalysis({ result }: RegistryAnalysisProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggle(type: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

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

      {/* 차종별 대수 (클릭 시 통합된 원본 명칭 펼치기) */}
      <div className="subsection">
        <h3 className="subsection__title">
          차종별 대수 (명칭 자동 통합){' '}
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
              {result.byVehicleType.map((v) => {
                const isOpen = expanded.has(v.type)
                const hasVariants = v.variants.length > 0
                return (
                  <Fragment key={v.type}>
                    <tr
                      className={hasVariants ? 'row--clickable' : ''}
                      onClick={hasVariants ? () => toggle(v.type) : undefined}
                    >
                      <td className="col-name">
                        {hasVariants && (
                          <span className="row-caret">
                            {isOpen ? '▼' : '▶'}
                          </span>
                        )}
                        {v.type}
                        {hasVariants && (
                          <span className="variant-count">
                            {' '}
                            ({v.variants.length}종 통합)
                          </span>
                        )}
                      </td>
                      <td>{v.count.toLocaleString()}</td>
                      <td>
                        {result.totalPeople > 0
                          ? ((v.count / result.totalPeople) * 100).toFixed(1)
                          : '0'}
                        %
                      </td>
                    </tr>
                    {isOpen &&
                      v.variants.map((va) => (
                        <tr key={`${v.type}::${va.name}`} className="row--variant">
                          <td className="col-name variant-name">
                            └ {va.name}
                          </td>
                          <td>{va.count.toLocaleString()}</td>
                          <td className="cell--null">—</td>
                        </tr>
                      ))}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="table-note">
          차종을 클릭하면 자동 통합된 <b>원본 입력 명칭</b>이 펼쳐집니다. 개인정보
          (사용자명·건물명·동·호·차량번호·스마트카드·전화·이메일)는 저장·표시하지
          않습니다.
        </p>
      </div>
    </section>
  )
}
