// CMO 컨설팅 보고서 모델.
// 실효 전기원가 산출·운영비 내역의 '구분'은 고정, 금액만 편집 가능하며,
// 산출된 전기원가(Lv1)와 운영비(원/kWh)가 손익·요금 하한선 표에 자동 반영된다.

export interface ElecCostInput {
  /** (A) 시간대·계절 가중 전력량요금 (원/kWh) */
  powerRate: number
  /** 계약전력 (kW) — (B) 기본요금 환산의 분자 */
  contractKw: number
  /** kWh당 기본요금 단가 (원/kW) */
  baseUnitPrice: number
  /** 월 사용량 (kWh) — (B) 분모이자 월간 손익 물량 */
  monthlyKwh: number
  /** 기후환경요금 (원/kWh) */
  climateFee: number
  /** 부가세·기금 배수 (예: 1.127 = +12.7%) */
  taxMultiplier: number
  /** 현행 부과 요금 (원/kWh) — 손익·하한선 비교용 */
  currentRate: number
}

export interface OpexRow {
  id: string
  /** 구분(항목명) */
  name: string
  /** 연 비용 (원) */
  yearCost: number
  /** 비고 */
  note: string
}

export interface ReportModel {
  siteName: string
  period: string
  reportDate: string
  /** Part1 개요 표 (자유 행) */
  overview: { id: string; label: string; value: string; note: string }[]
  /** Part1 유형별 실적 표 */
  perType: {
    id: string
    type: string
    count: string
    kwh: string
    revenue: string
    perUnit: string
  }[]
  /** Part1 월별 추이 표 */
  monthly: { id: string; month: string; kwh: string; revenue: string; note: string }[]
  /** 그룹 A: 모자분리 충전기 (7kW 완속 + DC 급속) */
  groupA: ElecCostInput
  /** 그룹 B: 모자분리 미적용 (3kW 완속, 공용부 부과) */
  groupB: ElecCostInput
  /** 운영비 내역 (구분 고정 성격이나 추가/삭제 가능) */
  opex: OpexRow[]
  /** 운영비 원/kWh 산출 분모 (월 충전량, 전체 기준) */
  opexBaseKwh: number
  /** 인상 권고안 표 */
  recommend: {
    id: string
    label: string
    current: string
    proposed: string
    note: string
  }[]
}

/** 실효 전기원가 계산 결과 */
export interface ElecCostResult {
  /** (B) kWh당 기본요금 환산 */
  baseCharge: number
  /** 소계 (A)+(B) */
  subtotal: number
  /** ★ 실효 전기원가 Lv1 (원/kWh) */
  lv1: number
}

export function computeElecCost(i: ElecCostInput): ElecCostResult {
  const baseCharge =
    i.monthlyKwh > 0 ? (i.contractKw * i.baseUnitPrice) / i.monthlyKwh : 0
  const subtotal = i.powerRate + baseCharge
  const lv1 = (subtotal + i.climateFee) * i.taxMultiplier
  return { baseCharge, subtotal, lv1 }
}

/** 운영비 월 합계(원) */
export function opexMonthlyTotal(rows: OpexRow[]): number {
  return rows.reduce((acc, r) => acc + (r.yearCost || 0) / 12, 0)
}

/** 운영비 원/kWh */
export function opexPerKwh(rows: OpexRow[], baseKwh: number): number {
  return baseKwh > 0 ? opexMonthlyTotal(rows) / baseKwh : 0
}

/** 한 그룹의 현행 월간 손익 */
export interface ProfitResult {
  revenuePerKwh: number
  elecPerKwh: number
  marginPerKwh: number
  opexPerKwh: number
  netPerKwh: number
  monthlyKwh: number
  revenueMonth: number
  elecMonth: number
  marginMonth: number
  opexMonth: number
  netMonth: number
  /** Lv2 손익분기 (전기+운영) */
  lv2: number
}

export function computeProfit(
  input: ElecCostInput,
  opexRate: number,
): ProfitResult {
  const { lv1 } = computeElecCost(input)
  const q = input.monthlyKwh
  const revenuePerKwh = input.currentRate
  const marginPerKwh = revenuePerKwh - lv1
  const netPerKwh = marginPerKwh - opexRate
  return {
    revenuePerKwh,
    elecPerKwh: lv1,
    marginPerKwh,
    opexPerKwh: opexRate,
    netPerKwh,
    monthlyKwh: q,
    revenueMonth: revenuePerKwh * q,
    elecMonth: lv1 * q,
    marginMonth: marginPerKwh * q,
    opexMonth: opexRate * q,
    netMonth: netPerKwh * q,
    lv2: lv1 + opexRate,
  }
}

let seq = 0
const rid = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`

/** 문서 예시(메이플자이) 기준 기본값. 모두 편집 가능. */
export function defaultReport(): ReportModel {
  return {
    siteName: '',
    period: '',
    reportDate: '',
    overview: [
      { id: rid(), label: '세대수', value: '', note: '' },
      { id: rid(), label: 'EV 등록', value: '', note: 'k-apt 기준 등록 수량' },
      { id: rid(), label: '충전기', value: '', note: '' },
      { id: rid(), label: '현행 요금', value: '완속 200원 / 급속 300원', note: '' },
      { id: rid(), label: '한전 요금타입', value: '일반용(을) 고압A', note: '' },
    ],
    perType: [
      { id: rid(), type: '3kW 완속', count: '', kwh: '', revenue: '', perUnit: '' },
      { id: rid(), type: '7kW 완속', count: '', kwh: '', revenue: '', perUnit: '' },
      { id: rid(), type: '급속 DC', count: '', kwh: '', revenue: '', perUnit: '' },
    ],
    monthly: [
      { id: rid(), month: '', kwh: '', revenue: '', note: '—' },
      { id: rid(), month: '', kwh: '', revenue: '', note: '' },
    ],
    groupA: {
      powerRate: 108.7,
      contractKw: 606,
      baseUnitPrice: 2580,
      monthlyKwh: 38734,
      climateFee: 9.0,
      taxMultiplier: 1.127,
      currentRate: 208.94,
    },
    groupB: {
      powerRate: 108.7,
      contractKw: 2108,
      baseUnitPrice: 2580,
      monthlyKwh: 108432,
      climateFee: 9.0,
      taxMultiplier: 1.127,
      currentRate: 200,
    },
    opex: [
      { id: rid(), name: '정기점검', yearCost: 360000, note: '1년 2회 기준' },
      { id: rid(), name: '긴급점검', yearCost: 720000, note: '1년 4회 기준' },
      {
        id: rid(),
        name: 'CS 운영/원격모니터링/정산',
        yearCost: 42000000,
        note: '1명(월 350만원)',
      },
      {
        id: rid(),
        name: '보험가입비용',
        yearCost: 53900000,
        note: '영업배상·손해배상책임보험',
      },
      { id: rid(), name: '수선비', yearCost: 63240000, note: '소모품·대수선비' },
    ],
    opexBaseKwh: 147166,
    recommend: [
      {
        id: rid(),
        label: '완속 (3kW)',
        current: '200원/kWh',
        proposed: '280원/kWh 이상',
        note: 'Lv2 초과 필수',
      },
      {
        id: rid(),
        label: '완속 (7kW)',
        current: '200원/kWh',
        proposed: '270원/kWh 이상',
        note: 'Lv2 초과 필수',
      },
      {
        id: rid(),
        label: '급속 (DC 50kW)',
        current: '300원/kWh',
        proposed: '330원/kWh 이상',
        note: '높은 수선비 적립 필요',
      },
    ],
  }
}

export function newOpexRow(): OpexRow {
  return { id: rid(), name: '', yearCost: 0, note: '' }
}
