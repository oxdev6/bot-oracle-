/**
 * Minimal dependency-free SVG sparkline. Renders a single polyline scaled to
 * its own min/max, so it works for any magnitude of price without axes.
 */
export default function Sparkline({
  values,
  className,
  ariaLabel = "Price trend",
}: {
  values: number[];
  className?: string;
  ariaLabel?: string;
}) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length < 2) {
    return <div className={`flex h-10 items-center justify-center text-xs text-slate-600 ${className ?? ""}`}>Not enough data</div>;
  }

  const width = 100;
  const height = 32;
  const pad = 2;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const step = (width - pad * 2) / (finite.length - 1);
  const points = finite.map((value, index) => {
    const x = pad + index * step;
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const rising = finite[finite.length - 1] >= finite[0];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <path
        d={path}
        fill="none"
        stroke={rising ? "#34d399" : "#fb7185"}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
