import { useMemo, useState } from 'react'
import type { AggKind, FileGroup } from '../types'
import { summarizeDataset } from '../lib/stats'
import ComparisonTable from './ComparisonTable'
import SummaryStats from './SummaryStats'
import DataPreview from './DataPreview'

interface GroupSectionProps {
  group: FileGroup
  aggKind: AggKind
}

/** 카테고리 그룹 하나에 대한 비교 표 + 통합 요약 통계. */
export default function GroupSection({ group, aggKind }: GroupSectionProps) {
  const [showPreview, setShowPreview] = useState(false)

  // 통합 요약에서는 출처 표시용 "__파일" 컬럼을 제외한다.
  const summaries = useMemo(
    () => summarizeDataset(group.combined).filter((s) => s.column !== '__파일'),
    [group],
  )

  const periodRange = useMemo(() => {
    const labels = group.files
      .map((f) => f.period?.label)
      .filter((l): l is string => !!l)
    if (labels.length === 0) return null
    if (labels.length === 1) return labels[0]
    return `${labels[0]} ~ ${labels[labels.length - 1]}`
  }, [group])

  return (
    <section className="card group-card">
      <div className="card__header">
        <div>
          <h2 className="group-title">{group.category}</h2>
          {periodRange && <p className="group-range">{periodRange}</p>}
        </div>
        <span className="badge">
          파일 {group.files.length} · 총{' '}
          {group.combined.rows.length.toLocaleString()}행
        </span>
      </div>

      <div className="subsection">
        <h3 className="subsection__title">기간별 비교</h3>
        <ComparisonTable group={group} aggKind={aggKind} />
      </div>

      <div className="subsection">
        <h3 className="subsection__title">
          통합 요약 통계 (모든 기간 행을 합쳐 계산)
        </h3>
        <SummaryStats summaries={summaries} />
      </div>

      <div className="subsection">
        <button
          type="button"
          className="link-button"
          onClick={() => setShowPreview((v) => !v)}
        >
          {showPreview ? '통합 데이터 미리보기 접기' : '통합 데이터 미리보기 펼치기'}
        </button>
        {showPreview && <DataPreview dataset={group.combined} />}
      </div>
    </section>
  )
}
