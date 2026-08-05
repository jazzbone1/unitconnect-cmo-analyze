import type { CellValue, Dataset, FileEntry, Period } from '../types'

/** 충전기 종류 하나의 설정 */
export interface ChargerType {
  /** 안정적인 식별자 */
  id: string
  /** 표시 이름 (예: "7kW") */
  name: string
  /** 정격 용량 (kW) — 이용률의 분모(총 용량) 계산에 사용 */
  kw: number
  /** 요금 (원/kWh) */
  rate: number
  /** 수량 (기) */
  count: number
  /** 모자분리(모자분리계량) 적용 여부. 이후 보고서를 분리 발행하는 기준. */
  separated?: boolean
  /**
   * 사업성/전기원가 분석에서 제외 여부. true면 이 종류를 대수 0으로 취급하여
   * 사업성·요금구조·전기원가·대기전력 등 모든 계산에서 빠진다(설정값은 보존).
   */
  excluded?: boolean
}

/** 충전기 정산 분석 설정. 충전기 종류 목록 + 월 가동시간. */
export interface SettlementConfig {
  chargers: ChargerType[]
  /** 월 가동 시간 (시간) — 기본 720 (=24×30) */
  hours: number
}

/** 고정 충전기 종류 5종. 정격(kW)은 고정, 요금·수량만 입력한다. */
export const CHARGER_KW: { id: string; name: string; kw: number }[] = [
  { id: 'c3', name: '3kW', kw: 3 },
  { id: 'c35', name: '3.5kW', kw: 3.5 },
  { id: 'c7', name: '7kW', kw: 7 },
  { id: 'c50', name: '50kW', kw: 50 },
  { id: 'c100', name: '100kW', kw: 100 },
]

// 요금·수량은 현장마다 다르므로 기본값은 비워둔다(0). 사용자가 현장별로 입력.
export const DEFAULT_CONFIG: SettlementConfig = {
  chargers: CHARGER_KW.map((c) => ({ ...c, rate: 0, count: 0, separated: false })),
  hours: 720,
}

/** 충전기 종류별 계산 결과 */
export interface TypeMetric {
  id: string
  name: string
  /** 이 종류의 사용량 (kWh) */
  usage: number
  /** 이 종류의 사용금액 (원) = 사용량 × 요금 */
  amount: number
  /** 이 종류의 이용률 (%) */
  utilization: number
}

/** 한 기간(파일)에 대한 정산 분석 결과 */
export interface SettlementMetrics {
  id: string
  fileName: string
  periodLabel: string
  sortKey: number
  periodType: Period['type']
  /** 이용률 환산에 사용한 분석 개월 수 */
  months: number
  /** 이용자 수 (사용량이 있는 행 수) */
  users: number
  /** 총 사용량 (kWh) */
  usageTotal: number
  /** 원본 파일의 사용금액 합계 (원) */
  amountRaw: number
  /** 재계산 사용금액 (원) = Σ(종류별 사용량 × 요금) */
  amountCalc: number
  /** 전체 이용률 (%) */
  utilTotal: number
  /** 충전기 종류별 지표 */
  types: TypeMetric[]
  /** 종류별 사용량 분리가 가능했는지 */
  splittable: boolean
  /** 분리 방식: auto=자동 역산/컬럼, manual=직접 입력, none=분리 불가 */
  splitMode: 'auto' | 'manual' | 'estimate' | 'none'
}

function toNumber(value: CellValue): number | null {
  if (value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const cleaned = value.replace(/,/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** 공백 제거 + 소문자화 정규화 */
function norm(s: string): string {
  return s.replace(/\s/g, '').toLowerCase()
}

/** 이름에 needle 중 하나라도 포함하는 첫 컬럼을 찾는다. */
function findCol(
  columns: string[],
  needles: string[],
  exclude: Set<string> = new Set(),
): string | null {
  for (const col of columns) {
    if (exclude.has(col)) continue
    const c = norm(col)
    if (needles.some((n) => c.includes(norm(n)))) return col
  }
  return null
}

/** 데이터셋에 정산 스키마(사용량·사용금액)가 있는지 판별한다. */
export function detectSettlement(dataset: Dataset): boolean {
  const usage = findCol(dataset.columns, ['사용량'])
  const amount = findCol(dataset.columns, ['사용금액', '금액'])
  return usage !== null && amount !== null
}

/** 충전기 종류별 명시 사용량 컬럼(예: "7kW사용량")을 찾는다. */
function explicitTypeCol(columns: string[], type: ChargerType): string | null {
  const target = norm(type.name) + '사용량'
  for (const col of columns) {
    if (norm(col) === target) return col
  }
  return null
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi)
}

/**
 * 한 정산 파일을 설정에 따라 분석한다.
 *
 * 종류별 사용량 분리 규칙:
 *  1) 데이터에 종류별 사용량 컬럼("7kW사용량" 등)이 모두 있으면 그대로 사용
 *  2) 없고 종류가 정확히 2개면 요금으로 역산:
 *       높은요금 종류 사용량 = (사용금액 − 사용량×낮은요금) / (높은요금 − 낮은요금)
 *  3) 그 외(종류 3개 이상 + 명시 컬럼 없음)는 분리 불가 → 총계만 계산
 */
export function computeFile(
  file: FileEntry,
  config: SettlementConfig,
  monthsOverride?: number,
  manualUsage?: Record<string, number>,
  /** 종류별 자동 비례 배분 가중치(정격×대수×가정이용률 등). 3종류 이상에서 사용. */
  autoWeights?: Record<string, number>,
): SettlementMetrics {
  const { dataset } = file
  const chargers = config.chargers
  const months =
    monthsOverride && monthsOverride > 0
      ? monthsOverride
      : file.period?.months ?? 1

  const explicitCols = new Map<string, string>()
  for (const t of chargers) {
    const col = explicitTypeCol(dataset.columns, t)
    if (col) explicitCols.set(t.id, col)
  }
  const hasAllExplicit =
    chargers.length > 0 && chargers.every((t) => explicitCols.has(t.id))

  // 총 사용량 컬럼: 종류별 명시 컬럼은 제외하고 찾는다.
  const excludeSet = new Set(explicitCols.values())
  const usageCol =
    findCol(dataset.columns, ['총사용량'], excludeSet) ||
    findCol(dataset.columns, ['사용량(kwh)'], excludeSet) ||
    findCol(dataset.columns, ['사용량'], excludeSet)
  const amountCol = findCol(dataset.columns, ['사용금액', '금액'])

  const usageByType = new Map<string, number>()
  for (const t of chargers) usageByType.set(t.id, 0)

  let users = 0
  let usageTotal = 0
  let amountRaw = 0

  // 요금이 지정된(활성) 종류만 사용량 분리에 참여한다.
  const active = chargers.filter((t) => t.rate > 0)
  const sorted = [...active].sort((a, b) => a.rate - b.rate)
  const low = sorted[0]
  const high = sorted[1]
  const denom = active.length === 2 ? high.rate - low.rate : 0

  // 자동 비례 배분 가중치 합(활성 종류 기준). 3종류 이상 등에서 사용.
  const weightSum = autoWeights
    ? active.reduce((a, t) => a + (autoWeights[t.id] ?? 0), 0)
    : 0
  // 자동 분리 가능 여부: 종류별 명시 컬럼 전부 존재 > 활성 1종 전량 >
  //  활성 2종 요금역산 > (그 외) 가중치 비례 배분(3종류 이상 등)
  const canProportion =
    !hasAllExplicit &&
    !(active.length === 1) &&
    !(active.length === 2 && denom > 0) &&
    weightSum > 0

  for (const row of dataset.rows) {
    const usage = usageCol ? toNumber(row[usageCol] ?? null) : null
    if (usage === null) continue
    users += 1
    usageTotal += usage
    const amount = amountCol ? toNumber(row[amountCol] ?? null) : null
    if (amount !== null) amountRaw += amount

    if (hasAllExplicit) {
      for (const t of chargers) {
        const c = explicitCols.get(t.id)!
        const v = toNumber(row[c] ?? null) ?? 0
        usageByType.set(t.id, (usageByType.get(t.id) ?? 0) + v)
      }
    } else if (active.length === 1) {
      usageByType.set(low.id, (usageByType.get(low.id) ?? 0) + usage)
    } else if (active.length === 2 && denom > 0) {
      const uHigh =
        amount !== null ? clamp((amount - usage * low.rate) / denom, 0, usage) : 0
      usageByType.set(high.id, (usageByType.get(high.id) ?? 0) + uHigh)
      usageByType.set(low.id, (usageByType.get(low.id) ?? 0) + (usage - uHigh))
    } else if (canProportion) {
      // 총 사용량을 종류별 가중치 비중으로 배분(총량 보존)
      for (const t of active) {
        const share = (autoWeights![t.id] ?? 0) / weightSum
        usageByType.set(t.id, (usageByType.get(t.id) ?? 0) + usage * share)
      }
    }
  }

  // 종류별 사용량 직접 입력(수동)이 있으면 자동값을 덮어쓴다.
  let manualApplied = false
  if (manualUsage) {
    for (const [cid, val] of Object.entries(manualUsage)) {
      if (Number.isFinite(val)) {
        usageByType.set(cid, val)
        manualApplied = true
      }
    }
  }
  const exactAuto =
    hasAllExplicit ||
    active.length === 1 ||
    (active.length === 2 && denom > 0)
  const splitMode: 'auto' | 'manual' | 'estimate' | 'none' = manualApplied
    ? 'manual'
    : exactAuto
      ? 'auto'
      : canProportion
        ? 'estimate'
        : 'none'
  const splittable = splitMode !== 'none'

  const types: TypeMetric[] = chargers.map((t) => {
    const raw = usageByType.get(t.id) ?? 0
    // 요금 역산 시 부동소수점 오차로 생기는 극소값(≈0)은 0으로 정리
    const usage = Math.abs(raw) < 1e-6 ? 0 : raw
    const capacity = t.kw * t.count * config.hours * months
    return {
      id: t.id,
      name: t.name,
      usage,
      amount: usage * t.rate,
      utilization: capacity > 0 ? (usage / capacity) * 100 : 0,
    }
  })

  const amountCalc = splittable
    ? types.reduce((acc, t) => acc + t.amount, 0)
    : amountRaw
  const capTotal =
    chargers.reduce((acc, t) => acc + t.kw * t.count, 0) * config.hours * months

  return {
    id: file.id,
    fileName: dataset.fileName,
    periodLabel: file.period?.label ?? dataset.fileName,
    sortKey: file.period?.sortKey ?? Number.POSITIVE_INFINITY,
    periodType: file.period?.type ?? 'unknown',
    months,
    users,
    usageTotal,
    amountRaw,
    amountCalc,
    utilTotal: capTotal > 0 ? (usageTotal / capTotal) * 100 : 0,
    types,
    splittable,
    splitMode,
  }
}

/** 여러 정산 파일을 분석하고 기간순으로 정렬해 반환한다. */
export function computeAll(
  files: FileEntry[],
  config: SettlementConfig,
  monthsById: Record<string, number> = {},
  manualUsageById: Record<string, Record<string, number>> = {},
  autoWeights?: Record<string, number>,
): SettlementMetrics[] {
  return files
    .map((f) =>
      computeFile(
        f,
        config,
        monthsById[f.id],
        manualUsageById[f.id],
        autoWeights,
      ),
    )
    .sort((a, b) => {
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey
      return a.fileName.localeCompare(b.fileName)
    })
}
