import { useEffect, useState } from 'react'
import { aiAnalyze, aiStatus, type AiKind } from '../lib/ai'

interface Props {
  kind: AiKind
  /** 분석에 보낼 구조화 데이터를 생성(버튼 클릭 시 호출). */
  getData: () => unknown
  /** 버튼 라벨 */
  label: string
  /** 결과를 보고서 필드 등에 삽입할 수 있으면 제공 */
  onInsert?: (text: string) => void
}

/** AI 분석 버튼 + 결과 패널. 서버에 키가 없으면 비활성 안내만 표시. */
export default function AiPanel({ kind, getData, label, onInsert }: Props) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    aiStatus().then((s) => {
      if (alive) setEnabled(s.enabled)
    })
    return () => {
      alive = false
    }
  }, [])

  const run = async () => {
    setLoading(true)
    setError('')
    setText('')
    try {
      const out = await aiAnalyze(kind, getData())
      setText(out)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  if (enabled === false) {
    return (
      <p className="ai-panel__hint no-print">
        🤖 AI 분석 비활성 — 서버에 <code>ANTHROPIC_API_KEY</code>를 설정하면
        활성화됩니다.
      </p>
    )
  }

  return (
    <div className="ai-panel no-print">
      <div className="ai-panel__bar">
        <button
          type="button"
          className="link-button ai-panel__btn"
          onClick={run}
          disabled={loading || enabled === null}
        >
          {loading ? '⏳ 분석 중…' : `🤖 ${label}`}
        </button>
        {text && (
          <>
            <button
              type="button"
              className="link-button"
              onClick={() => navigator.clipboard?.writeText(text)}
            >
              복사
            </button>
            {onInsert && (
              <button
                type="button"
                className="link-button"
                onClick={() => onInsert(text)}
              >
                보고서에 삽입
              </button>
            )}
          </>
        )}
      </div>
      {error && <p className="status status--err">{error}</p>}
      {text && <div className="ai-panel__out">{text}</div>}
      {text && (
        <p className="ai-panel__note">
          AI 생성 초안입니다. 수치·표현을 검토 후 사용하세요.
        </p>
      )}
    </div>
  )
}
