interface BarDatum {
  label: string
  value: number
}

interface BarChartProps {
  data: BarDatum[]
  /** 막대 색 (CSS 색상 값) */
  color?: string
  /** 막대 위 값 라벨 포맷 */
  valueFormat?: (v: number) => string
  /** 세로 높이(px) */
  height?: number
}

/**
 * 의존성 없는 순수 SVG 막대 그래프.
 * 월별 사용량/사용금액처럼 소수의 시계열 값을 비교할 때 사용한다.
 */
export default function BarChart({
  data,
  color = 'var(--accent)',
  valueFormat = (v) => v.toLocaleString(),
  height = 260,
}: BarChartProps) {
  if (data.length === 0) return null

  const padTop = 22
  const padBottom = 56
  const padLeft = 10
  const padRight = 10
  const step = 48
  const barW = 30
  const plotH = height - padTop - padBottom
  const chartW = padLeft + data.length * step + padRight

  const maxVal = Math.max(...data.map((d) => d.value), 0)
  const scale = maxVal > 0 ? plotH / (maxVal * 1.12) : 0
  const baseY = padTop + plotH

  return (
    <div className="chart-scroll">
      <svg
        width={chartW}
        height={height}
        role="img"
        className="bar-chart"
        viewBox={`0 0 ${chartW} ${height}`}
      >
        {/* 기준선 */}
        <line
          x1={padLeft}
          y1={baseY}
          x2={chartW - padRight}
          y2={baseY}
          className="bar-chart__axis"
        />
        {data.map((d, i) => {
          const cx = padLeft + i * step + step / 2
          const barH = d.value > 0 ? d.value * scale : 0
          const y = baseY - barH
          return (
            <g key={`${d.label}-${i}`}>
              <rect
                x={cx - barW / 2}
                y={y}
                width={barW}
                height={barH}
                rx={3}
                fill={color}
              >
                <title>{`${d.label}: ${valueFormat(d.value)}`}</title>
              </rect>
              <text
                x={cx}
                y={y - 5}
                textAnchor="middle"
                className="bar-chart__value"
              >
                {valueFormat(d.value)}
              </text>
              <text
                x={cx}
                y={baseY + 14}
                textAnchor="end"
                className="bar-chart__label"
                transform={`rotate(-40 ${cx} ${baseY + 14})`}
              >
                {d.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
