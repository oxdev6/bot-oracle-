/**
 * Dependency-free inline SVG icon set (24x24, currentColor). Kept local so the
 * dashboard ships no icon-font/runtime dependency.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Base({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ActivityIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 12h3.5l2.5 7 4-14 2.5 7H21" />
    </Base>
  );
}

export function WalletIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1H5.5A2.5 2.5 0 0 0 3 10.5Z" />
      <path d="M3 7.5v8A2.5 2.5 0 0 0 5.5 18H19a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1H5.5A2.5 2.5 0 0 1 3 7.5Z" />
      <circle cx="16.5" cy="12.5" r="1.1" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3 5 6v5.5c0 4.2 2.9 7.4 7 8.5 4.1-1.1 7-4.3 7-8.5V6Z" />
      <path d="m9.3 12 1.9 1.9 3.5-3.8" />
    </Base>
  );
}

export function LayersIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m12 3 8 4.5-8 4.5-8-4.5Z" />
      <path d="m4 12 8 4.5 8-4.5" />
      <path d="m4 16.5 8 4.5 8-4.5" />
    </Base>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
      <path d="M20 20v-4h-4" />
    </Base>
  );
}

export function ExternalLinkIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4" />
    </Base>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Base>
  );
}

export function TrendingUpIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m3 16 5.5-5.5 3.5 3.5L21 5" />
      <path d="M15 5h6v6" />
    </Base>
  );
}

export function TrendingDownIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m3 8 5.5 5.5L12 10l9 9" />
      <path d="M15 19h6v-6" />
    </Base>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Base>
  );
}

export function UsersIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 6.1" />
      <path d="M17.5 19a5.5 5.5 0 0 0-2.2-4.4" />
    </Base>
  );
}

export function CoinsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <ellipse cx="12" cy="6.5" rx="7" ry="3" />
      <path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
      <path d="M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
    </Base>
  );
}

export function GaugeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 18a8 8 0 1 1 16 0" />
      <path d="m12 14 4-4" />
      <circle cx="12" cy="14" r="1.2" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function AlertIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 4 3 19h18Z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="16.6" r="1" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <circle cx="12" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
    </Base>
  );
}

export function BoltIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M13 3 5 13h5l-1 8 8-10h-5Z" />
    </Base>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
    </Base>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12 3v5" />
      <path d="M12 16v5" />
      <path d="M3 12h5" />
      <path d="M16 12h5" />
      <path d="m6.3 6.3 3 3" />
      <path d="m14.7 14.7 3 3" />
      <path d="m17.7 6.3-3 3" />
      <path d="m9.3 14.7-3 3" />
    </Base>
  );
}
