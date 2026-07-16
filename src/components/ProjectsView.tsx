import { useState } from 'react'
import type { SavedSite } from '../lib/sites'
import { DEFAULT_CONFIG, type SettlementConfig } from '../lib/settlement'
import { DEFAULT_INPUTS, type FeasibilityInputs } from '../lib/feasibility'
import SettlementAnalysis from './SettlementAnalysis'
import RegistryAnalysis from './RegistryAnalysis'
import FeasibilityAnalysis from './FeasibilityAnalysis'
import SiteConfigForm, { type SiteInfo } from './SiteConfigForm'

interface ProjectsViewProps {
  projects: SavedSite[]
  onDelete: (id: string) => void
  onUpdate: (id: string, patch: Partial<SavedSite>) => void
}

/** 프로젝트 상세: 변수 편집 + 이용량/사업성 내부 탭 */
function ProjectDetail({
  project,
  onBack,
  onUpdate,
}: {
  project: SavedSite
  onBack: () => void
  onUpdate: (id: string, patch: Partial<SavedSite>) => void
}) {
  const [subtab, setSubtab] = useState<'usage' | 'feasibility'>('usage')
  const [feas, setFeas] = useState<FeasibilityInputs>(
    project.feas ?? DEFAULT_INPUTS(),
  )
  const [site, setSite] = useState<SiteInfo>({
    name: project.name,
    address: project.address,
    households: project.households,
  })
  const [config, setConfig] = useState<SettlementConfig>({
    hours: project.hours,
    chargers: project.chargers.map((c) => ({ ...c })),
  })
  const [saved, setSaved] = useState(false)

  const settlementFiles = project.settlementFiles ?? []
  const hasUsage = settlementFiles.length > 0 || !!project.registry

  function saveChanges() {
    onUpdate(project.id, {
      name: site.name,
      address: site.address,
      households: site.households,
      hours: config.hours,
      chargers: config.chargers.map((c) => ({ ...c })),
      feas,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  function resetConfig() {
    setConfig({
      hours: DEFAULT_CONFIG.hours,
      chargers: DEFAULT_CONFIG.chargers.map((c) => ({ ...c })),
    })
  }

  return (
    <div className="projects">
      <button type="button" className="link-button back-link" onClick={onBack}>
        ← 프로젝트 목록
      </button>

      <section className="card">
        <div className="card__header">
          <h2>{site.name || '(이름 없음)'} · 변수 수정</h2>
          <div className="site-edit-actions">
            {saved && <span className="saved-note">저장됨 ✓</span>}
            <button type="button" className="btn-primary" onClick={saveChanges}>
              변경 저장
            </button>
          </div>
        </div>
        <SiteConfigForm
          site={site}
          setSite={setSite}
          config={config}
          setConfig={setConfig}
          onReset={resetConfig}
        />
      </section>

      <div className="subtabs" role="tablist">
        <button
          type="button"
          role="tab"
          className={`subtab${subtab === 'usage' ? ' subtab--active' : ''}`}
          onClick={() => setSubtab('usage')}
        >
          이용량 분석
        </button>
        <button
          type="button"
          role="tab"
          className={`subtab${subtab === 'feasibility' ? ' subtab--active' : ''}`}
          onClick={() => setSubtab('feasibility')}
        >
          사업성 분석
        </button>
      </div>

      {subtab === 'feasibility' ? (
        <FeasibilityAnalysis inputs={feas} setInputs={setFeas} config={config} />
      ) : (
        <>
          {!hasUsage && (
            <p className="status status--info">
              이 현장에는 저장된 이용량 분석 데이터가 없습니다. 데이터 분석
              탭에서 파일을 올린 뒤 이 현장을 저장하면 표시됩니다.
            </p>
          )}
          {settlementFiles.length > 0 && (
            <SettlementAnalysis
              files={settlementFiles}
              config={config}
              site={site}
            />
          )}
          {project.registry && <RegistryAnalysis result={project.registry} />}
        </>
      )}
    </div>
  )
}

/** 프로젝트(저장된 현장) 목록 + 선택 시 상세 보기 */
export default function ProjectsView({
  projects,
  onDelete,
  onUpdate,
}: ProjectsViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = projects.find((p) => p.id === selectedId) ?? null

  if (selected) {
    return (
      <ProjectDetail
        key={selected.id}
        project={selected}
        onBack={() => setSelectedId(null)}
        onUpdate={onUpdate}
      />
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
