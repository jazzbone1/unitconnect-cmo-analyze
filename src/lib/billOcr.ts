// 한전 전기요금 청구서 자동 인식.
//  - PDF: pdfjs로 텍스트 추출
//  - JPG/PNG: tesseract.js(kor+eng) OCR
// 인식된 항목만 반환하고, 못 찾은 항목은 사용자가 직접 입력한다.

import { extractPdfText } from './buildingRegister'
import type { BillInputs } from './tariff'

/** 부호(△/▲/-) 포함 숫자 문자열 → number */
function parseSignedNumber(raw?: string | null): number | undefined {
  if (!raw) return undefined
  const neg = /[△▲\-]/.test(raw)
  const n = Number(raw.replace(/[^\d]/g, ''))
  if (!Number.isFinite(n) || raw.replace(/[^\d]/g, '') === '') return undefined
  return neg ? -n : n
}

/** label 뒤에 오는 첫 (부호)숫자를 찾는다. */
function findAmount(text: string, label: RegExp): number | undefined {
  const re = new RegExp(
    label.source + '[\\s:：]*([△▲\\-]?\\s*[\\d,]+)',
    label.flags,
  )
  const m = text.match(re)
  return m ? parseSignedNumber(m[1]) : undefined
}

export type BillFields = Partial<BillInputs>

/** 청구서 텍스트에서 청구내역 항목을 파싱한다. */
export function parseBill(text: string): {
  fields: BillFields
  recognized: string[]
  missing: string[]
} {
  const t = text.replace(/ /g, ' ')
  const fields: BillFields = {}
  const recognized: string[] = []
  const missing: string[] = []

  const put = (key: keyof BillInputs, label: string, v?: number) => {
    if (v != null && Number.isFinite(v)) {
      fields[key] = v
      recognized.push(label)
    } else {
      missing.push(label)
    }
  }

  put('basic', '기본요금', findAmount(t, /기본\s*요금/))
  put('energy', '전력량요금', findAmount(t, /전력량\s*요금/))
  put('climate', '기후환경요금', findAmount(t, /기후\s*환경\s*요금/))
  put('fuel', '연료비조정액', findAmount(t, /연료비\s*조정액?/))
  put('powerFactor', '역률요금', findAmount(t, /역률\s*요금/))
  put('vat', '부가가치세', findAmount(t, /부가\s*가치세/))
  put('fund', '전력기금', findAmount(t, /전력\s*기금/))
  put('round', '원단위절사', findAmount(t, /원단위\s*절사/))

  // 사용량: '사용량' 라벨 우선, 실패 시 'NNNN kWh' 패턴
  let usage = findAmount(t, /사용량(?!\s*(?:사항|비교))/)
  if (usage == null) {
    const m = t.match(/([\d,]{3,})\s*_?\s*kWh/i)
    usage = m ? parseSignedNumber(m[1]) : undefined
  }
  put('usageKwh', '사용량', usage)

  // 계약전력
  let contract = findAmount(t, /계약\s*전력/)
  if (contract == null) {
    const m = t.match(/([\d,]{2,})\s*kW(?!h)/i)
    contract = m ? parseSignedNumber(m[1]) : undefined
  }
  put('contractKw', '계약전력', contract)

  return { fields, recognized, missing }
}

/** 이미지(JPG/PNG)를 OCR해 텍스트를 얻는다. */
async function ocrImage(file: File): Promise<string> {
  const Tesseract = (await import('tesseract.js')).default
  const { data } = await Tesseract.recognize(file, 'kor+eng')
  return data.text
}

/** 업로드 파일(PDF/JPG/PNG)을 인식해 청구내역 필드를 반환한다. */
export async function recognizeBill(file: File): Promise<{
  fields: BillFields
  recognized: string[]
  missing: string[]
  source: 'pdf' | 'image'
}> {
  const name = file.name.toLowerCase()
  const isPdf = file.type === 'application/pdf' || name.endsWith('.pdf')
  const text = isPdf ? await extractPdfText(file) : await ocrImage(file)
  return { ...parseBill(text), source: isPdf ? 'pdf' : 'image' }
}
