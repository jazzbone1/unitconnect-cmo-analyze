import { usePersistentState } from '../lib/persist'
import { PROFIT_STANDARD } from '../lib/feasibility'
import { formatNumber } from '../lib/stats'
import HqMembersPanel from './HqMembersPanel'

function fmt(n: number) {
  return formatNumber(Math.round(n))
}

/** 영업비 전체 기준값(모든 현장 공통) 편집. localStorage(feasibility.bizFeeByYear)와 동일. */
function BizStandardTable() {
  const [bizFeeByYear, setBizFeeByYear] = usePersistentState<number[]>(
    'feasibility.bizFeeByYear',
    PROFIT_STANDARD.map((r) => r.bizFee),
  )
  const setAt = (i: number, raw: string) => {
    const v = Number(raw.replace(/[^0-9.]/g, '')) || 0
    setBizFeeByYear((prev) => {
      const next = [...prev]
      while (next.length < PROFIT_STANDARD.length) next.push(0)
      next[i] = v
      return next
    })
  }
  return (
    <section className="card">
      <div className="settings-sec__head">
        <h2>영업비 전체 기준값</h2>
        <button
          type="button"
          className="btn-link"
          onClick={() => setBizFeeByYear(PROFIT_STANDARD.map((r) => r.bizFee))}
        >
          기본값 복원
        </button>
      </div>
      <p className="settings-sec__desc">
        모든 현장의 <b>기본 영업비 기준값</b>입니다. 각 프로젝트에서 영업비를 따로
        기입하지 않은 계약연수에는 이 값이 적용됩니다. (프로젝트 개별 금액은 사업성
        분석 탭에서 입력)
      </p>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>계약기간</th>
              <th className="proj-num">영업비 1대분(원/대) · 기준값</th>
            </tr>
          </thead>
          <tbody>
            {PROFIT_STANDARD.map((row, i) => (
              <tr key={row.years}>
                <td className="col-name">{row.years}년</td>
                <td>
                  <input
                    className="cell-input"
                    type="text"
                    inputMode="numeric"
                    value={bizFeeByYear[i] ? String(bizFeeByYear[i]) : ''}
                    placeholder={fmt(row.bizFee)}
                    onChange={(e) => setAt(i, e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** 설정 화면 — 관리 기능 모음(본사 명단, 영업비 기준값 등). */
export default function SettingsView() {
  return (
    <div className="settings">
      <h1 className="settings__title">설정 · 관리</h1>
      <p className="settings__sub">
        본사 명단과 영업비 전체 기준값 등 공통 관리 항목입니다. 로그인 후 변경할 수
        있습니다.
      </p>
      <section className="card">
        <h2>본사 명단 관리 (승인자·담당자 명부)</h2>
        <p className="settings-sec__desc">
          결재의 <b>승인자</b>와 <b>담당자(기본안 관리)</b>로 지정할 본사 인원을
          등록합니다. 여기 등록한 이름이 결재 패널의 <b>승인자 검색</b>과{' '}
          <b>담당자 검색</b> 목록에 나타납니다. (승인자·담당자는 프로젝트별로 결재
          패널에서 각각 지정)
        </p>
        <HqMembersPanel defaultOpen />
      </section>
      <BizStandardTable />
    </div>
  )
}
