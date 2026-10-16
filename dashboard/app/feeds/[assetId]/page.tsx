"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatUnits } from "viem";
import Sparkline from "@/components/Sparkline";
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

function feedStatus(feed: FeedSnapshot): { label: string; className: string } {
  if (feed.isPaused) return { label: "Paused", className: "bg-rose-500/10 text-rose-200" };
  if (!feed.hasPrice) return { label: "Waiting", className: "bg-slate-500/10 text-slate-200" };
  if (feed.isStale || Date.now() - feed.updatedAt.getTime() > 3_600_000) return { label: "Stale", className: "bg-amber-500/10 text-amber-200" };
  return { label: "Live", className: "bg-emerald-500/10 text-emerald-200" };
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

  const status = feed ? feedStatus(feed) : null;

  return (
    <div className="min-h-screen bg-[#040b16] text-slate-100">
      <main className="relative mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 hover:text-cyan-200">
          <span aria-hidden>←</span> Back to dashboard
        </Link>

        {loading ? (
          <div className="mt-6 h-48 animate-pulse rounded-3xl border border-white/10 bg-white/[0.04]" />
        ) : error ? (
          <section className="mt-6 rounded-3xl border border-rose-500/20 bg-rose-500/10 p-6 sm:p-8" role="alert">
            <h1 className="text-2xl font-black text-white">Feed unavailable</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-rose-100/80">{error}</p>
            <Link href="/" className="mt-5 inline-block rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-cyan-100">
              Return to dashboard
            </Link>
          </section>
        ) : feed ? (
          <>
            <header className="mt-6 rounded-3xl border border-white/10 bg-slate-950/70 p-6 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">Price feed</p>
                  <h1 className="mt-2 text-3xl font-black tracking-tight text-white">{feed.symbol}</h1>
                  <p className="mt-2 font-mono text-xs text-slate-500">{feed.assetId}</p>
                </div>
                {status && <span className={`rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider ${status.className}`}>{status.label}</span>}
                <button
                  type="button"
                  disabled={refreshing}
                  onClick={() => { setRefreshing(true); void load(true).finally(() => setRefreshing(false)); }}
                  className="rounded-xl border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-wait disabled:opacity-60"
                >
                  {refreshing ? "Refreshing…" : "Refresh"}
                </button>
              </div>

              <div className="mt-6 flex flex-wrap items-end justify-between gap-4">
                <p className="text-5xl font-black tracking-tight text-white">{feed.hasPrice ? fmtPrice(feed.price, feed.decimals) : "—"}</p>
                <div className="w-full max-w-xs">
                  <Sparkline values={chartValues} className="h-12 w-full text-cyan-300" ariaLabel={`${feed.symbol} price trend across the last ${chartValues.length} rounds`} />
                  <p className="mt-1 text-right text-xs text-slate-500">{chartValues.length} round{chartValues.length === 1 ? "" : "s"} plotted</p>
                </div>
              </div>

              <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-white/10 pt-5 text-sm sm:grid-cols-4">
                <div><dt className="text-xs text-slate-500">Round</dt><dd className="mt-1 font-semibold text-white">#{feed.currentRound}</dd></div>
                <div><dt className="text-xs text-slate-500">Open submissions</dt><dd className="mt-1 font-semibold text-white">{feed.submissionsInRound}</dd></div>
                <div><dt className="text-xs text-slate-500">Last update</dt><dd className="mt-1 font-semibold text-white">{feed.hasPrice ? relative(feed.updatedAt) : "—"}</dd></div>
                <div><dt className="text-xs text-slate-500">Round closes</dt><dd className="mt-1 font-semibold text-white">{feed.nextRoundAt.getTime() > Date.now() ? fmtTimestamp(feed.nextRoundAt) : "—"}</dd></div>
              </dl>

              <a href={feed.scannerLink} target="_blank" rel="noreferrer" className="mt-6 inline-block text-sm font-semibold text-cyan-300 hover:text-cyan-200">
                View feed contract on explorer ↗
              </a>
            </header>

            <section className="mt-10">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">History</p>
                  <h2 className="mt-2 text-2xl font-black text-white">Published rounds</h2>
                </div>
                {updatedAt && <p className="text-xs text-slate-500">Updated {fmtTimestamp(updatedAt)}</p>}
              </div>

              {rounds.length ? (
                <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/50">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-left text-sm">
                      <caption className="sr-only">Recent published rounds for {feed.symbol}</caption>
                      <thead className="bg-white/[0.03] text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                        <tr>
                          <th scope="col" className="px-5 py-4">Round</th>
                          <th scope="col" className="px-5 py-4">Price</th>
                          <th scope="col" className="px-5 py-4">Accepted</th>
                          <th scope="col" className="px-5 py-4">Vetoed</th>
                          <th scope="col" className="px-5 py-4">Closed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rounds.map((round) => (
                          <tr key={round.roundId} className="border-t border-white/5 hover:bg-white/[0.03]">
                            <td className="px-5 py-4 font-semibold text-white">#{round.roundId}</td>
                            <td className="px-5 py-4 font-mono text-cyan-100">{fmtPrice(round.price, feed.decimals)}</td>
                            <td className="px-5 py-4 text-slate-200">{round.inThresholdSubmissions}</td>
                            <td className="px-5 py-4 text-slate-400">{round.vetoed ?? "—"}</td>
                            <td className="px-5 py-4 text-slate-400">{relative(round.timestamp)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/40 px-6 py-12 text-center">
                  <p className="text-lg font-bold text-white">No published rounds yet</p>
                  <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">Rounds appear here once operators reach the submission threshold and the aggregator publishes a price.</p>
                </div>
              )}
            </section>

            <p className="mt-10 text-xs text-slate-500">Configured chain: {CHAIN_CONFIG.chainId} · Data via the dashboard {`/api`} layer · Asset {shortAddr(feed.assetId)}</p>
          </>
        ) : null}
      </main>
    </div>
  );
}
