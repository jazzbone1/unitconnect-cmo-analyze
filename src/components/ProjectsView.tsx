import { useEffect, useMemo, useState } from 'react'
import type { SavedSite } from '../lib/sites'
import { usePersistentState } from '../lib/persist'
import { DEFAULT_CONFIG, type SettlementConfig } from '../lib/settlement'
import { detectSettlement, computeAll } from '../lib/settlement'
import {
  DEFAULT_INPUTS,
  computeFeasibility,
  type FeasibilityInputs,
} from '../lib/feasibility'
import { detectRegistry, computeRegistry } from '../lib/registry'
import { parseUploadedFiles } from '../lib/ingest'
import {
  defaultReport,
  makeElecGroup,
  type ReportModel,
} from '../lib/report'
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
  tariff?: TariffInputs,
  standby?: StandbyInputs,
): ReportModel {
  const d = defaultReport()
  d.siteName = project.name
  const total = config.chargers.reduce((a, c) => a + c.count, 0)
  const active = config.chargers.filter((c) => c.count > 0)
  const breakdown = active.map((c) => `${c.name} ${c.count}`).join(' + ')

  // 현행 요금 문자열(완속/급속) 자동 구성
  const slow = active.filter((c) => c.kw <= 7 && c.rate > 0)
  const fast = active.filter((c) => c.kw >= 50 && c.rate > 0)
  const rateParts: string[] = []
  if (slow.length) rateParts.push(`완속 ${Math.round(slow[0].rate)}원`)
  if (fast.length) rateParts.push(`급속 ${Math.round(fast[0].rate)}원`)
  const currentRateText = rateParts.join(' / ')

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
    if (row.label === '현행 요금')
      return { ...row, value: currentRateText }
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

  // 월 평균 총 충전량(운영비 원/kWh 산출 분모)
  const avgMonthlyKwh = months.length
    ? Math.round(months.reduce((a, m) => a + m.usageTotal, 0) / months.length)
    : 0
  if (avgMonthlyKwh > 0) d.opexBaseKwh = avgMonthlyKwh

  // 요금 구조(요금 구조 탭) 값 자동반영 → 그룹 A(모자분리) 전기원가
  if (tariff) {
    const installedKw = config.chargers.reduce((a, c) => a + c.kw * c.count, 0)
    const tr = computeTariff({ ...tariff, installedKw })
    const effCost = tr.selected.effCost
    d.groupA = {
      ...d.groupA,
      contractKw: tariff.contractKw || d.groupA.contractKw,
      monthlyKwh: tariff.monthlyKwh || avgMonthlyKwh || d.groupA.monthlyKwh,
      // 요금 구조 탭에서 산출된 실효원가를 직접입력(Lv1)으로 자동 반영
      lv1Override: Number.isFinite(effCost) ? Math.round(effCost * 10) / 10 : null,
    }
    // 그룹 B(모자분리 미적용) 계약전력 = 전체 설비용량 합산값(installedKw) 자동 반영.
    if (installedKw > 0) d.groupB = { ...d.groupB, contractKw: installedKw }
    if (fast.length || slow.length) {
      d.groupA.currentRate = (fast[0]?.rate ?? slow[0]?.rate ?? d.groupA.currentRate)
    }
    if (slow.length) d.groupB.currentRate = slow[0].rate
  }
  // 모자분리 미적용 종류의 월 대기전력량(공용부 부과 손실분) 자동 반영(하위호환 groupB)
  if (standby) {
    const nonSep = nonSepStandbyKwh(config.chargers, standby)
    if (nonSep > 0) d.groupB = { ...d.groupB, standbyKwh: Math.round(nonSep) }
  }

  // ── 등록 충전기 종류별 전기원가 분석 그룹 ──
  const effCostSeed =
    tariff != null
      ? computeTariff({
          ...tariff,
          installedKw: config.chargers.reduce((a, c) => a + c.kw * c.count, 0),
        }).selected.effCost
      : null
  d.elecGroups = active.map((c) => {
    const usageAvg = months.length
      ? Math.round((usageByType.get(c.id) ?? 0) / months.length)
      : 0
    const sep = !!c.separated
    const standbyKwh =
      !sep && standby
        ? Math.round(computeStandby([c], standby, 0).totalKwh)
        : 0
    const g = makeElecGroup({
      id: c.id,
      name: c.name,
      kw: c.kw,
      count: c.count,
      separated: sep,
      monthlyKwh: usageAvg,
      currentRate: c.rate,
      standbyKwh,
    })
    // 모자분리 종류는 요금구조 실효원가를 직접입력(Lv1)으로 자동 반영
    if (sep && effCostSeed != null && Number.isFinite(effCostSeed)) {
      g.lv1Override = Math.round(effCostSeed * 10) / 10
    }
    return g
  })
  return d
}

/** 모자분리 미적용(비모자분리) 종류의 월 대기전력량 합계 (kWh) */
function nonSepStandbyKwh(
  chargers: SettlementConfig['chargers'],
  standby: StandbyInputs,
): number {
  return computeStandby(
    chargers.filter((c) => c.count > 0 && !c.separated),
    standby,
    0,
  ).totalKwh
}

/** 프로젝트로부터 요금 구조(계약전력·월충전량) 기본값을 유도 */
function deriveTariff(project: SavedSite): TariffInputs {
  if (project.tariff) return project.tariff
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
}

/** 앞 단계 자동 연동(음영) 필드만 보고서에 반영, 직접입력 필드는 보존 */
function mergeLinked(m: ReportModel, s: ReportModel): ReportModel {
  const byLabel = new Map(s.overview.map((r) => [r.label, r]))
  const linkedLabels = ['세대수', '충전기', '현행 요금']
  const overview = m.overview.map((row) => {
    if (linkedLabels.includes(row.label)) {
      const src = byLabel.get(row.label)
      if (src)
        return {
          ...row,
          value: src.value,
          note: row.label === '충전기' ? src.note : row.note,
        }
    }
    return row
  })
  return {
    ...m,
    siteName: s.siteName || m.siteName,
    overview,
    perType: s.perType,
    monthly: s.monthly,
    opexBaseKwh: s.opexBaseKwh,
    groupA: {
      ...m.groupA,
      contractKw: s.groupA.contractKw,
      monthlyKwh: s.groupA.monthlyKwh,
      lv1Override: s.groupA.lv1Override,
      currentRate: s.groupA.currentRate,
    },
    groupB: {
      ...m.groupB,
      contractKw: s.groupB.contractKw,
      currentRate: s.groupB.currentRate,
      standbyKwh: s.groupB.standbyKwh,
    },
    // 등록 종류별 그룹: 자동연동 필드(대수·사용량·현행요금·모자분리·대기전력)만
    // 갱신, 직접입력 필드(전력량요금·기후·부가세·기본단가·계약전력·Lv1)는 보존.
    elecGroups: (s.elecGroups ?? []).map((sg) => {
      const prev = (m.elecGroups ?? []).find((g) => g.id === sg.id)
      if (!prev) return sg
      return {
        ...prev,
        name: sg.name,
        kw: sg.kw,
        count: sg.count,
        separated: sg.separated,
        monthlyKwh: sg.monthlyKwh,
        currentRate: sg.currentRate,
        standbyKwh: sg.standbyKwh,
      }
    }),
  }
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
        deriveTariff(project),
        project.standby ?? defaultStandby(),
      ),
  )
  const [tariff, setTariff] = useState<TariffInputs>(() => deriveTariff(project))
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

  // 총 설비용량(kW)
  const installedKw = useMemo(
    () => config.chargers.reduce((a, c) => a + c.kw * c.count, 0),
    [config],
  )
  // 사업성 분석 월 사용량 합산치 = Σ(종류 이용률 × 정격 × 720 × 대수)
  const feasMonthlyKwh = useMemo(() => {
    const countOf = (kw: number) =>
      config.chargers.find((c) => c.kw === kw)?.count ?? 0
    const rows: [number, keyof FeasibilityInputs][] = [
      [100, 'utilFast100'],
      [50, 'utilFast50'],
      [7, 'utilSlow7'],
      [3.5, 'utilSlow35'],
      [3, 'utilSlow3'],
    ]
    return rows.reduce(
      (a, [kw, key]) =>
        a + ((feas[key] as number) || 0) * kw * 720 * countOf(kw),
      0,
    )
  }, [feas, config])
  // 요금 구조 탭 월 총 충전량: override 있으면 우선, 없으면 사업성 월사용량 자동
  const effMonthlyKwh =
    tariff.monthlyKwhOverride != null &&
    Number.isFinite(tariff.monthlyKwhOverride)
      ? (tariff.monthlyKwhOverride as number)
      : Math.round(feasMonthlyKwh)
  // 요금 구조 결과(실효원가·계약전력)
  const tariffEff = useMemo(
    () => computeTariff({ ...tariff, installedKw, monthlyKwh: effMonthlyKwh }),
    [tariff, installedKw, effMonthlyKwh],
  )
  const autoElecCost = tariffEff.selected.effCost

  // 연차별 전기원가 모델 (부하율 고정: 이용률↑ → 충전량↑·계약전력↑)
  //  - 연차 월충전량 = 사업성 yearlyW
  //  - 계약전력_N = 월충전량_N ÷ (부하율 × 720)  (부하율=1년차 기준 유지)
  //  - 실효원가_N = 요금구조 재산정(계약전력_N, 월충전량_N)
  const elecYearModel = useMemo(() => {
    const countOf = (kw: number) =>
      config.chargers.find((c) => c.kw === kw)?.count ?? 0
    const effFeas: FeasibilityInputs = {
      ...feas,
      countFast100: countOf(100),
      countFast50: countOf(50),
      countSlow7: countOf(7),
      countSlow35: countOf(3.5),
      countSlow3: countOf(3),
    }
    const yearlyW = computeFeasibility(effFeas).yearlyW
    const contractKw1 = tariffEff.contractKw
    const mk1 = yearlyW[0] || effMonthlyKwh || 1
    const lf1 = contractKw1 > 0 ? mk1 / (contractKw1 * 720) : 0
    // 'loadFactorFixed': 부하율 유지 → 계약전력 충전량 비례 증설
    // 'demandFixed'(기본): 수용률·계약전력 고정 → 부하율 상승·실효원가 하락
    const mode = feas.elecYearMode ?? 'demandFixed'
    return yearlyW.map((mk) => {
      const contractKw =
        mode === 'loadFactorFixed'
          ? lf1 > 0
            ? mk / (lf1 * 720)
            : contractKw1
          : contractKw1
      const loadFactorN = contractKw > 0 ? mk / (contractKw * 720) : 0
      const effCost = computeTariff({
        ...tariff,
        installedKw: undefined,
        contractRatio: undefined,
        contractKw,
        monthlyKwh: mk,
      }).selected.effCost
      return { monthlyKwh: mk, contractKw, effCost, loadFactor: loadFactorN }
    })
  }, [feas, config, tariff, tariffEff, effMonthlyKwh])

  // 앞 단계(단지정보·충전기 요금·요금구조·정산) 변경 시 보고서의 자동 연동(음영)
  // 필드를 실시간 반영한다. 직접입력 필드는 보존.
  const linkedSeed = useMemo(
    () =>
      seedReport(
        {
          name: site.name,
          households: site.households,
        } as SavedSite,
        config,
        files,
        tariff,
        standby,
      ),
    [site.name, site.households, config, files, tariff, standby],
  )
  useEffect(() => {
    setReport((m) => mergeLinked(m, linkedSeed))
  }, [linkedSeed])

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
        <ReportView
          model={report}
          setModel={setReport}
          autoSeed={() =>
            seedReport(
              { ...project, name: site.name, households: site.households },
              config,
              files,
              tariff,
              standby,
            )
          }
        />
      ) : subtab === 'tariff' ? (
        <TariffAnalysis
          inputs={{ ...tariff, installedKw, monthlyKwh: effMonthlyKwh }}
          setInputs={setTariff}
          autoMonthlyKwh={Math.round(feasMonthlyKwh)}
        />
      ) : subtab === 'standby' ? (
        <StandbyAnalysis
          chargers={config.chargers}
          inputs={standby}
          setInputs={setStandby}
          effCost={autoElecCost}
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
          autoElecCost={autoElecCost}
          elecYearModel={elecYearModel}
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
