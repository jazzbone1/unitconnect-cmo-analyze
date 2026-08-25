import { useState } from 'react'
import {
  defaultApproval,
  type AnalysisApproval,
  type ApprovalStep,
} from '../lib/sites'

const STATUS_LABEL: Record<AnalysisApproval['status'], string> = {
  review: '검토 중',
  requested: '승인 요청(진행중)',
  approved: '승인 완료',
  rejected: '반려',
}

interface Props {
  approval?: AnalysisApproval
  onChange: (a: AnalysisApproval) => void
  /** 로그인 사용자 이름(SSO). 있으면 현재 차례 승인자만 처리 가능하게 게이트. */
  currentUser?: string | null
}

/** 현장 분석 승인 워크플로 패널 (검토중 → 승인요청 → 순차승인). */
export default function ApprovalPanel({ approval, onChange, currentUser }: Props) {
  const a = approval ?? defaultApproval()
  const [newApprover, setNewApprover] = useState('')

  const nowIso = () => new Date().toISOString()
  const fmt = (iso?: string) =>
    iso ? new Date(iso).toLocaleString('ko-KR', { hour12: false }) : ''
  const editable = a.status === 'review' // 검토중일 때만 담당자·승인자 편집

  const addApprover = () => {
    const name = newApprover.trim()
    if (!name) return
    onChange({ ...a, approvers: [...a.approvers, { name }] })
    setNewApprover('')
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
      requestedBy: currentUser || a.assignee || '',
      requestedAt: nowIso(),
      approvers: a.approvers.map((s) => ({
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
      approvers: a.approvers.map((s) => ({ name: s.name })),
    })

  const current = a.status === 'requested' ? a.approvers[a.currentStep] : null
  // 현재 차례 승인자만 처리 가능(로그인 사용자 이름 매칭). 로그인 정보 없으면 누구나 가능.
  const canDecide =
    a.status === 'requested' &&
    current != null &&
    (!currentUser || currentUser.trim() === current.name.trim())

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
          <input
            type="text"
            value={a.assignee ?? ''}
            disabled={!editable}
            placeholder="담당자 이름"
            onChange={(e) => onChange({ ...a, assignee: e.target.value })}
          />
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
                <span className="approval__name">{s.name}</span>
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
            <input
              type="text"
              value={newApprover}
              placeholder="승인자 이름"
              onChange={(e) => setNewApprover(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addApprover()}
            />
            <button type="button" className="link-button" onClick={addApprover}>
              + 승인자 추가
            </button>
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
          <button
            type="button"
            className="approval__btn"
            onClick={reset}
          >
            검토 중으로 되돌리기
          </button>
        )}
      </div>
    </section>
  )
}
