import { useEffect, useState } from 'react'

/**
 * useState와 동일하지만 값이 localStorage에 저장되어
 * 새로고침 후에도 화면 상태(탭·선택 등)가 유지된다.
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const storageKey = `unitconnect.ui.${key}`
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      return raw != null ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {
      /* 저장 실패는 무시 (프라이빗 모드 등) */
    }
  }, [storageKey, value])

  return [value, setValue]
}
