import { useState } from 'react'
import type { SavedSite } from '../lib/sites'
import type { SettlementConfig } from '../lib/settlement'
import SettlementAnalysis from './SettlementAnalysis'
import RegistryAnalysis from './RegistryAnalysis'

interface ProjectsViewProps {
  projects: SavedSite[]
  onDelete: (id: string) => void
}

/** 프로젝트(저장된 현장) 목록 + 선택 시 저장된 분석자료 보기 */
export default function ProjectsView({ projects, onDelete }: ProjectsViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = projects.find((p) => p.id === selectedId) ?? null

  if (selected) {
    const config: SettlementConfig = {
      hours: selected.hours,
      chargers: selected.chargers,
    }
    const settlementFiles = selected.settlementFiles ?? []
    return (
      <div className="projects">
        <button
          type="button"
          className="link-button back-link"
          onClick={() => setSelectedId(null)}
        >
          ← 프로젝트 목록
        </button>

        {settlementFiles.length === 0 && !selected.registry && (
          <p className="status status--info">
            이 현장에는 저장된 분석 데이터가 없습니다. 데이터 분석 탭에서 파일을
            올린 뒤 이 현장을 저장하면 여기에 표시됩니다.
          </p>
        )}

        {settlementFiles.length > 0 && (
          <SettlementAnalysis
            files={settlementFiles}
            config={config}
            site={{
              name: selected.name,
              address: selected.address,
              households: selected.households,
            }}
          />
        )}

        {selected.registry && <RegistryAnalysis result={selected.registry} />}
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="projects">
        <p className="status status--info">
          저장된 프로젝트가 없습니다. 데이터 분석 탭에서 단지 정보를 입력하고
          <b> 현장 저장</b>을 누르면 여기에 표시됩니다.
        </p>
      </div>
    )
  }

  return (
    <div className="projects">
      <h2 className="projects__title">프로젝트 ({projects.length})</h2>
      <div className="project-grid">
        {projects.map((p) => {
          const cnt = p.chargers.reduce((a, c) => a + c.count, 0)
          const fileCount = p.settlementFiles?.length ?? 0
          const people = p.registry?.totalPeople ?? 0
          return (
            <button
              key={p.id}
              type="button"
              className="project-card"
              onClick={() => setSelectedId(p.id)}
            >
              <div className="project-card__head">
                <span className="project-card__name">{p.name}</span>
                <span
                  className="remove-button"
                  role="button"
                  tabIndex={0}
                  aria-label={`${p.name} 삭제`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(p.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation()
                      onDelete(p.id)
                    }
                  }}
                >
                  ✕
                </span>
              </div>
              {p.address && (
                <div className="project-card__addr">{p.address}</div>
              )}
              <div className="project-card__meta">
                <span>{p.households ? `${p.households.toLocaleString()}세대` : '세대수 —'}</span>
                <span>충전기 {cnt}기</span>
              </div>
              <div className="project-card__meta">
                <span>정산 파일 {fileCount}개</span>
                <span>{people > 0 ? `등록 ${people.toLocaleString()}명` : '명부 없음'}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
