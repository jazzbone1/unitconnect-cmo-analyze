import { useState } from 'react'

/**
 * 천단위 콤마 표시 숫자 입력.
 *  - 편집 중(포커스): 콤마 없는 원본 숫자로 편집(입력 편의).
 *  - 포커스 아웃: 1,000 처럼 천단위 콤마로 표시.
 *  - 값 0/빈칸은 placeholder만 표시.
 */
export default function NumberInput({
  className,
  value,
  onValue,
  placeholder,
  maxFractionDigits = 2,
}: {
  className?: string
  value: number
  onValue: (n: number) => void
  placeholder?: string
  /** 소수 자릿수(콤마 표시 시). 정수 항목은 0. */
  maxFractionDigits?: number
}) {
  const [focused, setFocused] = useState(false)
  const [text, setText] = useState('')
  const has = Number.isFinite(value) && value !== 0
  const rawText = has ? String(value) : '' // 편집용(콤마 없음)
  const shownText = has
    ? value.toLocaleString(undefined, { maximumFractionDigits: maxFractionDigits })
    : '' // 표시용(콤마)
  return (
    <input
      className={className}
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      value={focused ? text : shownText}
      onFocus={() => {
        setText(rawText)
        setFocused(true)
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9.]/g, '')
        setText(raw)
        if (raw === '' || raw === '.') {
          onValue(0)
          return
        }
        const n = Number(raw)
        if (Number.isFinite(n)) onValue(n)
      }}
    />
  )
}
