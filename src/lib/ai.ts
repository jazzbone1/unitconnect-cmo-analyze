/**
 * AI 분석(Claude) 클라이언트. 서버(server.mjs)의 /api/ai/* 를 호출한다.
 * API 키는 서버에만 있으며 브라우저에 노출되지 않는다.
 * 원격 저장소와 동일한 base(VITE_API_BASE) 규칙을 따른다.
 */
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''
const APP_KEY = import.meta.env.VITE_APP_KEY as string | undefined

function headers(): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' }
  if (APP_KEY) h['x-app-key'] = APP_KEY
  return h
}

export type AiKind = 'summary' | 'report'

/** AI 기능 활성화 여부(서버에 키가 설정됐는지). 실패 시 false. */
export async function aiStatus(): Promise<{ enabled: boolean; model: string | null }> {
  try {
    const res = await fetch(`${BASE}/api/ai/status`, { headers: headers() })
    if (!res.ok) return { enabled: false, model: null }
    const d = await res.json()
    return { enabled: !!d.enabled, model: d.model ?? null }
  } catch {
    return { enabled: false, model: null }
  }
}

/** 구조화된 데이터를 보내고 AI 분석 텍스트(마크다운)를 받는다. */
export async function aiAnalyze(kind: AiKind, data: unknown): Promise<string> {
  const res = await fetch(`${BASE}/api/ai/analyze`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ kind, data }),
  })
  if (!res.ok) {
    let msg = `AI 분석 실패 (${res.status})`
    try {
      const e = await res.json()
      if (e?.error) msg = e.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  const d = await res.json()
  return String(d.text ?? '')
}
