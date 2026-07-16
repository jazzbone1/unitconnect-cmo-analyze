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
  /** Part3 공통 전제 */
  premise: string
  /** 자치운영 고려사항 (영역/상세) */
  autonomy: { id: string; area: string; detail: string }[]
  /** CPO 위탁 (항목/내용) */
  cpo: { id: string; label: string; content: string }[]
  /** CMO 위탁 (항목/내용) */
  cmo: { id: string; label: string; content: string }[]
  /** 3가지 방안 비교 */
  compare: {
    id: string
    item: string
    self: string
    cpo: string
    cmo: string
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
    premise:
      '① 어떤 운영 방식을 선택하더라도 충전요금 인상(완속 250원, 급속 330원 이상)이 필요하며, ② 위탁운영 시 모자분리(EV충전 전용 계량기 분리)가 선행되어야 합니다.',
    autonomy: [
      { id: rid(), area: '전기안전관리', detail: '정기점검 / 긴급점검 등 자체 진행 프로세스 마련' },
      { id: rid(), area: '고장 대응 / 입주민CS', detail: '입주민CS, AS 접수·일정 조율·현장 인력 배정' },
      { id: rid(), area: '정산·과금', detail: '수동 정산. 주기적인 사용 패턴 파악 및 부과요금 변경' },
      { id: rid(), area: '인력 연속성', detail: '관리소장·담당자 교체 시 운영 노하우 단절. 인수인계 체계 부재 시 서비스 품질 위험.' },
      { id: rid(), area: '수선비 적립', detail: '고장 빈도·부품을 예상한 적정한 수선비 적립' },
      { id: rid(), area: '실제 인건비', detail: '원가 산정 시 최소 1명 인건비 포함 추천' },
    ],
    cpo: [
      { id: rid(), label: '충전기', content: 'CPO 자체 충전기로 교체 (환경부 교체 가능여부 검토 중)' },
      { id: rid(), label: '계약 기간', content: '7~10년 장기, 중도해지 시 위약금' },
      { id: rid(), label: '운영·유지보수', content: 'CPO가 전담' },
      { id: rid(), label: '요금 결정권', content: 'CPO에 귀속' },
      { id: rid(), label: '요금 민원 부담', content: 'CPO가 요금 설정(완속 300~350원, 급속 400~500원). 높은 요금으로 관리주체가 민원 부담' },
      { id: rid(), label: '해지 시', content: 'CPO가 충전기 철거. 충전 설비(배관·배선)는 협의 사항' },
    ],
    cmo: [
      { id: rid(), label: '모자분리 비용', content: '위탁운영 업체(UC)에서 부담' },
      { id: rid(), label: '운영·유지보수', content: 'UC가 전담' },
      { id: rid(), label: '요금', content: '아파트와 협의 결정(완속 249원, 급속 280원). 급속 이용률 증대 위해 급속 요금 인하' },
      { id: rid(), label: '소유권·결정권', content: '아파트 유지. 요금인상 요인 발생 시 협의 후 인상' },
      { id: rid(), label: '계약 기간', content: '3년 (유연한 갱신)' },
      { id: rid(), label: '해지 시', content: '충전기 아파트 소유 유지' },
    ],
    compare: [
      { id: rid(), item: '충전기 소유권', self: '아파트', cpo: 'CPO', cmo: '아파트' },
      { id: rid(), item: '요금 결정권', self: '아파트', cpo: 'CPO', cmo: '아파트' },
      { id: rid(), item: '충전 요금', self: '완속 280 / 급속 330 (추천)', cpo: '완속 300~324 / 급속 330~430', cmo: '완속 249 / 급속 280 (협의)' },
      { id: rid(), item: '아파트 월 수익', self: '수익금 발생(수선비 적립필요)', cpo: '0원', cmo: '0원' },
      { id: rid(), item: '관리사무소 부담', self: '있음', cpo: '없음', cmo: '없음' },
      { id: rid(), item: '등록·규제(의무)', self: '아파트', cpo: 'CPO', cmo: 'UC' },
      { id: rid(), item: '고장·CS 대응', self: '아파트', cpo: 'CPO', cmo: 'UC' },
      { id: rid(), item: '정산·계량 관리', self: '아파트', cpo: 'CPO 별도', cmo: 'UC 별도' },
      { id: rid(), item: '인력 리스크', self: '있음', cpo: '없음', cmo: '없음' },
      { id: rid(), item: '전담 인력', self: '미보유', cpo: '보유', cmo: '보유' },
      { id: rid(), item: '수선비 적립', self: '별도 재원 필요', cpo: 'CPO', cmo: 'UC' },
      { id: rid(), item: '운영 전문성', self: '자체 확보 필요', cpo: 'CPO', cmo: 'UC' },
      { id: rid(), item: '계약 기간', self: '—', cpo: '7~10년(lock-in)', cmo: '최소 3년' },
      { id: rid(), item: '해지 시 소유권', self: '—', cpo: '철거·원상복구 협의', cmo: '변동없음' },
      { id: rid(), item: '초기 비용부담', self: '모자분리 공사비·보험·화재예방(옵션)', cpo: '기존 충전기 매몰비용', cmo: '-' },
      { id: rid(), item: '입주민 요금 부담', self: '낮음(280·330원)', cpo: '높음(300~324원)', cmo: '낮음(249·280원)' },
      { id: rid(), item: '화재 예방시설', self: '아파트 투자 검토', cpo: 'CPO 협의', cmo: '열화상AI솔루션 제공' },
      { id: rid(), item: '리스크', self: '수리비·CS 운영', cpo: '장기계약·충전요금', cmo: 'UC 문제 시 계약 해지가능' },
    ],
  }
}

export function newOpexRow(): OpexRow {
  return { id: rid(), name: '', yearCost: 0, note: '' }
}
