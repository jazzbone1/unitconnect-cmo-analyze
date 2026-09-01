import { useEffect, useMemo, useState } from 'react'
import { usePersistentState } from '../lib/persist'
import {
  PROFIT_STANDARD,
  MAX_YEARS,
  defaultStdUtil,
  defaultLoan,
  type StdUtil,
  type LoanInputs,
} from '../lib/feasibility'
import { formatNumber } from '../lib/stats'
import NumberInput from './NumberInput'
import {
  ssoDirectory,
  ssoGetSettings,
  ssoSaveSettings,
  type SsoAccount,
} from '../lib/sso'
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
  // 영업비 기준값은 전역 공통 → 로컬 저장 + 서버 저장(모든 사용자 동일 반영).
  const commit = (next: number[]) => {
    setBizFeeByYear(next)
    void ssoSaveSettings({ bizFeeByYear: next }).catch(() => {})
  }
  const setAt = (i: number, raw: string) => {
    const v = Number(raw.replace(/[^0-9.]/g, '')) || 0
    const next = [...bizFeeByYear]
    while (next.length < PROFIT_STANDARD.length) next.push(0)
    next[i] = v
    commit(next)
  }
  return (
    <section className="card">
      <div className="settings-sec__head">
        <h2>영업비 전체 기준값</h2>
        <button
          type="button"
          className="btn-link"
          onClick={() => commit(PROFIT_STANDARD.map((r) => r.bizFee))}
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

/** 사업성 종류별 표준 이용률(기준값·모든 현장 공통) 편집. localStorage(feasibility.utilStandard)와 동일. */
const UTIL_ROWS: { key: keyof StdUtil; label: string }[] = [
  { key: 'utilFast100', label: '급속 100kW' },
  { key: 'utilFast50', label: '급속 50kW' },
  { key: 'utilSlow7', label: '완속 7kW' },
  { key: 'utilSlow35', label: '완속 3.5kW' },
  { key: 'utilSlow3', label: '완속(콘센트) 3kW' },
]
function UtilStandardTable() {
  const [stdUtil, setStdUtil] = usePersistentState<StdUtil>(
    'feasibility.utilStandard',
    defaultStdUtil(),
  )
  // 전역 공통 → 로컬 저장 + 서버 저장(모든 사용자 동일 반영).
  const commit = (next: StdUtil) => {
    setStdUtil(next)
    void ssoSaveSettings({
      feasUtil: { ...next } as unknown as Record<string, number>,
    }).catch(() => {})
  }
  const setAt = (key: keyof StdUtil, pct: number) =>
    commit({ ...stdUtil, [key]: pct / 100 })
  return (
    <section className="card">
      <div className="settings-sec__head">
        <h2>종류별 표준 이용률 (사업성 기준값)</h2>
        <button
          type="button"
          className="btn-link"
          onClick={() => commit(defaultStdUtil())}
        >
          기본값 복원
        </button>
      </div>
      <p className="settings-sec__desc">
        사업성 분석 <b>이용률(%)</b>의 <b>기준값(UC 기준 이용률)</b>입니다. 새 프로젝트는
        이 값으로 시작하며, 각 프로젝트에서 직접 기입하면 그 값이 우선 적용됩니다.
        (사업성 분석 표의 <b>UC 기준 이용률</b> 열에 표시)
      </p>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>충전기 종류</th>
              <th className="proj-num">표준 이용률(%) · 기준값</th>
            </tr>
          </thead>
          <tbody>
            {UTIL_ROWS.map((row) => (
              <tr key={row.key}>
                <td className="col-name">{row.label}</td>
                <td>
                  <NumberInput
                    className="cell-input"
                    maxFractionDigits={2}
                    value={+((stdUtil[row.key] ?? 0) * 100).toFixed(4)}
                    onValue={(n) => setAt(row.key, n)}
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

/** 대출 이자(금융비용) 기준 — 전역 공통 상환 계획. 원금은 각 프로젝트 CAPEX 기준. */
function LoanStandardPanel() {
  const [loan, setLoan] = usePersistentState<LoanInputs>(
    'feasibility.loan',
    defaultLoan(),
  )
  const commit = (next: LoanInputs) => {
    setLoan(next)
    void ssoSaveSettings({
      loan: next as unknown as Record<string, unknown>,
    }).catch(() => {})
  }
  const rate = loan.rateByYear ?? []
  const setRate = (i: number, pct: number) => {
    const next = Array.from(
      { length: MAX_YEARS },
      (_, k) => rate[k] ?? 0.032,
    )
    next[i] = pct / 100
    commit({ ...loan, rateByYear: next })
  }
  return (
    <section className="card">
      <div className="settings-sec__head">
        <h2>대출 이자 (금융비용) 기준</h2>
        <button
          type="button"
          className="btn-link"
          onClick={() => commit(defaultLoan())}
        >
          기본값 복원
        </button>
      </div>
      <p className="settings-sec__desc">
        모든 프로젝트 공통 <b>상환 계획</b>입니다. 대출 <b>원금 = 각 프로젝트 CAPEX
        총액 × 대출 비율</b>로 자동 산정되어, 프로젝트별로 이자가 개별 계산됩니다.
        <b>이자만</b> 사업성(금융비용)에 반영되고 원금 상환은 비용에 넣지 않습니다.
      </p>
      <label className="loan-toggle">
        <input
          type="checkbox"
          checked={!!loan.enabled}
          onChange={(e) => commit({ ...loan, enabled: e.target.checked })}
        />
        <span>
          사업성에 <b>대출 이자 반영</b> {loan.enabled ? '(켜짐)' : '(꺼짐)'}
        </span>
      </label>
      <div className="site-grid" style={{ marginTop: 12 }}>
        <label className="var-field">
          <span className="var-field__label">CAPEX 대비 대출 비율(%)</span>
          <NumberInput
            className="var-field__input"
            maxFractionDigits={1}
            value={+(((loan.principalPct ?? 1) * 100).toFixed(2))}
            onValue={(n) => commit({ ...loan, principalPct: n / 100 })}
          />
        </label>
        <label className="var-field">
          <span className="var-field__label">상환 시점(년차 말)</span>
          <NumberInput
            className="var-field__input"
            maxFractionDigits={0}
            value={loan.repayYear ?? 3}
            onValue={(n) => commit({ ...loan, repayYear: Math.round(n) })}
          />
        </label>
        <label className="var-field">
          <span className="var-field__label">상환율(%)</span>
          <NumberInput
            className="var-field__input"
            maxFractionDigits={1}
            value={+(((loan.repayPct ?? 0) * 100).toFixed(2))}
            onValue={(n) => commit({ ...loan, repayPct: n / 100 })}
          />
        </label>
      </div>
      <div className="table-scroll" style={{ marginTop: 12 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>연차</th>
              <th className="proj-num">연 이자율(%)</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: MAX_YEARS }, (_, i) => (
              <tr key={i}>
                <td className="col-name">
                  {i + 1}년차
                  {i + 1 > (loan.repayYear ?? 3) ? ' (상환 후 잔금)' : ''}
                </td>
                <td>
                  <NumberInput
                    className="cell-input"
                    maxFractionDigits={2}
                    value={+(((rate[i] ?? 0.032) * 100).toFixed(4))}
                    onValue={(n) => setRate(i, n)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="settings-sec__desc">
        예: 1~3년차 3.2% · 3년차 말 25% 상환 · 4년차부터 잔금(75%)에 재산정 이자율 적용.
        계약기간이 상환 시점보다 짧으면 상환/재산정은 자연히 적용되지 않습니다.
      </p>
    </section>
  )
}

/** 기본안 담당자(전체 공통) 관리 — 여기 지정된 계정만 모든 프로젝트의 기본안을 수정. */
function BaseManagersManager({ accounts }: { accounts: SsoAccount[] }) {
  const [managers, setManagers] = useState<SsoAccount[]>([])
  const [sel, setSel] = useState('')
  const [msg, setMsg] = useState('')
  useEffect(() => {
    let alive = true
    ssoGetSettings().then((s) => alive && setManagers(s.baseManagers))
    return () => {
      alive = false
    }
  }, [])
  const persist = (next: SsoAccount[]) => {
    setManagers(next)
    setMsg('저장 중…')
    ssoSaveSettings({ baseManagers: next })
      .then((s) => {
        setManagers(s.baseManagers)
        setMsg(`저장 완료 · 담당자 ${s.baseManagers.length}명`)
      })
      .catch((e) => setMsg(e instanceof Error ? e.message : String(e)))
  }
  const addable = useMemo(() => {
    const have = new Set(managers.map((m) => m.id))
    return accounts.filter((a) => !have.has(a.id))
  }, [accounts, managers])
  const add = (id: string) => {
    const acc = accounts.find((a) => a.id === id)
    if (!acc) return
    persist([...managers, acc])
    setSel('')
  }
  const remove = (id: string) =>
    persist(managers.filter((m) => m.id !== id))
  return (
    <section className="card">
      <h2>기본안 담당자 (전체 공통)</h2>
      <p className="settings-sec__desc">
        여기 지정된 계정만 <b>모든 프로젝트의 기본안</b>을 수정·저장할 수 있습니다.
        아무도 지정하지 않으면 누구나 수정 가능합니다. (대체안 추가·편집·결재는
        담당자와 무관하게 누구나)
      </p>
      {managers.length === 0 ? (
        <p className="settings-sec__desc">지정된 담당자가 없습니다.</p>
      ) : (
        <ul className="hq-panel__list">
          {managers.map((m) => (
            <li key={m.id} className="hq-panel__item">
              <span className="hq-panel__name">{m.name}</span>
              <button
                type="button"
                className="hq-panel__x"
                aria-label={`${m.name} 제거`}
                onClick={() => remove(m.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="settings-add-row">
        <select
          className="assignee-select"
          value={sel}
          onChange={(e) => e.target.value && add(e.target.value)}
        >
          <option value="">+ 담당자 추가 (명부에서 선택)</option>
          {addable.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {msg && <span className="hq-panel__msg">{msg}</span>}
      </div>
      {accounts.length === 0 && (
        <p className="settings-sec__desc">
          선택 가능한 계정이 없습니다. 위 <b>본사 명단</b>에 등록하거나 로그인
          이력이 쌓이면 표시됩니다.
        </p>
      )}
    </section>
  )
}

/** 설정 화면 — 관리 기능 모음(본사 명단, 기본안 담당자, 영업비 기준값 등). */
export default function SettingsView() {
  const [accounts, setAccounts] = useState<SsoAccount[]>([])
  useEffect(() => {
    let alive = true
    ssoDirectory().then((list) => alive && setAccounts(list))
    return () => {
      alive = false
    }
  }, [])
  return (
    <div className="settings">
      <h1 className="settings__title">설정 · 관리</h1>
      <p className="settings__sub">
        본사 명단·담당자 지정·영업비 전체 기준값·표준 이용률 기준값 등 공통 관리
        항목입니다. 로그인 후 변경할 수 있습니다.
      </p>
      <section className="card">
        <h2>본사 명단 관리 (승인자·담당자 명부)</h2>
        <p className="settings-sec__desc">
          결재의 <b>승인자</b>와 <b>담당자(기본안 관리)</b>로 지정할 본사 인원을
          등록합니다. 여기 등록한 이름이 <b>기본안 담당자</b> 선택과 결재 패널의{' '}
          <b>승인자 검색</b>에 나타납니다.
        </p>
        <HqMembersPanel defaultOpen />
      </section>
      <BaseManagersManager accounts={accounts} />
      <BizStandardTable />
      <UtilStandardTable />
      <LoanStandardPanel />
    </div>
  )
}
