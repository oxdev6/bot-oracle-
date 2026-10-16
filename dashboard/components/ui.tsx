/**
 * Shared presentational primitives for the dashboard. Pure/presentational so
 * they can render in either a server or client tree.
 */
import type { ReactNode } from "react";

export type Tone = "live" | "warn" | "danger" | "idle" | "info";

const TONE_CLASS: Record<Tone, string> = {
  live: "border-emerald-400/25 bg-emerald-500/10 text-emerald-200",
  warn: "border-amber-400/25 bg-amber-500/10 text-amber-200",
  danger: "border-rose-400/25 bg-rose-500/10 text-rose-200",
  idle: "border-white/10 bg-white/[0.04] text-slate-300",
  info: "border-cyan-400/25 bg-cyan-500/10 text-cyan-100",
};

const DOT_CLASS: Record<Tone, string> = {
  live: "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.85)]",
  warn: "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.7)]",
  danger: "bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.8)]",
  idle: "bg-slate-400",
  info: "bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)]",
};

export function Badge({
  tone = "idle",
  children,
  dot = false,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span className={`chip ${TONE_CLASS[tone]} ${className}`}>
      {dot && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS[tone]} ${tone === "live" ? "animate-pulse-soft" : ""}`} />}
      {children}
    </span>
  );
}

export function StatusPill({ online, label }: { online: boolean; label: string }) {
  return (
    <Badge tone={online ? "live" : "warn"} dot>
      {label}
    </Badge>
  );
}

export function Card({
  children,
  className = "",
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}) {
  return <div className={`card ${hover ? "card-hover" : ""} ${className}`}>{children}</div>;
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-300">{eyebrow}</p>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-white">{title}</h2>
        {description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const STAT_TONE: Record<Tone, string> = {
  live: "from-emerald-400/20 text-emerald-200",
  warn: "from-amber-400/20 text-amber-200",
  danger: "from-rose-400/20 text-rose-200",
  idle: "from-white/10 text-slate-300",
  info: "from-cyan-400/20 text-cyan-200",
};

export function StatCard({
  icon,
  label,
  value,
  detail,
  tone = "info",
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  detail: string;
  tone?: Tone;
}) {
  return (
    <div className="card card-hover group relative overflow-hidden p-5">
      <div aria-hidden className={`pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-gradient-to-br ${STAT_TONE[tone]} to-transparent opacity-70 blur-2xl`} />
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</p>
        {icon && <span className={`${STAT_TONE[tone].split(" ")[1]} opacity-80 transition group-hover:opacity-100`}>{icon}</span>}
      </div>
      <p className="stat-value mt-3 text-3xl">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{detail}</p>
    </div>
  );
}

export function EmptyState({ title, description, icon }: { title: string; description: string; icon?: ReactNode }) {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 bg-ink-900/40 px-6 py-12 text-center">
      {icon && <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-400">{icon}</div>}
      <p className="text-lg font-bold text-white">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">{description}</p>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}

export function TableShell({
  caption,
  head,
  children,
  tone = "idle",
}: {
  caption: string;
  head: ReactNode;
  children: ReactNode;
  tone?: Tone;
}) {
  const headTone =
    tone === "danger"
      ? "bg-rose-500/[0.05] text-rose-200/70"
      : tone === "info"
        ? "bg-cyan-500/[0.05] text-cyan-200/70"
        : "bg-white/[0.03] text-slate-400";
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-ink-900/50 shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className={`text-xs font-bold uppercase tracking-[0.14em] ${headTone}`}>{head}</thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}
