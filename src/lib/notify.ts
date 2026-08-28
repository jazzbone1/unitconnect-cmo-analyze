/**
 * 결재 알림(DealerConnect 메신저) 클라이언트.
 *  - 실제 발송/인증키는 서버(server.mjs)의 /api/approval/notify 가 처리한다.
 *  - 여기서는 결재 이벤트 컨텍스트만 서버로 넘긴다. 실패해도 결재 흐름을 막지 않는다.
 */
export interface NotifyRecipient {
  name?: string
  uid?: string
  email?: string
}

export interface ApprovalNotifyInput {
  projectName?: string
  requesterName?: string
  eventType: 'requested' | 'approved' | 'rejected' | 'completed'
  status?: '상신' | '승인' | '반려'
  title: string
  message?: string
  /** 결재 건 식별(같은 값이면 상신→승인→반려가 한 타임라인으로 묶임) */
  refId?: string
  /** 멱등키(재시도 시 동일값) — 미지정 시 자동 생성 */
  requestId?: string
  /** 딥링크 — 알림 '원본 보기'로 결재 화면 열림 */
  sourceUrl?: string
  /** 알림 받을 사람들 */
  recipients: NotifyRecipient[]
}

function genRequestId(input: ApprovalNotifyInput): string {
  const base = `${input.refId ?? 'appr'}-${input.eventType}`
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID)
      return `${base}-${crypto.randomUUID()}`.slice(0, 80)
  } catch {
    /* fallthrough */
  }
  return `${base}-${Date.now()}`.slice(0, 80)
}

/** 결재 알림 발송. 실패는 조용히 무시(결재 저장은 이미 완료됨). */
export async function notifyApproval(input: ApprovalNotifyInput): Promise<void> {
  const recipients = (input.recipients || []).filter(
    (r) => r && (r.uid || r.email || r.name),
  )
  if (recipients.length === 0) return
  try {
    await fetch('/api/approval/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        ...input,
        requestId: input.requestId ?? genRequestId(input),
        recipients,
      }),
    })
  } catch {
    /* 알림 실패는 결재 흐름을 막지 않는다 */
  }
}
