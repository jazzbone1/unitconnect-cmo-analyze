import { parseFile } from './parse'
import { parseFileName } from './parseName'
import { stripPii } from './privacy'
import { detectRegistry, sanitizeRegistry } from './registry'
import type { FileEntry } from '../types'

let idCounter = 0
export function nextFileId(): string {
  idCounter += 1
  return `f${idCounter}`
}

export interface IngestResult {
  parsed: FileEntry[]
  errors: string[]
}

/**
 * 업로드된 파일들을 파싱해 FileEntry 목록으로 만든다.
 * 이용자 명부(차량번호 컬럼)는 test/costel 판별을 위해 원본 유지,
 * 그 외는 개인정보를 제거한다.
 */
export async function parseUploadedFiles(files: File[]): Promise<IngestResult> {
  const parsed: FileEntry[] = []
  const errors: string[] = []
  for (const file of files) {
    try {
      const raw = await parseFile(file)
      if (raw.columns.length === 0 || raw.rows.length === 0) {
        throw new Error('헤더 또는 데이터 행이 없습니다.')
      }
      // 명부는 개인정보 제거(정제) 후 저장, 그 외는 개인정보 컬럼 제거
      const dataset = detectRegistry(raw) ? sanitizeRegistry(raw) : stripPii(raw)
      const { category, period } = parseFileName(file.name)
      parsed.push({ id: nextFileId(), dataset, category, period })
    } catch (e) {
      errors.push(`${file.name}: ${e instanceof Error ? e.message : '처리 실패'}`)
    }
  }
  return { parsed, errors }
}
