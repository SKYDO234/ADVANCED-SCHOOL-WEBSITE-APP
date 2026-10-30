import { useMemo } from 'react';

/* Lightweight dependency-free SVG charts, driven by CSS variables. */

const PALETTE = ['var(--accent)', '#0f766e', '#b45309', '#7c3aed', '#be123c', '#0891b2'];

function styleFor(series, index) {
  return series.color || PALETTE[index % PALETTE.length];
}

function niceMax(value) {
  if (!value || value <= 0) return 10;
  const exp = Math.floor(Math.log10(value));
  const base = 10 ** exp;
  const scaled = value / base;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * base;
}

export function Legend({ series }) {
  return (
    <div className="chart-legend">
      {series.map((s, i) => (
        <span key={s.key} className="row gap-1">
          <span className="legend-dot" style={{ background: styleFor(s, i) }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

export function BarChart({ data = [], series = [], height = 210, format = (v) => v, stacked = false, xKey = 'label' }) {
  const width = 660;
  const pad = { top: 12, right: 8, bottom: 26, left: 42 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const totals = data.map((row) => (stacked
    ? series.reduce((sum, s) => sum + (Number(row[s.key]) || 0), 0)
    : Math.max(...series.map((s) => Number(row[s.key]) || 0), 0)));
  const max = niceMax(Math.max(...totals, 1));
  const slot = innerW / Math.max(data.length, 1);
  const barW = stacked ? Math.min(slot * 0.5, 34) : Math.min((slot * 0.66) / Math.max(series.length, 1), 26);
  const ticks = 4;

  if (!data.length) return <div className="muted fs-13" style={{ padding: 20, textAlign: 'center' }}>No data for this period</div>;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Bar chart">
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const y = pad.top + (innerH / ticks) * i;
          const value = max - (max / ticks) * i;
          return (
            <g key={i}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="var(--line)" strokeDasharray={i === ticks ? '0' : '3 4'} />
              <text x={pad.left - 8} y={y + 3.5} textAnchor="end" fontSize="10" fill="var(--ink-3)">{format(Math.round(value))}</text>
            </g>
          );
        })}
        {data.map((row, ri) => {
          const groupX = pad.left + slot * ri;
          let stackY = pad.top + innerH;
          return (
            <g key={row[xKey] ?? ri}>
              {series.map((s, si) => {
                const value = Number(row[s.key]) || 0;
                const h = (value / max) * innerH;
                const x = stacked
                  ? groupX + slot / 2 - barW / 2
                  : groupX + slot / 2 - (barW * series.length) / 2 + si * barW;
                const y = stacked ? stackY - h : pad.top + innerH - h;
                if (stacked) stackY -= h;
                return (
                  <rect key={s.key} x={x} y={y} width={Math.max(barW - 2, 1)} height={Math.max(h, value ? 1.5 : 0)} rx="3" fill={styleFor(s, si)} fillOpacity="0.92">
                    <title>{`${row[xKey]} · ${s.label}: ${format(value)}`}</title>
                  </rect>
                );
              })}
              <text x={groupX + slot / 2} y={height - 8} textAnchor="middle" fontSize="10.5" fill="var(--ink-3)">{row[xKey]}</text>
            </g>
          );
        })}
      </svg>
      <Legend series={series} />
    </div>
  );
}

export function LineChart({ data = [], series = [], height = 210, format = (v) => v, xKey = 'label', area = true }) {
  const width = 660;
  const pad = { top: 14, right: 10, bottom: 26, left: 42 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...data.flatMap((row) => series.map((s) => Number(row[s.key]) || 0)), 1));
  const step = data.length > 1 ? innerW / (data.length - 1) : 0;
  const ticks = 4;

  const pointsFor = (key) => data.map((row, i) => ({
    x: pad.left + (data.length > 1 ? step * i : innerW / 2),
    y: pad.top + innerH - ((Number(row[key]) || 0) / max) * innerH,
    v: Number(row[key]) || 0,
    label: row[xKey],
  }));

  const pathFor = (points) => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  if (!data.length) return <div className="muted fs-13" style={{ padding: 20, textAlign: 'center' }}>No data for this period</div>;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Line chart">
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const y = pad.top + (innerH / ticks) * i;
          return (
            <g key={i}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="var(--line)" strokeDasharray={i === ticks ? '0' : '3 4'} />
              <text x={pad.left - 8} y={y + 3.5} textAnchor="end" fontSize="10" fill="var(--ink-3)">{format(Math.round(max - (max / ticks) * i))}</text>
            </g>
          );
        })}
        {series.map((s, si) => {
          const points = pointsFor(s.key);
          const color = styleFor(s, si);
          return (
            <g key={s.key}>
              {area ? (
                <path
                  d={`${pathFor(points)} L${points[points.length - 1].x},${pad.top + innerH} L${points[0].x},${pad.top + innerH} Z`}
                  fill={color}
                  fillOpacity="0.1"
                />
              ) : null}
              <path d={pathFor(points)} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              {points.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--bg-elevated)" stroke={color} strokeWidth="2">
                  <title>{`${p.label} · ${s.label}: ${format(p.v)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {data.map((row, i) => {
          if (data.length > 7 && i % 2 !== 0 && i !== data.length - 1) return null;
          return (
            <text key={i} x={pad.left + (data.length > 1 ? step * i : innerW / 2)} y={height - 8} textAnchor="middle" fontSize="10.5" fill="var(--ink-3)">
              {row[xKey]}
            </text>
          );
        })}
      </svg>
      <Legend series={series} />
    </div>
  );
}

export function Donut({ data = [], size = 168, thickness = 20, centerLabel, centerValue, total: forcedTotal }) {
  const total = forcedTotal ?? data.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="row gap-3 row-wrap" style={{ alignItems: 'center' }}>
      <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Donut chart">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--bg-hover)" strokeWidth={thickness} />
          {total > 0 && data.map((d, i) => {
            const value = Number(d.value) || 0;
            const length = (value / total) * circumference;
            const dash = `${Math.max(length - 2, 0)} ${circumference}`;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={d.color || PALETTE[i % PALETTE.length]}
                strokeWidth={thickness}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                strokeLinecap="round"
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              >
                <title>{`${d.label}: ${value}`}</title>
              </circle>
            );
            offset += length;
            return el;
          })}
        </svg>
        {(centerValue !== undefined || centerLabel) ? (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', pointerEvents: 'none' }}>
            <div>
              <div style={{ fontWeight: 680, fontSize: 18 }}>{centerValue}</div>
              {centerLabel ? <div className="fs-12 muted">{centerLabel}</div> : null}
            </div>
          </div>
        ) : null}
      </div>
      <div className="col" style={{ gap: 8, flex: 1, minWidth: 130 }}>
        {data.map((d, i) => (
          <div key={i} className="row-between fs-13">
            <span className="row gap-1">
              <span className="legend-dot" style={{ background: d.color || PALETTE[i % PALETTE.length] }} />
              {d.label}
            </span>
            <strong className="tnum">{Number(d.value) || 0}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Sparkline({ values = [], height = 38, color = 'var(--accent)' }) {
  const width = 140;
  const nums = values.map((v) => Number(v) || 0);
  const max = Math.max(...nums, 1);
  const min = Math.min(...nums, 0);
  const span = max - min || 1;
  const points = nums.map((v, i) => ({
    x: nums.length > 1 ? (width / (nums.length - 1)) * i : width / 2,
    y: height - 4 - ((v - min) / span) * (height - 10),
  }));
  if (!nums.length) return null;
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const id = `spark-${Math.abs(nums.reduce((a, b) => a * 31 + b, 7)) % 99999}`;
  return (
    <svg className="sparkline" viewBox={`0 0 ${width} ${height}`} height={height} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function HBars({ data = [], format = (v) => v, color = 'var(--accent)' }) {
  const max = useMemo(() => Math.max(...data.map((d) => Number(d.value) || 0), 1), [data]);
  if (!data.length) return <div className="muted fs-13">No data</div>;
  return (
    <div className="col" style={{ gap: 12 }}>
      {data.map((d, i) => (
        <div key={i}>
          <div className="row-between fs-13" style={{ marginBottom: 4 }}>
            <span className="truncate">{d.label}</span>
            <span className="tnum muted">{format(d.value)}</span>
          </div>
          <div className="progress" style={{ height: 8 }}>
            <span style={{ width: `${((Number(d.value) || 0) / max) * 100}%`, background: d.color || color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ScoreRing({ percent = 0, size = 62, color, label }) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const tone = color || (value >= 75 ? 'var(--success)' : value >= 40 ? 'var(--warning)' : 'var(--danger)');
  return (
    <div className="score-ring" style={{ width: size, height: size, background: `conic-gradient(${tone} ${value * 3.6}deg, var(--bg-hover) 0)` }}>
      <div style={{
        width: size - stroke * 2,
        height: size - stroke * 2,
        borderRadius: '50%',
        background: 'var(--bg-elevated)',
        display: 'grid',
        placeItems: 'center',
        fontSize: size / 5,
      }}>
        {label ?? `${Math.round(value)}%`}
      </div>
    </div>
  );
}
