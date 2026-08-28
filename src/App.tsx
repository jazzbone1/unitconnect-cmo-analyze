import { useEffect, useMemo, useRef, useState } from 'react'
import Dropzone from './components/Dropzone'
import FileList from './components/FileList'
import GroupSection from './components/GroupSection'
import SettlementAnalysis from './components/SettlementAnalysis'
import RegistryAnalysis from './components/RegistryAnalysis'
import SiteInfoPanel, { EMPTY_SITE, type SiteInfo } from './components/SiteInfoPanel'
import ProjectsView from './components/ProjectsView'
import SettingsView from './components/SettingsView'
import FeasibilityAnalysis from './components/FeasibilityAnalysis'
import Logo from './components/Logo'
import { usePersistentState } from './lib/persist'
import { DEFAULT_INPUTS, type FeasibilityInputs } from './lib/feasibility'
import { groupFiles } from './lib/group'
import { detectSettlement, DEFAULT_CONFIG, type SettlementConfig } from './lib/settlement'
import { detectRegistry, computeRegistry } from './lib/registry'
import { parseUploadedFiles } from './lib/ingest'
import { newSiteId, type SavedSite } from './lib/sites'
import { getStore } from './lib/store'
import type { AggKind, FileEntry } from './types'

/** 빌드 버전 태그 — 배포/캐시 확인용(이 값이 보이면 최신 번들). */
const BUILD_TAG = 'v2026.08.26-20'

function cloneDefaultConfig(): SettlementConfig {
  return {
    hours: DEFAULT_CONFIG.hours,
    chargers: DEFAULT_CONFIG.chargers.map((c) => ({ ...c })),
  }
}

const AGG_OPTIONS: { value: AggKind; label: string }[] = [
  { value: 'sum', label: '합계' },
  { value: 'mean', label: '평균' },
  { value: 'count', label: '개수' },
]

export default function App() {
  const [tab, setTab] = usePersistentState<'analyze' | 'projects' | 'settings'>(
    'tab',
    'analyze',
  )
  const [analyzeTab, setAnalyzeTab] = usePersistentState<'usage' | 'feasibility'>(
    'analyzeTab',
    'usage',
  )
  // 선택된 프로젝트(상세) — App 레벨로 올려 탭 전환/뒤로가기에서 제어
  const [selectedProjectId, setSelectedProjectId] = usePersistentState<
    string | null
  >('selectedProjectId', null)

  // 네비게이션 상태를 브라우저 히스토리에 미러링 (뒤로가기 지원)
  const fromPop = useRef(false)
  const navMounted = useRef(false)
  useEffect(() => {
    const nav = { tab, project: selectedProjectId }
    if (!navMounted.current) {
      navMounted.current = true
      window.history.replaceState({ nav }, '')
      return
    }
    if (fromPop.current) {
      fromPop.current = false
      return
    }
    window.history.pushState({ nav }, '')
  }, [tab, selectedProjectId])

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const nav = (e.state && e.state.nav) || { tab: 'analyze', project: null }
      fromPop.current = true
      setTab(nav.tab)
      setSelectedProjectId(nav.project)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 알림 딥링크(?project=<id>) — 결재 알림 '원본 보기'로 해당 프로젝트 결재 화면 열기.
  useEffect(() => {
    const url = new URL(window.location.href)
    const pid = url.searchParams.get('project')
    if (!pid) return
    setTab('projects')
    setSelectedProjectId(pid)
    url.searchParams.delete('project')
    window.history.replaceState(
      {},
      '',
      url.pathname + (url.search || '') + url.hash,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [feas, setFeas] = useState<FeasibilityInputs>(() => DEFAULT_INPUTS())
  const [files, setFiles] = useState<FileEntry[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [aggKind, setAggKind] = useState<AggKind>('sum')
  // 파일 업로드 전에도 먼저 기입할 수 있는 단지 정보·충전기 설정
  const [site, setSite] = useState<SiteInfo>(EMPTY_SITE)
  const [config, setConfig] = useState<SettlementConfig>(cloneDefaultConfig)
  // 저장된 현장 목록 (localStorage 또는 원격 저장소)
  const store = useMemo(getStore, [])
  const [sites, setSites] = useState<SavedSite[]>([])
  const [sitesLoaded, setSitesLoaded] = useState(false)
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)
  // 저장 상태 표시(원격 저장 실패/401 진단용).
  const [saveState, setSaveState] = useState<{
    status: 'idle' | 'saving' | 'saved' | 'error'
    msg?: string
  }>({ status: 'idle' })

  useEffect(() => {
    let alive = true
    store
      .load()
      .then((s) => {
        if (alive) setSites(s)
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setSitesLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [store])

  useEffect(() => {
    // 최초 로드 완료 전에는 저장하지 않는다(빈 배열로 덮어쓰기 방지)
    if (!sitesLoaded) return
    setSaveState({ status: 'saving' })
    store
      .save(sites)
      .then(() => setSaveState({ status: 'saved' }))
      .catch((e) =>
        setSaveState({
          status: 'error',
          msg: e instanceof Error ? e.message : String(e),
        }),
      )
  }, [sites, sitesLoaded, store])

  function saveCurrentSite() {
    if (site.name.trim() === '') return
    const chargers = config.chargers.map((c) => ({ ...c }))
    // 저장 당시의 분석 데이터(정산 파일·명부 결과)도 함께 보관
    const analysisData = {
      hours: config.hours,
      chargers,
      files,
      feas,
      savedAt: new Date().toISOString(),
    }
    if (selectedSiteId) {
      setSites((prev) =>
        prev.map((s) =>
          s.id === selectedSiteId ? { ...s, ...site, ...analysisData } : s,
        ),
      )
    } else {
      const id = newSiteId()
      setSites((prev) => [...prev, { id, ...site, ...analysisData }])
      setSelectedSiteId(id)
    }
  }

  function loadSite(s: SavedSite) {
    setSite({
      name: s.name,
      address: s.address,
      households: s.households,
      parking: s.parking ?? 0,
    })
    // 저장된 요금·수량을 현재 5종 구조에 맞춰 반영
    const chargers = DEFAULT_CONFIG.chargers.map((base) => {
      const saved = s.chargers.find((c) => c.id === base.id)
      return { ...base, rate: saved?.rate ?? 0, count: saved?.count ?? 0 }
    })
    setConfig({ hours: s.hours || DEFAULT_CONFIG.hours, chargers })
    setFeas(s.feas ?? DEFAULT_INPUTS())
    setSelectedSiteId(s.id)
  }

  function deleteSite(id: string) {
    setSites((prev) => prev.filter((s) => s.id !== id))
    if (selectedSiteId === id) setSelectedSiteId(null)
  }

  function updateProject(id: string, patch: Partial<SavedSite>) {
    setSites((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  function newSite() {
    setSite(EMPTY_SITE)
    setConfig(cloneDefaultConfig())
    setFeas(DEFAULT_INPUTS())
    setSelectedSiteId(null)
  }

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
  const genericFiles = useMemo(
    () =>
      files.filter(
        (f) => !detectSettlement(f.dataset) && !detectRegistry(f.dataset),
      ),
    [files],
  )
  const groups = useMemo(() => groupFiles(genericFiles), [genericFiles])
  const registryResult = useMemo(
    () =>
      registryFiles.length > 0
        ? computeRegistry(registryFiles.map((f) => f.dataset))
        : null,
    [registryFiles],
  )

  async function handleFiles(incoming: File[]) {
    setLoading(true)
    setErrors([])
    const { parsed, errors: newErrors } = await parseUploadedFiles(incoming)
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
    <div className="layout">
      {store.kind === 'remote' && saveState.status !== 'idle' && (
        <div
          className={`save-toast save-toast--${saveState.status}`}
          role="status"
        >
          {saveState.status === 'saving'
            ? '저장 중…'
            : saveState.status === 'saved'
              ? '저장됨 ✓'
              : `저장 실패: ${saveState.msg ?? '알 수 없음'}`}
        </div>
      )}
      <aside className="sidebar">
        <div className="sidebar__brand">
          <Logo height={28} />
        </div>
        <nav className="sidebar__nav">
          <button
            type="button"
            className={`sidebar__tab${tab === 'analyze' ? ' sidebar__tab--active' : ''}`}
            onClick={() => setTab('analyze')}
          >
            데이터 분석
          </button>
          <button
            type="button"
            className={`sidebar__tab${tab === 'projects' ? ' sidebar__tab--active' : ''}`}
            onClick={() => {
              // 프로젝트 탭 진입 시 항상 초기 화면(리스트)으로
              setSelectedProjectId(null)
              setTab('projects')
            }}
          >
            프로젝트
            {sites.length > 0 && (
              <span className="sidebar__count">{sites.length}</span>
            )}
          </button>
          <button
            type="button"
            className={`sidebar__tab${tab === 'settings' ? ' sidebar__tab--active' : ''}`}
            onClick={() => setTab('settings')}
          >
            설정
          </button>
        </nav>
        <div className="sidebar__build" title="빌드 버전">
          {BUILD_TAG}
        </div>
      </aside>

      <div className="content">
        {tab === 'settings' ? (
          <div className="app">
            <SettingsView />
          </div>
        ) : tab === 'projects' ? (
          <div className="app">
            <ProjectsView
              projects={sites}
              selectedId={selectedProjectId}
              onSelect={setSelectedProjectId}
              onDelete={deleteSite}
              onUpdate={updateProject}
            />
          </div>
        ) : (
          <div className={`app${analyzeTab === 'usage' ? ' app--wide' : ''}`}>
            <header className="app__header app__header--left">
              <h1>데이터 분석</h1>
              <p className="app__subtitle">
                <b>단지 정보와 충전기 설정을 먼저 입력</b>한 뒤 이용량 분석에서
                파일을 올리거나, 사업성 분석에서 손익을 계산하세요. 데이터는
                서버로 전송되지 않고 전부 브라우저 안에서만 처리됩니다.
              </p>
            </header>

            <main className="app__main">
              <SiteInfoPanel
                site={site}
                setSite={setSite}
                config={config}
                setConfig={setConfig}
                onReset={() => setConfig(cloneDefaultConfig())}
                sites={sites}
                selectedId={selectedSiteId}
                onSave={saveCurrentSite}
                onLoad={loadSite}
                onDelete={deleteSite}
                onNew={newSite}
              />

              <div className="subtabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  className={`subtab${analyzeTab === 'usage' ? ' subtab--active' : ''}`}
                  onClick={() => setAnalyzeTab('usage')}
                >
                  이용량 분석
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`subtab${analyzeTab === 'feasibility' ? ' subtab--active' : ''}`}
                  onClick={() => setAnalyzeTab('feasibility')}
                >
                  사업성 분석
                </button>
              </div>

              {analyzeTab === 'feasibility' ? (
                <FeasibilityAnalysis
                  inputs={feas}
                  setInputs={setFeas}
                  config={config}
                />
              ) : (
                <>
                  <div className="dropzone-row">
                    <Dropzone
                      onFiles={handleFiles}
                      disabled={loading}
                      icon="📊"
                      title="이용량 데이터 (정산)"
                      hint="정산 CSV·Excel (사용량·사용금액) · 파일명 날짜로 월간/연간 자동 분류"
                    />
                    <Dropzone
                      onFiles={handleFiles}
                      disabled={loading}
                      icon="🚗"
                      title="사용자 정보 (차량 등록)"
                      hint="차량 등록 명부 CSV·Excel · 차량번호 기준 중복 제거·차종 집계"
                    />
                  </div>

                  {loading && (
                    <p className="status status--loading">분석 중…</p>
                  )}
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
                      <FileList
                        files={files}
                        onRemove={removeFile}
                        onClear={clearAll}
                      />

                      {settlementFiles.length > 0 && (
                        <SettlementAnalysis
                          files={settlementFiles}
                          config={config}
                          site={site}
                        />
                      )}

                      {registryResult && (
                        <RegistryAnalysis result={registryResult} />
                      )}

                      {groups.length > 0 && (
                        <div className="toolbar">
                          <div className="overview-inline">
                            <span>
                              기타 데이터 <b>{groups.length}</b>개 그룹
                            </span>
                          </div>
                          <div
                            className="agg-toggle"
                            role="group"
                            aria-label="집계 방식"
                          >
                            <span className="agg-toggle__label">비교 집계</span>
                            {AGG_OPTIONS.map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                className={`agg-toggle__btn${
                                  aggKind === opt.value
                                    ? ' agg-toggle__btn--active'
                                    : ''
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
                        <GroupSection
                          key={group.category}
                          group={group}
                          aggKind={aggKind}
                        />
                      ))}
                    </>
                  )}
                </>
              )}
            </main>

            <footer className="app__footer">
              <p>
                모든 분석은 브라우저에서 처리됩니다 · 파일은 업로드되지 않습니다.
              </p>
            </footer>
          </div>
        )}
      </div>
    </div>
  )
}
