import type { Dataset, CostelAgg, PerChargerUsage, FileEntry } from '../types'

/**
 * 코스텔 충전내역관리 프로그램 내보내기(거래 단위 로그) 어댑터.
 *
 * 기존 정산 형식(세대별 월 사용량이 미리 집계된 CSV)과 달리, 코스텔 충전내역은
 * 충전 '건별' 로그다(시작일시·충전량(kWh)·비용(원)·충전기구분(AC/DC/SOCKET)·동호).
 * 이 모듈은 코스텔 파일을 감지하고, 충전기 구분/모델로 종류(kW)를 추정한다.
 * 실제 월별 집계는 settlement.ts의 computeCostelFile 에서 수행한다.
 */

/** 공백 제거 + 소문자화 정규화 */
function norm(s: string): string {
  return s.replace(/\s/g, '').toLowerCase()
}

/** 이름에 needle 중 하나라도 포함하는 첫 컬럼을 찾는다. */
export function findCostelCol(
  columns: string[],
  needles: string[],
): string | null {
  for (const col of columns) {
    const c = norm(col)
    if (needles.some((n) => c.includes(norm(n)))) return col
  }
  return null
}

/** 코스텔 충전내역(거래 단위) 데이터셋인지 판별한다. */
export function detectCostel(dataset: Dataset): boolean {
  const cols = dataset.columns
  const hasEnergy = findCostelCol(cols, ['충전량', 'charging_energy']) !== null
  const hasType = findCostelCol(cols, ['충전기구분', 'charger_type']) !== null
  const hasStart = findCostelCol(cols, ['시작일시', 'charging_start']) !== null
  return hasEnergy && hasType && hasStart
}

/** 거래 로그의 주요 컬럼명 매핑(한글 우선, 없으면 원본 영문). */
export interface CostelCols {
  energy: string | null
  cost: string | null
  type: string | null
  model: string | null
  start: string | null
  end: string | null
  dong: string | null
  noncharge: string | null
}
export function costelCols(dataset: Dataset): CostelCols {
  const c = dataset.columns
  return {
    energy: findCostelCol(c, ['충전량', 'charging_energy']),
    cost: findCostelCol(c, ['비용', 'payment_fee', 'charging_cost']),
    type: findCostelCol(c, ['충전기구분', 'charger_type']),
    model: findCostelCol(c, ['충전기모델', 'charger_model', 'model']),
    start: findCostelCol(c, ['시작일시', 'charging_start']),
    end: findCostelCol(c, ['종료일시', 'charging_end']),
    dong: findCostelCol(c, ['동호', 'customer_dong']),
    noncharge: findCostelCol(c, ['미충전', 'non_start_charging']),
  }
}

/**
 * 충전기 구분(AC/DC/SOCKET)과 모델코드로 종류(kW)를 추정한다.
 *  - SOCKET/콘센트 → 3kW (콘센트형 표준)
 *  - AC/완속 → 모델에 3.5 힌트 있으면 3.5kW, 아니면 7kW
 *  - DC/급속 → 모델에 100/200 힌트 있으면 100kW, 아니면 50kW
 * 앱의 고정 5종(3/3.5/7/50/100) 범위로 anchor 되어, 추정 실패해도
 * 구분 기준 안전한 기본값으로 수렴한다.
 */
export function chargerKwFromModelType(
  model: string | null | undefined,
  type: string | null | undefined,
): number {
  const t = norm(String(type ?? ''))
  const m = norm(String(model ?? ''))
  const isSocket = t.includes('socket') || t.includes('콘센트')
  const isDC = t.includes('dc') || t.includes('급속')
  const isAC = t.includes('ac') || t.includes('완속')
  if (isSocket) return 3
  if (isDC) {
    if (m.includes('200') || m.includes('100')) return 100
    return 50
  }
  if (isAC) {
    if (m.includes('3.5') || m.includes('35')) return 3.5
    return 7
  }
  // 구분 불명: 모델 숫자 힌트로 최후 추정
  if (m.includes('100') || m.includes('50')) return 50
  if (m.includes('3.5')) return 3.5
  return 7
}

/** 시작일시 문자열에서 'YYYY-MM' 과 정렬키(YYYYMM01)를 뽑는다. 실패 시 null. */
export function monthKeyOf(
  value: unknown,
): { ym: string; sortKey: number } | null {
  const s = String(value ?? '').trim()
  const m = s.match(/(\d{4})[-./](\d{1,2})/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  if (!(y >= 2000 && mo >= 1 && mo <= 12)) return null
  const ym = `${y}-${String(mo).padStart(2, '0')}`
  return { ym, sortKey: y * 10000 + mo * 100 + 1 }
}

/** 테스트/더미 세대(동호) 판별 — 999동·1234동 등 명백한 테스트값 제외용. */
export function isTestDong(dong: unknown): boolean {
  const s = String(dong ?? '').replace(/\s/g, '')
  if (s === '') return true
  return /999|1234/.test(s)
}

/**
 * 코스텔 충전내역을 분석에 필요한 컬럼만 남기고 슬림화한다(원본 ~50열 → ~9열).
 * 저장 payload·스토리지·개인정보(카드번호 등 제거)를 크게 줄인다.
 * 코스텔 형식이 아니면 원본 그대로 반환.
 */
export function slimCostelDataset(dataset: Dataset): Dataset {
  if (!detectCostel(dataset)) return dataset
  const cols = costelCols(dataset)
  const nameCol = findCostelCol(dataset.columns, ['충전기명', 'charger_name'])
  const idCol =
    dataset.columns.find((c) => norm(c) === 'id') ??
    findCostelCol(dataset.columns, ['history_id', 'transaction_id'])
  const keep = new Set<string>()
  for (const c of [
    cols.start,
    cols.end,
    cols.energy,
    cols.cost,
    cols.type,
    cols.model,
    cols.dong,
    cols.noncharge,
    nameCol,
    idCol,
  ])
    if (c) keep.add(c)
  if (keep.size === 0) return dataset
  const columns = dataset.columns.filter((c) => keep.has(c))
  const rows = dataset.rows.map((r) => {
    const o: Record<string, import('../types').CellValue> = {}
    for (const c of columns) o[c] = r[c] ?? null
    return o
  })
  return { ...dataset, columns, rows }
}

function toNum(v: unknown): number | null {
  if (v == null) return null
  const n = Number(String(v).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** 'YYYY-MM-DD HH:MM:SS' 등을 Date로. 실패 시 null. */
function parseDateTime(v: unknown): Date | null {
  const s = String(v ?? '').trim().replace(' ', 'T')
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}
/** [start,end] 구간을 시간대(0~23)별 '분'으로 분배해 arr[h]에 누적. */
function spreadMinutes(start: Date, end: Date, arr: number[]): void {
  if (end <= start) return
  // 과도한 루프 방지(이상치): 최대 31일
  const cap = start.getTime() + 31 * 24 * 3600 * 1000
  let t = start.getTime()
  const endMs = Math.min(end.getTime(), cap)
  while (t < endMs) {
    const d = new Date(t)
    const h = d.getHours()
    const next = new Date(d)
    next.setMinutes(60, 0, 0)
    const seg = (Math.min(endMs, next.getTime()) - t) / 60000
    arr[h] += seg
    t = Math.min(endMs, next.getTime())
  }
}

/**
 * 코스텔 충전내역 데이터셋들을 한 번에 집계한다(월별 + 충전기별 + 시간대 + 연간).
 *  - 거래 고유 id 로 중복 제거(전체 파일 + 월별 파일을 함께 올려도 중복 합산 방지)
 *  - 미충전·테스트 동호·충전량 0 제외
 * 결과(CostelAgg)는 원본 행 대신 저장 가능한 소형 요약이다.
 */
export function buildCostelAgg(datasets: Dataset[]): CostelAgg {
  interface M {
    ym: string
    sortKey: number
    users: Set<string>
    amountRaw: number
    usageTotal: number
    byKw: Map<number, number>
    byKwAmount: Map<number, number>
    hourByKw: Map<number, number[]>
    dates: Set<string>
  }
  const months = new Map<string, M>()
  const byName = new Map<string, PerChargerUsage>()
  const seenIds = new Set<string>()
  for (const ds of datasets) {
    const cols = costelCols(ds)
    const nameCol = findCostelCol(ds.columns, ['충전기명', 'charger_name'])
    if (!cols.energy || !cols.start) continue
    const idCol =
      ds.columns.find((c) => norm(c) === 'id') ??
      findCostelCol(ds.columns, ['history_id', 'transaction_id'])
    for (const row of ds.rows) {
      if (
        cols.noncharge &&
        String(row[cols.noncharge] ?? '').trim().toUpperCase() === 'Y'
      )
        continue
      const e = toNum(row[cols.energy])
      if (e === null || e <= 0) continue
      const dong = cols.dong ? row[cols.dong] : null
      if (isTestDong(dong)) continue
      if (idCol) {
        const id = String(row[idCol] ?? '').trim()
        if (id !== '') {
          const key = `${idCol}:${id}`
          if (seenIds.has(key)) continue
          seenIds.add(key)
        }
      }
      const mk = monthKeyOf(row[cols.start])
      if (!mk) continue
      const type = cols.type ? String(row[cols.type] ?? '').trim() : ''
      const kw = chargerKwFromModelType(
        cols.model ? String(row[cols.model] ?? '') : '',
        type,
      )
      const cost = cols.cost ? toNum(row[cols.cost]) ?? 0 : 0

      // 월별
      let m = months.get(mk.ym)
      if (!m) {
        m = {
          ym: mk.ym,
          sortKey: mk.sortKey,
          users: new Set(),
          amountRaw: 0,
          usageTotal: 0,
          byKw: new Map(),
          byKwAmount: new Map(),
          hourByKw: new Map(),
          dates: new Set(),
        }
        months.set(mk.ym, m)
      }
      m.byKw.set(kw, (m.byKw.get(kw) ?? 0) + e)
      m.byKwAmount.set(kw, (m.byKwAmount.get(kw) ?? 0) + cost)
      m.usageTotal += e
      m.amountRaw += cost
      if (dong != null) m.users.add(String(dong).replace(/\s/g, ''))
      // 시간대 프로파일: [시작,종료] 구간을 시간대별 분으로 분배
      const sdt = parseDateTime(row[cols.start])
      const edt = cols.end ? parseDateTime(row[cols.end]) : null
      if (sdt) {
        m.dates.add(
          `${sdt.getFullYear()}-${sdt.getMonth()}-${sdt.getDate()}`,
        )
        let arr = m.hourByKw.get(kw)
        if (!arr) {
          arr = new Array(24).fill(0)
          m.hourByKw.set(kw, arr)
        }
        if (edt && edt > sdt) spreadMinutes(sdt, edt, arr)
        else arr[sdt.getHours()] += 1 // 종료 없거나 0분: 시작 시각에 1분만
      }

      // 충전기별
      const name = nameCol ? String(row[nameCol] ?? '').trim() || '(미상)' : '(미상)'
      const prev = byName.get(name)
      if (prev) {
        prev.kwh += e
        prev.amount += cost
        prev.count += 1
      } else {
        byName.set(name, { name, type, kw, kwh: e, amount: cost, rate: 0, count: 1 })
      }
    }
  }
  const chargers = [...byName.values()]
  for (const c of chargers) c.rate = c.kwh > 0 ? c.amount / c.kwh : 0
  chargers.sort((a, b) => b.kwh - a.kwh)

  const hourlyOf = (m: M): CostelAgg['months'][number]['hourly'] => ({
    byHourByKw: Object.fromEntries(
      [...m.hourByKw.entries()].map(([k, v]) => [
        String(k),
        v.map((x) => Math.round(x)),
      ]),
    ),
    days: m.dates.size,
  })
  const sortedM = [...months.values()].sort((a, b) => a.sortKey - b.sortKey)
  const monthsOut = sortedM.map((m) => ({
    ym: m.ym,
    sortKey: m.sortKey,
    users: m.users.size,
    amountRaw: m.amountRaw,
    usageTotal: m.usageTotal,
    byKw: Object.fromEntries([...m.byKw.entries()].map(([k, v]) => [String(k), v])),
    byKwAmount: Object.fromEntries(
      [...m.byKwAmount.entries()].map(([k, v]) => [String(k), v]),
    ),
    hourly: hourlyOf(m),
  }))

  // 최근 12개월 연간 집계(월이 2개 이상일 때만)
  let annual: CostelAgg['annual']
  if (sortedM.length >= 2) {
    const last12 = sortedM.slice(-12)
    const byKw = new Map<number, number>()
    const byKwAmount = new Map<number, number>()
    const hourByKw = new Map<number, number[]>()
    const users = new Set<string>()
    let usageTotal = 0
    let amountRaw = 0
    let days = 0
    for (const m of last12) {
      usageTotal += m.usageTotal
      amountRaw += m.amountRaw
      days += m.dates.size
      for (const u of m.users) users.add(u)
      for (const [k, v] of m.byKw) byKw.set(k, (byKw.get(k) ?? 0) + v)
      for (const [k, v] of m.byKwAmount)
        byKwAmount.set(k, (byKwAmount.get(k) ?? 0) + v)
      for (const [k, arr] of m.hourByKw) {
        let a = hourByKw.get(k)
        if (!a) {
          a = new Array(24).fill(0)
          hourByKw.set(k, a)
        }
        for (let h = 0; h < 24; h++) a[h] += arr[h]
      }
    }
    const fromYm = last12[0].ym
    const toYm = last12[last12.length - 1].ym
    annual = {
      label: `최근 12개월 (${fromYm}~${toYm})`,
      fromYm,
      toYm,
      sortKey: last12[last12.length - 1].sortKey,
      users: users.size,
      amountRaw,
      usageTotal,
      byKw: Object.fromEntries([...byKw.entries()].map(([k, v]) => [String(k), v])),
      byKwAmount: Object.fromEntries(
        [...byKwAmount.entries()].map(([k, v]) => [String(k), v]),
      ),
      hourly: {
        byHourByKw: Object.fromEntries(
          [...hourByKw.entries()].map(([k, v]) => [
            String(k),
            v.map((x) => Math.round(x)),
          ]),
        ),
        days,
      },
    }
  }
  return { months: monthsOut, chargers, annual }
}

/**
 * 파일 목록에서 코스텔 충전기별 집계를 얻는다.
 *  - 저장된 사전 집계(file.costel)가 있으면 그것을, 없으면 원본 행에서 즉시 집계.
 */
/** 파일 목록에서 단일 코스텔 집계를 얻는다(저장분 우선, 없으면 원본에서 즉시 집계). */
export function costelAggFromFiles(
  files: { dataset: Dataset; costel?: CostelAgg }[],
): CostelAgg | null {
  const withAgg = files.find((f) => f.costel)
  if (withAgg?.costel) return withAgg.costel
  const raw = files.filter((f) => detectCostel(f.dataset)).map((f) => f.dataset)
  if (raw.length === 0) return null
  return buildCostelAgg(raw)
}

export function perChargerFromFiles(
  files: { dataset: Dataset; costel?: CostelAgg }[],
): PerChargerUsage[] {
  return costelAggFromFiles(files)?.chargers ?? []
}

/**
 * 저장 전 코스텔 파일 정리:
 *  원본 행이 있는 코스텔 파일들을 거래 id 중복제거 후 하나의 '사전 집계' 파일로
 *  합쳐, 저장 payload를 수 KB 수준으로 줄인다(413 방지).
 *  원본 행이 없는(이미 집계된) 코스텔 파일은 새 원본이 있으면 대체된다.
 */
export function consolidateCostelFiles(files: FileEntry[]): FileEntry[] {
  const costelRaw = files.filter(
    (f) => detectCostel(f.dataset) && f.dataset.rows.length > 0,
  )
  if (costelRaw.length === 0) return files // 새 원본 없음 → 그대로(기존 집계 유지)
  // 코스텔(원본/집계) 외의 파일만 보존, 코스텔은 하나의 집계로 대체
  const keep = files.filter((f) => !f.costel && !detectCostel(f.dataset))
  const agg = buildCostelAgg(costelRaw.map((f) => f.dataset))
  const aggFile: FileEntry = {
    id: 'costel-agg',
    dataset: {
      columns: ['시작일시', '충전량(kWh)', '충전기구분'],
      rows: [],
      fileName: '충전내역(집계)',
    },
    category: '충전내역',
    period: null,
    costel: agg,
  }
  return [...keep, aggFile]
}

/**
 * 저장 직전 파일 축소(413 방지, 모든 경로 공용):
 *  1) 코스텔 충전내역 → 사전 집계 1개로 통합
 *  2) 분석에 쓰지 않는 대용량 원본(예: 충전진행상세 수십만 행)은 행을 저장하지 않음
 *     (열·파일명은 보존). 정상 정산/명부 파일(소량)은 그대로 유지.
 */
export function shrinkFilesForSave(files: FileEntry[]): FileEntry[] {
  const MAX_ROWS = 10000
  return consolidateCostelFiles(files).map((f) => {
    if (f.costel) return f
    if (f.dataset.rows.length > MAX_ROWS) {
      return { ...f, dataset: { ...f.dataset, rows: [] } }
    }
    return f
  })
}
