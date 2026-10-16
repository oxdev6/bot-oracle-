"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatUnits } from "viem";
import Sparkline from "@/components/Sparkline";
import { Badge, EmptyState, SectionHeading, Skeleton, TableShell, type Tone } from "@/components/ui";
import { BoltIcon, ClockIcon, ExternalLinkIcon, RefreshIcon } from "@/components/icons";
import { CHAIN_CONFIG, fmtPrice, fmtTimestamp, type FeedSnapshot, type RoundRow } from "@/lib/client";
import { fetchFeedDetail, revalidateDashboard } from "@/lib/api";

function shortAddr(address: string): string {
  if (!address) return "—";
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function relative(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime()) || date.getTime() <= 0) return "—";
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${Math.max(1, seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function feedStatus(feed: FeedSnapshot): { label: string; tone: Tone } {
  if (feed.isPaused) return { label: "Paused", tone: "danger" };
  if (!feed.hasPrice) return { label: "Waiting", tone: "idle" };
  if (feed.isStale || Date.now() - feed.updatedAt.getTime() > 3_600_000) return { label: "Stale", tone: "warn" };
  return { label: "Live", tone: "live" };
}

export default function FeedDetailPage() {
  const params = useParams<{ assetId: string }>();
  const assetId = params?.assetId ?? "";

  const [feed, setFeed] = useState<FeedSnapshot | null>(null);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    if (!/^0x[0-9a-fA-F]{64}$/.test(assetId)) {
      setError("This feed id is malformed. Return to the dashboard and pick a feed.");
      setLoading(false);
      return;
    }
    try {
      setError(null);
      if (force) await revalidateDashboard();
      const data = await fetchFeedDetail(assetId);
      if (data.error || !data.feed) {
        setError(data.error ?? "This feed is not registered on the aggregator.");
        setFeed(null);
        setRounds([]);
      } else {
        setFeed(data.feed);
        setRounds(data.rounds);
      }
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "The feed could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  useEffect(() => {
    void load();
  }, [load]);

  const chartValues = useMemo(
    () => [...rounds].reverse().map((round) => Number(formatUnits(round.price, feed?.decimals ?? 8))),
    [rounds, feed?.decimals],
  );
  const trendUp = chartValues.length > 1 ? chartValues[chartValues.length - 1] >= chartValues[0] : true;

  const status = feed ? feedStatus(feed) : null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-ink-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-gradient text-slate-950 shadow-glow">
              <BoltIcon className="h-5 w-5" />
            </span>
            <span className="leading-tight">
              <span className="block text-[10px] font-extrabold uppercase tracking-[0.28em] text-cyan-300">Lodestar</span>
              <span className="block text-base font-black tracking-tight text-white">Oracle</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/" className="btn-ghost hidden sm:inline-flex">← Dashboard</Link>
            <button
              type="button"
              disabled={refreshing}
              onClick={() => { setRefreshing(true); void load(true).finally(() => setRefreshing(false)); }}
              className="btn-primary"
            >
              <RefreshIcon className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{refreshing ? "Refreshing…" : "Refresh"}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 transition hover:gap-3 hover:text-cyan-200">
          <span aria-hidden>←</span> Back to dashboard
        </Link>

        {loading ? (
          <div className="mt-6 space-y-4">
            <Skeleton className="h-56" />
            <Skeleton className="h-64" />
          </div>
        ) : error ? (
          <section className="mt-6 rounded-3xl border border-rose-500/25 bg-rose-500/[0.08] p-6 shadow-card sm:p-8" role="alert">
            <h1 className="text-2xl font-black text-white">Feed unavailable</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-rose-100/80">{error}</p>
            <Link href="/" className="btn-ghost mt-5">Return to dashboard</Link>
          </section>
        ) : feed ? (
          <>
            <header className="card mt-6 overflow-hidden p-6 shadow-glow sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-300">Price feed</p>
                  <h1 className="mt-2 text-3xl font-black tracking-tight text-white">{feed.symbol}</h1>
                  <p className="mt-2 font-mono text-xs text-slate-500">{feed.assetId}</p>
                </div>
                {status && <Badge tone={status.tone} dot>{status.label}</Badge>}
              </div>

              <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
                <p className="stat-value text-5xl sm:text-6xl">{feed.hasPrice ? fmtPrice(feed.price, feed.decimals) : "—"}</p>
                <div className="w-full max-w-xs">
                  <Sparkline
                    values={chartValues}
                    className={`h-14 w-full ${trendUp ? "text-emerald-400/90" : "text-rose-400/90"}`}
                    ariaLabel={`${feed.symbol} price trend across the last ${chartValues.length} rounds`}
                  />
                  <p className="mt-1 text-right text-xs text-slate-500">{chartValues.length} round{chartValues.length === 1 ? "" : "s"} plotted</p>
                </div>
              </div>

              <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-white/10 pt-5 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-slate-500">Round</dt><dd className="stat-value mt-1">#{feed.currentRound}</dd></div>
                <div><dt className="text-xs text-slate-500">Open submissions</dt><dd className="stat-value mt-1">{feed.submissionsInRound}</dd></div>
                <div><dt className="text-xs text-slate-500">Last update</dt><dd className="mt-1 font-semibold text-white">{feed.hasPrice ? relative(feed.updatedAt) : "—"}</dd></div>
                <div><dt className="text-xs text-slate-500">Round closes</dt><dd className="mt-1 font-semibold text-white">{feed.nextRoundAt.getTime() > Date.now() ? fmtTimestamp(feed.nextRoundAt) : "—"}</dd></div>
              </dl>

              <a href={feed.scannerLink} target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-300 transition hover:gap-2.5 hover:text-cyan-200">
                View feed contract on explorer <ExternalLinkIcon className="h-4 w-4" />
              </a>
            </header>

            <section className="mt-10">
              <SectionHeading
                eyebrow="History"
                title="Published rounds"
                action={updatedAt ? <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><ClockIcon className="h-3.5 w-3.5" /> Updated {fmtTimestamp(updatedAt)}</span> : undefined}
              />

              {rounds.length ? (
                <TableShell
                  caption={`Recent published rounds for ${feed.symbol}`}
                  tone="info"
                  head={<tr><th scope="col" className="px-5 py-4">Round</th><th scope="col" className="px-5 py-4">Price</th><th scope="col" className="px-5 py-4">Accepted</th><th scope="col" className="px-5 py-4">Vetoed</th><th scope="col" className="px-5 py-4">Closed</th></tr>}
                >
                  {rounds.map((round) => (
                    <tr key={round.roundId} className="border-t border-white/5 transition hover:bg-white/[0.03]">
                      <td className="px-5 py-4 font-semibold text-white tnum">#{round.roundId}</td>
                      <td className="px-5 py-4 font-mono text-cyan-100">{fmtPrice(round.price, feed.decimals)}</td>
                      <td className="px-5 py-4 text-slate-200 tnum">{round.inThresholdSubmissions}</td>
                      <td className="px-5 py-4 text-slate-400 tnum">{round.vetoed ?? "—"}</td>
                      <td className="px-5 py-4 text-slate-400">{relative(round.timestamp)}</td>
                    </tr>
                  ))}
                </TableShell>
              ) : (
                <EmptyState icon={<ClockIcon className="h-5 w-5" />} title="No published rounds yet" description="Rounds appear here once operators reach the submission threshold and the aggregator publishes a price." />
              )}
            </section>

            <p className="mt-10 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              Configured chain: {CHAIN_CONFIG.chainId}
              <span aria-hidden>·</span> Data via the dashboard <code className="rounded bg-white/5 px-1 font-mono">/api</code> layer
              <span aria-hidden>·</span> Asset {shortAddr(feed.assetId)}
            </p>
          </>
        ) : null}
      </main>

      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-grid bg-[size:46px_46px] opacity-[0.35]" />
    </div>
  );
}
