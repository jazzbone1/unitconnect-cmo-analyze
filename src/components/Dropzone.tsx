import { useCallback, useRef, useState } from 'react'

interface DropzoneProps {
  onFile: (file: File) => void
  disabled?: boolean
}

/** 드래그 앤 드롭 + 클릭 업로드를 지원하는 파일 입력 영역. */
export default function Dropzone({ onFile, disabled }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0]
      if (file) onFile(file)
    },
    [onFile],
  )

  return (
    <div
      className={`dropzone${dragOver ? ' dropzone--over' : ''}${
        disabled ? ' dropzone--disabled' : ''
      }`}
      role="button"
      tabIndex={0}
      aria-label="CSV 또는 Excel 파일 업로드"
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
        accept=".csv,.txt,.xlsx,.xls"
        hidden
        onChange={(e) => {
          handleFiles(e.target.files)
          // 같은 파일 재선택 허용을 위해 값 초기화
          e.target.value = ''
        }}
      />
      <div className="dropzone__icon" aria-hidden>
        ⬆
      </div>
      <p className="dropzone__title">
        파일을 여기에 끌어다 놓거나 클릭해서 선택하세요
      </p>
      <p className="dropzone__hint">CSV · Excel (.xlsx, .xls) 지원</p>
    </div>
  )
}
