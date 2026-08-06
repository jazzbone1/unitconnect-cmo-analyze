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
import {
  computeTariff,
  computeBill,
  defaultTariff,
  properContractKwByUsage,
  type TariffInputs,
  type BillInputs,
} from '../lib/tariff'
import { defaultStandby, computeStandby, type StandbyInputs } from '../lib/standby'
import {
  defaultApartmentBill,
  baseUnitPerKw,
  aptEnergyRate,
  evTouRate,
  EV_TARIFF,
  type ApartmentBillInputs,
} from '../lib/apartmentBill'
import type { FileEntry } from '../types'
import SettlementAnalysis from './SettlementAnalysis'
import RegistryAnalysis from './RegistryAnalysis'
import FeasibilityAnalysis from './FeasibilityAnalysis'
import ReportView from './ReportView'
import TariffAnalysis from './TariffAnalysis'
import StandbyAnalysis from './StandbyAnalysis'
import ApartmentBillAnalysis from './ApartmentBillAnalysis'
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
  feas?: FeasibilityInputs,
  aptBill?: ApartmentBillInputs,
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

  // 사업성 1년차 이용률(종류별) — 정산 데이터가 없을 때 대체값·비례 배분 가중치 산출용
  const utilByKw = (kw: number): number => {
    if (!feas) return 0
    if (kw === 100) return feas.utilFast100 ?? 0
    if (kw === 50) return feas.utilFast50 ?? 0
    if (kw === 7) return feas.utilSlow7 ?? 0
    if (kw === 3.5) return feas.utilSlow35 ?? 0
    if (kw === 3) return feas.utilSlow3 ?? 0
    return 0
  }
  // 3종류 이상 자동 비례 배분 가중치 = 정격 × 대수 × 가정 이용률
  const autoWeights: Record<string, number> = {}
  for (const c of config.chargers)
    autoWeights[c.id] = c.kw * c.count * utilByKw(c.kw)

  // 정산 월간 데이터가 있으면 유형별 실적·월별 추이 자동 기입
  const metrics = files.length
    ? computeAll(files, config, {}, {}, autoWeights)
    : []
  const months = metrics.filter((m) => m.periodType === 'month')
  // 종류별 사용량·개월수 기준: '정산 분석' 탭과 동일하게 맞춘다.
  //  연간 파일(periodType==='year')이 있으면 그 파일의 종류별 사용량·개월수(보통 12)를
  //  그대로 사용 → 보고서 유형별 실적/이용률이 정산 연간 표와 정확히 일치.
  //  연간 파일이 없으면 월별 파일 합계와 월 개수(개월수 합)를 사용.
  const yearMetric = metrics.find((m) => m.periodType === 'year')
  const usageByType = new Map<string, number>()
  let analyzedMonths: number
  if (yearMetric) {
    analyzedMonths = yearMetric.months || 12
    for (const t of yearMetric.types)
      usageByType.set(t.id, (usageByType.get(t.id) ?? 0) + t.usage)
  } else {
    analyzedMonths = months.reduce((a, m) => a + (m.months || 1), 0) || 1
    for (const m of months)
      for (const t of m.types)
        usageByType.set(t.id, (usageByType.get(t.id) ?? 0) + t.usage)
  }
  if (active.length) {
    const nMonths = analyzedMonths || 1
    d.perType = active.map((c) => {
      const uSettle = usageByType.get(c.id) ?? 0
      // 충전량(월): 정산 총합을 개월수(nMonths)로 나눈 월 평균. 정산값이 없으면
      //  사업성 1년차(이용률×정격×720) 기준. (uSettle는 여러 달 합계이므로 반드시
      //  개월수로 나눠 월 값으로 환산해야 한다 — 이 나눗셈 누락이 년=월 동일 버그였음.)
      let monthlyTotal = uSettle / nMonths
      let perUnitMonthly = c.count ? monthlyTotal / c.count : 0
      if (uSettle <= 0 && feas) {
        perUnitMonthly = utilByKw(c.kw) * c.kw * 720 // 대당 월 충전량
        monthlyTotal = perUnitMonthly * c.count // 종류별 월 충전량
      }
      // 충전량(년) = 월 충전량 × 12
      const kwhTotal = monthlyTotal * 12
      // 월 이용률 = 대당 월 충전량 ÷ (정격 × 720). 표시된 대당 월 충전량과 정합.
      const util = c.kw > 0 ? perUnitMonthly / (c.kw * 720) : 0
      return {
        id: c.id,
        type: c.name,
        count: `${c.count}대`,
        kwh: kwhTotal ? `${Math.round(kwhTotal).toLocaleString()} kWh` : '',
        monthlyKwh: monthlyTotal
          ? `${Math.round(monthlyTotal).toLocaleString()} kWh`
          : '',
        perUnit: perUnitMonthly
          ? `${Math.round(perUnitMonthly).toLocaleString()} kWh`
          : '',
        util: util > 0 ? `${(util * 100).toFixed(2)}%` : '',
      }
    })
  }
  if (months.length) {
    const activeIds = new Set(active.map((c) => c.id))
    d.monthly = months.map((m) => ({
      id: m.id,
      month: m.periodLabel,
      // 전체 충전량
      kwh: Math.round(m.usageTotal).toLocaleString(),
      // 합산(전체) 이용률 = 총사용량 ÷ (총설비 × 개월수)
      utilTotal: `${m.utilTotal.toFixed(2)}%`,
      // 충전기 종류별 충전량·이용률(제외 종류는 빼고 활성 종류만)
      types: m.types
        .filter((t) => activeIds.has(t.id))
        .map((t) => ({
          id: t.id,
          name: t.name,
          kwh: `${Math.round(t.usage).toLocaleString()} kWh`,
          util: `${t.utilization.toFixed(2)}%`,
        })),
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
  // 고지서 실측 입력(⑦)에 값이 있으면 실측 실효원가(VAT포함)를 우선 사용
  const billHasData = (b?: BillInputs | null): boolean =>
    !!b && b.usageKwh > 0 && (b.basic > 0 || b.energy > 0)
  const billEffCost =
    tariff && billHasData(tariff.bill)
      ? computeBill(tariff.bill as BillInputs).effInclVat
      : null
  // 모자분리 계약전력 재책정: 고지서 실측 입력(⑦)이 있으면 요금적용전력
  //  (기본요금 ÷ 기본단가)을 모자분리 그룹 설비용량 비중으로 배분한다. 고지서가
  //  없으면 각 그룹 설비용량 × 0.8을 계약전력 기준으로 사용(수용률 80% 가정).
  const sepCapTotal = active
    .filter((c) => c.separated)
    .reduce((a, c) => a + c.kw * c.count, 0)
  const sepBill = tariff?.bill
  const sepAppliedKw =
    sepBill && sepBill.basic > 0 ? computeBill(sepBill).appliedKw : null
  // 운영비 원/kWh 분모(전체 월 충전량) — 종류별 월 사용량 합계로 자동 산출.
  let totalGroupMonthly = 0
  d.elecGroups = active.map((c) => {
    // 월 사용량: 정산 종류별 총사용량 ÷ 개월수(정산 분석과 동일 기준).
    const usageAvg =
      usageByType.size > 0
        ? Math.round((usageByType.get(c.id) ?? 0) / analyzedMonths)
        : 0
    // 월 사용량: 정산값 우선, 없으면 사업성 종류별 월 사용량(이용률×정격×720×대수)
    const feasMonthly = Math.round(utilByKw(c.kw) * c.kw * 720 * c.count)
    const groupMonthly = usageAvg > 0 ? usageAvg : feasMonthly
    totalGroupMonthly += groupMonthly
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
      monthlyKwh: groupMonthly,
      currentRate: c.rate,
      standbyKwh,
    })
    // 모자분리 종류(EV 전용 계량기): 전력량요금·기본요금을 '전기차 충전전력 자가소비용'
    //  요금표 기준으로 반영. 기본요금 2,580원/kW, (A) 전력량요금은 자가소비용 TOU
    //  단가를 '아파트 요금분석' TOU 비중으로 가중한 값.
    if (sep) {
      g.baseUnitPrice = EV_TARIFF.self.base
      if (aptBill) g.powerRate = evTouRate(aptBill, 'self')
      // 계약전력 재책정: 고지서 실측 요금적용전력을 설비 비중으로 배분, 없으면 설비×0.8.
      const groupCap = c.kw * c.count
      g.contractKw =
        sepAppliedKw != null && sepAppliedKw > 0 && sepCapTotal > 0
          ? Math.max(1, Math.round(sepAppliedKw * (groupCap / sepCapTotal)))
          : Math.round(groupCap * 0.8)
      // 실효원가(Lv1): 고지서 실측 입력(⑦)이 있으면 그 값(측정) 우선,
      //  없으면 자가소비용 (A)+(B) 조립식 계산값을 그대로 사용(override 없음).
      if (billEffCost != null && Number.isFinite(billEffCost)) {
        g.lv1Override = Math.round(billEffCost * 10) / 10
      }
    }
    // 모자분리 미적용: 공용부 기본요금 배분 = 적정계약전력 × 기본단가(아파트요금)
    //  적정계약전력 = 그 종류의 실사용량 기반 = 월사용량 ÷ (목표부하율×720) × (1+마진).
    //  종류별 독립 산정이라 모자분리 충전기와 섞이지 않는다(공용부 계약과 EV 전용 계약 분리).
    if (!sep && tariff && aptBill) {
      const contractKw = properContractKwByUsage(
        groupMonthly,
        tariff.targetLoadFactor ?? 0.18,
        tariff.contractMargin ?? 0.15,
      )
      g.contractKw = Math.round(contractKw)
      const bu = baseUnitPerKw(aptBill)
      g.baseUnitPrice = Math.round(bu.value)
      g.apartmentBaseAlloc = contractKw > 0
      // 주택용 누진은 '세대당 기본료'(계약전력 무관) → 고지서 역산 미적용.
      g.baseUnitTier = bu.source === 'tier'
      // 고지서 역산: 일반용(계약전력 기반)에서 공용부 고지서 기본요금·계약전력이
      //  있으면 기본단가 = 기본요금 ÷ 계약전력으로 역산. 주택용은 시드하지 않음.
      if (
        bu.source !== 'tier' &&
        aptBill.baseCharge > 0 &&
        aptBill.contractKw > 0
      ) {
        g.billBase = Math.round(aptBill.baseCharge)
        g.billContractKw = Math.round(aptBill.contractKw)
      } else {
        g.billBase = undefined
        g.billContractKw = undefined
      }
    }
    // (A) 시간대·계절 가중 전력량요금(모자분리 미적용): 아파트 요금분석에서 선택한
    // 계약형태·누진구간의 전력량요금 단가를 연동. (모자분리 그룹은 위에서 EV 자가소비용
    // TOU 단가를 이미 반영.)
    if (!sep && aptBill && !g.billMode) {
      const er = aptEnergyRate(aptBill)
      if (er > 0) g.powerRate = Math.round(er * 10) / 10
    }
    // 대기전력 손실 단가: 모자분리 미적용은 공용부(아파트) 전기로 소비 →
    //  아파트 요금제 단가 기준으로 자동 반영.
    if (!sep && aptBill) {
      const er = aptEnergyRate(aptBill)
      if (er > 0) g.standbyRate = Math.round(er * 10) / 10
    }
    return g
  })

  // 운영비 원/kWh 분모: 사업성 분석 종류별 월 사용량 합계를 자동 반영.
  if (totalGroupMonthly > 0) d.opexBaseKwh = totalGroupMonthly

  // 운영비 모델(아파트 관리소 자치운영 기준, 자동 산출·수정 가능).
  //  · 정기점검: 회당 30만원 × 연2회 + 정기점검 인건비(100대당 30만원, 회당)
  //  · 긴급점검: 회당 30만원 × 연4회
  //  · CS 운영/정산: 관리인력 시간 배분 → 대당 60,000원/년(대수 비례)
  //  · 배상책임보험: 완속 4,000·급속 10,000원 (대당·연)
  //  · 수선비·부품적립: 완속 30,000·급속 300,000원 (대당·연, 급속 파워모듈 적립)
  //  (통신비·전기안전관리자 선임·PG 기본료는 관리소 자치운영 기준 제외)
  if (active.length) {
    const cnt = active.reduce((a, c) => a + c.count, 0)
    const slow = active
      .filter((c) => c.kw <= 7)
      .reduce((a, c) => a + c.count, 0)
    const fast = active
      .filter((c) => c.kw >= 50)
      .reduce((a, c) => a + c.count, 0)
    const visitFee = 300000 // 점검 1회당 기준 비용
    // 정기점검: 100대 단위(올림)로 점검 1세트(회당 30만원 × 연 2회) 필요.
    //  100대→×1, 150대→×2, 200대→×2, 201~300대→×3 …
    const inspectSets = Math.max(1, Math.ceil(cnt / 100))
    d.opex = [
      { id: 'opex-regular', name: '정기점검', yearCost: visitFee * 2 * inspectSets, note: '회당 30만원 × 연 2회 × (충전기 100대당 1세트, 올림)' },
      { id: 'opex-urgent', name: '긴급점검', yearCost: visitFee * 4, note: '회당 30만원 × 연 4회' },
      { id: 'opex-cs', name: 'CS 운영/원격모니터링/정산', yearCost: cnt * 60000, note: '' },
      { id: 'opex-insurance', name: '배상책임보험', yearCost: slow * 4000 + fast * 10000, note: '완속 4,000 / 급속 10,000원 (대당·연)' },
      { id: 'opex-repair', name: '수선비·부품적립', yearCost: slow * 30000 + fast * 300000, note: '완속 30,000 / 급속 300,000원 (대당·연)' },
    ]
  }

  // 충전요금 인상 권고안: 현행 요금을 '충전기 종류별 수량·요금'의 요금으로 자동 반영.
  //  (현행 요금은 편집 가능하되 기본값은 config.rate를 따라간다.)
  if (active.length) {
    d.recommend = active.map((c) => ({
      id: c.id,
      label: `${c.kw >= 50 ? '급속' : '완속'} (${c.name})`,
      current: c.rate > 0 ? `${Math.round(c.rate)}원/kWh` : '',
      proposed: '',
      note: c.kw >= 50 ? '높은 수선비 적립 필요' : 'Lv2 초과 필수',
    }))
  }
  return d
}

/** 권고안 라벨에서 정격(kW) 숫자를 추출 (예: "완속 (7kW)" → 7) */
function kwFromLabel(label: string): number | null {
  const m = label.match(/(\d+(?:\.\d+)?)\s*kW/i)
  return m ? Number(m[1]) : null
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

/** 자동 연동 seed 행에 사용자가 직접 수정한 필드(edited)만 덮어써 보존한다. */
function mergeEdited<T extends { id: string; edited?: string[] }>(
  prevRows: T[],
  seedRows: T[],
): T[] {
  return seedRows.map((seed) => {
    const prev = prevRows.find((p) => p.id === seed.id)
    const edited = prev?.edited ?? []
    if (!prev || edited.length === 0) return { ...seed, edited: [] }
    const merged: Record<string, unknown> = { ...seed }
    for (const k of edited) merged[k] = (prev as Record<string, unknown>)[k]
    merged.edited = edited
    return merged as T
  })
}

/** 월별 추이 행 병합: 행 필드 + 종류별(types) 하위 셀의 edited까지 보존한다. */
function mergeMonthly(
  prevRows: ReportModel['monthly'],
  seedRows: ReportModel['monthly'],
): ReportModel['monthly'] {
  return seedRows.map((seed) => {
    const prev = prevRows.find((p) => p.id === seed.id)
    const rowEdited = prev?.edited ?? []
    const merged: Record<string, unknown> = { ...seed }
    for (const k of rowEdited) merged[k] = (prev as Record<string, unknown>)[k]
    merged.edited = rowEdited
    // 종류별 하위 셀 병합
    merged.types = (seed.types ?? []).map((st) => {
      const pt = prev?.types?.find((x) => x.id === st.id)
      const tEdited = pt?.edited ?? []
      if (!pt || tEdited.length === 0) return st
      const mt: Record<string, unknown> = { ...st }
      for (const k of tEdited) mt[k] = (pt as Record<string, unknown>)[k]
      mt.edited = tEdited
      return mt
    })
    return merged as ReportModel['monthly'][number]
  })
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
    perType: mergeEdited(m.perType, s.perType),
    monthly: mergeMonthly(m.monthly, s.monthly),
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
      const base = {
        ...prev,
        name: sg.name,
        kw: sg.kw,
        count: sg.count,
        separated: sg.separated,
        monthlyKwh: sg.monthlyKwh,
        currentRate: sg.currentRate,
        standbyKwh: sg.standbyKwh,
        // (A) 전력량요금: 고지서 실측 모드가 아니면 아파트 요금분석 단가로 자동 연동
        powerRate: prev.billMode ? prev.powerRate : sg.powerRate,
      }
      // 미적용 그룹은 공용부 기본요금 배분값(계약전력·기본단가)도 자동 연동.
      // 배분 적용 여부(토글)는 사용자가 끈 경우 보존(undefined면 자동값 사용).
      if (sg.separated === false)
        return {
          ...base,
          contractKw: sg.contractKw,
          baseUnitPrice: sg.baseUnitPrice,
          apartmentBaseAlloc:
            prev.apartmentBaseAlloc ?? sg.apartmentBaseAlloc,
          // 주택용 누진(baseUnitTier)이면 세대당 기본료 사용 → 고지서 역산값 제거.
          //  일반용은 사용자 직접 입력 보존, 미입력이면 아파트요금분석 시드값 반영.
          baseUnitTier: sg.baseUnitTier,
          billBase: sg.baseUnitTier ? undefined : prev.billBase ?? sg.billBase,
          billContractKw: sg.baseUnitTier
            ? undefined
            : prev.billContractKw ?? sg.billContractKw,
          // 대기전력 손실 단가: 아파트 요금제 단가로 자동 연동.
          standbyRate: sg.standbyRate,
        }
      // 모자분리 그룹: 계약전력(고지서 재책정/설비×0.8)·실효원가(Lv1) 자동 반영
      return { ...base, contractKw: sg.contractKw, lv1Override: sg.lv1Override }
    }),
    // 운영비: 자동 산출 항목(정기·긴급점검·보험·수선)의 연비용만 대수 기준으로 연동.
    //  CS 운영(수동·별도 기입)과 사용자 추가 항목·비고는 보존.
    opex: (m.opex ?? []).map((r) => {
      // 자동 산출 항목(대수 비례)은 연비용 연동. 사용자 추가 항목은 시드에 없어 보존.
      const sr =
        (s.opex ?? []).find((x) => x.id === r.id) ??
        (s.opex ?? []).find((x) => x.name === r.name)
      return sr ? { ...r, yearCost: sr.yearCost } : r
    }),
    // 인상 권고안: 현행 요금(current)만 '충전기 종류별 요금'에서 자동 연동.
    //  행 id 또는 라벨의 정격(kW)으로 시드 행을 매칭. 나머지 열(최소 인상안·비고)은 보존.
    recommend: (m.recommend ?? []).map((r) => {
      const sr =
        (s.recommend ?? []).find((x) => x.id === r.id) ??
        (s.recommend ?? []).find(
          (x) =>
            kwFromLabel(x.label) != null &&
            kwFromLabel(x.label) === kwFromLabel(r.label),
        )
      return sr && sr.current ? { ...r, current: sr.current } : r
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
    'usage' | 'feasibility' | 'report' | 'tariff' | 'standby' | 'aptbill'
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
        project.feas ?? DEFAULT_INPUTS(),
        project.aptBill ?? defaultApartmentBill(),
      ),
  )
  const [tariff, setTariff] = useState<TariffInputs>(() => deriveTariff(project))
  const [standby, setStandby] = useState<StandbyInputs>(
    () => project.standby ?? defaultStandby(),
  )
  const [aptBill, setAptBill] = useState<ApartmentBillInputs>(() => {
    if (project.aptBill) return project.aptBill
    const d = defaultApartmentBill()
    d.households = project.households ?? 0 // 가구수 자동 반영
    return d
  })
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
  // 제외(excluded) 처리된 종류를 대수 0으로 취급한 '유효 설정'.
  //  사업성·요금구조·전기원가·대기전력 등 모든 계산은 이 값을 기준으로 한다.
  const effConfig = useMemo<SettlementConfig>(
    () => ({
      ...config,
      chargers: config.chargers.map((c) =>
        c.excluded ? { ...c, count: 0 } : c,
      ),
    }),
    [config],
  )
  const [files, setFiles] = useState<FileEntry[]>(
    project.files ?? project.settlementFiles ?? [],
  )
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [saved, setSaved] = useState(false)

  // 총 설비용량(kW) — 제외 종류 반영(effConfig)
  const installedKw = useMemo(
    () => effConfig.chargers.reduce((a, c) => a + c.kw * c.count, 0),
    [effConfig],
  )
  // 사업성 분석 월 사용량 합산치 = Σ(종류 이용률 × 정격 × 720 × 대수)
  const feasMonthlyKwh = useMemo(() => {
    const countOf = (kw: number) =>
      effConfig.chargers.find((c) => c.kw === kw)?.count ?? 0
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
  }, [feas, effConfig])
  // 정산 종류별 자동 비례 배분 가중치 = 정격 × 대수 × 사업성 가정 이용률.
  //  요금 역산 불가(3종류 이상)일 때 총 사용량을 이 비중으로 배분해 이용률 추정.
  const settleWeights = useMemo(() => {
    const u = (kw: number) => {
      if (kw === 100) return feas.utilFast100 ?? 0
      if (kw === 50) return feas.utilFast50 ?? 0
      if (kw === 7) return feas.utilSlow7 ?? 0
      if (kw === 3.5) return feas.utilSlow35 ?? 0
      if (kw === 3) return feas.utilSlow3 ?? 0
      return 0
    }
    const w: Record<string, number> = {}
    for (const c of config.chargers) w[c.id] = c.kw * c.count * u(c.kw)
    return w
  }, [config, feas])
  // 요금 구조 탭 월 총 충전량: override 있으면 우선, 없으면 사업성 월사용량 자동
  const effMonthlyKwh =
    tariff.monthlyKwhOverride != null &&
    Number.isFinite(tariff.monthlyKwhOverride)
      ? (tariff.monthlyKwhOverride as number)
      : Math.round(feasMonthlyKwh)
  // 충전기 제외가 있으면 요금 구조 계약전력을 '권장 적정 계약전력'(실사용량 기반)으로
  //  자동 전환하여 실효원가에 반영한다(수용률을 적정계약전력/설비용량으로 대체).
  const hasExclusion = config.chargers.some((c) => c.excluded && c.count > 0)
  const properKw = properContractKwByUsage(
    effMonthlyKwh,
    tariff.targetLoadFactor ?? 0.18,
    tariff.contractMargin ?? 0.15,
  )
  const contractRatioAuto =
    hasExclusion && installedKw > 0 && properKw > 0
      ? properKw / installedKw
      : undefined
  // 요금 구조 입력(제외 시 적정계약전력 반영). 탭·실효원가 공통 사용.
  const tariffInputsEff = useMemo(
    () => ({
      ...tariff,
      installedKw,
      monthlyKwh: effMonthlyKwh,
      ...(contractRatioAuto != null ? { contractRatio: contractRatioAuto } : {}),
    }),
    [tariff, installedKw, effMonthlyKwh, contractRatioAuto],
  )
  // 요금 구조 결과(실효원가·계약전력)
  const tariffEff = useMemo(
    () => computeTariff(tariffInputsEff),
    [tariffInputsEff],
  )
  const autoElecCost = tariffEff.selected.effCost

  // 연차별 전기원가 모델 (부하율 고정: 이용률↑ → 충전량↑·계약전력↑)
  //  - 연차 월충전량 = 사업성 yearlyW
  //  - 계약전력_N = 월충전량_N ÷ (부하율 × 720)  (부하율=1년차 기준 유지)
  //  - 실효원가_N = 요금구조 재산정(계약전력_N, 월충전량_N)
  const elecYearModel = useMemo(() => {
    const countOf = (kw: number) =>
      effConfig.chargers.find((c) => c.kw === kw)?.count ?? 0
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
  }, [feas, effConfig, tariff, tariffEff, effMonthlyKwh])

  // 앞 단계(단지정보·충전기 요금·요금구조·정산) 변경 시 보고서의 자동 연동(음영)
  // 필드를 실시간 반영한다. 직접입력 필드는 보존.
  const linkedSeed = useMemo(
    () =>
      seedReport(
        {
          name: site.name,
          households: site.households,
        } as SavedSite,
        effConfig,
        files,
        tariff,
        standby,
        feas,
        aptBill,
      ),
    [site.name, site.households, effConfig, files, tariff, standby, feas, aptBill],
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
      aptBill,
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
          className={`subtab${subtab === 'aptbill' ? ' subtab--active' : ''}`}
          onClick={() => setSubtab('aptbill')}
        >
          아파트 요금 분석
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
          billMeasured={
            !!tariff.bill &&
            tariff.bill.usageKwh > 0 &&
            (tariff.bill.basic > 0 || tariff.bill.energy > 0)
          }
          autoSeed={() =>
            seedReport(
              { ...project, name: site.name, households: site.households },
              effConfig,
              files,
              tariff,
              standby,
              feas,
              aptBill,
            )
          }
        />
      ) : subtab === 'tariff' ? (
        <TariffAnalysis
          inputs={tariffInputsEff}
          setInputs={setTariff}
          autoMonthlyKwh={Math.round(feasMonthlyKwh)}
        />
      ) : subtab === 'standby' ? (
        <StandbyAnalysis
          chargers={effConfig.chargers}
          inputs={standby}
          setInputs={setStandby}
          effCost={autoElecCost}
          aptRate={aptEnergyRate(aptBill)}
        />
      ) : subtab === 'aptbill' ? (
        <ApartmentBillAnalysis inputs={aptBill} setInputs={setAptBill} />
      ) : subtab === 'feasibility' ? (
        <FeasibilityAnalysis
          inputs={feas}
          setInputs={setFeas}
          config={config}
          setConfig={setConfig}
          standbyMonthlyKwhSeparated={computeStandby(
            effConfig.chargers.filter((c) => c.separated),
            standby,
            0,
          ).totalKwh}
          standbyMonthlyKwhAll={
            computeStandby(effConfig.chargers, standby, 0).totalKwh
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
              autoWeights={settleWeights}
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
