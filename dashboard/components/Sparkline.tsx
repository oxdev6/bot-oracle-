"use client";

import { useId } from "react";

/**
 * Minimal dependency-free SVG sparkline with a soft area fill. Colors come from
 * `currentColor`, so callers control the trend color with a Tailwind text class.
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
  const gradientId = useId().replace(/[:]/g, "");
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
  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${points[points.length - 1][0].toFixed(2)},${height} L${points[0][0].toFixed(2)},${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      preserveAspectRatio="none"
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} stroke="none" />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
