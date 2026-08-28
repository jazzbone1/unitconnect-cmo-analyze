import { useMemo, useRef, useState } from 'react'
import {
  defaultApproval,
  SALES_STATUS,
  DEFAULT_SALES_STATUS,
  type AnalysisApproval,
  type ApprovalStep,
} from '../lib/sites'
import type { SsoUser, SsoAccount } from '../lib/sso'

const STATUS_LABEL: Record<AnalysisApproval['status'], string> = {
  review: '분석 중',
  reviewed: '분석 완료',
  sales_review: '영업 분석 중',
  sales_reviewed: '영업 분석 완료',
  requested: '승인 요청(진행중)',
  approved: '승인 완료',
  rejected: '반려',
}

/** 직접 선택 가능한 상태(승인 완료는 승인자 전원 승인 시 자동 반영되지만 수동 지정도 허용). */
const STATUS_CHOICES: AnalysisApproval['status'][] = [
  'review',
  'reviewed',
  'sales_review',
  'sales_reviewed',
  'requested',
  'approved',
]
const STATUS_CHOICE_LABEL: Record<AnalysisApproval['status'], string> = {
  review: '분석 중',
  reviewed: '분석 완료',
  sales_review: '영업 분석 중',
  sales_reviewed: '영업 분석 완료',
  requested: '승인 요청',
  approved: '승인 완료',
  rejected: '반려',
}
/** 승인요청 전(편집 가능) 상태 집합. */
const PRE_APPROVAL_STATUSES: AnalysisApproval['status'][] = [
  'review',
  'reviewed',
  'sales_review',
  'sales_reviewed',
]

interface Props {
  approval?: AnalysisApproval
  onChange: (a: AnalysisApproval) => void
  /** 로그인 사용자(SSO). 있으면 현재 차례 승인자 본인만 처리 가능하게 게이트. */
  currentUser?: SsoUser | null
  /** 메신저 계정 명부(승인자/담당자 지정용). */
  accounts?: SsoAccount[]
  /** 영업 상태(파이프라인) — 프로젝트 필드. */
  salesStatus?: string
  onSalesStatus?: (s: string) => void
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
  salesStatus,
  onSalesStatus,
}: Props) {
  const a = approval ?? defaultApproval()

  const nowIso = () => new Date().toISOString()
  const fmt = (iso?: string) =>
    iso ? new Date(iso).toLocaleString('ko-KR', { hour12: false }) : ''
  // 승인요청 전(분석·영업분석 단계)일 때만 승인자 편집.
  const editable = PRE_APPROVAL_STATUSES.includes(a.status)

  // 담당자는 수동 지정(명부에서 선택). 기본안은 이 담당자만 수정 가능.

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

  /** 진행 이력 초기화(승인자 id/name 유지, 결정·시각 삭제). */
  const clearedApprovers = (): ApprovalStep[] =>
    a.approvers.map((s) => ({ id: s.id, name: s.name }))

  /** 상태 직접 변경. 승인요청은 승인자 필요, 승인완료는 전원 승인 처리. */
  const setStatus = (status: AnalysisApproval['status']) => {
    if (status === a.status) return
    if (status === 'requested') {
      if (a.approvers.length === 0) return // 버튼 자체를 비활성화하지만 방어
      request()
      return
    }
    if (status === 'approved') {
      // 수동 승인 완료 → 미결정 승인자를 모두 승인 처리(반려는 유지).
      const approvers = a.approvers.map((s) =>
        s.decision === 'rejected'
          ? s
          : { ...s, decision: 'approved' as const, at: s.at ?? nowIso() },
      )
      onChange({
        ...a,
        status: 'approved',
        approvers,
        currentStep: a.approvers.length,
      })
      return
    }
    // review / reviewed → 진행 초기화
    onChange({
      ...a,
      status,
      currentStep: 0,
      requestedAt: undefined,
      requestedBy: undefined,
      approvers: clearedApprovers(),
    })
  }

  const current = a.status === 'requested' ? a.approvers[a.currentStep] : null
  // 현재 차례 승인자 본인만 처리 가능.
  //  매칭: 계정ID(sub) 일치 또는 이름 일치 중 하나면 통과.
  //   - 식별자를 '이름'으로 쓰므로 보통 sub=이름이라 둘 다 맞는다.
  //   - 메신저가 sub를 사번 등으로 발급해도 이름으로 매칭되어 어긋나지 않는다.
  //   - 로그인 정보가 없으면(SSO 비활성) 제약 없음.
  const matchesCurrentUser =
    current != null &&
    currentUser != null &&
    ((!!current.id && current.id === currentUser.sub) ||
      current.name.trim() === (currentUser.name || '').trim())
  const canDecide =
    a.status === 'requested' && current != null && (!currentUser || matchesCurrentUser)

  const excludeIds = a.approvers.map((s) => s.id).filter(Boolean) as string[]

  return (
    <section className="card approval no-print">
      <div className="approval__head">
        <h2>현장 분석 승인</h2>
        <span className={`approval__badge approval__badge--${a.status}`}>
          {STATUS_LABEL[a.status]}
        </span>
      </div>

      <div className="approval__status-set">
        <span className="approval__status-label">상태 변경</span>
        <div className="approval__seg">
          {STATUS_CHOICES.map((s) => {
            const disabled = s === 'requested' && a.approvers.length === 0
            return (
              <button
                key={s}
                type="button"
                className={`approval__seg-btn${a.status === s ? ' is-active' : ''}`}
                aria-pressed={a.status === s}
                disabled={disabled}
                title={
                  disabled ? '승인자를 먼저 추가하세요.' : undefined
                }
                onClick={() => setStatus(s)}
              >
                {STATUS_CHOICE_LABEL[s]}
              </button>
            )
          })}
          {a.status === 'rejected' && (
            <button
              type="button"
              className="approval__seg-btn is-active approval__seg-btn--rejected"
              aria-pressed
              disabled
            >
              반려
            </button>
          )}
        </div>
      </div>
      {a.status === 'approved' && (
        <p className="approval__hint">
          승인자 전원 승인이 완료되면 자동으로 “승인 완료”로 전환됩니다.
        </p>
      )}

      {onSalesStatus && (
        <div className="approval__status-set">
          <span className="approval__status-label">영업 상태</span>
          <select
            className="assignee-select"
            value={salesStatus || DEFAULT_SALES_STATUS}
            onChange={(e) => onSalesStatus(e.target.value)}
          >
            {SALES_STATUS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="approval__row approval__assignee">
        <label className="approval__field">
          <span>결재 요청자 (상신 계정)</span>
          <div className="approval__chip">
            <span className="approval__name">
              {a.requestedBy || currentUser?.name || '로그인 필요'}
            </span>
          </div>
          <span className="approval__hint-sm">
            결재를 올리는(상신하는) 로그인 계정입니다. 기본안 수정 권한을 가진{' '}
            <b>기본안 담당자</b>는 설정 탭에서 별도로 지정합니다.
          </span>
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

      {a.status === 'requested' && current && (
        <div className="approval__actions">
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
        </div>
      )}
    </section>
  )
}
