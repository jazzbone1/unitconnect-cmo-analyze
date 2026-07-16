import type { Period } from '../types'

/** 2자리 연도(YY)를 20YY로, 4자리는 그대로 반환한다. */
function expandYear(y: string): number {
  return y.length === 2 ? 2000 + Number(y) : Number(y)
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * 날짜 숫자 문자열을 {year,month,day}로 파싱한다.
 * - 8자리: YYYYMMDD
 * - 6자리: YYMMDD 우선(월 1~12·일 1~31이면), 아니면 YYYYMM으로 해석
 *   (예: "240601"→2024-06-01, "202401"→2024-01)
 */
function parseDateDigits(d: string): { year: number; month: number; day: number } {
  if (d.length === 8) {
    return {
      year: Number(d.slice(0, 4)),
      month: Number(d.slice(4, 6)),
      day: Number(d.slice(6, 8)),
    }
  }
  // 6자리: YYMMDD 해석이 유효하면 우선
  const mmddMonth = Number(d.slice(2, 4))
  const mmddDay = Number(d.slice(4, 6))
  if (mmddMonth >= 1 && mmddMonth <= 12 && mmddDay >= 1 && mmddDay <= 31) {
    return { year: expandYear(d.slice(0, 2)), month: mmddMonth, day: mmddDay }
  }
  // 그 외에는 YYYYMM (일=1)
  return { year: Number(d.slice(0, 4)), month: Number(d.slice(4, 6)), day: 1 }
}

function ymd(year: number, month: number, day: number): number {
  return year * 10000 + month * 100 + day
}

/** 파일명(확장자 제외)에서 분류 기준으로 쓸 수 있도록 주변 구분자를 정리한다. */
function cleanCategory(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[_\-~∼〜.·|/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s()[\]{}]+|[\s()[\]{}]+$/g, '')
    .trim()
}

interface Rule {
  re: RegExp
  build: (m: RegExpMatchArray) => Period
}

// 순서 중요: 더 구체적인 패턴을 먼저 시도한다.
const RULES: Rule[] = [
  // 1) 기간 범위: 240601~250703, 20240601 - 20250703 등
  {
    re: /(\d{8}|\d{6})\s*[~∼〜\-–—]\s*(\d{8}|\d{6})/,
    build: (m) => {
      const s = parseDateDigits(m[1])
      const e = parseDateDigits(m[2])
      // 일(day) 정보가 없으면(둘 다 1일) YYYY-MM 범위로, 있으면 YY.MM.DD로 표시
      const monthOnly = s.day === 1 && e.day === 1
      const fmt = (d: { year: number; month: number; day: number }) =>
        monthOnly
          ? `${d.year}-${pad2(d.month)}`
          : `${String(d.year).slice(2)}.${pad2(d.month)}.${pad2(d.day)}`
      const months =
        (e.year * 12 + e.month) - (s.year * 12 + s.month) + 1
      // 기간 범위(예: 240601~250703)는 연간 분석 데이터로 분류한다.
      return {
        label: `${fmt(s)}~${fmt(e)}`,
        sortKey: ymd(s.year, s.month, s.day),
        type: 'year',
        months: Math.max(1, months),
      }
    },
  },
  // 2) 한글 연월: 2024년 06월, 2024년6월
  {
    re: /(\d{4})\s*년\s*(\d{1,2})\s*월/,
    build: (m) => {
      const year = Number(m[1])
      const month = Number(m[2])
      return {
        label: `${year}-${pad2(month)}`,
        sortKey: ymd(year, month, 1),
        type: 'month',
        months: 1,
      }
    },
  },
  // 3) 한글 연도만: 2024년
  {
    re: /(\d{4})\s*년/,
    build: (m) => {
      const year = Number(m[1])
      return {
        label: `${year}`,
        sortKey: ymd(year, 1, 1),
        type: 'year',
        months: 12,
      }
    },
  },
  // 4) YYYY-MM / YYYY.MM / YYYY_MM
  {
    re: /(20\d{2})[-._/](0?[1-9]|1[0-2])(?!\d)/,
    build: (m) => {
      const year = Number(m[1])
      const month = Number(m[2])
      return {
        label: `${year}-${pad2(month)}`,
        sortKey: ymd(year, month, 1),
        type: 'month',
        months: 1,
      }
    },
  },
  // 5) YYYYMM (구분자 없이 붙은 6자리, 20xx 시작)
  {
    re: /(20\d{2})(0[1-9]|1[0-2])(?!\d)/,
    build: (m) => {
      const year = Number(m[1])
      const month = Number(m[2])
      return {
        label: `${year}-${pad2(month)}`,
        sortKey: ymd(year, month, 1),
        type: 'month',
        months: 1,
      }
    },
  },
  // 6) 연도만: 2024
  {
    re: /(20\d{2})(?!\d)/,
    build: (m) => {
      const year = Number(m[1])
      return {
        label: `${year}`,
        sortKey: ymd(year, 1, 1),
        type: 'year',
        months: 12,
      }
    },
  },
]

/**
 * 파일명을 분류 기준(category)과 기간(period)으로 분해한다.
 * 기간 토큰을 제거한 나머지 문자열이 카테고리가 된다.
 */
export function parseFileName(fileName: string): {
  category: string
  period: Period | null
} {
  const base = fileName.replace(/\.[^.]+$/, '')
  // 파일명에 "전체"가 들어가면 전체 기간 데이터로 분류한다.
  const isTotal = base.includes('전체')

  for (const { re, build } of RULES) {
    const m = base.match(re)
    if (m) {
      const period = build(m)
      let category = cleanCategory(base.replace(m[0], ' '))
      if (isTotal) {
        period.type = 'total'
        category = cleanCategory(category.replace(/전체/g, ' '))
        return { category: category || '전체', period }
      }
      return { category: category || cleanCategory(base) || base, period }
    }
  }

  // 날짜는 없지만 "전체"가 있으면 전체 기간으로 분류 (기간 라벨은 "전체")
  if (isTotal) {
    return {
      category: cleanCategory(base.replace(/전체/g, ' ')) || base,
      period: { label: '전체', sortKey: Number.POSITIVE_INFINITY, type: 'total', months: 1 },
    }
  }

  return { category: cleanCategory(base) || base, period: null }
}
