import { useEffect, useMemo, useState } from 'react'
import Dropzone from './components/Dropzone'
import FileList from './components/FileList'
import GroupSection from './components/GroupSection'
import SettlementAnalysis from './components/SettlementAnalysis'
import RegistryAnalysis from './components/RegistryAnalysis'
import SiteInfoPanel, { EMPTY_SITE, type SiteInfo } from './components/SiteInfoPanel'
import { parseFile } from './lib/parse'
import { parseFileName } from './lib/parseName'
import { groupFiles } from './lib/group'
import { detectSettlement, DEFAULT_CONFIG, type SettlementConfig } from './lib/settlement'
import { detectRegistry } from './lib/registry'
import { stripPii } from './lib/privacy'
import {
  loadSites,
  saveSites,
  newSiteId,
  type SavedSite,
} from './lib/sites'
import type { AggKind, FileEntry } from './types'

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
  // 파일 업로드 전에도 먼저 기입할 수 있는 단지 정보·충전기 설정
  const [site, setSite] = useState<SiteInfo>(EMPTY_SITE)
  const [config, setConfig] = useState<SettlementConfig>(cloneDefaultConfig)
  // 저장된 현장 목록 (localStorage 유지)
  const [sites, setSites] = useState<SavedSite[]>(() => loadSites())
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null)

  useEffect(() => {
    saveSites(sites)
  }, [sites])

  function saveCurrentSite() {
    if (site.name.trim() === '') return
    const chargers = config.chargers.map((c) => ({ ...c }))
    if (selectedSiteId) {
      setSites((prev) =>
        prev.map((s) =>
          s.id === selectedSiteId
            ? { ...s, ...site, hours: config.hours, chargers }
            : s,
        ),
      )
    } else {
      const id = newSiteId()
      setSites((prev) => [
        ...prev,
        { id, ...site, hours: config.hours, chargers },
      ])
      setSelectedSiteId(id)
    }
  }

  function loadSite(s: SavedSite) {
    setSite({ name: s.name, address: s.address, households: s.households })
    // 저장된 요금·수량을 현재 5종 구조에 맞춰 반영
    const chargers = DEFAULT_CONFIG.chargers.map((base) => {
      const saved = s.chargers.find((c) => c.id === base.id)
      return { ...base, rate: saved?.rate ?? 0, count: saved?.count ?? 0 }
    })
    setConfig({ hours: s.hours || DEFAULT_CONFIG.hours, chargers })
    setSelectedSiteId(s.id)
  }

  function deleteSite(id: string) {
    setSites((prev) => prev.filter((s) => s.id !== id))
    if (selectedSiteId === id) setSelectedSiteId(null)
  }

  function newSite() {
    setSite(EMPTY_SITE)
    setConfig(cloneDefaultConfig())
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
        // 이용자 명부는 test/costel 판별에 이름·건물명이 필요하므로 원본 유지
        // (표시는 RegistryAnalysis가 개인정보를 숨김). 그 외는 개인정보 제거.
        const dataset = detectRegistry(raw) ? raw : stripPii(raw)
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
          <b>단지 정보와 충전기 설정을 먼저 입력</b>한 뒤 아래에서 CSV·Excel
          파일을 올리면, 파일명의 날짜로 자동 분류해 정산·이용률을 계산합니다.
          <br />
          데이터는 서버로 전송되지 않고 전부 브라우저 안에서만 처리됩니다.
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
              <SettlementAnalysis
                files={settlementFiles}
                config={config}
                site={site}
              />
            )}

            {registryFiles.length > 0 && (
              <RegistryAnalysis files={registryFiles} />
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
