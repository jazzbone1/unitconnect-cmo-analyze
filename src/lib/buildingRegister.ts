import * as pdfjs from 'pdfjs-dist'
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline'

// 워커를 번들에 인라인해 단일 파일 환경에서도 동작하도록 설정
pdfjs.GlobalWorkerOptions.workerPort = new PdfjsWorker()

/** PDF 파일에서 전체 텍스트를 추출한다. */
export async function extractPdfText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise
  let text = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    text += content.items
      .map((it) => ('str' in it ? (it as { str: string }).str : ''))
      .join('')
  }
  return text
}

export interface BuildingInfo {
  name?: string
  address?: string
  households?: number
  parking?: number
}

// 광역 행정구역명 (주소 앵커)
const PROV =
  '(?:서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시|경기도|강원특별자치도|강원도|충청북도|충청남도|전라북도|전북특별자치도|전라남도|경상북도|경상남도|제주특별자치도)'

function toNum(s?: string | null): number | undefined {
  if (!s) return undefined
  const n = Number(String(s).replace(/[^\d]/g, ''))
  return Number.isFinite(n) ? n : undefined
}

/**
 * 건축물대장(총괄표제부) 텍스트에서 단지명·주소·세대수·총주차대수를 추출한다.
 * 형식이 조금씩 달라도 최대한 뽑아내며, 실패한 항목은 undefined로 둔다.
 */
export function parseBuildingRegister(text: string): BuildingInfo {
  const info: BuildingInfo = {}

  const name = text.match(/건축물\s?명칭\s*([가-힣A-Za-z0-9·\-()]+?)\s*특이사항/)
  if (name) info.name = name[1].trim()

  const body = '[가-힣0-9\\s]*?(?:로|길)\\s*\\d+(?:-\\d+)?(?:\\s*\\([가-힣·\\s]+\\))?'
  const road =
    text.match(new RegExp(`도로명주소\\s*(${PROV}${body})`)) ||
    text.match(new RegExp(`(${PROV}${body})`))
  if (road) info.address = road[1].replace(/\s+/g, ' ').trim()

  const hgs = text.match(
    /(\d[\d,]*)\s*호\s*\/\s*(\d[\d,]*)\s*가구\s*\/\s*(\d[\d,]*)\s*세대/,
  )
  if (hgs) info.households = toNum(hgs[3])

  // 세대수 뒤에 오는 숫자를 총주차대수로 본다.
  const park = text.match(/[\d,]+\s*세대\s*([\d,]+)/)
  if (park) info.parking = toNum(park[1])

  return info
}

/** PDF 파일을 파싱해 건축물 정보를 반환한다. */
export async function parseBuildingPdf(file: File): Promise<BuildingInfo> {
  const text = await extractPdfText(file)
  return parseBuildingRegister(text)
}
