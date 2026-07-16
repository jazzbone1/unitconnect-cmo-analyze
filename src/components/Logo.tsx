/**
 * 위차(Wecha) 브랜드 로고 — 순수 SVG 재현.
 * 정식 원본(PNG/SVG)이 있으면 이 컴포넌트만 교체하면 된다.
 */
export default function Logo({ height = 28 }: { height?: number }) {
  return (
    <span className="brand-logo" aria-label="위차">
      <svg
        height={height}
        viewBox="0 0 132 40"
        role="img"
        aria-hidden="true"
        style={{ display: 'block' }}
      >
        {/* 상승하는 웨이브 마크 */}
        <g strokeLinecap="round" fill="none" strokeWidth="5">
          <path d="M4 27 L15 12" stroke="#4FC3F0" />
          <path d="M15 29 L28 9" stroke="#2C86E0" />
          <path d="M28 27 L38 14" stroke="#173B7A" />
        </g>
        <circle cx="39" cy="26" r="3.2" fill="#4FC3F0" />
        {/* 워드마크 */}
        <text
          x="56"
          y="30"
          fontSize="27"
          fontWeight="800"
          fill="#173B7A"
          fontFamily="'Pretendard','Noto Sans KR',system-ui,sans-serif"
          letterSpacing="-1"
        >
          위차
        </text>
      </svg>
    </span>
  )
}
