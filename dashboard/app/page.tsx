"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { formatUnits } from "viem";
import OperatorConsole from "@/components/OperatorConsole";
import Sparkline from "@/components/Sparkline";
import { Badge, Card, EmptyState, SectionHeading, Skeleton, StatCard, StatusPill, TableShell } from "@/components/ui";
import {
  ActivityIcon,
  ArrowRightIcon,
  BoltIcon,
  ClockIcon,
  CoinsIcon,
  ExternalLinkIcon,
  GaugeIcon,
  LayersIcon,
  RefreshIcon,
  ShieldIcon,
  UsersIcon,
} from "@/components/icons";
import {
  CHAIN_CONFIG,
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
import { fetchOverview, revalidateDashboard } from "@/lib/api";

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
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function hueFor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
  return hash;
}

function resolveFeedStatus(feed: FeedSnapshot): "live" | "stale" | "paused" | "waiting" {
  if (feed.isPaused) return "paused";
  if (!feed.hasPrice) return "waiting";
  if (feed.isStale || Date.now() - feed.updatedAt.getTime() > 60 * 60 * 1000) return "stale";
  return "live";
}

const FEED_STATUS: Record<string, { label: string; tone: "live" | "warn" | "danger" | "idle" }> = {
  live: { label: "Live", tone: "live" },
  stale: { label: "Stale", tone: "warn" },
  paused: { label: "Paused", tone: "danger" },
  waiting: { label: "Waiting", tone: "idle" },
};

function FeedCard({ feed, history }: { feed: FeedSnapshot; history: number[] }) {
  const status = resolveFeedStatus(feed);
  const meta = FEED_STATUS[status];
  const newest = history[0];
  const previous = history[1];
  const delta = newest !== undefined && previous !== undefined && previous !== 0 ? ((newest - previous) / previous) * 100 : null;
  const chart = useMemo(() => [...history].reverse(), [history]);

  return (
    <article className="card card-hover group relative flex flex-col overflow-hidden p-6">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent opacity-0 transition group-hover:opacity-100" />
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 text-sm font-black text-white/90"
            style={{ background: `linear-gradient(135deg, hsl(${hueFor(feed.symbol)} 70% 45%), hsl(${(hueFor(feed.symbol) + 40) % 360} 70% 30%))` }}
          >
            {feed.symbol.slice(0, 1)}
          </span>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Price feed</p>
            <h3 className="text-xl font-bold text-white">{feed.symbol}</h3>
          </div>
        </div>
        <Badge tone={meta.tone} dot>{meta.label}</Badge>
      </div>

      <div className="mt-6 flex items-end justify-between gap-4">
        <p className="stat-value text-4xl">{feed.hasPrice ? fmtPrice(feed.price, feed.decimals) : "—"}</p>
        {delta !== null && (
          <span className={`mb-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${delta >= 0 ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"}`}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(2)}%
          </span>
        )}
      </div>

      {chart.length > 1 && (
        <div className="mt-4">
          <Sparkline
            values={chart}
            className={`h-10 w-full ${delta !== null && delta < 0 ? "text-rose-400/90" : "text-cyan-300/90"}`}
            ariaLabel={`${feed.symbol} recent price trend`}
          />
        </div>
      )}

      <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-white/10 pt-4 text-sm">
        <div><dt className="text-xs text-slate-500">Round</dt><dd className="stat-value mt-1 text-base">#{feed.currentRound}</dd></div>
        <div><dt className="text-xs text-slate-500">Reports</dt><dd className="stat-value mt-1 text-base">{feed.submissionsInRound}</dd></div>
        <div><dt className="text-xs text-slate-500">Updated</dt><dd className="mt-1 text-base font-semibold text-slate-200">{feed.hasPrice ? flexAgo(feed.updatedAt) : "—"}</dd></div>
      </dl>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/5 pt-4">
        <Link href={`/feeds/${feed.assetId}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-cyan-300 transition hover:gap-2.5 hover:text-cyan-200">
          {status === "waiting" ? "Awaiting first round" : "Feed details"} <ArrowRightIcon className="h-4 w-4" />
        </Link>
        <a href={feed.scannerLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 transition hover:text-slate-300">
          Explorer <ExternalLinkIcon className="h-3.5 w-3.5" />
        </a>
      </div>
    </article>
  );
}

function OperatorsTable({ operators }: { operators: OperatorRow[] }) {
  if (!operators.length) {
    return <EmptyState icon={<UsersIcon className="h-5 w-5" />} title="No operators bonded" description="Operators must stake the minimum amount before they can submit prices." />;
  }
  const total = operators.reduce((sum, operator) => sum + operator.stake, 0n) || 1n;
  return (
    <TableShell
      caption="Bonded operators and their stake"
      head={<tr><th scope="col" className="px-5 py-4">Operator</th><th scope="col" className="px-5 py-4">Stake</th><th scope="col" className="px-5 py-4">Share</th><th scope="col" className="px-5 py-4">Status</th></tr>}
    >
      {operators.map((operator) => {
        const share = Number((operator.stake * 10000n) / total) / 100;
        return (
          <tr key={operator.address} className="border-t border-white/5 transition hover:bg-white/[0.03]">
            <td className="px-5 py-4">
              <div className="flex items-center gap-3">
                <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-black text-slate-950" style={{ background: `hsl(${hueFor(operator.address)} 80% 60%)` }}>
                  {operator.address.slice(2, 4).toUpperCase()}
                </span>
                <span className="font-mono text-xs text-cyan-300">{shortAddr(operator.address)}</span>
              </div>
            </td>
            <td className="px-5 py-4 font-semibold text-white tnum">{fmtToken(operator.stake, 18, 0)} LODE</td>
            <td className="px-5 py-4 text-slate-300 tnum">{share.toFixed(1)}%</td>
            <td className="px-5 py-4"><Badge tone={operator.isEligible ? "live" : "warn"}>{operator.isEligible ? "Eligible" : "Leaving"}</Badge></td>
          </tr>
        );
      })}
    </TableShell>
  );
}

function RecentRounds({ rounds, symbols }: { rounds: RoundRow[]; symbols: Record<string, string> }) {
  if (!rounds.length) {
    return <EmptyState icon={<ClockIcon className="h-5 w-5" />} title="No closed rounds yet" description="The protocol will publish accepted prices here as operators complete their first round." />;
  }
  return (
    <TableShell
      caption="Most recently closed rounds across all feeds"
      tone="info"
      head={<tr><th scope="col" className="px-5 py-4">Feed</th><th scope="col" className="px-5 py-4">Price</th><th scope="col" className="px-5 py-4">Accepted</th><th scope="col" className="px-5 py-4">Vetoed</th><th scope="col" className="px-5 py-4">Closed</th></tr>}
    >
      {rounds.map((round) => (
        <tr key={`${round.assetId}-${round.roundId}`} className="border-t border-white/5 transition hover:bg-white/[0.03]">
          <td className="px-5 py-4 font-semibold text-white">{symbols[round.assetId] ?? shortAddr(round.assetId)}</td>
          <td className="px-5 py-4 font-mono text-cyan-100">{fmtPrice(round.price, 8)}</td>
          <td className="px-5 py-4 text-slate-200 tnum">{round.inThresholdSubmissions}</td>
          <td className="px-5 py-4 text-slate-400 tnum">{round.vetoed === null ? "—" : round.vetoed}</td>
          <td className="px-5 py-4 text-slate-400">{flexAgo(round.timestamp)}</td>
        </tr>
      ))}
    </TableShell>
  );
}

function SlashHistory({ slashes }: { slashes: SlashRow[] }) {
  if (!slashes.length) {
    return <EmptyState icon={<ShieldIcon className="h-5 w-5" />} title="No slashing events" description="All operators are currently satisfying the protocol rules." />;
  }
  return (
    <TableShell
      caption="Recent slashing events"
      tone="danger"
      head={<tr><th scope="col" className="px-5 py-4">Operator</th><th scope="col" className="px-5 py-4">Amount</th><th scope="col" className="px-5 py-4">Reason</th><th scope="col" className="px-5 py-4">Time</th></tr>}
    >
      {slashes.map((slash) => (
        <tr key={`${slash.operator}-${slash.txHash}`} className="border-t border-rose-500/10 transition hover:bg-rose-500/[0.03]">
          <td className="px-5 py-4 font-mono text-xs text-rose-300">{shortAddr(slash.operator)}</td>
          <td className="px-5 py-4 font-semibold text-rose-200 tnum">-{fmtToken(slash.amount, 18, 0)} LODE</td>
          <td className="max-w-md px-5 py-4 text-slate-300">{slash.reason}</td>
          <td className="px-5 py-4 text-slate-400">{flexAgo(slash.timestamp)}</td>
        </tr>
      ))}
    </TableShell>
  );
}

const NAV_LINKS = [
  { href: "#console", label: "Operator console" },
  { href: "#feeds", label: "Feeds" },
  { href: "#operators", label: "Operators" },
  { href: "#security", label: "Security" },
  { href: "#rounds", label: "Rounds" },
];

export default function DashboardPage() {
  const [feeds, setFeeds] = useState<FeedSnapshot[]>([]);
  const [token, setToken] = useState<TokenSnapshot | null>(null);
  const [vault, setVault] = useState<VaultSnapshot | null>(null);
  const [operators, setOperators] = useState<OperatorRow[]>([]);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [slashes, setSlashes] = useState<SlashRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [demoReason, setDemoReason] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    setRefreshing(true);
    setError(null);
    try {
      if (force) await revalidateDashboard();
      const data = await fetchOverview();
      setToken(data.token);
      setVault(data.vault);
      setOperators(data.operators);
      setRounds(data.rounds);
      setSlashes(data.slashes);
      setFeeds(data.feeds);
      setDemo(data.demo);
      setDemoReason(data.configError ?? null);
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
  }, [load]);

  const symbols = useMemo(() => Object.fromEntries(feeds.map((feed) => [feed.assetId, feed.symbol])), [feeds]);
  const historyByAsset = useMemo(() => {
    const decimalsByAsset = Object.fromEntries(feeds.map((feed) => [feed.assetId, feed.decimals]));
    const map: Record<string, number[]> = {};
    for (const round of rounds) {
      const decimals = decimalsByAsset[round.assetId] ?? 8;
      (map[round.assetId] ??= []).push(Number(formatUnits(round.price, decimals)));
    }
    return map;
  }, [feeds, rounds]);

  const liveFeeds = feeds.filter((feed) => resolveFeedStatus(feed) === "live").length;
  const staleFeeds = feeds.filter((feed) => resolveFeedStatus(feed) === "stale").length;
  const waitingFeeds = feeds.filter((feed) => resolveFeedStatus(feed) === "waiting").length;
  const pausedFeeds = feeds.filter((feed) => resolveFeedStatus(feed) === "paused").length;
  const chainLabel = CHAIN_CONFIG.chainId === 677 ? "BOT Mainnet" : CHAIN_CONFIG.chainId === 968 ? "BOT Testnet" : "Local Network";
  const chainStatus = loading ? "Checking…" : error ? "Unavailable" : demo ? "Demo data" : "Connected";

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-slate-950">
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-white/10 bg-ink-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span aria-hidden className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-brand-gradient text-slate-950 shadow-glow">
              <BoltIcon className="h-5 w-5" />
            </span>
            <span className="leading-tight">
              <span className="block text-[10px] font-extrabold uppercase tracking-[0.28em] text-cyan-300">Lodestar</span>
              <span className="block text-base font-black tracking-tight text-white">Oracle</span>
            </span>
          </Link>

          <nav aria-label="Dashboard sections" className="hidden items-center gap-1 lg:flex">
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-400 transition hover:bg-white/5 hover:text-cyan-200">
                {link.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <div className="hidden sm:block">
              <StatusPill online={!loading && !error && !demo} label={`${chainLabel} · ${chainStatus}`} />
            </div>
            <a href={CHAIN_CONFIG.scannerUrl} target="_blank" rel="noreferrer" className="btn-ghost hidden sm:inline-flex" title="Open the block explorer">
              <ExternalLinkIcon className="h-4 w-4" /> Explorer
            </a>
            <button type="button" onClick={() => void load(true)} disabled={refreshing} aria-busy={refreshing} className="btn-primary">
              <RefreshIcon className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">{refreshing ? "Refreshing…" : "Refresh"}</span>
            </button>
          </div>
        </div>
      </header>

      <main id="main" className="relative mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6 lg:px-8">
        <section className="animate-fade-up">
          <Badge tone="info" dot className="!tracking-[0.18em]">On-chain price oracle</Badge>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-white sm:text-5xl">
            Protocol <span className="bg-gradient-to-r from-cyan-300 via-sky-400 to-indigo-400 bg-clip-text text-transparent">intelligence</span>
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-slate-400">
            Live prices, operator health, and network activity on {chainLabel}. Data refreshes only when you ask it to.
          </p>
        </section>

        {demo && (
          <section className="mt-8 rounded-3xl border border-amber-400/25 bg-amber-400/[0.08] p-6 shadow-card" role="status">
            <div className="flex items-start gap-3">
              <ActivityIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-200" />
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.16em] text-amber-200">Demo data</p>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-amber-100/80">
                  This deployment has no contract addresses configured{demoReason ? ` (${demoReason})` : ""}, so the dashboard is showing synthetic data.
                  Set <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-xs">NEXT_PUBLIC_TOKEN_ADDRESS</code>,{" "}
                  <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-xs">NEXT_PUBLIC_VAULT_ADDRESS</code> and{" "}
                  <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-xs">NEXT_PUBLIC_AGGREGATOR_ADDRESS</code> to display live on-chain data.
                </p>
              </div>
            </div>
          </section>
        )}

        {error && !demo && (
          <section className="mt-8 rounded-3xl border border-rose-500/25 bg-rose-500/[0.08] p-6 shadow-card sm:p-8" role="alert">
            <div className="flex items-start gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-rose-400/30 bg-rose-500/10 text-rose-200">
                <GaugeIcon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.16em] text-rose-200">Connection required</p>
                <h2 className="mt-2 text-2xl font-black text-white">Cannot reach the on-chain oracle</h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-rose-100/80">{error}</p>
                <p className="mt-4 text-sm text-rose-100/60">Check the configured BOT network, RPC endpoint, and contract addresses, then retry.</p>
                <button type="button" onClick={() => void load(true)} className="btn-ghost mt-4">
                  <RefreshIcon className="h-4 w-4" /> Try again
                </button>
              </div>
            </div>
          </section>
        )}

        {!error && lastUpdated && (
          <p className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <ClockIcon className="h-3.5 w-3.5" /> Updated {fmtTimestamp(lastUpdated)}
          </p>
        )}

        {loading ? (
          <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((index) => <Skeleton key={index} className="h-36" />)}
          </section>
        ) : !error && (
          <>
            <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {token && (
                <StatCard icon={<CoinsIcon className="h-5 w-5" />} label="Token supply" value={`${fmtToken(token.totalSupply, token.decimals, 0)} ${token.symbol}`} detail="Fixed supply minted to treasury" tone="info" />
              )}
              {vault && (
                <StatCard icon={<LayersIcon className="h-5 w-5" />} label="Total staked" value={`${fmtToken(vault.totalStake, 18, 0)} LODE`} detail="Bonded in StakingVault" tone="live" />
              )}
              <StatCard icon={<ActivityIcon className="h-5 w-5" />} label="Live feeds" value={String(liveFeeds)} detail={`${staleFeeds} stale · ${waitingFeeds} waiting · ${pausedFeeds} paused`} tone={liveFeeds > 0 ? "live" : "idle"} />
              <StatCard icon={<UsersIcon className="h-5 w-5" />} label="Node operators" value={String(operators.length)} detail={operators.length ? "Bonded and eligible" : "No operators currently bonded"} tone="info" />
            </section>

            <div id="console" className="mt-12 scroll-mt-24">
              <OperatorConsole feeds={feeds} tokenDecimals={token?.decimals ?? 18} onRefresh={() => load(true)} />
            </div>

            <section id="feeds" className="mt-14 scroll-mt-24">
              <SectionHeading
                eyebrow="Oracle feeds"
                title="Price data"
                description="Each feed aggregates bonded operator submissions into a single verified on-chain price."
                action={<Badge tone="idle">{feeds.length} registered feed{feeds.length === 1 ? "" : "s"}</Badge>}
              />
              {feeds.length > 0 && waitingFeeds === feeds.length && (
                <div className="mb-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.05] px-5 py-4 text-sm leading-6 text-cyan-100/85" role="status">
                  These feeds are registered on-chain but no price round has closed yet. Prices appear once operators submit and the round is accepted. You can also report a price yourself from the Operator console above.
                </div>
              )}
              {feeds.length ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {feeds.map((feed) => <FeedCard key={feed.assetId} feed={feed} history={historyByAsset[feed.assetId] ?? []} />)}
                </div>
              ) : (
                <EmptyState icon={<ActivityIcon className="h-5 w-5" />} title="No feeds registered" description="The OracleAggregator has no asset feeds configured yet." />
              )}
            </section>

            <section className="mt-14 grid gap-8 lg:grid-cols-2">
              <div id="operators" className="scroll-mt-24">
                <SectionHeading eyebrow="Operators" title="Bonded network" />
                <OperatorsTable operators={operators} />
              </div>
              <div id="security" className="scroll-mt-24">
                <SectionHeading eyebrow="Security" title="Slashing activity" />
                <SlashHistory slashes={slashes} />
              </div>
            </section>

            <section id="rounds" className="mt-14 scroll-mt-24">
              <SectionHeading eyebrow="Audit trail" title="Recent closed rounds" />
              <RecentRounds rounds={rounds} symbols={symbols} />
            </section>
          </>
        )}

        <footer className="mt-16 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 text-xs text-slate-500 sm:flex-row">
          <p className="inline-flex items-center gap-2">
            <BoltIcon className="h-3.5 w-3.5 text-cyan-400/70" /> Lodestar Oracle · {chainLabel} · Chain #{CHAIN_CONFIG.chainId}{demo ? " · demo mode" : ""}
          </p>
          <p>Served by the cached dashboard API · refreshed on demand</p>
        </footer>
      </main>

      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 bg-grid bg-[size:46px_46px] opacity-[0.35]" />
    </div>
  );
}
