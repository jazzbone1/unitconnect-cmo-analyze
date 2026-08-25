import { useMemo, useRef, useState } from 'react'
import {
  defaultApproval,
  type AnalysisApproval,
  type ApprovalStep,
} from '../lib/sites'
import type { SsoUser, SsoAccount } from '../lib/sso'

const STATUS_LABEL: Record<AnalysisApproval['status'], string> = {
  review: '검토 중',
  requested: '승인 요청(진행중)',
  approved: '승인 완료',
  rejected: '반려',
}

interface Props {
  approval?: AnalysisApproval
  onChange: (a: AnalysisApproval) => void
  /** 로그인 사용자(SSO). 있으면 현재 차례 승인자 본인만 처리 가능하게 게이트. */
  currentUser?: SsoUser | null
  /** 메신저 계정 명부(승인자/담당자 지정용). */
  accounts?: SsoAccount[]
}

/**
 * 계정 검색·자동완성 선택기.
 *  - 이름 일부를 입력하면 명부에서 매칭되는 계정을 골라 선택한다.
 *  - 매칭이 없으면 입력한 이름 그대로(계정 미연동) 추가할 수 있다.
 */
function AccountPicker({
  accounts,
  exclude,
  placeholder,
  onPick,
}: {
  accounts: SsoAccount[]
  exclude?: string[]
  placeholder: string
  onPick: (acc: { id?: string; name: string }) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const blurTimer = useRef<number | null>(null)

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase()
    const ex = new Set(exclude ?? [])
    return accounts
      .filter((a) => !ex.has(a.id))
      .filter((a) =>
        term
          ? a.name.toLowerCase().includes(term) ||
            a.id.toLowerCase().includes(term)
          : true,
      )
      .slice(0, 8)
  }, [accounts, exclude, q])

  const exactByName = accounts.some(
    (a) => a.name.trim().toLowerCase() === q.trim().toLowerCase(),
  )

  const pick = (acc: { id?: string; name: string }) => {
    onPick(acc)
    setQ('')
    setOpen(false)
  }

  return (
    <div className="approval__picker">
      <input
        type="text"
        value={q}
        placeholder={placeholder}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // 드롭다운 항목 클릭이 먼저 처리되도록 지연 후 닫기
          blurTimer.current = window.setTimeout(() => setOpen(false), 120)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (matches.length === 1) pick(matches[0])
            else if (q.trim() && !exactByName) pick({ name: q.trim() })
          } else if (e.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && (matches.length > 0 || q.trim()) && (
        <ul
          className="approval__dropdown"
          onMouseDown={() => {
            // input blur 로 닫히기 전에 클릭을 살린다
            if (blurTimer.current) window.clearTimeout(blurTimer.current)
          }}
        >
          {matches.map((a) => (
            <li key={a.id}>
              <button type="button" onClick={() => pick({ id: a.id, name: a.name })}>
                <span className="approval__opt-name">{a.name}</span>
                <span className="approval__opt-id">{a.id}</span>
              </button>
            </li>
          ))}
          {matches.length === 0 && (
            <li className="approval__dropdown-empty">
              {accounts.length === 0
                ? '연동된 계정이 없습니다. (로그인 이력이 쌓이면 표시)'
                : '일치하는 계정 없음'}
            </li>
          )}
          {q.trim() && !exactByName && (
            <li className="approval__dropdown-add">
              <button type="button" onClick={() => pick({ name: q.trim() })}>
                “{q.trim()}” 이름으로 추가 <em>(계정 미연동)</em>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

/** 현장 분석 승인 워크플로 패널 (검토중 → 승인요청 → 순차승인). */
export default function ApprovalPanel({
  approval,
  onChange,
  currentUser,
  accounts = [],
}: Props) {
  const a = approval ?? defaultApproval()

  const nowIso = () => new Date().toISOString()
  const fmt = (iso?: string) =>
    iso ? new Date(iso).toLocaleString('ko-KR', { hour12: false }) : ''
  const editable = a.status === 'review' // 검토중일 때만 담당자·승인자 편집

  const addApprover = (acc: { id?: string; name: string }) => {
    const name = acc.name.trim()
    if (!name) return
    // 같은 계정(id) 중복 방지
    if (acc.id && a.approvers.some((s) => s.id && s.id === acc.id)) return
    onChange({ ...a, approvers: [...a.approvers, { id: acc.id, name }] })
  }
  const removeApprover = (i: number) =>
    onChange({ ...a, approvers: a.approvers.filter((_, idx) => idx !== i) })
  const moveApprover = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= a.approvers.length) return
    const list = [...a.approvers]
    ;[list[i], list[j]] = [list[j], list[i]]
    onChange({ ...a, approvers: list })
  }

  const request = () => {
    if (a.approvers.length === 0) return
    onChange({
      ...a,
      status: 'requested',
      currentStep: 0,
      requestedBy: currentUser?.name || a.assignee || '',
      requestedAt: nowIso(),
      // 이전 처리 이력 초기화(id/name 유지)
      approvers: a.approvers.map((s) => ({
        id: s.id,
        name: s.name,
      })) as ApprovalStep[],
    })
  }

  const decide = (decision: 'approved' | 'rejected') => {
    const i = a.currentStep
    const approvers = a.approvers.map((s, idx) =>
      idx === i ? { ...s, decision, at: nowIso() } : s,
    )
    if (decision === 'rejected') {
      onChange({ ...a, approvers, status: 'rejected' })
      return
    }
    const next = i + 1
    onChange({
      ...a,
      approvers,
      currentStep: next,
      status: next >= a.approvers.length ? 'approved' : 'requested',
    })
  }

  const reset = () =>
    onChange({
      ...a,
      status: 'review',
      currentStep: 0,
      requestedAt: undefined,
      requestedBy: undefined,
      approvers: a.approvers.map((s) => ({ id: s.id, name: s.name })),
    })

  const current = a.status === 'requested' ? a.approvers[a.currentStep] : null
  // 현재 차례 승인자 본인만 처리 가능.
  //  - 계정 연동(id) 있으면 로그인 계정ID(sub)로 매칭(이름 중복에 안전).
  //  - id 없으면 이름으로 매칭. 로그인 정보가 없으면 제약 없음.
  const canDecide =
    a.status === 'requested' &&
    current != null &&
    (!currentUser ||
      (current.id
        ? current.id === currentUser.sub
        : current.name.trim() === currentUser.name.trim()))

  const excludeIds = a.approvers.map((s) => s.id).filter(Boolean) as string[]

  return (
    <section className="card approval no-print">
      <div className="approval__head">
        <h2>현장 분석 승인</h2>
        <span className={`approval__badge approval__badge--${a.status}`}>
          {STATUS_LABEL[a.status]}
        </span>
      </div>

      <div className="approval__row">
        <label className="approval__field">
          <span>담당자</span>
          {editable ? (
            a.assignee ? (
              <div className="approval__chip">
                <span className="approval__name">{a.assignee}</span>
                {a.assigneeId && (
                  <span className="approval__opt-id">{a.assigneeId}</span>
                )}
                <button
                  type="button"
                  className="approval__chip-x"
                  onClick={() =>
                    onChange({ ...a, assignee: '', assigneeId: undefined })
                  }
                >
                  ✕
                </button>
              </div>
            ) : (
              <AccountPicker
                accounts={accounts}
                placeholder="담당자 검색·선택"
                onPick={(acc) =>
                  onChange({ ...a, assignee: acc.name, assigneeId: acc.id })
                }
              />
            )
          ) : (
            <div className="approval__chip">
              <span className="approval__name">{a.assignee || '—'}</span>
              {a.assigneeId && (
                <span className="approval__opt-id">{a.assigneeId}</span>
              )}
            </div>
          )}
        </label>
      </div>

      <div className="approval__approvers">
        <div className="approval__sub">승인자 (순차 · 위에서부터 승인)</div>
        {a.approvers.length === 0 && (
          <p className="approval__empty">승인자를 추가하세요.</p>
        )}
        <ol className="approval__list">
          {a.approvers.map((s, i) => {
            const isCurrent = a.status === 'requested' && i === a.currentStep
            return (
              <li
                key={i}
                className={`approval__item${isCurrent ? ' approval__item--current' : ''}`}
              >
                <span className="approval__step">{i + 1}</span>
                <span className="approval__name">
                  {s.name}
                  {s.id ? (
                    <span className="approval__opt-id">{s.id}</span>
                  ) : (
                    <span className="approval__unlinked">계정 미연동</span>
                  )}
                </span>
                <span
                  className={`approval__state approval__state--${
                    s.decision ?? (isCurrent ? 'current' : 'wait')
                  }`}
                >
                  {s.decision === 'approved'
                    ? `승인 · ${fmt(s.at)}`
                    : s.decision === 'rejected'
                      ? `반려 · ${fmt(s.at)}`
                      : isCurrent
                        ? '처리 차례'
                        : '대기'}
                </span>
                {editable && (
                  <span className="approval__ctrl">
                    <button type="button" onClick={() => moveApprover(i, -1)}>
                      ↑
                    </button>
                    <button type="button" onClick={() => moveApprover(i, 1)}>
                      ↓
                    </button>
                    <button type="button" onClick={() => removeApprover(i)}>
                      ✕
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ol>
        {editable && (
          <div className="approval__add">
            <AccountPicker
              accounts={accounts}
              exclude={excludeIds}
              placeholder="승인자 검색·선택 (메신저 계정)"
              onPick={addApprover}
            />
          </div>
        )}
      </div>

      <div className="approval__actions">
        {a.status === 'review' && (
          <button
            type="button"
            className="approval__btn approval__btn--primary"
            disabled={a.approvers.length === 0}
            onClick={request}
          >
            승인 요청
          </button>
        )}
        {a.status === 'requested' && current && (
          <>
            <span className="approval__turn">
              현재 차례: <b>{current.name}</b>
              {currentUser && !canDecide && ' (본인만 처리 가능)'}
            </span>
            <button
              type="button"
              className="approval__btn approval__btn--primary"
              disabled={!canDecide}
              onClick={() => decide('approved')}
            >
              승인
            </button>
            <button
              type="button"
              className="approval__btn approval__btn--danger"
              disabled={!canDecide}
              onClick={() => decide('rejected')}
            >
              반려
            </button>
          </>
        )}
        {(a.status === 'approved' || a.status === 'rejected') && (
          <button type="button" className="approval__btn" onClick={reset}>
            검토 중으로 되돌리기
          </button>
        )}
      </div>
    </section>
  )
}
