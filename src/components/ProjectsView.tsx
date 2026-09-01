import { useEffect, useMemo, useState } from 'react'
import type {
  SavedSite,
  AnalysisApproval,
  AnalysisVariant,
  PreInstalledCharger,
} from '../lib/sites'
import {
  defaultApproval,
  approvalRequest,
  approvalDecide,
  approvalCanDecide,
  newSiteId,
  SALES_STATUS,
} from '../lib/sites'
import type { ChargerType } from '../lib/settlement'
import { ssoCurrentUser, ssoDirectory, ssoGetSettings } from '../lib/sso'
import { notifyApproval } from '../lib/notify'
import type { SsoUser, SsoAccount } from '../lib/sso'
import ApprovalPanel from './ApprovalPanel'
import { usePersistentState } from '../lib/persist'
import { DEFAULT_CONFIG, type SettlementConfig } from '../lib/settlement'
import { detectSettlement, computeAll } from '../lib/settlement'
import {
  DEFAULT_INPUTS,
  computeFeasibility,
  defaultBizFee,
  ELEC_COST,
  MAX_YEARS,
  PG_RATE,
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

/**
 * 종류별 표준 '이용률(%)' — 정산 종류별 배분 가중치용(사업성 가정과 분리).
 *  분배는 대수 × (이용률 × 정격kW) 비율로 결정되므로, 종류별 '이용률 비율'이 핵심.
 *  기준: 완속 7kW=7%. 상대 비율(공동주택 실태 반영):
 *   · 완속 7kW 7.0% (주력) · 완속 3.5kW 5.0% (×0.7)
 *   · 콘센트 3kW 1.5% (×0.21 — 저속·저선호·의무설치 대량 → 거의 미사용)
 *   · 급속 50kW 1.6% (×0.23) · 급속 100kW 1.1% (×0.16)
 *     (급속은 대당 절대 충전량은 크나 정격이 커 %는 낮음)
 */
export interface KwhProfile {
  p100: number
  p50: number
  p7: number
  p35: number
  p3: number
}
/** 정산 배분용 표준 이용률(%) 기본값(편집 가능). 완속 7kW=7% 기준. */
export const DEFAULT_KWH_PROFILE: KwhProfile = {
  p100: 1.1,
  p50: 1.6,
  p7: 7.0,
  p35: 5.0,
  p3: 1.5,
}
/** 정격(kW)의 표준 이용률(%). */
function utilPctFromProfile(kw: number, p: KwhProfile): number {
  if (kw >= 100) return p.p100
  if (kw >= 50) return p.p50
  if (kw >= 7) return p.p7
  if (kw >= 3.5) return p.p35
  return p.p3 // 3kW 콘센트
}
/** 정격(kW)의 월 대당 충전량(kWh) = 이용률 × 정격 × 720h. 배분 가중치용. */
function monthlyKwhFromProfile(kw: number, p: KwhProfile): number {
  return (utilPctFromProfile(kw, p) / 100) * kw * 720
}

/**
 * 설치 예정 충전기로 인한 이용률 분산 계수(0~1).
 *  = 위차 적용 가중치 ÷ (위차 적용 + 설치 예정) 가중치.
 * 가중치 = 대수 × 종류별 표준 월 대당 충전량. 설치 예정이 없으면 1(희석 없음).
 */
function utilShareFactor(
  chargers: { kw: number; count: number }[],
  planned: { kw: number; count: number }[] | undefined,
  profile: KwhProfile,
): number {
  const wOf = (kw: number, count: number) =>
    (count || 0) * monthlyKwhFromProfile(kw, profile)
  const wApplied = chargers.reduce((a, c) => a + wOf(c.kw, c.count), 0)
  const wPlanned = (planned ?? []).reduce((a, p) => a + wOf(p.kw, p.count), 0)
  const denom = wApplied + wPlanned
  return denom > 0 ? wApplied / denom : 1
}

/** 전역 저장된 표준 이용률 프로파일 로드(없으면 기본값). 순수 함수에서 사용. */
function loadUtilProfile(): KwhProfile {
  try {
    const raw = localStorage.getItem('unitconnect.ui.settle.utilProfile')
    const p = raw ? JSON.parse(raw) : null
    if (p && typeof p === 'object') return { ...DEFAULT_KWH_PROFILE, ...p }
  } catch {
    /* noop */
  }
  return DEFAULT_KWH_PROFILE
}

/** 프로젝트 데이터로 보고서 초기값(현장 정보) 자동 기입 */
function seedReport(
  project: SavedSite,
  config: SettlementConfig,
  files: FileEntry[],
  tariff?: TariffInputs,
  standby?: StandbyInputs,
  feas?: FeasibilityInputs,
  aptBill?: ApartmentBillInputs,
  kwhProfile: KwhProfile = DEFAULT_KWH_PROFILE,
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
  // 3종류 이상 자동 비례 배분 가중치 = 대수 × 표준 월 대당 충전량(kWh).
  //  일반 공동주택 충전 실적 기반 프로파일이라 사업성 가정 이용률과 분리 →
  //  사업성 %를 바꿔도 정산 배분이 흔들리지 않고, 정산 실적을 사업성 기준값으로 쓸 수 있다.
  const autoWeights: Record<string, number> = {}
  for (const c of config.chargers)
    autoWeights[c.id] = c.count * monthlyKwhFromProfile(c.kw, kwhProfile)

  // 정산 월간 데이터가 있으면 유형별 실적·월별 추이 자동 기입
  const metrics = files.length
    ? computeAll(files, config, {}, {}, autoWeights)
    : []
  const months = metrics.filter((m) => m.periodType === 'month')
  // 종류별 사용량·개월수 기준: '정산 분석' 탭과 동일하게 맞춘다.
  //  연간 파일(periodType==='year')이 있으면 그 파일의 종류별 사용량·개월수(보통 12)를
  //  그대로 사용 → 보고서 유형별 실적/이용률이 정산 연간 표와 정확히 일치.
  //  연간 파일이 없으면 월별 파일 합계와 월 개수(개월수 합)를 사용.
  // 연간 파일이 여러 개면(예: 부분기간 + 전체연도) 실적이 가장 많은(총사용량 최대)
  //  파일을 대표로 사용한다. (기존 .find는 가장 이른 파일을 집어 엉뚱한 값이 나왔음)
  const yearMetrics = metrics.filter((m) => m.periodType === 'year')
  const yearMetric = yearMetrics.length
    ? yearMetrics.reduce((best, m) => (m.usageTotal > best.usageTotal ? m : best))
    : undefined
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
      { id: 'opex-insurance', name: '보험가입비용', yearCost: slow * 4000 + fast * 10000, note: '완속 4,000 / 급속 10,000원 (대당·연)' },
      { id: 'opex-repair', name: '수선비', yearCost: slow * 30000 + fast * 300000, note: '완속 30,000 / 급속 300,000원 (대당·연)' },
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

/** 프로젝트 목록 표시용: 등록 충전기 종류별 수량 요약 문자열 (예: "3kW 503 · 7kW 21") */
function chargerBreakdown(p: SavedSite): string {
  return p.chargers
    .filter((c) => c.count > 0)
    .map((c) => `${c.kw}kW ${c.count.toLocaleString()}`)
    .join(' · ')
}

/** 프로젝트 목록 표시용: 사업성 결과(영업이익률·영업이익). 사업성 탭(ProjectDetail)의
 *  파생 계산 체인(제외 반영·요금구조 실효원가·연차별 전기원가·대기전력 전체 종류)을
 *  그대로 재현해 탭 결과와 일치시킨다. */
/** 한 분석 슬롯(기본안/대체안 공통)의 데이터 묶음. */
interface AnalysisSet {
  hours: number
  chargers: ChargerType[]
  feas: FeasibilityInputs
  tariff: TariffInputs
  standby: StandbyInputs
  aptBill: ApartmentBillInputs
}

/** 결재용 요약: 사업성 결과 + CAPEX·영업비 회수기간. 연수(years) override 가능. */
interface PerChargerRate {
  kw: number
  count: number
  /** 반영된 충전단가 (VAT 포함, 원/kWh) */
  rateVat: number
  /** 반영된 전기원가 (VAT 제외, 원/kWh) */
  elecCost: number
}
interface ProjectFeasFull {
  r: ReturnType<typeof computeFeasibility>
  years: number
  paybackText: string
  paybackReached: boolean
  /** 반영된 전기원가 (VAT 제외, 원/kWh) */
  effElecCost: number
  /** 충전기 종류별 반영 단가 */
  perCharger: PerChargerRate[]
}
function projectFeasFull(
  p: SavedSite,
  yearsOverride?: number,
): ProjectFeasFull | null {
  const f = p.feas
  if (!f) return null
  const years = Math.max(
    1,
    Math.min(MAX_YEARS, Math.round(yearsOverride ?? f.years)),
  )
  const tariff = p.tariff ?? deriveTariff(p)
  const standby = p.standby ?? defaultStandby()
  // 제외(excluded) 종류는 대수 0으로 취급(effConfig).
  const chargers = p.chargers.map((c) => (c.excluded ? { ...c, count: 0 } : c))
  const totalCount = chargers.reduce((a, c) => a + c.count, 0)
  if (totalCount === 0) return null
  // 설치 예정 충전기 이용률 분산 계수(전역 프로파일 기준)
  const share = utilShareFactor(chargers, p.plannedInstall, loadUtilProfile())
  const countOf = (kw: number) => chargers.find((c) => c.kw === kw)?.count ?? 0
  const installedKw = chargers.reduce((a, c) => a + c.kw * c.count, 0)
  const utilOf = (kw: number): number => {
    if (kw === 100) return f.utilFast100 ?? 0
    if (kw === 50) return f.utilFast50 ?? 0
    if (kw === 7) return f.utilSlow7 ?? 0
    if (kw === 3.5) return f.utilSlow35 ?? 0
    if (kw === 3) return f.utilSlow3 ?? 0
    return 0
  }
  const feasMonthlyKwh =
    chargers.reduce((a, c) => a + utilOf(c.kw) * c.kw * 720 * c.count, 0) *
    share
  const effMonthlyKwh =
    tariff.monthlyKwhOverride != null &&
    Number.isFinite(tariff.monthlyKwhOverride)
      ? (tariff.monthlyKwhOverride as number)
      : Math.round(feasMonthlyKwh)
  const hasExclusion = p.chargers.some((c) => c.excluded && c.count > 0)
  const properKw = properContractKwByUsage(
    effMonthlyKwh,
    tariff.targetLoadFactor ?? 0.18,
    tariff.contractMargin ?? 0.15,
  )
  const contractRatioAuto =
    hasExclusion && installedKw > 0 && properKw > 0
      ? properKw / installedKw
      : undefined
  const tariffEff = computeTariff({
    ...tariff,
    installedKw,
    monthlyKwh: effMonthlyKwh,
    ...(contractRatioAuto != null ? { contractRatio: contractRatioAuto } : {}),
  })
  const autoElecCost = tariffEff.selected.effCost
  // 연차별 전기원가 모델
  const yearlyW = computeFeasibility({
    ...f,
    utilShareFactor: share,
    countFast100: countOf(100),
    countFast50: countOf(50),
    countSlow7: countOf(7),
    countSlow35: countOf(3.5),
    countSlow3: countOf(3),
  }).yearlyW
  const contractKw1 = tariffEff.contractKw
  const mk1 = yearlyW[0] || effMonthlyKwh || 1
  const lf1 = contractKw1 > 0 ? mk1 / (contractKw1 * 720) : 0
  const mode = f.elecYearMode ?? 'demandFixed'
  const elecByYearAll = yearlyW.map((mk) => {
    const contractKw =
      mode === 'loadFactorFixed'
        ? lf1 > 0
          ? mk / (lf1 * 720)
          : contractKw1
        : contractKw1
    return computeTariff({
      ...tariff,
      installedKw: undefined,
      contractRatio: undefined,
      contractKw,
      monthlyKwh: mk,
    }).selected.effCost
  })
  const hasElecOverride =
    f.elecCostOverride != null && Number.isFinite(f.elecCostOverride)
  const effElecCost = hasElecOverride
    ? (f.elecCostOverride as number)
    : Number.isFinite(autoElecCost)
      ? autoElecCost
      : ELEC_COST
  const elecByYear = hasElecOverride ? undefined : elecByYearAll
  const rateKeyOf = (kw: number): keyof FeasibilityInputs =>
    kw === 100
      ? 'rateFast100'
      : kw === 50
        ? 'rateFast50'
        : kw === 7
          ? 'rateSlow7'
          : kw === 3.5
            ? 'rateSlow35'
            : 'rateSlow3'
  const rateOf = (kw: number) => {
    const ov = (f[rateKeyOf(kw)] as number) ?? 0
    if (ov > 0) return ov
    return p.chargers.find((c) => c.kw === kw)?.rate ?? 0
  }
  // 영업비 1대분(값>0 만 유효):
  //  단일 override(f.bizFeeOverride) > 프로젝트별 기준표(p.bizFeeByYear) >
  //  전체 기준값(bizFeeByYear·localStorage) > 계약연수 기본값.
  let globalBiz: number[] | null = null
  try {
    const raw = localStorage.getItem('unitconnect.ui.feasibility.bizFeeByYear')
    const arr = raw ? JSON.parse(raw) : null
    if (Array.isArray(arr)) globalBiz = arr
  } catch {
    globalBiz = null
  }
  const yearIdx = years - 1
  const projBizRaw = p.bizFeeByYear?.[yearIdx]
  const projBizVal = projBizRaw != null ? projBizRaw : undefined // 0 포함, null만 제외
  const globalBizVal =
    globalBiz && globalBiz[yearIdx] > 0 ? globalBiz[yearIdx] : undefined
  const standardBiz = projBizVal ?? globalBizVal ?? defaultBizFee(years)
  const biz =
    f.bizFeeOverride != null &&
    Number.isFinite(f.bizFeeOverride) &&
    (f.bizFeeOverride as number) > 0
      ? (f.bizFeeOverride as number)
      : standardBiz
  const sepK = computeStandby(
    chargers.filter((c) => c.separated),
    standby,
    0,
  ).totalKwh
  const allK = computeStandby(chargers, standby, 0).totalKwh
  const eff: FeasibilityInputs = {
    ...f,
    years,
    utilShareFactor: share,
    countFast100: countOf(100),
    countFast50: countOf(50),
    countSlow7: countOf(7),
    countSlow35: countOf(3.5),
    countSlow3: countOf(3),
    rateFast100: rateOf(100),
    rateFast50: rateOf(50),
    rateSlow7: rateOf(7),
    rateSlow35: rateOf(3.5),
    rateSlow3: rateOf(3),
    bizFeePerUnit: biz,
    elecCostUnit: effElecCost,
    standbyMonthlyKwhSeparated: sepK,
    standbyMonthlyKwhAll: allK,
    includeStandby: true,
    standbyScope: 'all',
  }
  const r = computeFeasibility(eff, elecByYear)

  // CAPEX·영업비 회수기간 (사업성 탭과 동일 로직).
  //  투자액 = CAPEX + 영업비(총). 연간 영업현금흐름(매출총이익 − 현장운영비) 누적 도달 시점.
  const opsPerYear = r.opsCost / years
  const standbyPerYear = r.standbyCost / years
  const cfByYear = Array.from({ length: years }, (_, y) => {
    const W = r.yearlyW[y] ?? 0
    const rev = 12 * r.rateExVat * W
    const pg = -rev * PG_RATE
    const eu = elecByYear && elecByYear[y] != null ? elecByYear[y] : effElecCost
    const elecCharge = -12 * eu * W
    const gross = rev + pg + elecCharge + standbyPerYear
    return gross + opsPerYear
  })
  const investment = -(r.capex + r.bizCost)
  let paybackText = '회수 불가'
  let paybackReached = false
  if (investment <= 0) {
    paybackText = '즉시 회수'
    paybackReached = true
  } else {
    let cum = 0
    for (let y = 0; y < cfByYear.length; y++) {
      const cf = cfByYear[y]
      if (cf <= 0) continue
      if (cum + cf >= investment) {
        paybackText = `${(y + (investment - cum) / cf).toFixed(1)}년`
        paybackReached = true
        break
      }
      cum += cf
    }
    if (!paybackReached) {
      const avgCf = years > 0 ? cum / years : 0
      paybackText =
        avgCf > 0
          ? `${years}년 내 미회수 (약 ${(investment / avgCf).toFixed(1)}년)`
          : '회수 불가'
    }
  }
  const perCharger: PerChargerRate[] = chargers
    .filter((c) => !c.excluded && c.count > 0)
    .slice()
    .sort((a, b) => b.kw - a.kw)
    .map((c) => ({
      kw: c.kw,
      count: c.count,
      rateVat: rateOf(c.kw),
      elecCost: effElecCost,
    }))
  return {
    r,
    years,
    paybackText,
    paybackReached,
    effElecCost,
    perCharger,
  }
}

/** 분석안(기본안/대체안) 기준의 SavedSite 를 만든다. slotId=null/미매칭이면 기본안. */
function siteForSlot(
  p: SavedSite,
  slotId: string | null | undefined,
): SavedSite {
  if (!slotId) return p
  const v = (p.variants ?? []).find((x) => x.id === slotId)
  if (!v) return p
  return {
    ...p,
    hours: v.hours,
    chargers: v.chargers,
    feas: v.feas ?? p.feas,
    tariff: v.tariff,
    standby: v.standby,
    aptBill: v.aptBill,
  }
}

/** 목록·정렬용: 최종 결재 선택안(+결재 계약기간) 기준 사업성 결과. */
function projectFeas(
  p: SavedSite,
): ReturnType<typeof computeFeasibility> | null {
  return (
    projectFeasFull(
      siteForSlot(p, p.approval?.slotId),
      p.approval?.contractYears,
    )?.r ?? null
  )
}
/** 목록 표시용 계약기간: 결재 계약기간(설정 시) 또는 선택안의 계약연수. */
function projectYears(p: SavedSite): number | null {
  if (p.approval?.contractYears != null) return p.approval.contractYears
  return siteForSlot(p, p.approval?.slotId).feas?.years ?? null
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
    if (
      linkedLabels.includes(row.label) &&
      !(row.edited ?? []).includes('value')
    ) {
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
      const merged =
        sg.separated === false
          ? {
              ...base,
              contractKw: sg.contractKw,
              baseUnitPrice: sg.baseUnitPrice,
              apartmentBaseAlloc:
                prev.apartmentBaseAlloc ?? sg.apartmentBaseAlloc,
              // 주택용 누진(baseUnitTier)이면 세대당 기본료 사용 → 고지서 역산값 제거.
              baseUnitTier: sg.baseUnitTier,
              billBase: sg.baseUnitTier
                ? undefined
                : prev.billBase ?? sg.billBase,
              billContractKw: sg.baseUnitTier
                ? undefined
                : prev.billContractKw ?? sg.billContractKw,
              // 대기전력 손실 단가: 아파트 요금제 단가로 자동 연동.
              standbyRate: sg.standbyRate,
            }
          : // 모자분리 그룹: 계약전력(고지서 재책정/설비×0.8)·실효원가(Lv1) 자동 반영
            { ...base, contractKw: sg.contractKw, lv1Override: sg.lv1Override }
      // 사용자가 직접 수정한 필드(edited)는 seed로 덮어쓰지 않고 보존한다.
      const edited = prev.edited ?? []
      if (edited.length === 0) return merged
      const out: Record<string, unknown> = { ...merged }
      const prevRec = prev as unknown as Record<string, unknown>
      for (const k of edited) out[k] = prevRec[k]
      out.edited = edited
      return out as unknown as typeof merged
    }),
    // 운영비: 자동 산출 항목(정기·긴급점검·보험·수선)의 연비용만 대수 기준으로 연동.
    //  CS 운영(수동·별도 기입)과 사용자 추가 항목·비고는 보존.
    opex: (m.opex ?? []).map((r) => {
      // 사용자가 직접 수정한(yearCost 편집) 항목은 자동 연동에서 보존.
      if ((r.edited ?? []).includes('yearCost')) return r
      // 자동 산출 항목(대수 비례)은 연비용 연동. 사용자 추가 항목은 시드에 없어 보존.
      const sr =
        (s.opex ?? []).find((x) => x.id === r.id) ??
        (s.opex ?? []).find((x) => x.name === r.name)
      return sr ? { ...r, yearCost: sr.yearCost } : r
    }),
    // 인상 권고안: 현행 요금(current)만 '충전기 종류별 요금'에서 자동 연동.
    //  행 id 또는 라벨의 정격(kW)으로 시드 행을 매칭. 나머지 열(최소 인상안·비고)은 보존.
    recommend: (m.recommend ?? []).map((r) => {
      if ((r.edited ?? []).includes('current')) return r
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
  // 상세 화면 모드: 결재(요약·승인) / 분석·편집. 결재를 우선 표시.
  const [detailMode, setDetailMode] = usePersistentState<'approval' | 'work'>(
    'projectDetailMode',
    'approval',
  )
  // 정산 종류별 배분용 표준 월 대당 충전량 프로파일(편집 가능·전역 저장).
  const [kwhProfile, setKwhProfile] = usePersistentState<KwhProfile>(
    'settle.utilProfile',
    DEFAULT_KWH_PROFILE,
  )
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
        kwhProfile,
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

  // ── 대체안(변형 분석) ──
  //  이용량 분석·보고서는 기본안 공유. 사업성~아파트요금만 대체안별 별도 저장.
  //  working 상태(config/feas/tariff/standby/aptBill)는 '현재 선택 슬롯'을 나타낸다.
  const [variants, setVariants] = useState<AnalysisVariant[]>(
    () => project.variants ?? [],
  )
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null)
  // 기본안 슬롯 데이터(대체안 활성 시 보관·이용량/보고서·저장에 사용).
  const [baseSet, setBaseSet] = useState<AnalysisSet>(() => ({
    hours: project.hours,
    chargers: project.chargers.map((c) => ({ ...c })),
    feas: project.feas ?? DEFAULT_INPUTS(),
    tariff: deriveTariff(project),
    standby: project.standby ?? defaultStandby(),
    aptBill:
      project.aptBill ??
      (() => {
        const d = defaultApartmentBill()
        d.households = project.households ?? 0
        return d
      })(),
  }))
  const readWorking = (): AnalysisSet => ({
    hours: config.hours,
    chargers: config.chargers.map((c) => ({ ...c })),
    feas,
    tariff,
    standby,
    aptBill,
  })
  const applySet = (s: AnalysisSet | AnalysisVariant) => {
    setConfig({ hours: s.hours, chargers: s.chargers.map((c) => ({ ...c })) })
    setFeas(s.feas ?? DEFAULT_INPUTS())
    setTariff(s.tariff ?? deriveTariff(project))
    setStandby(s.standby ?? defaultStandby())
    setAptBill(s.aptBill ?? defaultApartmentBill())
  }
  // 현재 working 을 활성 슬롯에 반영(기본안 or 대체안).
  const commitActive = (wk: AnalysisSet) => {
    if (activeVariantId == null) setBaseSet(wk)
    else
      setVariants((prev) =>
        prev.map((v) => (v.id === activeVariantId ? { ...v, ...wk } : v)),
      )
  }
  const switchVariant = (targetId: string | null) => {
    if (targetId === activeVariantId) return
    commitActive(readWorking())
    if (targetId == null) applySet(baseSet)
    else {
      const v = variants.find((x) => x.id === targetId)
      if (v) applySet(v)
    }
    setActiveVariantId(targetId)
    if (targetId != null && subtab === 'report') setSubtab('feasibility')
  }
  const addVariant = () => {
    const wk = readWorking()
    commitActive(wk)
    const id = newSiteId()
    const label = `대체안 ${variants.length + 1}`
    const nv: AnalysisVariant = {
      id,
      label,
      hours: wk.hours,
      chargers: wk.chargers.map((c) => ({ ...c })),
      feas: wk.feas,
      tariff: wk.tariff,
      standby: wk.standby,
      aptBill: wk.aptBill,
    }
    setVariants((prev) => [...prev, nv])
    setActiveVariantId(id)
    if (subtab === 'report') setSubtab('feasibility')
    // working 은 그대로(=대체안 시작값) 두고, 여기서 충전기 제외 등을 편집.
  }
  const deleteVariant = (id: string) => {
    if (activeVariantId === id) {
      applySet(baseSet)
      setActiveVariantId(null)
    }
    setVariants((prev) => prev.filter((v) => v.id !== id))
  }
  const renameVariant = (id: string, label: string) =>
    setVariants((prev) => prev.map((v) => (v.id === id ? { ...v, label } : v)))
  // 이용량 분석용 config: 항상 기본안 기준(대체안 활성 시 baseSet).
  const usageConfig: SettlementConfig =
    activeVariantId == null
      ? config
      : { hours: baseSet.hours, chargers: baseSet.chargers }

  // 영업 상태(파이프라인) — 변경 즉시 저장.
  const [salesStatus, setSalesStatus] = useState<string>(
    project.salesStatus ?? '',
  )
  // 기설치 충전기(기존 설치분) — '변경 저장' 시 반영.
  const [preInstalled, setPreInstalled] = useState<PreInstalledCharger[]>(
    project.preInstalled ?? [],
  )
  // 설치 예정 충전기 — 이용률 분산 반영. '변경 저장' 시 반영.
  const [plannedInstall, setPlannedInstall] = useState<PreInstalledCharger[]>(
    project.plannedInstall ?? [],
  )
  // EV 등록 대수 — '변경 저장' 시 반영.
  const [evCount, setEvCount] = useState<number>(project.evCount ?? 0)
  // 현장 분석 승인 워크플로 상태(변경 즉시 저장).
  const [approval, setApproval] = useState<AnalysisApproval>(
    () => project.approval ?? defaultApproval(),
  )
  const updateApproval = (next: AnalysisApproval) => {
    const prev = approval
    setApproval(next)
    onUpdate(project.id, { approval: next })
    fireApprovalNotify(prev, next)
  }
  // 결재 상태 전이 → 메신저 알림(상신/승인/반려/최종승인). 실패는 무시.
  const fireApprovalNotify = (
    prev: AnalysisApproval,
    next: AnalysisApproval,
  ) => {
    const pjName = project.name || '(이름 없음)'
    const requestedAt = next.requestedAt ?? prev.requestedAt ?? ''
    const refId = `appr-${project.id}-${requestedAt}`.slice(0, 100)
    const sourceUrl = `${window.location.origin}/?project=${project.id}`
    const resolveAcct = (
      name: string | undefined,
      id?: string,
    ): { name?: string; uid?: string; email?: string } => {
      const a = accounts.find(
        (x) =>
          (id && x.id === id) ||
          x.name.trim() === (name ?? '').trim(),
      )
      // 요청자가 현재 로그인 사용자면 그 계정의 uid/email 우선.
      const cu =
        currentUser && currentUser.name.trim() === (name ?? '').trim()
          ? currentUser
          : null
      return {
        name: name || a?.name,
        uid: cu?.uid || a?.uid,
        email: cu?.email || a?.email,
      }
    }
    const requesterName = next.requestedBy || currentUser?.name || ''

    // 1) 검토→승인요청(상신): 1번 승인자에게
    if (prev.status !== 'requested' && next.status === 'requested') {
      const cur = next.approvers[next.currentStep]
      if (cur)
        notifyApproval({
          projectName: pjName,
          requesterName,
          eventType: 'requested',
          status: '상신',
          title: '결재 승인 요청',
          message: `${pjName} 현장 결재가 상신되었습니다. 승인 바랍니다.`,
          refId,
          sourceUrl,
          recipients: [resolveAcct(cur.name, cur.id)],
        })
      return
    }
    // 2) 진행 중 승인 → 다음 차례 승인자에게
    if (
      prev.status === 'requested' &&
      next.status === 'requested' &&
      next.currentStep > prev.currentStep
    ) {
      const cur = next.approvers[next.currentStep]
      if (cur)
        notifyApproval({
          projectName: pjName,
          requesterName,
          eventType: 'approved',
          status: '승인',
          title: '결재 승인 진행 · 다음 승인 요청',
          message: `${pjName} 현장, 승인 차례입니다.`,
          refId,
          sourceUrl,
          recipients: [resolveAcct(cur.name, cur.id)],
        })
      return
    }
    // 3) 최종 승인 완료 → 요청자에게
    if (prev.status === 'requested' && next.status === 'approved') {
      notifyApproval({
        projectName: pjName,
        requesterName,
        eventType: 'completed',
        status: '승인',
        title: '결재 최종 승인 완료',
        message: `${pjName} 현장 결재가 최종 승인되었습니다.`,
        refId,
        sourceUrl,
        recipients: [resolveAcct(requesterName)],
      })
      return
    }
    // 4) 반려 → 요청자에게
    if (prev.status !== 'rejected' && next.status === 'rejected') {
      notifyApproval({
        projectName: pjName,
        requesterName,
        eventType: 'rejected',
        status: '반려',
        title: '결재 반려',
        message: `${pjName} 현장 결재가 반려되었습니다.`,
        refId,
        sourceUrl,
        recipients: [resolveAcct(requesterName)],
      })
    }
  }
  // 로그인 사용자(SSO) — 승인 차례 게이트용.
  const [currentUser, setCurrentUser] = useState<SsoUser | null>(null)
  // 계정 명부 — 승인자 지정 드롭다운용.
  const [accounts, setAccounts] = useState<SsoAccount[]>([])
  // 기본안 담당자(전체 공통) — 설정에서 지정. 기본안 수정 권한 게이트용.
  const [baseManagers, setBaseManagers] = useState<SsoAccount[]>([])
  useEffect(() => {
    let alive = true
    ssoCurrentUser().then((u) => {
      if (alive) setCurrentUser(u ?? null)
    })
    ssoDirectory().then((list) => {
      if (alive) setAccounts(list)
    })
    ssoGetSettings().then((s) => {
      if (alive) setBaseManagers(s.baseManagers)
    })
    return () => {
      alive = false
    }
  }, [])
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
  // 설치 예정 충전기로 인한 이용률 분산 계수(0~1) — 사업성 이용률 희석용
  const utilShare = useMemo(
    () => utilShareFactor(effConfig.chargers, plannedInstall, kwhProfile),
    [effConfig, plannedInstall, kwhProfile],
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
    return (
      rows.reduce(
        (a, [kw, key]) =>
          a + ((feas[key] as number) || 0) * kw * 720 * countOf(kw),
        0,
      ) * utilShare
    )
  }, [feas, effConfig, utilShare])
  // 정산 종류별 자동 비례 배분 가중치 = 대수 × 표준 월 대당 충전량(kWh).
  //  요금 역산 불가(3종류 이상)일 때 총 사용량을 이 비중으로 배분해 이용률 추정.
  //  일반 공동주택 실적 기반이라 사업성 가정 이용률과 분리(사업성 %와 무관).
  //  이용량 분석은 기본안 기준(usageConfig) — 대체안의 충전기 제외에 영향받지 않음.
  const settleWeights = useMemo(() => {
    const w: Record<string, number> = {}
    for (const c of usageConfig.chargers)
      w[c.id] = c.count * monthlyKwhFromProfile(c.kw, kwhProfile)
    return w
  }, [usageConfig, kwhProfile])
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
      utilShareFactor: utilShare,
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
  }, [feas, effConfig, tariff, tariffEff, effMonthlyKwh, utilShare])

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
        kwhProfile,
      ),
    [site.name, site.households, effConfig, files, tariff, standby, feas, aptBill, kwhProfile],
  )
  useEffect(() => {
    // 보고서는 기본안 기준. 대체안 활성 중에는 자동연동을 멈춰 기본안 보고서를 보존.
    if (activeVariantId != null) return
    setReport((m) => mergeLinked(m, linkedSeed))
  }, [linkedSeed, activeVariantId])

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

  // 기본안(활성=기본안)은 '기본안 담당자(전체 공통)'만 수정 가능.
  //  담당자 미지정/비로그인이면 제약 없음. 대체안은 누구나.
  const isBaseManager =
    currentUser != null &&
    baseManagers.some(
      (m) =>
        m.id === currentUser.sub ||
        m.name.trim() === (currentUser.name ?? '').trim(),
    )
  const canEditBase =
    activeVariantId != null || // 대체안은 제약 없음
    baseManagers.length === 0 || // 담당자 미지정
    !currentUser || // 비로그인(로컬)
    isBaseManager

  function saveChanges() {
    if (!canEditBase) {
      window.alert(
        `기본안은 지정된 담당자(${baseManagers.map((m) => m.name).join(', ')})만 수정할 수 있습니다. (설정 · 기본안 담당자)`,
      )
      return
    }
    // 현재 working 을 활성 슬롯 기준으로 정리 → 기본안 필드 + 대체안 배열 저장.
    const wk = readWorking()
    const resolvedBase = activeVariantId == null ? wk : baseSet
    const resolvedVariants =
      activeVariantId == null
        ? variants
        : variants.map((v) =>
            v.id === activeVariantId ? { ...v, ...wk } : v,
          )
    onUpdate(project.id, {
      name: site.name,
      address: site.address,
      households: site.households,
      parking: site.parking,
      hours: resolvedBase.hours,
      chargers: resolvedBase.chargers.map((c) => ({ ...c })),
      files,
      feas: resolvedBase.feas,
      report,
      tariff: resolvedBase.tariff,
      standby: resolvedBase.standby,
      aptBill: resolvedBase.aptBill,
      approval,
      variants: resolvedVariants,
      fieldNote,
      bizFeeByYear: projectBizFee,
      preInstalled,
      plannedInstall,
      evCount,
    })
    setBaseSet(resolvedBase)
    setVariants(resolvedVariants)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  function resetConfig() {
    setConfig({
      hours: DEFAULT_CONFIG.hours,
      chargers: DEFAULT_CONFIG.chargers.map((c) => ({ ...c })),
    })
  }

  // ── 현장 요약 (저장된 데이터 기준) ──
  //  결재 뷰에서 기본안/대체안을 선택해 그 분석을 요약으로 본다(저장된 데이터 기준).
  const savedVariants = project.variants ?? []
  // 결재 대상 분석안 — 승인(approval)에 저장. null=기본안. 승인 진행 중 잠금.
  const targetSlotId = approval.slotId ?? null
  const slotLocked =
    approval.status === 'requested' || approval.status === 'approved'
  // 요약 보기 탭 — 결재 대상과 별개로 어떤 안이든 보기 전용 전환 가능. 초기값=결재 대상.
  const [viewSlotId, setViewSlotId] = useState<string | null>(
    approval.slotId ?? null,
  )
  // 탭 선택: 항상 보기 전환, 편집 가능 상태면 결재 대상도 함께 지정.
  const selectSlot = (id: string | null) => {
    setViewSlotId(id)
    if (!slotLocked && id !== targetSlotId)
      updateApproval({ ...approval, slotId: id })
  }
  // 프로젝트별 영업비 1대분(계약년수별). 숫자(0 포함)=적용, null=미기입(전체 기준값).
  //  자동저장 없음 — '변경 저장'을 눌러야 반영(saveChanges에서 함께 저장).
  const [projectBizFee, setProjectBizFee] = useState<(number | null)[]>(
    project.bizFeeByYear ?? [],
  )
  // 현장 의견(결재 참고 메모) — 입력 후 포커스 아웃 시 저장.
  const [fieldNote, setFieldNote] = useState<string>(project.fieldNote ?? '')
  const saveFieldNote = () => {
    if ((project.fieldNote ?? '') !== fieldNote)
      onUpdate(project.id, { fieldNote })
  }
  // 저장 후 사라진 대체안을 가리키면 기본안으로.
  const viewSlotValid =
    viewSlotId == null || savedVariants.some((v) => v.id === viewSlotId)
  const summarySlot = useMemo(() => {
    const sv =
      viewSlotValid && viewSlotId != null
        ? savedVariants.find((v) => v.id === viewSlotId) ?? null
        : null
    const site: SavedSite = sv
      ? {
          ...project,
          hours: sv.hours,
          chargers: sv.chargers,
          feas: sv.feas ?? project.feas,
          tariff: sv.tariff,
          standby: sv.standby,
          aptBill: sv.aptBill,
        }
      : project
    return { sv, site }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, viewSlotId, viewSlotValid])
  const slotSite = summarySlot.site
  const summaryYearsList = [3, 5, 7]
  const summaryByYear = useMemo(
    () => summaryYearsList.map((y) => ({ y, full: projectFeasFull(slotSite, y) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slotSite],
  )
  // 현재 계약연수 기준 상세(P&L·충전기별 단가).
  const summaryCur = useMemo(
    () => projectFeasFull(slotSite),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slotSite],
  )
  const effChargers = slotSite.chargers
    .filter((c) => !c.excluded && c.count > 0)
    .slice()
    .sort((a, b) => b.kw - a.kw)
  const summaryTotalUnits = effChargers.reduce((a, c) => a + c.count, 0)
  const summaryInstalledKw = effChargers.reduce((a, c) => a + c.kw * c.count, 0)
  // 강조 연도: 결재 계약기간(설정 시) 우선, 없으면 보는 안의 계약연수.
  const highlightYears =
    approval.contractYears ??
    (slotSite.feas
      ? Math.max(1, Math.min(MAX_YEARS, Math.round(slotSite.feas.years)))
      : null)
  // 비교 연도: 대체안(보는 안)의 계약연수(또는 결재 계약기간) — 기본안도 이 연도로 동일 비교.
  const cmpYears =
    highlightYears ??
    (slotSite.feas ? Math.round(slotSite.feas.years) : 5)
  // 비교표(기본안 vs 선택 대체안) — 양쪽 모두 cmpYears 기준으로 산출해 동일 비교.
  const cmpBaseFull = useMemo(
    () => projectFeasFull(project, cmpYears),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, cmpYears],
  )
  const cmpSelFull = useMemo(
    () => projectFeasFull(slotSite, cmpYears),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [slotSite, cmpYears],
  )
  const cmpEffCount = (site: SavedSite, kw: number) => {
    const c = site.chargers.find((x) => x.kw === kw)
    return c && !c.excluded ? c.count : 0
  }
  const cmpKws = useMemo(() => {
    const s = new Set<number>()
    for (const c of project.chargers)
      if (!c.excluded && c.count > 0) s.add(c.kw)
    for (const c of slotSite.chargers)
      if (!c.excluded && c.count > 0) s.add(c.kw)
    return [...s].sort((a, b) => b - a)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, slotSite])
  const cmpBaseKw = project.chargers.reduce(
    (a, c) => a + (c.excluded ? 0 : c.kw * c.count),
    0,
  )

  // 분석안별 의견(slotNotes) — 키 'base'=기본안, 그 외=variant id. 변형 배열과 독립.
  const slotNoteKey = viewSlotId ?? 'base'
  const slotNoteSaved = project.slotNotes?.[slotNoteKey] ?? ''
  const [slotNoteDraft, setSlotNoteDraft] = useState(slotNoteSaved)
  useEffect(() => {
    setSlotNoteDraft(slotNoteSaved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotNoteKey, slotNoteSaved])
  const saveSlotNote = () => {
    if (slotNoteDraft === slotNoteSaved) return
    onUpdate(project.id, {
      slotNotes: { ...(project.slotNotes ?? {}), [slotNoteKey]: slotNoteDraft },
    })
  }
  // 결재 계약기간 변경(잠금 시 불가).
  const setApprovalYears = (y: number | undefined) => {
    if (slotLocked) return
    updateApproval({ ...approval, contractYears: y })
  }
  const curYears = slotSite.feas
    ? Math.max(1, Math.min(MAX_YEARS, Math.round(slotSite.feas.years)))
    : null
  const fmtWon = (v?: number) =>
    v == null || !Number.isFinite(v) ? '—' : `${Math.round(v).toLocaleString()}원`
  const fmtPct = (v?: number) =>
    v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(2)}%`
  const fmtRate = (v?: number) =>
    v == null || !Number.isFinite(v)
      ? '—'
      : `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}원/kWh`

  // 요약 상단 승인 컨트롤(승인 요청 / 승인 / 반려).
  const summaryApprover =
    approval.status === 'requested' ? approval.approvers[approval.currentStep] : null
  const summaryCanDecide = approvalCanDecide(approval, currentUser)
  const requestApproval = () => {
    if (approval.approvers.length === 0) return
    updateApproval(
      approvalRequest(approval, currentUser?.name, new Date().toISOString()),
    )
  }
  const decideApprovalSummary = (d: 'approved' | 'rejected') =>
    updateApproval(approvalDecide(approval, d, new Date().toISOString()))
  const APPROVAL_LABEL: Record<AnalysisApproval['status'], string> = {
    review: '분석 중',
    reviewed: '분석 완료',
    sales_review: '영업 분석 중',
    sales_reviewed: '영업 분석 완료',
    requested: '승인 요청(진행중)',
    approved: '승인 완료',
    rejected: '반려',
  }
  const canRequest = (
    ['review', 'reviewed', 'sales_review', 'sales_reviewed'] as const
  ).includes(approval.status as 'review')

  return (
    <div className="projects">
      <div className="detail-top">
        <button type="button" className="link-button back-link" onClick={onBack}>
          ← 프로젝트 목록
        </button>
        <div className="detail-modes" role="tablist">
          <button
            type="button"
            role="tab"
            className={`detail-mode${detailMode === 'approval' ? ' detail-mode--active' : ''}`}
            onClick={() => setDetailMode('approval')}
          >
            결재 · 요약
          </button>
          <button
            type="button"
            role="tab"
            className={`detail-mode${detailMode === 'work' ? ' detail-mode--active' : ''}`}
            onClick={() => setDetailMode('work')}
          >
            분석 · 편집
          </button>
        </div>
      </div>

      {detailMode === 'approval' && (
      <>
      <section className="card field-note">
        <label className="field-note__label" htmlFor="field-note">
          현장 의견
        </label>
        <textarea
          id="field-note"
          className="field-note__area"
          value={fieldNote}
          onChange={(e) => setFieldNote(e.target.value)}
          onBlur={saveFieldNote}
          rows={3}
          placeholder="현장 관련 의견·특이사항을 입력하세요. (결재 참고용 · 포커스 아웃 시 자동 저장)"
        />
      </section>

      {savedVariants.length > 0 && (
        <section className="card slot-select">
          <span className="slot-select__label">분석안 보기</span>
          <div className="variant-tabs" role="tablist">
            {[{ id: null as string | null, label: '기본안' }, ...savedVariants].map(
              (opt) => (
                <button
                  key={opt.id ?? 'base'}
                  type="button"
                  className={`variant-tab${viewSlotId === opt.id ? ' variant-tab--active' : ''}${
                    targetSlotId === opt.id ? ' variant-tab--target' : ''
                  }`}
                  onClick={() => selectSlot(opt.id)}
                  title={
                    targetSlotId === opt.id ? '현재 결재 대상' : undefined
                  }
                >
                  {opt.label}
                  {targetSlotId === opt.id && (
                    <span className="variant-tab__mark">★ 결재대상</span>
                  )}
                </button>
              ),
            )}
          </div>
          <span className="slot-select__cur">
            보기:{' '}
            <b>
              {viewSlotId == null
                ? '기본안'
                : (savedVariants.find((v) => v.id === viewSlotId)?.label ??
                  '기본안')}
            </b>
            {' · 결재 대상: '}
            <b>
              {targetSlotId == null
                ? '기본안'
                : (savedVariants.find((v) => v.id === targetSlotId)?.label ??
                  '기본안')}
            </b>
            {slotLocked && (
              <span className="slot-select__lock"> 🔒 잠금(승인 진행 중)</span>
            )}
          </span>
          {slotLocked && (
            <p className="slot-select__note">
              결재 대상은 승인 진행 중이라 고정됩니다. 탭은 <b>보기 전용</b>으로
              자유롭게 전환해 각 안의 요약을 확인할 수 있습니다.
            </p>
          )}
        </section>
      )}

      <section className="card summary-card">
        <div className="card__header summary-head">
          <div className="summary-head__title">
            <h2>현장 요약</h2>
            <span className="summary-slot-tag">
              {viewSlotId == null
                ? '기본안'
                : (savedVariants.find((v) => v.id === viewSlotId)?.label ??
                  '기본안')}
              {viewSlotId !== targetSlotId && ' · 보기 전용'}
            </span>
            <label className="summary-years">
              결재 계약기간
              <select
                value={approval.contractYears ?? ''}
                disabled={slotLocked}
                onChange={(e) =>
                  setApprovalYears(
                    e.target.value === '' ? undefined : Number(e.target.value),
                  )
                }
              >
                <option value="">미설정</option>
                {[1, 2, 3, 4, 5, 6, 7].map((y) => (
                  <option key={y} value={y}>
                    {y}년
                  </option>
                ))}
              </select>
            </label>
            {approval.contractYears != null ? (
              <span className="summary-cur summary-cur--set">
                결재 {approval.contractYears}년 강조
              </span>
            ) : (
              curYears != null && (
                <span className="summary-cur">계약연수 {curYears}년(안 기준)</span>
              )
            )}
          </div>
          <div className="summary-approve">
            <span
              className={`approval__badge approval__badge--${approval.status} summary-approve__badge`}
            >
              {APPROVAL_LABEL[approval.status]}
            </span>
            {canRequest && (
              <button
                type="button"
                className="approval__btn approval__btn--primary"
                disabled={approval.approvers.length === 0}
                title={
                  approval.approvers.length === 0
                    ? '아래 승인 패널에서 승인자를 먼저 지정하세요.'
                    : undefined
                }
                onClick={requestApproval}
              >
                승인 요청
              </button>
            )}
            {approval.status === 'requested' && summaryApprover && (
              <>
                <span className="summary-approve__turn">
                  현재 차례 <b>{summaryApprover.name}</b>
                </span>
                <button
                  type="button"
                  className="approval__btn approval__btn--primary"
                  disabled={!summaryCanDecide}
                  onClick={() => decideApprovalSummary('approved')}
                >
                  승인
                </button>
                <button
                  type="button"
                  className="approval__btn approval__btn--danger"
                  disabled={!summaryCanDecide}
                  onClick={() => decideApprovalSummary('rejected')}
                >
                  반려
                </button>
              </>
            )}
          </div>
        </div>

        <div className="summary-overview">
          <div>
            <span className="summary-k">단지명</span>
            <span className="summary-v">{project.name || '—'}</span>
          </div>
          <div>
            <span className="summary-k">주소</span>
            <span className="summary-v">{project.address || '—'}</span>
          </div>
          <div>
            <span className="summary-k">세대수</span>
            <span className="summary-v">
              {project.households ? project.households.toLocaleString() : '—'}
            </span>
          </div>
          <div>
            <span className="summary-k">총 주차대수</span>
            <span className="summary-v">
              {project.parking ? project.parking.toLocaleString() : '—'}
            </span>
          </div>
          <div>
            <span className="summary-k">충전기</span>
            <span className="summary-v">
              총 {summaryTotalUnits}기
              {effChargers.length > 0 && (
                <em className="summary-sub">
                  {' '}
                  {effChargers.map((c) => `${c.kw}kW ${c.count}`).join(' · ')}
                </em>
              )}
            </span>
          </div>
          <div>
            <span className="summary-k">총 설비용량</span>
            <span className="summary-v">
              {summaryInstalledKw > 0
                ? `${summaryInstalledKw.toLocaleString()} kW`
                : '—'}
            </span>
          </div>
        </div>

        <div className="slot-note">
          <label className="slot-note__label" htmlFor="slot-note">
            {viewSlotId == null
              ? '기본안 의견'
              : `${savedVariants.find((v) => v.id === viewSlotId)?.label ?? '대체안'} 의견`}
          </label>
          <textarea
            id="slot-note"
            className="field-note__area"
            value={slotNoteDraft}
            onChange={(e) => setSlotNoteDraft(e.target.value)}
            onBlur={saveSlotNote}
            rows={2}
            placeholder="이 분석안에 대한 의견을 입력하세요. (분석안별 저장 · 포커스 아웃 시 자동 저장)"
          />
        </div>

        {viewSlotId != null && summarySlot.sv && (
          <div className="table-scroll summary-block">
            <div className="summary-block__h">
              기본안 vs 선택안 비교
            </div>
            <table className="data-table summary-table summary-cmp">
              <thead>
                <tr>
                  <th>항목</th>
                  <th className="proj-num">기본안</th>
                  <th className="proj-num summary-col--cur">
                    {summarySlot.sv.label}
                  </th>
                </tr>
              </thead>
              <tbody>
                {cmpKws.map((kw) => {
                  const b = cmpEffCount(project, kw)
                  const s = cmpEffCount(slotSite, kw)
                  return (
                    <tr key={kw}>
                      <th>{kw}kW 대수</th>
                      <td className="proj-num">{b}기</td>
                      <td
                        className={`proj-num summary-col--cur${s !== b ? ' cell--down' : ''}`}
                      >
                        {s}기
                      </td>
                    </tr>
                  )
                })}
                <tr className="summary-pl__strong">
                  <th>총 대수</th>
                  <td className="proj-num">
                    {project.chargers.reduce(
                      (a, c) => a + (c.excluded ? 0 : c.count),
                      0,
                    )}
                    기
                  </td>
                  <td className="proj-num summary-col--cur">
                    {summaryTotalUnits}기
                  </td>
                </tr>
                <tr>
                  <th>총 설비용량</th>
                  <td className="proj-num">
                    {cmpBaseKw.toLocaleString()} kW
                  </td>
                  <td className="proj-num summary-col--cur">
                    {summaryInstalledKw.toLocaleString()} kW
                  </td>
                </tr>
                <tr>
                  <th>계약연수(동일 기준)</th>
                  <td className="proj-num">{cmpYears}년</td>
                  <td className="proj-num summary-col--cur">{cmpYears}년</td>
                </tr>
                <tr className="summary-pl__strong">
                  <th>영업이익률</th>
                  <td
                    className={`proj-num${cmpBaseFull && cmpBaseFull.r.margin < 0 ? ' cell--down' : ''}`}
                  >
                    {fmtPct(cmpBaseFull?.r.margin)}
                  </td>
                  <td
                    className={`proj-num summary-col--cur${cmpSelFull && cmpSelFull.r.margin < 0 ? ' cell--down' : ''}`}
                  >
                    {fmtPct(cmpSelFull?.r.margin)}
                  </td>
                </tr>
                <tr className="summary-pl__strong">
                  <th>영업이익</th>
                  <td
                    className={`proj-num${cmpBaseFull && cmpBaseFull.r.operatingProfit < 0 ? ' cell--down' : ''}`}
                  >
                    {fmtWon(cmpBaseFull?.r.operatingProfit)}
                  </td>
                  <td
                    className={`proj-num summary-col--cur${cmpSelFull && cmpSelFull.r.operatingProfit < 0 ? ' cell--down' : ''}`}
                  >
                    {fmtWon(cmpSelFull?.r.operatingProfit)}
                  </td>
                </tr>
                <tr>
                  <th>CAPEX·영업비 회수기간</th>
                  <td className="proj-num">{cmpBaseFull?.paybackText ?? '—'}</td>
                  <td className="proj-num summary-col--cur">
                    {cmpSelFull?.paybackText ?? '—'}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="summary-note">
              지금 <b>{summarySlot.sv.label}</b>을(를) 보고 있습니다
              {viewSlotId === targetSlotId
                ? ' — 현재 결재 대상입니다.'
                : ' (보기 전용).'}{' '}
              비교는 <b>{cmpYears}년</b>(대체안 계약연수
              {approval.contractYears != null ? ' · 결재 계약기간' : ''}) 기준으로
              기본안·대체안을 <b>동일 조건</b>으로 산출했습니다.
            </p>
          </div>
        )}

        {project.feas && summaryCur && summaryCur.perCharger.length > 0 && (
          <div className="table-scroll summary-block">
            <div className="summary-block__h">충전기별 반영 단가</div>
            <table className="data-table summary-table">
              <thead>
                <tr>
                  <th>종류</th>
                  <th className="proj-num">대수</th>
                  <th className="proj-num">충전단가(VAT 포함)</th>
                  <th className="proj-num">전기원가(VAT 제외)</th>
                  <th className="proj-num">단가차(마진)</th>
                </tr>
              </thead>
              <tbody>
                {summaryCur.perCharger.map((pc) => {
                  const rateEx = pc.rateVat / 1.1
                  const gap = rateEx - pc.elecCost
                  return (
                    <tr key={pc.kw}>
                      <th>{pc.kw}kW</th>
                      <td className="proj-num">{pc.count}기</td>
                      <td className="proj-num">{fmtRate(pc.rateVat)}</td>
                      <td className="proj-num">{fmtRate(pc.elecCost)}</td>
                      <td className={`proj-num${gap < 0 ? ' cell--down' : ''}`}>
                        {fmtRate(gap)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="summary-note">
              충전단가는 종류별 입력값(없으면 충전기 요금)을, 전기원가는 요금구조
              분석의 실효원가를 반영합니다. 단가차 = 충전단가(VAT 제외) − 전기원가.
            </p>
          </div>
        )}

        {project.feas && (
          <div className="table-scroll summary-block">
            <div className="summary-block__h">사업 전체 손익 (P&L · 계약연수별)</div>
            <table className="data-table summary-table summary-pl">
              <thead>
                <tr>
                  <th>항목</th>
                  {summaryByYear.map(({ y }) => (
                    <th
                      key={y}
                      className={`proj-num${y === highlightYears ? ' summary-col--cur' : ''}`}
                    >
                      {y}년
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ['매출 (VAT 제외)', 'revenue', false, false],
                    ['(−) PG 수수료', 'pgFee', true, false],
                    ['(−) 전기원가 (충전)', 'elecCost', true, false],
                    ['(−) 전기원가 (대기전력)', 'standbyCost', true, false],
                    ['매출총이익', 'grossProfit', false, true],
                    ['(−) 현장 운영비', 'opsCost', true, false],
                    ['(−) 영업비 (총)', 'bizCost', true, false],
                    ['(−) CAPEX', 'capex', true, false],
                    ['영업이익', 'operatingProfit', false, true],
                  ] as [
                    string,
                    keyof ReturnType<typeof computeFeasibility>,
                    boolean,
                    boolean,
                  ][]
                ).map(([label, key, neg, strong]) => (
                  <tr key={label} className={strong ? 'summary-pl__strong' : ''}>
                    <th>{label}</th>
                    {summaryByYear.map(({ y, full }) => (
                      <td
                        key={y}
                        className={`proj-num${neg ? ' cell--down' : ''}${
                          y === highlightYears ? ' summary-col--cur' : ''
                        }`}
                      >
                        {fmtWon(full?.r[key] as number | undefined)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="summary-pl__strong">
                  <th>영업이익률</th>
                  {summaryByYear.map(({ y, full }) => (
                    <td
                      key={y}
                      className={`proj-num${full && full.r.margin < 0 ? ' cell--down' : ''}${
                        y === highlightYears ? ' summary-col--cur' : ''
                      }`}
                    >
                      {fmtPct(full?.r.margin)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th>CAPEX·영업비 회수기간</th>
                  {summaryByYear.map(({ y, full }) => (
                    <td
                      key={y}
                      className={`proj-num${full && !full.paybackReached ? ' cell--down' : ''}${
                        y === highlightYears ? ' summary-col--cur' : ''
                      }`}
                    >
                      {full?.paybackText ?? '—'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th>판정</th>
                  {summaryByYear.map(({ y, full }) => (
                    <td
                      key={y}
                      className={y === highlightYears ? 'summary-col--cur' : ''}
                    >
                      <span
                        className={`summary-verdict summary-verdict--${
                          full?.r.verdict === '진행가능'
                            ? 'ok'
                            : full?.r.verdict === '진행불가'
                              ? 'no'
                              : 'na'
                        }`}
                      >
                        {full?.r.verdict ?? '—'}
                      </span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {!project.feas && (
          <p className="summary-empty">
            사업성 입력이 없어 요약 지표를 계산할 수 없습니다. 사업성 분석 탭에서
            먼저 입력·저장해 주세요.
          </p>
        )}
        <p className="summary-note">
          동일 조건(충전기 구성·이용률·요금)에서 계약연수(3·5·7년)만 달리해 산출한
          결과입니다. 모든 지표는 저장된 데이터 기준입니다. 분석 값 변경은{' '}
          <b>분석 · 편집</b> 탭에서 하고 저장하면 요약에 반영됩니다.
        </p>
      </section>

      <ApprovalPanel
        approval={approval}
        onChange={updateApproval}
        currentUser={currentUser}
        accounts={accounts}
        salesStatus={salesStatus}
        onSalesStatus={(s) => {
          setSalesStatus(s)
          onUpdate(project.id, { salesStatus: s })
        }}
      />
      </>
      )}

      {detailMode === 'work' && (
      <>
      <section className="card variant-bar">
        <div className="variant-bar__row">
          <span className="variant-bar__label">분석안</span>
          <div className="variant-tabs" role="tablist">
            <button
              type="button"
              className={`variant-tab${activeVariantId == null ? ' variant-tab--active' : ''}`}
              onClick={() => switchVariant(null)}
            >
              기본안
            </button>
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                className={`variant-tab${activeVariantId === v.id ? ' variant-tab--active' : ''}`}
                onClick={() => switchVariant(v.id)}
              >
                {v.label}
              </button>
            ))}
            <button
              type="button"
              className="variant-tab variant-tab--add"
              onClick={addVariant}
            >
              + 대체안 추가
            </button>
          </div>
          {activeVariantId != null && (
            <div className="variant-bar__actions">
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  const cur = variants.find((v) => v.id === activeVariantId)
                  const name = window.prompt('대체안 이름', cur?.label ?? '')
                  if (name && name.trim())
                    renameVariant(activeVariantId, name.trim())
                }}
              >
                이름 변경
              </button>
              <button
                type="button"
                className="link-button link-button--danger"
                onClick={() => {
                  if (window.confirm('이 대체안을 삭제할까요?'))
                    deleteVariant(activeVariantId)
                }}
              >
                삭제
              </button>
            </div>
          )}
        </div>
        <p className="variant-bar__note">
          {activeVariantId == null
            ? '기본안입니다. “대체안 추가”를 누르면 현재 분석을 복제해, 충전기 일부 제외 등으로 사업성~아파트요금을 별도 저장할 수 있습니다. 이용량 분석·보고서는 기본안과 공유됩니다.'
            : '대체안 편집 중 — 충전기 구성(제외 등)·사업성·요금구조·대기전력·아파트요금이 이 대체안으로 저장됩니다. 이용량 분석·보고서는 기본안 기준이며, 변경 저장을 눌러야 반영됩니다.'}
        </p>
      </section>

      <section className="card">
        <div className="card__header">
          <h2>
            {site.name || '(이름 없음)'} · 편집
            {activeVariantId != null && (
              <span className="variant-cur">
                {' · '}
                {variants.find((v) => v.id === activeVariantId)?.label}
              </span>
            )}
          </h2>
          <div className="site-edit-actions">
            {saved && <span className="saved-note">저장됨 ✓</span>}
            <button
              type="button"
              className="btn-primary"
              onClick={saveChanges}
              disabled={!canEditBase}
              title={
                !canEditBase
                  ? `기본안은 담당자(${approval.assignee})만 수정할 수 있습니다.`
                  : undefined
              }
            >
              변경 저장
            </button>
          </div>
        </div>
        {!canEditBase && (
          <p className="edit-locked-note">
            🔒 기본안은 지정된 담당자(
            <b>{baseManagers.map((m) => m.name).join(', ')}</b>)만 수정할 수
            있습니다. 입력은 가능하지만 저장되지 않습니다. (설정 · 기본안 담당자)
          </p>
        )}
        <SiteConfigForm
          site={site}
          setSite={setSite}
          config={config}
          setConfig={setConfig}
          onReset={resetConfig}
          preInstalled={preInstalled}
          setPreInstalled={setPreInstalled}
          plannedInstall={plannedInstall}
          setPlannedInstall={setPlannedInstall}
          evCount={evCount}
          setEvCount={setEvCount}
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
        {activeVariantId == null && (
          <button
            type="button"
            role="tab"
            className={`subtab${subtab === 'report' ? ' subtab--active' : ''}`}
            onClick={() => setSubtab('report')}
          >
            보고서
          </button>
        )}
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
              kwhProfile,
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
          inputs={{ ...feas, utilShareFactor: utilShare }}
          setInputs={(next) => setFeas({ ...next, utilShareFactor: undefined })}
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
          projectBizFee={projectBizFee}
          setProjectBizFee={setProjectBizFee}
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
              config={usageConfig}
              site={site}
              autoWeights={settleWeights}
              kwhProfile={kwhProfile}
              setKwhProfile={setKwhProfile}
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
  const [filterApproval, setFilterApproval] = useState('')
  const [filterSales, setFilterSales] = useState('')
  const [filterSlot, setFilterSlot] = useState('')
  // 기본 정렬: 생성 순서 최신순(배열 뒤쪽=최근 생성 → 위로).
  const [sortKey, setSortKey] = useState<string>('created')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const selected = projects.find((p) => p.id === selectedId) ?? null

  const chargerCount = (p: SavedSite) =>
    p.chargers.reduce((a, c) => a + c.count, 0)
  const etcChargerCount = (p: SavedSite) =>
    (p.preInstalled ?? []).reduce((a, c) => a + (c.count || 0), 0)
  const totalChargerCount = (p: SavedSite) =>
    chargerCount(p) + etcChargerCount(p)
  // 목록 표시용 파생값(영업이익률·영업이익)은 프로젝트 변경 시에만 재계산.
  const feasById = useMemo(() => {
    const m = new Map<string, ReturnType<typeof computeFeasibility> | null>()
    for (const p of projects) m.set(p.id, projectFeas(p))
    return m
  }, [projects])
  const val = (p: SavedSite, key: string): string | number => {
    switch (key) {
      case 'name':
        return p.name
      case 'address':
        return p.address ?? ''
      case 'chargers':
        return chargerCount(p)
      case 'etcChargers':
        return etcChargerCount(p)
      case 'totalChargers':
        return totalChargerCount(p)
      case 'households':
        return p.households ?? 0
      case 'parking':
        return p.parking ?? 0
      case 'pct2':
        return Math.round((p.parking ?? 0) * 0.02)
      case 'pct5':
        return Math.round((p.parking ?? 0) * 0.05)
      case 'ev':
        return p.evCount ?? 0
      case 'years':
        return projectYears(p) ?? 0
      case 'margin':
        return feasById.get(p.id)?.margin ?? -Infinity
      case 'profit':
        return feasById.get(p.id)?.operatingProfit ?? -Infinity
      case 'approval':
        return p.approval?.status ?? 'review'
      case 'salesStatus':
        return p.salesStatus ?? ''
      case 'slot':
        return p.approval?.slotId
          ? ((p.variants ?? []).find((v) => v.id === p.approval?.slotId)
              ?.label ?? '기본안')
          : '기본안'
      default:
        return ''
    }
  }

  const q = query.trim().toLowerCase()
  const filtered = projects.filter((p) => {
    const matchQ =
      !q ||
      p.name.toLowerCase().includes(q) ||
      (p.address ?? '').toLowerCase().includes(q)
    const matchApproval =
      !filterApproval || (p.approval?.status ?? 'review') === filterApproval
    const matchSales = !filterSales || (p.salesStatus ?? '') === filterSales
    const slotIsVariant = !!p.approval?.slotId
    const matchSlot =
      !filterSlot ||
      (filterSlot === 'base' ? !slotIsVariant : slotIsVariant)
    return matchQ && matchApproval && matchSales && matchSlot
  })

  // 생성 순서 인덱스(배열 순서 = 만든 순서).
  const orderIndex = useMemo(() => {
    const m = new Map<string, number>()
    projects.forEach((p, i) => m.set(p.id, i))
    return m
  }, [projects])
  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === 'created') {
      const cmp = (orderIndex.get(a.id) ?? 0) - (orderIndex.get(b.id) ?? 0)
      return sortDir === 'asc' ? cmp : -cmp
    }
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
    { key: 'chargers', label: '위차 충전기', num: true },
    { key: 'etcChargers', label: '기타 충전기', num: true },
    { key: 'totalChargers', label: '총 충전기', num: true },
    { key: 'parking', label: '총 주차면', num: true },
    { key: 'pct2', label: '2%', num: true },
    { key: 'pct5', label: '5%', num: true },
    { key: 'ev', label: 'EV 등록', num: true },
    { key: 'years', label: '계약기간', num: true },
    { key: 'margin', label: '영업이익률', num: true },
    { key: 'approval', label: '승인 상태' },
    { key: 'salesStatus', label: '영업 상태' },
    { key: 'slot', label: '분석안' },
  ]
  const sortMark = (key: string) =>
    sortKey === key ? (sortDir === 'asc' ? ' ↓' : ' ↑') : ''

  return (
    <div className="projects">
      {/* 검색 + 필터 */}
      <div className="proj-panel">
        <input
          type="search"
          className="proj-search"
          placeholder="단지명 · 주소 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="proj-filters">
          <select
            className="proj-filter"
            value={filterApproval}
            onChange={(e) => setFilterApproval(e.target.value)}
          >
            <option value="">승인 상태 전체</option>
            {(
              [
                ['review', '분석 중'],
                ['reviewed', '분석 완료'],
                ['sales_review', '영업 분석 중'],
                ['sales_reviewed', '영업 분석 완료'],
                ['requested', '승인 요청'],
                ['approved', '승인 완료'],
                ['rejected', '반려'],
              ] as [string, string][]
            ).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select
            className="proj-filter"
            value={filterSales}
            onChange={(e) => setFilterSales(e.target.value)}
          >
            <option value="">영업 상태 전체</option>
            {SALES_STATUS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            className="proj-filter"
            value={filterSlot}
            onChange={(e) => setFilterSlot(e.target.value)}
          >
            <option value="">분석안 전체</option>
            <option value="base">기본안</option>
            <option value="variant">대체안</option>
          </select>
          {(filterApproval || filterSales || filterSlot || query) && (
            <button
              type="button"
              className="link-button"
              onClick={() => {
                setFilterApproval('')
                setFilterSales('')
                setFilterSlot('')
                setQuery('')
              }}
            >
              필터 초기화
            </button>
          )}
        </div>
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
                    {chargerBreakdown(p) && (
                      <div className="proj-charger-breakdown">
                        {chargerBreakdown(p)}
                      </div>
                    )}
                  </td>
                  <td className="proj-num">
                    {etcChargerCount(p)
                      ? `${etcChargerCount(p).toLocaleString()}기`
                      : '—'}
                  </td>
                  <td className="proj-num">
                    {totalChargerCount(p)
                      ? `${totalChargerCount(p).toLocaleString()}기`
                      : '—'}
                  </td>
                  <td className="proj-num">
                    {p.parking ? p.parking.toLocaleString() : '—'}
                  </td>
                  <td className="proj-num">
                    {p.parking
                      ? Math.round(p.parking * 0.02).toLocaleString()
                      : '—'}
                  </td>
                  <td className="proj-num">
                    {p.parking
                      ? Math.round(p.parking * 0.05).toLocaleString()
                      : '—'}
                  </td>
                  <td className="proj-num">
                    {p.evCount ? p.evCount.toLocaleString() : '—'}
                  </td>
                  <td className="proj-num">
                    {(() => {
                      const yrs = projectYears(p)
                      return yrs ? `${yrs}년` : '—'
                    })()}
                  </td>
                  <td className="proj-num">
                    {(() => {
                      const mg = feasById.get(p.id)?.margin
                      return mg == null || !Number.isFinite(mg)
                        ? '—'
                        : `${(mg * 100).toFixed(2)}%`
                    })()}
                  </td>
                  <td>
                    {(() => {
                      const st = p.approval?.status ?? 'review'
                      const label =
                        st === 'review'
                          ? '분석 중'
                          : st === 'reviewed'
                            ? '분석 완료'
                            : st === 'sales_review'
                              ? '영업 분석 중'
                              : st === 'sales_reviewed'
                                ? '영업 분석 완료'
                                : st === 'requested'
                                  ? '승인 요청'
                                  : st === 'approved'
                                    ? '승인 완료'
                                    : '반려'
                      return (
                        <span
                          className={`approval__badge approval__badge--${st} proj-approval`}
                        >
                          {label}
                        </span>
                      )
                    })()}
                  </td>
                  <td>
                    <span className="proj-sales-tag">
                      {p.salesStatus || '—'}
                    </span>
                  </td>
                  <td>
                    {(() => {
                      const isBaseSlot = !p.approval?.slotId
                      const slotLabel = isBaseSlot
                        ? '기본안'
                        : ((p.variants ?? []).find(
                            (v) => v.id === p.approval?.slotId,
                          )?.label ?? '기본안')
                      return (
                        <span
                          className={`proj-slot-tag proj-slot-tag--${isBaseSlot ? 'base' : 'variant'}`}
                        >
                          {slotLabel}
                        </span>
                      )
                    })()}
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
