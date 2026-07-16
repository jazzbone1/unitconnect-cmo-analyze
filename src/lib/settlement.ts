import type { CellValue, Dataset, FileEntry } from '../types'

/** 충전기 요금·구성 변수. 엑셀 분석 시트의 상수를 변수화한 것. */
export interface RateConfig {
  /** 7kW 충전기 요금 (원/kWh) — 엑셀 기본값 200 */
  rate7: number
  /** 50kW 충전기 요금 (원/kWh) — 엑셀 기본값 300 */
  rate50: number
  /** 7kW 충전기 수량 (기) — 기본 20 */
  count7: number
  /** 50kW 충전기 수량 (기) — 기본 3 */
  count50: number
  /** 월 가동 시간 (시간) — 기본 720 (=24×30) */
  hours: number
}

export const DEFAULT_CONFIG: RateConfig = {
  rate7: 200,
  rate50: 300,
  count7: 20,
  count50: 3,
  hours: 720,
}

/** 충전기 종류별 정격 용량(kW). 이용률(총 용량) 계산에 사용. */
const KW7 = 7
const KW50 = 50

/** 한 기간(파일)에 대한 정산 분석 결과 */
export interface SettlementMetrics {
  id: string
  fileName: string
  periodLabel: string
  sortKey: number
  /** 이용자 수 (데이터 행 수) */
  users: number
  /** 총 사용량 (kWh) */
  usageTotal: number
  /** 7kW 충전기 사용량 (kWh) */
  usage7: number
  /** 50kW 충전기 사용량 (kWh) */
  usage50: number
  /** 원본 파일의 사용금액 합계 (원) — 청구 기준 */
  amountRaw: number
  /** 재계산 사용금액 (원) = 7kW사용량×요금7 + 50kW사용량×요금50 */
  amountCalc: number
  /** 7kW 이용률 (%) */
  util7: number
  /** 50kW 이용률 (%) */
  util50: number
  /** 전체 이용률 (%) */
  utilTotal: number
}

function toNumber(value: CellValue): number | null {
  if (value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const cleaned = value.replace(/,/g, '')
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** 이름에 needle 중 하나라도 포함하는 첫 컬럼을 찾는다. */
function findCol(columns: string[], needles: string[]): string | null {
  for (const col of columns) {
    const c = col.replace(/\s/g, '')
    if (needles.some((n) => c.includes(n))) return col
  }
  return null
}

/** 데이터셋에 정산 스키마(사용량·사용금액)가 있는지 판별한다. */
export function detectSettlement(dataset: Dataset): boolean {
  const usage = findCol(dataset.columns, ['사용량'])
  const amount = findCol(dataset.columns, ['사용금액', '금액'])
  return usage !== null && amount !== null
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi)
}

/**
 * 한 정산 파일을 요금 설정에 따라 분석한다.
 * 각 사용자의 (총 사용량, 청구 사용금액)을 요금으로 역산해
 * 50kW / 7kW 사용량으로 분리한다.
 *   50kW사용량 = (사용금액 − 사용량×요금7) / (요금50 − 요금7)
 *   7kW사용량  = 사용량 − 50kW사용량
 */
export function computeFile(
  file: FileEntry,
  config: RateConfig,
): SettlementMetrics {
  const { dataset } = file
  const usageCol = findCol(dataset.columns, ['사용량'])
  const amountCol = findCol(dataset.columns, ['사용금액', '금액'])
  const denom = config.rate50 - config.rate7

  let users = 0
  let usageTotal = 0
  let usage7 = 0
  let usage50 = 0
  let amountRaw = 0

  for (const row of dataset.rows) {
    const usage = usageCol ? toNumber(row[usageCol] ?? null) : null
    if (usage === null) continue // 사용량 없는 행은 이용자로 세지 않음
    users += 1
    usageTotal += usage
    const amount = amountCol ? toNumber(row[amountCol] ?? null) : null
    if (amount !== null) amountRaw += amount

    // 요금 차이가 없거나 사용금액이 없으면 전량 7kW로 간주
    let u50 = 0
    if (denom > 0 && amount !== null) {
      u50 = clamp((amount - usage * config.rate7) / denom, 0, usage)
    }
    usage50 += u50
    usage7 += usage - u50
  }

  const amountCalc = usage7 * config.rate7 + usage50 * config.rate50
  // 범위·연간 파일은 여러 달을 누적하므로 용량도 개월수만큼 곱한다.
  const months = file.period?.months ?? 1
  const cap7 = KW7 * config.count7 * config.hours * months
  const cap50 = KW50 * config.count50 * config.hours * months
  const capTotal = cap7 + cap50

  return {
    id: file.id,
    fileName: dataset.fileName,
    periodLabel: file.period?.label ?? dataset.fileName,
    sortKey: file.period?.sortKey ?? Number.POSITIVE_INFINITY,
    users,
    usageTotal,
    usage7,
    usage50,
    amountRaw,
    amountCalc,
    util7: cap7 > 0 ? (usage7 / cap7) * 100 : 0,
    util50: cap50 > 0 ? (usage50 / cap50) * 100 : 0,
    utilTotal: capTotal > 0 ? (usageTotal / capTotal) * 100 : 0,
  }
}

/** 여러 정산 파일을 분석하고 기간순으로 정렬해 반환한다. */
export function computeAll(
  files: FileEntry[],
  config: RateConfig,
): SettlementMetrics[] {
  return files
    .map((f) => computeFile(f, config))
    .sort((a, b) => {
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey
      return a.fileName.localeCompare(b.fileName)
    })
}
