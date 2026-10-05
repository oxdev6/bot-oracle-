"use client";
import { useEffect, useMemo, useState } from "react";
import {
  isDemo,
  getRegistry,
  getFeed,
  getToken,
  getVault,
  getOperators,
  getRounds,
  getSlashes,
  fmtPrice,
  fmtToken,
  fmtTimestamp,
  CHAIN_CONFIG,
  type FeedSnapshot,
  type TokenSnapshot,
  type VaultSnapshot,
  type OperatorRow,
  type RoundRow,
  type SlashRow,
} from "@/lib/client";
import {
  DEMO_TOKEN,
  DEMO_VAULT,
  demoFeeds,
  demoOperators,
  demoRounds,
  demoSlashes,
} from "@/lib/demo";

/* ── small presentational atoms ─────────────────────────── */

function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "warning" | "success" | "danger" | "demo" }) {
  const styles: Record<string, string> = {
    default:  "bg-surface-200/10 text-surface-200",
    success:  "bg-emerald-500/15 text-emerald-400",
    warning:  "bg-amber-500/15 text-amber-400",
    danger:   "bg-red-500/15 text-red-400",
    demo:     "bg-fuchsia-500/15 text-fuchsia-400 border border-fuchsia-500/30",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${styles[variant]}`}>{children}</span>;
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-surface-800 p-5">
      <p className="text-xs font-medium uppercase tracking-wider text-surface-200/60">{label}</p>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-surface-200/40">{sub}</p>}
    </div>
  );
}

function shortAddr(a: string): string {
  if (!a) return "—";
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function flexAgo(d: Date): string {
  const s = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/* ── price feed card ────────────────────────────────────── */

function PriceFeedCard({ feed }: { feed: FeedSnapshot }) {
  const inner = (
    <>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-surface-200/60">Feed</p>
          <h3 className="mt-1 text-2xl font-bold tracking-tight text-white group-hover:text-brand-400">{feed.symbol}</h3>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {feed.isPaused && <Badge variant="danger">CIRCUIT BREAKER</Badge>}
          {feed.isStale && !feed.isPaused && <Badge variant="warning">STALE</Badge>}
          {!feed.isStale && !feed.isPaused && <Badge variant="success">LIVE</Badge>}
        </div>
      </div>

      <p className="text-4xl font-extrabold tracking-tight text-white">{fmtPrice(feed.price, feed.decimals)}</p>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-surface-200/70">
        <div><span className="text-surface-200/40">Round</span> #{feed.currentRound.toLocaleString()}</div>
        <div><span className="text-surface-200/40">Submissions</span> {feed.submissionsInRound}</div>
        <div className="col-span-2"><span className="text-surface-200/40">Last update</span> {fmtTimestamp(feed.updatedAt)}</div>
        <div className="col-span-2"><span className="text-surface-200/40">Round closes</span> {fmtTimestamp(feed.nextRoundAt)}</div>
      </div>

      <p className="mt-3 pt-3 text-[10px] uppercase tracking-widest text-surface-200/30 group-hover:text-brand-400/50 transition-colors">
        View on Explorer →
      </p>
    </>
  );
  if (feed.scannerLink !== "#") {
    return (
      <a href={feed.scannerLink} target="_blank" rel="noopener noreferrer" className="group rounded-2xl border border-white/5 bg-surface-800 p-6 shadow-lg transition-all hover:border-brand-400/30 hover:shadow-brand-500/5">
        {inner}
      </a>
    );
  }
  return <div className="group rounded-2xl border border-white/5 bg-surface-800 p-6 shadow-lg transition-all hover:border-brand-400/30 hover:shadow-brand-500/5">{inner}</div>;
}

/* ── operators table ────────────────────────────────────── */

function OperatorsTable({ operators }: { operators: OperatorRow[] }) {
  if (operators.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-surface-800/50 px-6 py-10 text-center text-sm text-surface-200/60">
        No operators bonded yet. Operators stake ≥ minStake in the StakingVault to join the network.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-surface-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-900/60 text-xs uppercase tracking-wider text-surface-200/50">
          <tr>
            <th className="px-4 py-3 font-semibold">Operator</th>
            <th className="px-4 py-3 font-semibold">Stake</th>
            <th className="px-4 py-3 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {operators.map((o) => (
            <tr key={o.address} className="hover:bg-surface-700/30">
              <td className="px-4 py-3 font-mono text-xs text-brand-300">{shortAddr(o.address)}</td>
              <td className="px-4 py-3 font-semibold text-white">{fmtToken(o.stake, 18, 0)} LODE</td>
              <td className="px-4 py-3">{o.isEligible ? <Badge variant="success">ACTIVE · ELIGIBLE</Badge> : <Badge variant="warning">LEAVING</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── recent rounds ──────────────────────────────────────── */

function RecentRounds({ rounds, symbols }: { rounds: RoundRow[]; symbols: Record<string, string> }) {
  if (rounds.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-surface-800/50 px-6 py-8 text-center text-sm text-surface-200/60">
        Rounds will appear here once operators submit.
      </div>
    );
  }
  const deltas = useMemo(() => {
    const m: Record<string, number> = {};
    const chrono = [...rounds].reverse(); // oldest → newest
    for (let i = 0; i < chrono.length; i++) {
      const r = chrono[i];
      if (i === 0) {
        m[`${r.assetId}-${r.roundId}`] = 0;
        continue;
      }
      const prev = chrono[i - 1];
      if (prev.assetId !== r.assetId) {
        m[`${r.assetId}-${r.roundId}`] = 0;
        continue;
      }
      const prevPx = Number(prev.price) || 1;
      m[`${r.assetId}-${r.roundId}`] = ((Number(r.price) - prevPx) / prevPx) * 100;
    }
    return m;
  }, [rounds]);

  return (
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-surface-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-900/60 text-xs uppercase tracking-wider text-surface-200/50">
          <tr>
            <th className="px-4 py-3 font-semibold">Feed</th>
            <th className="px-4 py-3 font-semibold">Closed price</th>
            <th className="px-4 py-3 font-semibold">Δ</th>
            <th className="px-4 py-3 font-semibold">Accepted</th>
            <th className="px-4 py-3 font-semibold">Outliers vetoed</th>
            <th className="px-4 py-3 font-semibold">Closed</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rounds.map((r, i) => {
            const dpct = deltas[`${r.assetId}-${r.roundId}`] ?? 0;
            return (
              <tr key={`${r.assetId}-${r.roundId}`} className="hover:bg-surface-700/30">
                <td className="px-4 py-3 font-semibold text-white">{symbols[r.assetId] ?? shortAddr(r.assetId)}</td>
                <td className="px-4 py-3 font-mono text-surface-100">{fmtPrice(r.price, 8)}</td>
                <td className={`px-4 py-3 text-xs font-bold ${dpct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {dpct === 0 ? "·" : `${dpct >= 0 ? "▲" : "▼"} ${Math.abs(dpct).toFixed(2)}%`}
                </td>
                <td className="px-4 py-3 text-surface-200/70">{r.inThresholdSubmissions}</td>
                <td className="px-4 py-3 text-surface-200/50">{r.vetoed === null ? "—" : r.vetoed}</td>
                <td className="px-4 py-3 text-surface-200/50">{flexAgo(r.timestamp)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── slashing history ───────────────────────────────────── */

function SlashHistory({ slashes }: { slashes: SlashRow[] }) {
  if (slashes.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/10 bg-surface-800/50 px-6 py-8 text-center text-sm text-surface-200/60">
        No slashing events — all operators are behaving.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-red-500/10 bg-surface-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-900/60 text-xs uppercase tracking-wider text-surface-200/50">
          <tr>
            <th className="px-4 py-3 font-semibold">Operator</th>
            <th className="px-4 py-3 font-semibold">Amount slashed</th>
            <th className="px-4 py-3 font-semibold">Reason</th>
            <th className="px-4 py-3 font-semibold">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {slashes.map((s, i) => (
            <tr key={i} className="hover:bg-surface-700/30">
              <td className="px-4 py-3 font-mono text-xs text-red-300">{shortAddr(s.operator)}</td>
              <td className="px-4 py-3 font-semibold text-red-400">
                -{fmtToken(s.amount, 18, 0)} LODE
                {s.pendingCanceled > 0n && <span className="block text-[10px] font-normal text-surface-200/50">incl. {fmtToken(s.pendingCanceled, 18, 0)} from pending withdrawal</span>}
              </td>
              <td className="px-4 py-3 max-w-xs text-surface-200/70">{s.reason}</td>
              <td className="px-4 py-3 text-surface-200/50">{flexAgo(s.timestamp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── demo banner ────────────────────────────────────────── */

function DemoBanner() {
  return (
    <div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/10 px-5 py-4">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-fuchsia-500/20 text-lg">⚡</span>
        <div>
          <p className="text-sm font-bold text-fuchsia-100">Demo network — no contracts connected</p>
          <p className="text-xs text-fuchsia-200/60">
            Showing representative output so you can preview the product. Set NEXT_PUBLIC_AGGREGATOR_ADDRESS to read live data.
          </p>
        </div>
      </div>
      <a href="#config" className="rounded-lg border border-fuchsia-400/40 px-4 py-2 text-xs font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/10">
        How to go live ↓
      </a>
    </div>
  );
}

function chainLabel(): string {
  if (isDemo) return "Demo";
  if (CHAIN_CONFIG.chainId === 677) return "Mainnet";
  if (CHAIN_CONFIG.chainId === 968) return "Testnet";
  return "Local";
}

/* ── main page ──────────────────────────────────────────── */

export default function DashboardPage() {
  const [feeds, setFeeds] = useState<FeedSnapshot[]>([]);
  const [token, setToken] = useState<TokenSnapshot | null>(null);
  const [vault, setVault] = useState<VaultSnapshot | null>(null);
  const [operators, setOperators] = useState<OperatorRow[]>([]);
  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [slashes, setSlashes] = useState<SlashRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        if (isDemo) {
          setToken(DEMO_TOKEN);
          setVault(DEMO_VAULT);
          setFeeds(demoFeeds());
          setOperators(demoOperators());
          setRounds(demoRounds());
          setSlashes(demoSlashes());
          setLoading(false);
          return;
        }
        const [ids, tok, vlt, ops, rds, slh] = await Promise.all([
          getRegistry(),
          getToken(),
          getVault(),
          getOperators(),
          getRounds(),
          getSlashes(),
        ]);
        setToken(tok);
        setVault(vlt);
        setOperators(ops);
        setRounds(rds);
        setSlashes(slh);
        if (ids.length > 0) {
          const f = await Promise.all(ids.map(getFeed));
          setFeeds(f.filter(Boolean) as FeedSnapshot[]);
        }
      } catch (err) {
        console.error("dashboard load error", err);
      } finally {
        setLoading(false);
      }
    }
    void load();
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, []);

  const symbols = useMemo(() => {
    const m: Record<string, string> = {};
    for (const f of feeds) m[f.assetId] = f.symbol;
    return m;
  }, [feeds]);

  const headerExplorer = CHAIN_CONFIG.scannerUrl;
  const label = chainLabel();

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      {/* Header */}
      <header className="mb-10 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-400">Lodestar Oracle</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight text-white">Live Dashboard</h1>
        </div>
        <a
          href={headerExplorer}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-500"
        >
          Open {label} Explorer
        </a>
      </header>

      {isDemo && <DemoBanner />}

      {/* Loading state */}
      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-56 animate-pulse rounded-2xl border border-white/5 bg-surface-800/60" />
          ))}
        </div>
      )}

      {!loading && (
        <>
          {/* Summary cards */}
          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {token && <StatCard label={`${token.symbol} Token Supply`} value={`${fmtToken(token.totalSupply, token.decimals, 0)} ${token.symbol}`} sub="Fixed supply · minted to treasury" />}
            {vault && <StatCard label="Total Staked" value={`${fmtToken(vault.totalStake, 18, 0)} LODE`} sub="Bonded in StakingVault" />}
            <StatCard label="Active Feeds" value={String(feeds.length)} sub="Chainlink-compatible pairs" />
            <StatCard label="Node Operators" value={operators.length ? String(operators.length) : "—"} sub={operators.length ? "All eligible · submitting" : "Stake to join"} />
          </div>

          {/* Price feeds */}
          <h2 className="mb-4 text-lg font-bold text-white/90">Price Feeds</h2>
          {feeds.length === 0 ? (
            <p className="mb-10 rounded-2xl border border-dashed border-white/10 bg-surface-800/50 px-6 py-10 text-center text-sm text-surface-200/60">
              No feeds registered on-chain yet.
            </p>
          ) : (
            <div className="mb-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {feeds.map((f) => <PriceFeedCard key={f.assetId + f.symbol} feed={f} />)}
            </div>
          )}

          {/* Operators + activity */}
          <div className="mb-8 grid gap-10 lg:grid-cols-2">
            <div>
              <h2 className="mb-4 text-lg font-bold text-white/90">Node Operators <span className="text-sm font-normal text-surface-200/40">· bonded &amp; reporting</span></h2>
              <OperatorsTable operators={operators} />
            </div>
            <div>
              <h2 className="mb-4 text-lg font-bold text-white/90">Slash History <span className="text-sm font-normal text-surface-200/40">· protocol-enforced honesty</span></h2>
              <SlashHistory slashes={slashes} />
            </div>
          </div>

          {/* Recent rounds */}
          <div>
            <h2 className="mb-4 text-lg font-bold text-white/90">Recent Rounds <span className="text-sm font-normal text-surface-200/40">· median of accepted submissions</span></h2>
            <RecentRounds rounds={rounds} symbols={symbols} />
          </div>

          {/* Demo / go-live note */}
          {isDemo && (
            <div id="config" className="mt-12 rounded-2xl border border-white/5 bg-surface-800 p-6">
              <h3 className="mb-2 text-sm font-bold text-white/90">Go live on BOT {CHAIN_CONFIG.chainId === 677 ? "Mainnet" : "Testnet"}</h3>
              <ol className="grid gap-2 text-sm text-surface-200/70 sm:grid-cols-2">
                <li><span className="font-mono text-xs">1.</span> Deploy contracts (contracts/README) and fund the operator wallet.</li>
                <li><span className="font-mono text-xs">2.</span> Put the deployed addresses in dashboard/.env.local: NEXT_PUBLIC_TOKEN_ADDRESS, NEXT_PUBLIC_VAULT_ADDRESS, NEXT_PUBLIC_AGGREGATOR_ADDRESS.</li>
                <li><span className="font-mono text-xs">3.</span> Restart the dashboard — demo banner disappears and every value above becomes on-chain reads.</li>
                <li><span className="font-mono text-xs">4.</span> Deploy the dashboard to Vercel and the panel shows live network status.</li>
              </ol>
            </div>
          )}
        </>
      )}

      {/* Footer */}
      <footer className="mt-16 border-t border-white/5 pt-6 text-center text-xs text-surface-200/30">
        Lodestar Oracle · {isDemo ? "Demo preview" : `BOT Chain ${CHAIN_CONFIG.chainId === 677 ? "Mainnet" : CHAIN_CONFIG.chainId === 968 ? "Testnet" : "Local"} (Chain #${CHAIN_CONFIG.chainId})`}
      </footer>
    </div>
  );
}