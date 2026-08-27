import { useEffect, useState } from 'react'
import { usePersistentState } from '../lib/persist'
import { PROFIT_STANDARD } from '../lib/feasibility'
import { formatNumber } from '../lib/stats'
import { defaultApproval, type SavedSite } from '../lib/sites'
import { ssoDirectory, type SsoAccount } from '../lib/sso'
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

/** 프로젝트별 담당자(기본안 관리) 일괄 지정. */
function AssigneeManager({
  projects,
  onUpdate,
  accounts,
}: {
  projects: SavedSite[]
  onUpdate: (id: string, patch: Partial<SavedSite>) => void
  accounts: SsoAccount[]
}) {
  const setAssignee = (p: SavedSite, id: string) => {
    const acc = accounts.find((a) => a.id === id)
    const base = p.approval ?? defaultApproval()
    onUpdate(p.id, {
      approval: id
        ? { ...base, assignee: acc?.name ?? id, assigneeId: id }
        : { ...base, assignee: '', assigneeId: undefined },
    })
  }
  return (
    <section className="card">
      <h2>담당자 지정 (기본안 관리)</h2>
      <p className="settings-sec__desc">
        프로젝트별로 <b>기본안</b>을 수정·저장할 수 있는 담당자를 지정합니다.
        명부(본사 명단·로그인 계정)에서 1명 선택. 지정 시 그 담당자만 기본안을
        수정할 수 있고, 미지정이면 누구나 수정 가능합니다.
      </p>
      {projects.length === 0 ? (
        <p className="settings-sec__desc">등록된 프로젝트가 없습니다.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>단지명</th>
                <th>담당자 (기본안 관리)</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const curId = p.approval?.assigneeId ?? ''
                const opts = accounts.slice()
                if (curId && !opts.find((a) => a.id === curId))
                  opts.unshift({
                    id: curId,
                    name: p.approval?.assignee || curId,
                  })
                return (
                  <tr key={p.id}>
                    <td className="col-name">{p.name || '(이름 없음)'}</td>
                    <td>
                      <select
                        className="assignee-select"
                        value={curId}
                        onChange={(e) => setAssignee(p, e.target.value)}
                      >
                        <option value="">미지정 (누구나 수정)</option>
                        {opts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {accounts.length === 0 && (
        <p className="settings-sec__desc">
          선택 가능한 계정이 없습니다. 위 <b>본사 명단</b>에 인원을 등록하거나,
          로그인 이력이 쌓이면 표시됩니다.
        </p>
      )}
    </section>
  )
}

/** 설정 화면 — 관리 기능 모음(본사 명단, 담당자 지정, 영업비 기준값 등). */
export default function SettingsView({
  projects,
  onUpdate,
}: {
  projects: SavedSite[]
  onUpdate: (id: string, patch: Partial<SavedSite>) => void
}) {
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
        본사 명단·담당자 지정·영업비 전체 기준값 등 공통 관리 항목입니다. 로그인 후
        변경할 수 있습니다.
      </p>
      <section className="card">
        <h2>본사 명단 관리 (승인자·담당자 명부)</h2>
        <p className="settings-sec__desc">
          결재의 <b>승인자</b>와 <b>담당자(기본안 관리)</b>로 지정할 본사 인원을
          등록합니다. 여기 등록한 이름이 <b>담당자 지정</b> 목록과 결재 패널의{' '}
          <b>승인자 검색</b>에 나타납니다.
        </p>
        <HqMembersPanel defaultOpen />
      </section>
      <AssigneeManager
        projects={projects}
        onUpdate={onUpdate}
        accounts={accounts}
      />
      <BizStandardTable />
    </div>
  )
}
