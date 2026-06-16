'use client';

import { useMemo } from 'react';

interface LatencyChartProps {
  history: { time: string; latency: number }[];
}

// Attempt a smooth catmull-rom-style spline through the points
function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let d = `M ${points[0].x} ${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];

    // Catmull-Rom to cubic bezier conversion
    const tension = 6; // Higher = less curvature
    const cp1x = p1.x + (p2.x - p0.x) / tension;
    const cp1y = p1.y + (p2.y - p0.y) / tension;
    const cp2x = p2.x - (p3.x - p1.x) / tension;
    const cp2y = p2.y - (p3.y - p1.y) / tension;

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  return d;
}

export default function LatencyChart({ history }: LatencyChartProps) {
  const chartWidth = 480;
  const chartHeight = 160;
  const paddingTop = 20;
  const paddingBottom = 28;
  const paddingLeft = 44;
  const paddingRight = 16;

  const drawableWidth = chartWidth - paddingLeft - paddingRight;
  const drawableHeight = chartHeight - paddingTop - paddingBottom;

  const { points, smoothLine, areaPath, yTicks, niceMax, stats } = useMemo(() => {
    if (history.length === 0) {
      return { points: [], smoothLine: '', areaPath: '', yTicks: [], niceMax: 0, stats: null };
    }

    const latencies = history.map((h) => h.latency);
    const max = Math.max(...latencies, 50);
    const min = Math.min(...latencies);
    const avg = Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);

    // Nice max for y-axis
    const nice = Math.ceil(max / 50) * 50 || 50;

    const pts = history.map((h, i) => {
      const x = paddingLeft + (i / Math.max(history.length - 1, 1)) * drawableWidth;
      const y = paddingTop + drawableHeight - ((h.latency / nice) * drawableHeight);
      return { x, y, latency: h.latency, time: h.time };
    });

    const smooth = buildSmoothPath(pts);

    // Area path — append the close below the curve
    let area = '';
    if (pts.length >= 2 && smooth) {
      const bottomY = paddingTop + drawableHeight;
      area = smooth + ` L ${pts[pts.length - 1].x} ${bottomY} L ${pts[0].x} ${bottomY} Z`;
    }

    // Y-axis ticks (4 lines for a richer grid)
    const ticks = [0, Math.round(nice * 0.25), Math.round(nice * 0.5), Math.round(nice * 0.75), nice];

    return {
      points: pts,
      smoothLine: smooth,
      areaPath: area,
      yTicks: ticks,
      niceMax: nice,
      stats: { min, max: Math.max(...latencies), avg, current: latencies[latencies.length - 1] },
    };
  }, [history]);

  if (history.length < 2) {
    return (
      <div className="latency-chart-empty">
        <div className="chart-empty-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M2 17L7 12L10.5 14.5L15 9L22 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="22" cy="13" r="2" fill="currentColor" opacity="0.3" />
          </svg>
        </div>
        <span>Collecting latency data…</span>
      </div>
    );
  }

  return (
    <div className="latency-chart-container">
      {/* Stats row */}
      {stats && (
        <div className="chart-stats-row">
          <div className="chart-stat">
            <span className="chart-stat-label">Current</span>
            <span className="chart-stat-value chart-stat-current">{stats.current}ms</span>
          </div>
          <div className="chart-stat">
            <span className="chart-stat-label">Avg</span>
            <span className="chart-stat-value">{stats.avg}ms</span>
          </div>
          <div className="chart-stat">
            <span className="chart-stat-label">Min</span>
            <span className="chart-stat-value chart-stat-good">{stats.min}ms</span>
          </div>
          <div className="chart-stat">
            <span className="chart-stat-label">Max</span>
            <span className="chart-stat-value chart-stat-warn">{stats.max}ms</span>
          </div>
        </div>
      )}

      {/* Chart */}
      <div className="latency-chart-wrapper">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="latency-chart-svg"
        >
          <defs>
            {/* Area gradient */}
            <linearGradient id="chartAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary-500)" stopOpacity="0.20" />
              <stop offset="60%" stopColor="var(--color-primary-500)" stopOpacity="0.06" />
              <stop offset="100%" stopColor="var(--color-primary-500)" stopOpacity="0" />
            </linearGradient>
            {/* Line glow */}
            <filter id="lineGlow">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {/* Dot glow */}
            <filter id="dotGlow">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Horizontal grid lines */}
          {yTicks.map((tick) => {
            const y = paddingTop + drawableHeight - (tick / niceMax) * drawableHeight;
            return (
              <g key={tick}>
                <line
                  x1={paddingLeft}
                  y1={y}
                  x2={chartWidth - paddingRight}
                  y2={y}
                  stroke="var(--border-subtle)"
                  strokeWidth="0.7"
                />
                <text
                  x={paddingLeft - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  className="chart-axis-label"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {/* Average line */}
          {stats && (
            <line
              x1={paddingLeft}
              y1={paddingTop + drawableHeight - (stats.avg / niceMax) * drawableHeight}
              x2={chartWidth - paddingRight}
              y2={paddingTop + drawableHeight - (stats.avg / niceMax) * drawableHeight}
              stroke="var(--color-warning)"
              strokeWidth="1"
              strokeDasharray="4 4"
              opacity="0.5"
            />
          )}

          {/* Area fill */}
          <path
            d={areaPath}
            fill="url(#chartAreaGrad)"
            className="chart-area-path"
          />

          {/* Main line with glow */}
          <path
            d={smoothLine}
            fill="none"
            stroke="var(--color-primary-500)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#lineGlow)"
            className="chart-line-path"
          />

          {/* Data points — show only a subset to avoid clutter */}
          {points.filter((_, i) => i === points.length - 1 || i % Math.max(1, Math.floor(points.length / 8)) === 0).map((p, i) => (
            <g key={i}>
              <circle
                cx={p.x}
                cy={p.y}
                r="3.5"
                fill="var(--bg-surface)"
                stroke="var(--color-primary-500)"
                strokeWidth="2"
                className="chart-dot"
              >
                <title>{`${p.time}: ${p.latency}ms`}</title>
              </circle>
            </g>
          ))}

          {/* Latest point — highlighted with glow */}
          {points.length > 0 && (
            <g>
              <circle
                cx={points[points.length - 1].x}
                cy={points[points.length - 1].y}
                r="5"
                fill="var(--color-primary-500)"
                filter="url(#dotGlow)"
                opacity="0.4"
                className="chart-latest-glow"
              />
              <circle
                cx={points[points.length - 1].x}
                cy={points[points.length - 1].y}
                r="4"
                fill="var(--bg-surface)"
                stroke="var(--color-primary-600)"
                strokeWidth="2.5"
              >
                <title>{`${points[points.length - 1].time}: ${points[points.length - 1].latency}ms`}</title>
              </circle>
            </g>
          )}

          {/* X-axis time labels — show first, middle, last */}
          {points.length >= 3 && [0, Math.floor(points.length / 2), points.length - 1].map((idx) => (
            <text
              key={`x-${idx}`}
              x={points[idx].x}
              y={chartHeight - 4}
              textAnchor="middle"
              className="chart-axis-label"
            >
              {points[idx].time}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}
