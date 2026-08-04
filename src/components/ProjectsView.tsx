import { useMemo, useState } from 'react'
import type { SavedSite } from '../lib/sites'
import { usePersistentState } from '../lib/persist'
import { DEFAULT_CONFIG, type SettlementConfig } from '../lib/settlement'
import { detectSettlement, computeAll } from '../lib/settlement'
import { DEFAULT_INPUTS, type FeasibilityInputs } from '../lib/feasibility'
import { detectRegistry, computeRegistry } from '../lib/registry'
import { parseUploadedFiles } from '../lib/ingest'
import { defaultReport, type ReportModel } from '../lib/report'
import { computeTariff, defaultTariff, type TariffInputs } from '../lib/tariff'
import { defaultStandby, computeStandby, type StandbyInputs } from '../lib/standby'
import type { FileEntry } from '../types'
import SettlementAnalysis from './SettlementAnalysis'
import RegistryAnalysis from './RegistryAnalysis'
import FeasibilityAnalysis from './FeasibilityAnalysis'
import ReportView from './ReportView'
import TariffAnalysis from './TariffAnalysis'
import StandbyAnalysis from './StandbyAnalysis'
import SiteConfigForm, { type SiteInfo } from './SiteConfigForm'
import Dropzone from './Dropzone'
import FileList from './FileList'

/** 프로젝트 데이터로 보고서 초기값(현장 정보) 자동 기입 */
function seedReport(
  project: SavedSite,
  config: SettlementConfig,
  files: FileEntry[],
): ReportModel {
  const d = defaultReport()
  d.siteName = project.name
  const total = config.chargers.reduce((a, c) => a + c.count, 0)
  const active = config.chargers.filter((c) => c.count > 0)
  const breakdown = active.map((c) => `${c.name} ${c.count}`).join(' + ')

  d.overview = d.overview.map((row) => {
    if (row.label === '세대수')
      return {
        ...row,
        value: project.households ? `${project.households.toLocaleString()}세대` : '',
      }
    if (row.label === '충전기')
      return {
        ...row,
        value: total ? `${total.toLocaleString()}대` : '',
        note: breakdown,
      }
    return row
  })

  // 정산 월간 데이터가 있으면 유형별 실적·월별 추이 자동 기입
  const metrics = files.length ? computeAll(files, config) : []
  const months = metrics.filter((m) => m.periodType === 'month')
  const usageByType = new Map<string, number>()
  for (const m of months)
    for (const t of m.types)
      usageByType.set(t.id, (usageByType.get(t.id) ?? 0) + t.usage)

  if (active.length) {
    d.perType = active.map((c) => {
      const u = usageByType.get(c.id) ?? 0
      return {
        id: c.id,
        type: c.name,
        count: `${c.count}대`,
        kwh: u ? `${Math.round(u).toLocaleString()} kWh` : '',
        revenue: u && c.rate ? `${Math.round((u * c.rate) / 10000).toLocaleString()}만원` : '',
        perUnit: u && c.count ? `${Math.round(u / c.count).toLocaleString()} kWh` : '',
      }
    })
  }
  if (months.length) {
    d.monthly = months.map((m) => ({
      id: m.id,
      month: m.periodLabel,
      kwh: Math.round(m.usageTotal).toLocaleString(),
      revenue: Math.round(m.amountCalc).toLocaleString(),
      note: '',
    }))
  }
  return d
}

interface ProjectsViewProps {
  projects: SavedSite[]
  selectedId: string | null
  onSelect: (id: string | null) => void
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
  const [subtab, setSubtab] = usePersistentState<
    'usage' | 'feasibility' | 'report' | 'tariff' | 'standby'
  >('projectSubtab', 'usage')
  const [feas, setFeas] = useState<FeasibilityInputs>(
    project.feas ?? DEFAULT_INPUTS(),
  )
  const [report, setReport] = useState<ReportModel>(
    () =>
      project.report ??
      seedReport(
        project,
        { hours: project.hours, chargers: project.chargers.map((c) => ({ ...c })) },
        project.files ?? project.settlementFiles ?? [],
      ),
  )
  const [tariff, setTariff] = useState<TariffInputs>(() => {
    if (project.tariff) return project.tariff
    // 계약전력·월충전량을 충전기 설정/정산 데이터로 자동 기입
    const t = defaultTariff()
    const cap = project.chargers.reduce((a, c) => a + c.kw * c.count, 0)
    t.installedKw = cap
    t.contractRatio = 1
    t.contractKw = cap
    const files = project.files ?? project.settlementFiles ?? []
    const months = files.length
      ? computeAll(files, {
          hours: project.hours,
          chargers: project.chargers.map((c) => ({ ...c })),
        }).filter((m) => m.periodType === 'month')
      : []
    if (months.length)
      t.monthlyKwh = Math.round(
        months.reduce((a, m) => a + m.usageTotal, 0) / months.length,
      )
    return t
  })
  const [standby, setStandby] = useState<StandbyInputs>(
    () => project.standby ?? defaultStandby(),
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
      report,
      tariff,
      standby,
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
        <button
          type="button"
          role="tab"
          className={`subtab${subtab === 'tariff' ? ' subtab--active' : ''}`}
          onClick={() => setSubtab('tariff')}
        >
          요금 구조
        </button>
        <button
          type="button"
          role="tab"
          className={`subtab${subtab === 'standby' ? ' subtab--active' : ''}`}
          onClick={() => setSubtab('standby')}
        >
          대기전력
        </button>
        <button
          type="button"
          role="tab"
          className={`subtab${subtab === 'report' ? ' subtab--active' : ''}`}
          onClick={() => setSubtab('report')}
        >
          보고서
        </button>
      </div>

      {subtab === 'report' ? (
        <ReportView model={report} setModel={setReport} />
      ) : subtab === 'tariff' ? (
        <TariffAnalysis
          inputs={{
            ...tariff,
            installedKw: config.chargers.reduce((a, c) => a + c.kw * c.count, 0),
          }}
          setInputs={setTariff}
        />
      ) : subtab === 'standby' ? (
        <StandbyAnalysis
          chargers={config.chargers}
          inputs={standby}
          setInputs={setStandby}
          effCost={
            computeTariff({
              ...tariff,
              installedKw: config.chargers.reduce(
                (a, c) => a + c.kw * c.count,
                0,
              ),
            }).selected.effCost
          }
        />
      ) : subtab === 'feasibility' ? (
        <FeasibilityAnalysis
          inputs={feas}
          setInputs={setFeas}
          config={config}
          standbyMonthlyKwhSeparated={computeStandby(
            config.chargers.filter((c) => c.separated),
            standby,
            0,
          ).totalKwh}
          standbyMonthlyKwhAll={
            computeStandby(config.chargers, standby, 0).totalKwh
          }
        />
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
  selectedId,
  onSelect,
  onDelete,
  onUpdate,
}: ProjectsViewProps) {
  const setSelectedId = onSelect
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<string>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const selected = projects.find((p) => p.id === selectedId) ?? null

  const chargerCount = (p: SavedSite) =>
    p.chargers.reduce((a, c) => a + c.count, 0)
  const val = (p: SavedSite, key: string): string | number => {
    switch (key) {
      case 'name':
        return p.name
      case 'address':
        return p.address ?? ''
      case 'chargers':
        return chargerCount(p)
      case 'households':
        return p.households ?? 0
      case 'parking':
        return p.parking ?? 0
      default:
        return ''
    }
  }

  const q = query.trim().toLowerCase()
  const filtered = projects.filter(
    (p) =>
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.address ?? '').toLowerCase().includes(q),
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

  const cols: { key: string; label: string; num?: boolean }[] = [
    { key: 'name', label: '단지명' },
    { key: 'address', label: '주소' },
    { key: 'chargers', label: '충전기 수량', num: true },
    { key: 'households', label: '세대수', num: true },
    { key: 'parking', label: '총 주차대수', num: true },
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
          placeholder="단지명 · 주소 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* 건수 + 정렬 안내 */}
      <div className="proj-count">
        <span>
          총 <b>{sorted.length}</b>건
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
                {cols.map((c) => (
                  <th
                    key={c.key}
                    className={`proj-sortable${c.num ? ' proj-num' : ''}`}
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
                <tr key={p.id}>
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
                  <td className="proj-num">
                    {chargerCount(p).toLocaleString()}기
                  </td>
                  <td className="proj-num">
                    {p.households ? p.households.toLocaleString() : '—'}
                  </td>
                  <td className="proj-num">
                    {p.parking ? p.parking.toLocaleString() : '—'}
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
                  <td colSpan={cols.length + 1} className="proj-empty">
                    {projects.length === 0
                      ? '저장된 프로젝트가 없습니다. 데이터 분석 탭에서 현장을 저장하세요.'
                      : '검색 결과가 없습니다.'}
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
