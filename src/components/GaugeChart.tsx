'use client';

interface GaugeChartProps {
  value: number;      // 0-100
  label: string;      // e.g. "CPU Usage", "Memory"
  unit?: string;      // e.g. "%", "MB"
  rawValue?: string;  // e.g. "5332" for display below gauge
  size?: number;      // diameter in px
  thresholds?: { warn: number; danger: number };
}

export default function GaugeChart({
  value,
  label,
  unit = '%',
  rawValue,
  size = 120,
  thresholds = { warn: 60, danger: 80 },
}: GaugeChartProps) {
  const clampedValue = Math.min(Math.max(value, 0), 100);

  // SVG arc math
  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = size * 0.1;
  const radius = (size - strokeWidth) / 2 - 4;

  // Arc from -225° to +45° (270° sweep)
  const startAngle = -225;
  const totalAngle = 270;
  const sweepAngle = (clampedValue / 100) * totalAngle;

  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const arcPath = (angle: number) => {
    const endAngle = startAngle + angle;
    const x1 = cx + radius * Math.cos(toRad(startAngle));
    const y1 = cy + radius * Math.sin(toRad(startAngle));
    const x2 = cx + radius * Math.cos(toRad(endAngle));
    const y2 = cy + radius * Math.sin(toRad(endAngle));
    const largeArc = angle > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;
  };

  // Color based on thresholds
  const getColor = () => {
    if (clampedValue >= thresholds.danger) return '#ef4444';
    if (clampedValue >= thresholds.warn) return '#f59e0b';
    return '#22c55e';
  };

  return (
    <div className="gauge-container" style={{ width: size, height: size + 20 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background arc */}
        <path
          d={arcPath(totalAngle)}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Value arc */}
        {clampedValue > 0 && (
          <path
            d={arcPath(sweepAngle)}
            fill="none"
            stroke={getColor()}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            style={{
              transition: 'all 0.8s ease-out',
              filter: `drop-shadow(0 0 4px ${getColor()}40)`,
            }}
          />
        )}
        {/* Center text */}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          dominantBaseline="middle"
          className="gauge-value-text"
          style={{ fontSize: size * 0.22, fill: 'var(--text-primary)', fontWeight: 700 }}
        >
          {rawValue || `${Math.round(clampedValue)}`}
        </text>
        <text
          x={cx}
          y={cy + size * 0.14}
          textAnchor="middle"
          dominantBaseline="middle"
          className="gauge-unit-text"
          style={{ fontSize: size * 0.11, fill: 'var(--text-tertiary)', fontWeight: 500 }}
        >
          {unit}
        </text>
      </svg>
      <div className="gauge-label">{label}</div>
    </div>
  );
}
