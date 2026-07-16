interface Point {
  label: string
  /** 막대 값 (사용금액) */
  bar: number
  /** 선 값 (사용량) */
  line: number
}

interface ComboChartProps {
  data: Point[]
  barLabel: string
  lineLabel: string
  barFormat?: (v: number) => string
  lineFormat?: (v: number) => string
  barColor?: string
  lineColor?: string
}

/**
 * 의존성 없는 순수 SVG 콤보 차트.
 * 막대(왼쪽 축) + 선(오른쪽 축)을 하나의 그래프에 겹쳐 그린다.
 * viewBox 기반이라 컨테이너 폭에 맞춰 균형 있게 늘어난다(좌측 쏠림 없음).
 */
export default function ComboChart({
  data,
  barLabel,
  lineLabel,
  barFormat = (v) => v.toLocaleString(),
  lineFormat = (v) => v.toLocaleString(),
  barColor = '#3B82F6',
  lineColor = '#F59E0B',
}: ComboChartProps) {
  if (data.length === 0) return null

  const W = 900
  const H = 340
  const padLeft = 60
  const padRight = 56
  const padTop = 34
  const padBottom = 52
  const plotW = W - padLeft - padRight
  const plotH = H - padTop - padBottom
  const baseY = padTop + plotH
  const n = data.length
  const step = plotW / n
  const barW = Math.min(36, step * 0.5)

  const barMax = Math.max(...data.map((d) => d.bar), 0) * 1.1 || 1
  const lineMax = Math.max(...data.map((d) => d.line), 0) * 1.1 || 1

  const cx = (i: number) => padLeft + step * (i + 0.5)
  const ticks = [0, 0.25, 0.5, 0.75, 1]

  const linePts = data
    .map((d, i) => `${cx(i)},${baseY - (d.line / lineMax) * plotH}`)
    .join(' ')

  return (
    <div className="chart-box">
      {/* 범례 */}
      <div className="chart-legend">
        <span className="chart-legend__item">
          <span
            className="chart-legend__swatch"
            style={{ background: barColor }}
          />
          {barLabel}
        </span>
        <span className="chart-legend__item">
          <span
            className="chart-legend__swatch chart-legend__swatch--line"
            style={{ background: lineColor }}
          />
          {lineLabel}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        className="combo-chart"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* 그리드 + 좌/우 축 눈금 */}
        {ticks.map((f) => {
          const y = baseY - f * plotH
          return (
            <g key={f}>
              <line
                x1={padLeft}
                y1={y}
                x2={W - padRight}
                y2={y}
                className="combo-chart__grid"
              />
              <text
                x={padLeft - 8}
                y={y + 4}
                textAnchor="end"
                className="combo-chart__axis-left"
              >
                {barFormat(barMax * f)}
              </text>
              <text
                x={W - padRight + 8}
                y={y + 4}
                textAnchor="start"
                className="combo-chart__axis-right"
              >
                {lineFormat(lineMax * f)}
              </text>
            </g>
          )
        })}

        {/* 막대 (사용금액) */}
        {data.map((d, i) => {
          const barH = d.bar > 0 ? (d.bar / barMax) * plotH : 0
          return (
            <rect
              key={`b-${i}`}
              x={cx(i) - barW / 2}
              y={baseY - barH}
              width={barW}
              height={barH}
              rx={3}
              fill={barColor}
              opacity={0.9}
            >
              <title>{`${d.label} · ${barLabel}: ${barFormat(d.bar)}`}</title>
            </rect>
          )
        })}

        {/* 선 (사용량) */}
        <polyline
          points={linePts}
          fill="none"
          stroke={lineColor}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {data.map((d, i) => (
          <circle
            key={`p-${i}`}
            cx={cx(i)}
            cy={baseY - (d.line / lineMax) * plotH}
            r={3.5}
            fill="#fff"
            stroke={lineColor}
            strokeWidth={2}
          >
            <title>{`${d.label} · ${lineLabel}: ${lineFormat(d.line)}`}</title>
          </circle>
        ))}

        {/* x축 라벨 */}
        {data.map((d, i) => (
          <text
            key={`x-${i}`}
            x={cx(i)}
            y={baseY + 16}
            textAnchor="end"
            className="combo-chart__xlabel"
            transform={`rotate(-38 ${cx(i)} ${baseY + 16})`}
          >
            {d.label}
          </text>
        ))}
      </svg>
    </div>
  )
}
