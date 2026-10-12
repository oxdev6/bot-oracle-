"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import OperatorConsole from "@/components/OperatorConsole";
import {
  CHAIN_CONFIG,
  checkRpcConnection,
  getConfigurationError,
  getFeed,
  getOperators,
  getRegistry,
  getRounds,
  getSlashes,
  getToken,
  getVault,
  fmtPrice,
  fmtToken,
  fmtTimestamp,
  type FeedSnapshot,
  type OperatorRow,
  type RoundRow,
  type SlashRow,
  type TokenSnapshot,
  type VaultSnapshot,
} from "@/lib/client";

function shortAddr(address: string): string {
  if (!address) return "—";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function flexAgo(date: Date): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime()) || date.getTime() <= 0) return "No data yet";
  const seconds = Math.max(1, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function StatusPill({ online, label }: { online: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${online ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-200" : "border-amber-400/25 bg-amber-500/10 text-amber-200"}`}>
      <span className={`h-2 w-2 rounded-full ${online ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" : "bg-amber-400"}`} />
      {label}
    </span>
  );
}

function resolveFeedStatus(feed: FeedSnapshot): "live" | "stale" | "paused" | "waiting" {
  if (feed.isPaused) return "paused";
  if (!feed.hasPrice) return "waiting";
  if (feed.isStale || Date.now() - feed.updatedAt.getTime() > 60 * 60 * 1000) return "stale";
  return "live";
}

function StatCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_25px_60px_-45px_rgba(2,132,199,0.9)] backdrop-blur-xl">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-3 text-3xl font-black tracking-tight text-white">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{detail}</p>
    </div>
  );
}

function FeedCard({ feed }: { feed: FeedSnapshot }) {
  const status = resolveFeedStatus(feed);
  const statusLabel = {
    live: "Live",
    stale: "Stale",
    paused: "Paused",
    waiting: "Waiting",
  }[status];
  const statusClass = {
    live: "bg-emerald-500/10 text-emerald-200",
    stale: "bg-amber-500/10 text-amber-200",
    paused: "bg-rose-500/10 text-rose-200",
    waiting: "bg-slate-500/10 text-slate-200",
  }[status];

  return (
    <a href={feed.scannerLink} target="_blank" rel="noreferrer" className="group block rounded-3xl border border-white/10 bg-slate-950/60 p-6 transition duration-300 hover:-translate-y-1 hover:border-cyan-400/40 hover:bg-slate-900/80">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Price feed</p>
          <h3 className="mt-2 text-2xl font-bold text-white">{feed.symbol}</h3>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${statusClass}`}>{statusLabel}</span>
      </div>
      <p className="mt-6 text-4xl font-black tracking-tight text-white">{feed.hasPrice ? fmtPrice(feed.price, feed.decimals) : "—"}</p>
      <div className="mt-6 grid grid-cols-2 gap-3 border-t border-white/10 pt-4 text-sm text-slate-300">
        <div><span className="block text-xs text-slate-500">Round</span>#{feed.currentRound}</div>
        <div><span className="block text-xs text-slate-500">Submissions</span>{feed.submissionsInRound}</div>
        <div className="col-span-2"><span className="block text-xs text-slate-500">Status</span>{feed.hasPrice ? `Published ${fmtTimestamp(feed.updatedAt)}` : "No published price"}</div>
      </div>
      <p className="mt-5 text-sm font-semibold text-cyan-300 group-hover:text-cyan-200">{status === "waiting" ? "Waiting for a valid round →" : status === "stale" ? "Price is stale — check health →" : "View on explorer →"}</p>
    </a>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 bg-slate-950/40 px-6 py-12 text-center">
      <p className="text-lg font-bold text-white">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">{description}</p>
    </div>
  );
}

function OperatorsTable({ operators }: { operators: OperatorRow[] }) {
  if (!operators.length) return <EmptyState title="No operators bonded" description="Operators must stake the minimum amount before they can submit prices." />;
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/50">
      <table className="w-full text-left text-sm">
        <thead className="bg-white/[0.03] text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
          <tr><th className="px-5 py-4">Operator</th><th className="px-5 py-4">Stake</th><th className="px-5 py-4">Status</th></tr>
        </thead>
        <tbody>
          {operators.map((operator) => (
            <tr key={operator.address} className="border-t border-white/5 hover:bg-white/[0.03]">
              <td className="px-5 py-4 font-mono text-xs text-cyan-300">{shortAddr(operator.address)}</td>
              <td className="px-5 py-4 font-semibold text-white">{fmtToken(operator.stake, 18, 0)} LODE</td>
              <td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${operator.isEligible ? "bg-emerald-500/10 text-emerald-200" : "bg-amber-500/10 text-amber-200"}`}>{operator.isEligible ? "Eligible" : "Leaving"}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecentRounds({ rounds, symbols }: { rounds: RoundRow[]; symbols: Record<string, string> }) {
  if (!rounds.length) return <EmptyState title="No closed rounds yet" description="The protocol will publish accepted prices here as operators complete their first round." />;
  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/50">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-white/[0.03] text-xs font-bold uppercase tracking-[0.14em] text-slate-400"><tr><th className="px-5 py-4">Feed</th><th className="px-5 py-4">Price</th><th className="px-5 py-4">Accepted</th><th className="px-5 py-4">Vetoed</th><th className="px-5 py-4">Closed</th></tr></thead>
          <tbody>{rounds.map((round) => (
            <tr key={`${round.assetId}-${round.roundId}`} className="border-t border-white/5 hover:bg-white/[0.03]">
              <td className="px-5 py-4 font-semibold text-white">{symbols[round.assetId] ?? shortAddr(round.assetId)}</td>
              <td className="px-5 py-4 font-mono text-cyan-100">{fmtPrice(round.price, 8)}</td>
              <td className="px-5 py-4 text-slate-200">{round.inThresholdSubmissions}</td>
              <td className="px-5 py-4 text-slate-400">{round.vetoed === null ? "—" : round.vetoed}</td>
              <td className="px-5 py-4 text-slate-400">{flexAgo(round.timestamp)}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}

function SlashHistory({ slashes }: { slashes: SlashRow[] }) {
  if (!slashes.length) return <EmptyState title="No slashing events" description="All operators are currently satisfying the protocol rules." />;
  return (
    <div className="overflow-hidden rounded-3xl border border-rose-500/15 bg-slate-950/50">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="bg-rose-500/[0.04] text-xs font-bold uppercase tracking-[0.14em] text-rose-200/70"><tr><th className="px-5 py-4">Operator</th><th className="px-5 py-4">Amount</th><th className="px-5 py-4">Reason</th><th className="px-5 py-4">Time</th></tr></thead>
          <tbody>{slashes.map((slash) => (
            <tr key={`${slash.operator}-${slash.txHash}`} className="border-t border-rose-500/10 hover:bg-rose-500/[0.03]">
              <td className="px-5 py-4 font-mono text-xs text-rose-300">{shortAddr(slash.operator)}</td>
              <td className="px-5 py-4 font-semibold text-rose-200">-{fmtToken(slash.amount, 18, 0)} LODE</td>
              <td className="max-w-md px-5 py-4 text-slate-300">{slash.reason}</td>
              <td className="px-5 py-4 text-slate-400">{flexAgo(slash.timestamp)}</td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [feeds, setFeeds] = useState<FeedSnapshot[]>([]);
  const [token, setToken] = useState<TokenSnapshot | null>(null);
  const [vault, setVault] = useState<VaultSnapshot | null>(null);
  const [operators, setOperators] = useState<OperatorRow[]>([]);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [slashes, setSlashes] = useState<SlashRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const configError = getConfigurationError();
      if (configError) throw new Error(configError);
      await checkRpcConnection();
      const [registry, tok, vlt, ops, rds, slh] = await Promise.all([getRegistry(), getToken(), getVault(), getOperators(), getRounds(), getSlashes()]);
      setToken(tok);
      setVault(vlt);
      setOperators(ops);
      setRounds(rds);
      setSlashes(slh);
      setFeeds((await Promise.all(registry.map(getFeed))).filter((feed): feed is FeedSnapshot => Boolean(feed)));
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "The dashboard could not load on-chain data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(), 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const symbols = useMemo(() => Object.fromEntries(feeds.map((feed) => [feed.assetId, feed.symbol])), [feeds]);
  const liveFeeds = feeds.filter((feed) => resolveFeedStatus(feed) === "live").length;
  const staleFeeds = feeds.filter((feed) => resolveFeedStatus(feed) === "stale").length;
  const waitingFeeds = feeds.filter((feed) => resolveFeedStatus(feed) === "waiting").length;
  const pausedFeeds = feeds.filter((feed) => resolveFeedStatus(feed) === "paused").length;
  const chainLabel = CHAIN_CONFIG.chainId === 677 ? "BOT Mainnet" : CHAIN_CONFIG.chainId === 968 ? "BOT Testnet" : "Local Network";
  const chainStatus = loading ? "Checking…" : error ? "Unavailable" : "Connected";

  return (
    <div className="min-h-screen bg-[#040b16] text-slate-100">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-24 top-0 h-96 w-96 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="absolute right-0 top-32 h-[30rem] w-[30rem] rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute -bottom-20 left-1/3 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl" />
      </div>

      <main className="relative mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header className="relative overflow-hidden rounded-[28px] border border-cyan-400/15 bg-slate-950/80 px-5 py-5 shadow-[0_40px_100px_-60px_rgba(6,182,212,0.9)] backdrop-blur-2xl sm:px-7">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent" />
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 via-sky-500 to-blue-700 text-xl font-black text-slate-950">L</div>
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.25em] text-cyan-300">Lodestar Oracle</p>
                <h1 className="mt-2 text-2xl font-black tracking-tight text-white sm:text-3xl">Protocol Intelligence</h1>
                <p className="mt-1 text-sm text-slate-400">Live prices, operator health, and network activity on BOT Chain.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <StatusPill online={!loading && !error} label={`${chainLabel} · ${chainStatus}`} />
              <a href={CHAIN_CONFIG.scannerUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2.5 text-sm font-semibold text-cyan-100 transition hover:border-cyan-300 hover:bg-cyan-400/15">View explorer</a>
              <button type="button" onClick={() => void load()} disabled={refreshing} className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100 disabled:cursor-wait disabled:opacity-60">{refreshing ? "Refreshing…" : "Refresh"}</button>
            </div>
          </div>
        </header>

        {error && (
          <section className="mt-8 rounded-3xl border border-rose-500/20 bg-rose-500/10 p-6 sm:p-8" role="alert">
            <p className="text-sm font-bold uppercase tracking-[0.16em] text-rose-200">Connection required</p>
            <h2 className="mt-3 text-2xl font-black text-white">Cannot reach the on-chain oracle</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-rose-100/80">{error}</p>
            <p className="mt-5 text-sm text-rose-100/65">Check the configured BOT network, RPC endpoint, and contract addresses, then retry.</p>
          </section>
        )}

        {!error && lastUpdated && <p className="mt-5 text-right text-xs font-medium text-slate-500">Updated {fmtTimestamp(lastUpdated)}</p>}

        {loading ? (
          <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((index) => <div key={index} className="h-36 animate-pulse rounded-3xl border border-white/10 bg-white/[0.04]" />)}
          </section>
        ) : !error && (
          <>
            <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {token && <StatCard label="Token supply" value={`${fmtToken(token.totalSupply, token.decimals, 0)} ${token.symbol}`} detail="Fixed supply minted to treasury" />}
              {vault && <StatCard label="Total staked" value={`${fmtToken(vault.totalStake, 18, 0)} LODE`} detail="Bonded in StakingVault" />}
              <StatCard label="Live feeds" value={String(liveFeeds)} detail={`${staleFeeds} stale · ${waitingFeeds} waiting · ${pausedFeeds} paused`} />
              <StatCard label="Node operators" value={String(operators.length)} detail={operators.length ? "Bonded and eligible" : "No operators currently bonded"} />
            </section>

            <OperatorConsole feeds={feeds} tokenDecimals={token?.decimals ?? 18} onRefresh={load} />

            <section className="mt-10">
              <div className="mb-4 flex items-end justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">Oracle feeds</p><h2 className="mt-2 text-2xl font-black text-white">Price data</h2></div><p className="text-sm text-slate-500">{feeds.length} registered feed{feeds.length === 1 ? "" : "s"}</p></div>
              {feeds.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{feeds.map((feed) => <FeedCard key={feed.assetId} feed={feed} />)}</div> : <EmptyState title="No feeds registered" description="The OracleAggregator has no asset feeds configured yet." />}
            </section>

            <section className="mt-12 grid gap-8 lg:grid-cols-2">
              <div><div className="mb-4"><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">Operators</p><h2 className="mt-2 text-2xl font-black text-white">Bonded network</h2></div><OperatorsTable operators={operators} /></div>
              <div><div className="mb-4"><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">Security</p><h2 className="mt-2 text-2xl font-black text-white">Slashing activity</h2></div><SlashHistory slashes={slashes} /></div>
            </section>

            <section className="mt-12"><div className="mb-4"><p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">Audit trail</p><h2 className="mt-2 text-2xl font-black text-white">Recent closed rounds</h2></div><RecentRounds rounds={rounds} symbols={symbols} /></section>
          </>
        )}

        <footer className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 text-xs text-slate-500 sm:flex-row">
          <p>Lodestar Oracle · {chainLabel} · Chain #{CHAIN_CONFIG.chainId}</p>
          <p>Protocol data is read directly from the BOT chain.</p>
        </footer>
      </main>
    </div>
  );
}
