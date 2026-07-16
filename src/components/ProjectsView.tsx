import { useMemo, useState } from 'react'
import type { SavedSite } from '../lib/sites'
import {
  projectCode,
  SALES_STATUS,
  SURVEY_STATUS,
  CONSTRUCTION_STATUS,
  CPO_OPTIONS,
} from '../lib/sites'
import { usePersistentState } from '../lib/persist'
import { DEFAULT_CONFIG, type SettlementConfig } from '../lib/settlement'
import { detectSettlement } from '../lib/settlement'
import { DEFAULT_INPUTS, type FeasibilityInputs } from '../lib/feasibility'
import { detectRegistry, computeRegistry } from '../lib/registry'
import { parseUploadedFiles } from '../lib/ingest'
import type { FileEntry } from '../types'
import SettlementAnalysis from './SettlementAnalysis'
import RegistryAnalysis from './RegistryAnalysis'
import FeasibilityAnalysis from './FeasibilityAnalysis'
import SiteConfigForm, { type SiteInfo } from './SiteConfigForm'
import Dropzone from './Dropzone'
import FileList from './FileList'

interface ProjectsViewProps {
  projects: SavedSite[]
  onDelete: (id: string) => void
  onUpdate: (id: string, patch: Partial<SavedSite>) => void
}

/** 프로젝트 상세: 변수·파일 편집 + 이용량/사업성 내부 탭 */
function ProjectDetail({
  project,
  onBack,
  onUpdate,
}: {
  project: SavedSite
  onBack: () => void
  onUpdate: (id: string, patch: Partial<SavedSite>) => void
}) {
  const [subtab, setSubtab] = usePersistentState<'usage' | 'feasibility'>(
    'projectSubtab',
    'usage',
  )
  const [feas, setFeas] = useState<FeasibilityInputs>(
    project.feas ?? DEFAULT_INPUTS(),
  )
  const [site, setSite] = useState<SiteInfo>({
    name: project.name,
    address: project.address,
    households: project.households,
    parking: project.parking ?? 0,
  })
  const [config, setConfig] = useState<SettlementConfig>({
    hours: project.hours,
    chargers: project.chargers.map((c) => ({ ...c })),
  })
  const [files, setFiles] = useState<FileEntry[]>(
    project.files ?? project.settlementFiles ?? [],
  )
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [saved, setSaved] = useState(false)

  const settlementFiles = useMemo(
    () => files.filter((f) => detectSettlement(f.dataset)),
    [files],
  )
  const registryFiles = useMemo(
    () =>
      files.filter(
        (f) => !detectSettlement(f.dataset) && detectRegistry(f.dataset),
      ),
    [files],
  )
  const registryResult = useMemo(() => {
    if (registryFiles.length > 0)
      return computeRegistry(registryFiles.map((f) => f.dataset))
    // 구버전 프로젝트(파일 미저장)는 저장된 결과를 표시
    return project.files === undefined ? (project.registry ?? null) : null
  }, [registryFiles, project])

  async function handleAdd(incoming: File[]) {
    setLoading(true)
    setErrors([])
    const { parsed, errors: errs } = await parseUploadedFiles(incoming)
    setFiles((prev) => [...prev, ...parsed])
    setErrors(errs)
    setLoading(false)
  }

  function saveChanges() {
    onUpdate(project.id, {
      name: site.name,
      address: site.address,
      households: site.households,
      parking: site.parking,
      hours: config.hours,
      chargers: config.chargers.map((c) => ({ ...c })),
      files,
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
          <h2>{site.name || '(이름 없음)'} · 편집</h2>
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
          <div className="dropzone-row">
            <Dropzone
              onFiles={handleAdd}
              disabled={loading}
              icon="📊"
              title="이용량 데이터 (정산)"
              hint="정산 CSV·Excel 추가"
            />
            <Dropzone
              onFiles={handleAdd}
              disabled={loading}
              icon="🚗"
              title="사용자 정보 (차량 등록)"
              hint="차량 등록 명부 CSV·Excel 추가"
            />
          </div>

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

          {files.length > 0 && (
            <FileList
              files={files}
              onRemove={(id) => setFiles((p) => p.filter((f) => f.id !== id))}
              onClear={() => setFiles([])}
            />
          )}

          {settlementFiles.length > 0 && (
            <SettlementAnalysis
              files={settlementFiles}
              config={config}
              site={site}
            />
          )}
          {registryResult && <RegistryAnalysis result={registryResult} />}

          {files.length === 0 && !registryResult && (
            <p className="status status--info">
              위 업로드 칸에서 정산·명부 파일을 추가하면 분석이 표시됩니다.
              변경 후 <b>변경 저장</b>을 누르면 프로젝트에 반영됩니다.
            </p>
          )}
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
  const [selectedId, setSelectedId] = usePersistentState<string | null>(
    'selectedProjectId',
    null,
  )
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string>('code')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [rowsSel, setRowsSel] = useState<Set<string>>(new Set())
  const [showFilter, setShowFilter] = useState(false)
  const [filters, setFilters] = useState({
    cpo: '',
    sales: '',
    survey: '',
    construction: '',
  })
  const [presets, setPresets] = usePersistentState<
    { name: string; filters: typeof filters }[]
  >('projectFilterPresets', [])
  const [preset, setPreset] = useState('기본 보기')

  const selected = projects.find((p) => p.id === selectedId) ?? null

  const chargerCount = (p: SavedSite) =>
    p.chargers.reduce((a, c) => a + c.count, 0)
  const val = (p: SavedSite, key: string): string | number => {
    switch (key) {
      case 'code':
        return projectCode(p)
      case 'cpo':
        return p.cpo ?? '선택안함'
      case 'name':
        return p.name
      case 'address':
        return p.address ?? ''
      case 'contract':
        return p.contractTotal ?? chargerCount(p)
      case 'survey':
        return p.surveyStatus ?? ''
      case 'sales':
        return p.salesStatus ?? '계약진행필요'
      case 'construction':
        return p.constructionStatus ?? ''
      case 'env':
        return p.envSubmitDate ?? ''
      case 'cend':
        return p.constructionEndDate ?? ''
      case 'safety':
        return p.safetyCheckDate ?? ''
      default:
        return ''
    }
  }

  const q = query.trim().toLowerCase()
  const filtered = projects
    .filter(
      (p) =>
        !q ||
        projectCode(p).toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.address ?? '').toLowerCase().includes(q),
    )
    .filter((p) => !filters.cpo || (p.cpo ?? '선택안함') === filters.cpo)
    .filter(
      (p) => !filters.sales || (p.salesStatus ?? '계약진행필요') === filters.sales,
    )
    .filter((p) => !filters.survey || (p.surveyStatus ?? '') === filters.survey)
    .filter(
      (p) =>
        !filters.construction ||
        (p.constructionStatus ?? '') === filters.construction,
    )

  const sorted = [...filtered].sort((a, b) => {
    const va = val(a, sortKey)
    const vb = val(b, sortKey)
    let cmp: number
    if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb
    else cmp = String(va).localeCompare(String(vb), 'ko')
    return sortDir === 'asc' ? cmp : -cmp
  })

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }
  function toggleRow(id: string) {
    setRowsSel((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const allChecked = sorted.length > 0 && sorted.every((p) => rowsSel.has(p.id))
  function toggleAll() {
    setRowsSel(allChecked ? new Set() : new Set(sorted.map((p) => p.id)))
  }
  function applyPreset(name: string) {
    setPreset(name)
    if (name === '기본 보기') {
      setFilters({ cpo: '', sales: '', survey: '', construction: '' })
      return
    }
    const found = presets.find((p) => p.name === name)
    if (found) setFilters(found.filters)
  }
  function savePreset() {
    const name = window.prompt('필터 프리셋 이름을 입력하세요')
    if (!name) return
    setPresets((prev) => [
      ...prev.filter((p) => p.name !== name),
      { name, filters },
    ])
    setPreset(name)
  }

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

  const cols: { key: string; label: string }[] = [
    { key: 'code', label: '프로젝트 코드' },
    { key: 'cpo', label: 'CPO' },
    { key: 'name', label: '충전소명' },
    { key: 'address', label: '도로명 주소' },
    { key: 'contract', label: '계약합계' },
    { key: 'survey', label: '실사 상태' },
    { key: 'sales', label: '영업 상태(본사기입)' },
    { key: 'construction', label: '시공 상태(본사기입)' },
    { key: 'env', label: '환경부접수일' },
    { key: 'cend', label: '시공예정일(종료)' },
    { key: 'safety', label: '안전점검일' },
  ]
  const sortMark = (key: string) =>
    sortKey === key ? (sortDir === 'asc' ? ' ↓' : ' ↑') : ''

  return (
    <div className="projects">
      {/* 검색 */}
      <div className="proj-panel">
        <input
          type="search"
          className="proj-search"
          placeholder="프로젝트 코드 · 충전소명 · 주소 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* 필터 */}
      <div className="proj-panel">
        <div className="proj-filter-divider">필터</div>
        <div className="proj-filter-bar">
          <button
            type="button"
            className="btn-outline"
            onClick={() => setShowFilter((s) => !s)}
          >
            ⚙ 필터 설정
          </button>
          <div className="proj-filter-preset">
            <label className="proj-preset-label">
              필터 프리셋
              <select
                value={preset}
                onChange={(e) => applyPreset(e.target.value)}
              >
                <option>기본 보기</option>
                {presets.map((p) => (
                  <option key={p.name}>{p.name}</option>
                ))}
              </select>
            </label>
            <button type="button" className="btn-outline" onClick={savePreset}>
              🔖 필터 프리셋 저장
            </button>
          </div>
        </div>

        {showFilter && (
          <div className="proj-filter-fields">
            <label>
              CPO
              <select
                value={filters.cpo}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, cpo: e.target.value }))
                }
              >
                <option value="">전체</option>
                {CPO_OPTIONS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label>
              영업 상태
              <select
                value={filters.sales}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, sales: e.target.value }))
                }
              >
                <option value="">전체</option>
                {SALES_STATUS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label>
              실사 상태
              <select
                value={filters.survey}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, survey: e.target.value }))
                }
              >
                <option value="">전체</option>
                {SURVEY_STATUS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label>
              시공 상태
              <select
                value={filters.construction}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, construction: e.target.value }))
                }
              >
                <option value="">전체</option>
                {CONSTRUCTION_STATUS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setFilters({ cpo: '', sales: '', survey: '', construction: '' })
                setPreset('기본 보기')
              }}
            >
              필터 초기화
            </button>
          </div>
        )}

        <p className="proj-hint">
          필터 설정에서 항목을 선택하면 필터 입력칸이 나타납니다.
        </p>
        <p className="proj-hint">
          검색어는 프로젝트 코드·충전소명·주소가 대상이며 입력 즉시 반영됩니다.
        </p>
      </div>

      {/* 건수 + 정렬 안내 */}
      <div className="proj-count">
        <span>
          총 <b>{sorted.length}</b>건 · 페이지 1/1 · 선택 <b>{rowsSel.size}</b>건
        </span>
        <span className="proj-count__hint">
          헤더 텍스트를 클릭하시면 정렬할 수 있습니다.
        </span>
      </div>

      {/* 목록 */}
      <div className="proj-table-card">
        <div className="table-scroll">
          <table className="data-table proj-table">
            <thead>
              <tr>
                <th className="proj-check">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    aria-label="전체 선택"
                  />
                </th>
                {cols.map((c) => (
                  <th
                    key={c.key}
                    className="proj-sortable"
                    onClick={() => toggleSort(c.key)}
                  >
                    {c.label}
                    {sortMark(c.key)}
                  </th>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id} className={rowsSel.has(p.id) ? 'row--sel' : ''}>
                  <td className="proj-check">
                    <input
                      type="checkbox"
                      checked={rowsSel.has(p.id)}
                      onChange={() => toggleRow(p.id)}
                      aria-label={`${p.name} 선택`}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="proj-code"
                      onClick={() => setSelectedId(p.id)}
                    >
                      {projectCode(p)}
                    </button>
                  </td>
                  <td>
                    <select
                      className="proj-inline"
                      value={p.cpo ?? '선택안함'}
                      onChange={(e) => onUpdate(p.id, { cpo: e.target.value })}
                    >
                      {CPO_OPTIONS.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  </td>
                  <td className="col-name">
                    <button
                      type="button"
                      className="proj-link"
                      onClick={() => setSelectedId(p.id)}
                    >
                      {p.name}
                    </button>
                  </td>
                  <td className="col-name">{p.address || '—'}</td>
                  <td className="proj-contract">
                    {(p.contractTotal ?? chargerCount(p)).toLocaleString()}
                  </td>
                  <td>
                    <select
                      className="proj-inline"
                      value={p.surveyStatus ?? ''}
                      onChange={(e) =>
                        onUpdate(p.id, { surveyStatus: e.target.value })
                      }
                    >
                      <option value="">—</option>
                      {SURVEY_STATUS.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="proj-inline"
                      value={p.salesStatus ?? '계약진행필요'}
                      onChange={(e) =>
                        onUpdate(p.id, { salesStatus: e.target.value })
                      }
                    >
                      {SALES_STATUS.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      className="proj-inline"
                      value={p.constructionStatus ?? ''}
                      onChange={(e) =>
                        onUpdate(p.id, { constructionStatus: e.target.value })
                      }
                    >
                      <option value="">—</option>
                      {CONSTRUCTION_STATUS.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="date"
                      className="proj-inline proj-date"
                      value={p.envSubmitDate ?? ''}
                      onChange={(e) =>
                        onUpdate(p.id, { envSubmitDate: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      className="proj-inline proj-date"
                      value={p.constructionEndDate ?? ''}
                      onChange={(e) =>
                        onUpdate(p.id, { constructionEndDate: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      className="proj-inline proj-date"
                      value={p.safetyCheckDate ?? ''}
                      onChange={(e) =>
                        onUpdate(p.id, { safetyCheckDate: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="remove-button"
                      aria-label={`${p.name} 삭제`}
                      onClick={() => onDelete(p.id)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={cols.length + 2} className="proj-empty">
                    {projects.length === 0
                      ? '저장된 프로젝트가 없습니다. 데이터 분석 탭에서 현장을 저장하세요.'
                      : '조건에 해당하는 프로젝트가 없습니다.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
