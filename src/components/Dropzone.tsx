import { useCallback, useRef, useState } from 'react'

interface DropzoneProps {
  onFiles: (files: File[]) => void
  disabled?: boolean
  title?: string
  hint?: string
  icon?: string
  accept?: string
  multiple?: boolean
  /** 컴팩트(작은) 표시 */
  compact?: boolean
}

/** 드래그 앤 드롭 + 클릭 업로드를 지원하는 파일 입력 영역. */
export default function Dropzone({
  onFiles,
  disabled,
  title = '파일을 여기에 끌어다 놓거나 클릭해서 선택하세요 (여러 개 가능)',
  hint = 'CSV · Excel (.xlsx, .xls) 지원 · 파일명의 날짜로 자동 분류됩니다',
  icon = '⬆',
  accept = '.csv,.txt,.xlsx,.xls',
  multiple = true,
  compact = false,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return
      onFiles(Array.from(files))
    },
    [onFiles],
  )

  return (
    <div
      className={`dropzone${dragOver ? ' dropzone--over' : ''}${
        disabled ? ' dropzone--disabled' : ''
      }${compact ? ' dropzone--compact' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={title}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (!disabled) handleFiles(e.dataTransfer.files)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          handleFiles(e.target.files)
          // 같은 파일 재선택 허용을 위해 값 초기화
          e.target.value = ''
        }}
      />
      <div className="dropzone__icon" aria-hidden>
        {icon}
      </div>
      <p className="dropzone__title">{title}</p>
      <p className="dropzone__hint">{hint}</p>
    </div>
  )
}
