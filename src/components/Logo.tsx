/**
 * UNITCONNECT 워드마크 — 순수 SVG 재현 (브랜드 코어: 육각형 UC 모노그램 + 워드마크).
 * 컬러 토큰: ink(#0A0A0A) 워드마크 + lime(#C3F53E) 육각형 · voltage 액센트.
 * 정식 원본(PNG/SVG)이 있으면 이 컴포넌트만 교체하면 된다.
 */
export default function Logo({ height = 28 }: { height?: number }) {
  return (
    <span className="brand-logo" aria-label="UNITCONNECT">
      <svg
        height={height}
        viewBox="0 0 208 36"
        role="img"
        aria-hidden="true"
        style={{ display: 'block' }}
      >
        {/* 육각형 마크 (voltage) */}
        <polygon
          points="31.9,10 18,2 4.1,10 4.1,26 18,34 31.9,26"
          fill="#C3F53E"
        />
        <polygon
          points="31.9,10 18,2 4.1,10 4.1,26 18,34 31.9,26"
          fill="none"
          stroke="#A8E024"
          strokeWidth="1.2"
        />
        {/* UC 모노그램 (ink) */}
        <text
          x="18"
          y="24.5"
          fontSize="14.5"
          fontWeight="800"
          fill="#0A0A0A"
          textAnchor="middle"
          fontFamily="'Pretendard Variable','Pretendard',system-ui,sans-serif"
          letterSpacing="-0.8"
        >
          UC
        </text>
        {/* 워드마크 (ink) */}
        <text
          x="44"
          y="25.5"
          fontSize="20"
          fontWeight="800"
          fill="currentColor"
          fontFamily="'Pretendard Variable','Pretendard',system-ui,sans-serif"
          letterSpacing="-0.9"
        >
          UNITCONNECT
        </text>
      </svg>
    </span>
  )
}
