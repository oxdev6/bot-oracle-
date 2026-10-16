"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits, type Address, type EIP1193Provider } from "viem";
import { Badge } from "@/components/ui";
import { AlertIcon, BoltIcon, ClockIcon, CoinsIcon, ExternalLinkIcon, ShieldIcon, WalletIcon } from "@/components/icons";
import {
  CHAIN_CONFIG,
  claimLodeWithdrawal,
  connectOperatorWallet,
  discoverInjectedWallets,
  fmtToken,
  getInjectedWallet,
  getOperatorAccount,
  requestLodeWithdrawal,
  setActiveWallet,
  stakeLode,
  submitFeedPrice,
  type FeedSnapshot,
  type InjectedWallet,
  type OperatorAccount,
} from "@/lib/client";

const fieldClass = "field mt-2";

/** Curated, broad wallet directory for the install/connect hints. */
const WALLET_LINKS: Array<{ name: string; url: string; tag: string }> = [
  { name: "MetaMask", url: "https://metamask.io/download/", tag: "Extension · Mobile" },
  { name: "Coinbase Wallet", url: "https://www.coinbase.com/wallet/downloads", tag: "Extension · Mobile" },
  { name: "Rabby", url: "https://rabby.io/", tag: "Extension" },
  { name: "Brave Wallet", url: "https://brave.com/wallet/", tag: "Built-in" },
  { name: "OKX Wallet", url: "https://www.okx.com/web3", tag: "Extension · Mobile" },
  { name: "Trust Wallet", url: "https://trustwallet.com/browser-extension", tag: "Extension · Mobile" },
  { name: "Rainbow", url: "https://rainbow.me/", tag: "Extension · Mobile" },
  { name: "Phantom", url: "https://phantom.com/", tag: "Extension · Mobile" },
  { name: "Enkrypt", url: "https://www.enkrypt.com/", tag: "Extension" },
  { name: "OneKey", url: "https://onekey.so/", tag: "Extension · Mobile" },
  { name: "Bitget Wallet", url: "https://web3.bitget.com/", tag: "Extension · Mobile" },
  { name: "SafePal", url: "https://www.safepal.com/", tag: "Extension · Mobile" },
  { name: "TokenPocket", url: "https://www.tokenpocket.pro/", tag: "Extension · Mobile" },
  { name: "MathWallet", url: "https://mathwallet.org/", tag: "Extension · Mobile" },
  { name: "Core", url: "https://core.app/", tag: "Extension · Mobile" },
  { name: "Coin98", url: "https://coin98.com/wallet", tag: "Extension · Mobile" },
  { name: "Zerion", url: "https://zerion.io/", tag: "Mobile" },
  { name: "Frame", url: "https://frame.sh/", tag: "Desktop" },
  { name: "imToken", url: "https://token.im/", tag: "Mobile" },
  { name: "FoxWallet", url: "https://foxwallet.com/", tag: "Mobile" },
];

function friendlyError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes("User rejected") || error.message.includes("user rejected")) {
      return "The wallet request was rejected.";
    }
    return error.message;
  }
  return "The transaction failed. Check your wallet and try again.";
}

function MetricTile({ label, value, tone = "idle" }: { label: string; value: string; tone?: "idle" | "live" | "warn" }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-2 font-bold tnum ${tone === "live" ? "text-emerald-300" : tone === "warn" ? "text-amber-200" : "text-white"}`}>{value}</p>
    </div>
  );
}

export default function OperatorConsole({
  feeds,
  tokenDecimals,
  onRefresh,
}: {
  feeds: FeedSnapshot[];
  tokenDecimals: number;
  onRefresh: () => Promise<void>;
}) {
  const [address, setAddress] = useState<string | null>(null);
  const [walletProvider, setWalletProvider] = useState<EIP1193Provider | null>(null);
  const [walletChoices, setWalletChoices] = useState<InjectedWallet[]>([]);
  const [account, setAccount] = useState<OperatorAccount | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stakeAmount, setStakeAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [price, setPrice] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedWallet = window.localStorage.getItem("lodestar-preferred-wallet");
    if (!storedWallet) return;

    void discoverInjectedWallets().then(async (wallets) => {
      const preferred = wallets.find((wallet) => wallet.info.uuid === storedWallet || wallet.info.name === storedWallet);
      if (!preferred) return;
      const accounts = await preferred.provider.request({ method: "eth_accounts" });
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string") return;
      setActiveWallet(preferred.provider);
      setWalletProvider(preferred.provider);
      setAddress(accounts[0]);
      setNotice(`Reconnected to ${preferred.info.name}.`);
    }).catch(() => undefined);
  }, []);

  const loadAccount = useCallback(async () => {
    if (!address) {
      setAccount(null);
      return;
    }
    setAccountLoading(true);
    try {
      setAccount(await getOperatorAccount(address));
    } catch (loadError) {
      setError(friendlyError(loadError));
    } finally {
      setAccountLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  useEffect(() => {
    const provider = walletProvider ?? getInjectedWallet();
    if (!provider) return;

    const onAccountsChanged = (accounts: Address[]) => {
      setAddress(accounts[0] ?? null);
      setAccount(null);
      setError(null);
      setNotice(null);
    };
    const onChainChanged = () => {
      setError(null);
      setNotice("Wallet network changed. Transactions will switch to the configured BOT network.");
    };
    provider.on("accountsChanged", onAccountsChanged);
    provider.on("chainChanged", onChainChanged);
    void provider.request({ method: "eth_accounts" }).then((accounts) => {
      if (Array.isArray(accounts) && typeof accounts[0] === "string") {
        setAddress(accounts[0]);
      }
    }).catch((providerError: unknown) => {
      setError(friendlyError(providerError));
    });
    return () => {
      provider.removeListener("accountsChanged", onAccountsChanged);
      provider.removeListener("chainChanged", onChainChanged);
    };
  }, [walletProvider]);

  useEffect(() => {
    if (feeds.length && !feeds.some((feed) => feed.assetId === selectedAssetId)) {
      setSelectedAssetId(feeds[0].assetId);
    }
  }, [feeds, selectedAssetId]);

  const selectedFeed = useMemo(
    () => feeds.find((feed) => feed.assetId === selectedAssetId) ?? null,
    [feeds, selectedAssetId],
  );
  const eligible = Boolean(account && account.effectiveStake >= account.minStake);

  async function connectWith(wallet: InjectedWallet) {
    setError(null);
    setNotice(null);
    setBusy("Connecting wallet…");
    try {
      const connectedAddress = await connectOperatorWallet(wallet.provider);
      setWalletProvider(wallet.provider);
      setAddress(connectedAddress);
      setWalletChoices([]);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("lodestar-preferred-wallet", wallet.info.uuid || wallet.info.name);
      }
      setNotice(`Connected to ${wallet.info.name} on the configured BOT network.`);
    } catch (connectError) {
      setError(friendlyError(connectError));
    } finally {
      setBusy("");
    }
  }

  async function connect() {
    setError(null);
    setNotice(null);
    setBusy("Looking for wallets…");
    try {
      const wallets = await discoverInjectedWallets();
      if (wallets.length === 0) {
        setError("No browser wallet detected. Install any wallet below, or open this dashboard inside your wallet's in-app browser, then select Connect wallet again.");
        setWalletChoices([]);
      } else if (wallets.length === 1) {
        await connectWith(wallets[0]);
      } else {
        setWalletChoices(wallets);
        setNotice(`Found ${wallets.length} wallets. Choose one to connect.`);
      }
    } catch (connectError) {
      setError(friendlyError(connectError));
    } finally {
      setBusy("");
    }
  }

  async function runAction(label: string, action: () => Promise<void>, success: string) {
    setError(null);
    setNotice(null);
    setBusy(label);
    try {
      await action();
      setNotice(success);
      await Promise.all([loadAccount(), onRefresh()]);
    } catch (actionError) {
      setError(friendlyError(actionError));
    } finally {
      setBusy("");
    }
  }

  function parseTokenAmount(value: string): bigint {
    const amount = parseUnits(value.trim(), tokenDecimals);
    if (amount <= 0n) throw new Error("Enter an amount greater than zero.");
    return amount;
  }

  return (
    <section className="card relative overflow-hidden p-5 shadow-glow sm:p-7">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent" />
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-300">
            <WalletIcon className="h-4 w-4" /> Operator console
          </p>
          <h2 className="mt-2 text-2xl font-black tracking-tight text-white">Manage your node on-chain</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Stake LODE, manage the 7-day withdrawal queue, and report prices directly to the aggregator — with any EVM wallet.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void connect()}
          disabled={Boolean(busy)}
          className="btn-primary shrink-0"
        >
          <WalletIcon className="h-4 w-4" />
          {busy || (address ? `${address.slice(0, 6)}…${address.slice(-4)} · Change` : "Connect wallet")}
        </button>
      </div>

      {walletChoices.length > 0 && (
        <div className="mt-5 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4">
          <p className="text-sm font-semibold text-white">Choose a wallet</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {walletChoices.map((wallet) => (
              <button
                key={wallet.info.uuid}
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void connectWith(wallet)}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-left text-sm font-semibold text-white transition hover:border-cyan-300/50 hover:bg-white/[0.09] hover:text-cyan-100 disabled:opacity-50"
              >
                {wallet.info.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={wallet.info.icon} alt="" className="h-6 w-6 rounded-md" />
                ) : (
                  <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-gradient text-[11px] font-black text-slate-950">{wallet.info.name.slice(0, 1).toUpperCase()}</span>
                )}
                {wallet.info.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {walletChoices.length === 0 && !address && (
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-white">Supported wallets</p>
            <Badge tone="idle">{WALLET_LINKS.length} wallets</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-400">Install any of these (or use your wallet&apos;s in-app browser), then select Connect wallet. Your keys never leave your wallet.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {WALLET_LINKS.map((wallet) => (
              <a
                key={wallet.name}
                href={wallet.url}
                target="_blank"
                rel="noreferrer"
                className="group flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-cyan-300/40 hover:bg-white/[0.07] hover:text-cyan-100"
              >
                <span className="flex flex-col">
                  <span>{wallet.name}</span>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{wallet.tag}</span>
                </span>
                <ExternalLinkIcon className="h-3.5 w-3.5 text-slate-500 transition group-hover:text-cyan-300" />
              </a>
            ))}
          </div>
        </div>
      )}

      {!address ? (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-sm leading-6 text-slate-400">
          <ShieldIcon className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300/80" />
          <p>
            Connect an injected EVM wallet to see your LODE balance, stake, and withdrawal requests. Transactions are signed by your wallet; the dashboard never asks for a private key.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricTile label="Wallet balance" value={account ? `${fmtToken(account.tokenBalance, tokenDecimals)} LODE` : accountLoading ? "Loading…" : "Unavailable"} />
            <MetricTile label="Effective stake" value={account ? `${fmtToken(account.effectiveStake, tokenDecimals)} LODE` : accountLoading ? "Loading…" : "Unavailable"} />
            <MetricTile label="Minimum to report" value={account ? `${fmtToken(account.minStake, tokenDecimals)} LODE` : accountLoading ? "Loading…" : "Unavailable"} />
            <MetricTile label="Operator status" value={account ? eligible ? "Eligible" : "Not eligible" : accountLoading ? "Loading…" : "Unavailable"} tone={account ? (eligible ? "live" : "warn") : "idle"} />
          </div>

          {account && account.nativeBalance < 10n ** 16n && (
            <p className="mt-4 flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-100">
              <AlertIcon className="h-4 w-4 shrink-0" /> Your BOT gas balance is low. Fund this wallet with BOT before sending transactions.
            </p>
          )}

          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <form
              className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"
              onSubmit={(event) => {
                event.preventDefault();
                if (!address || !account) return;
                void runAction("Staking…", async () => {
                  const amount = parseTokenAmount(stakeAmount);
                  if (amount > account.tokenBalance) throw new Error("Your LODE balance is lower than this amount.");
                  if (account.nativeBalance === 0n) throw new Error("This wallet needs BOT for transaction gas.");
                  await stakeLode(address, amount, () => setBusy("Approve LODE in your wallet…"));
                }, "LODE stake confirmed on-chain.");
              }}
            >
              <h3 className="flex items-center gap-2 font-bold text-white"><CoinsIcon className="h-4 w-4 text-cyan-300" /> Stake LODE</h3>
              <p className="mt-1 text-sm text-slate-400">First-time staking asks your wallet to approve the exact amount.</p>
              <label className="mt-4 block text-xs font-semibold text-slate-300">
                Amount (LODE)
                <input className={fieldClass} type="number" min="0" step="any" inputMode="decimal" value={stakeAmount} onChange={(event) => setStakeAmount(event.target.value)} placeholder="e.g. 1000" required />
              </label>
              <button type="button" className="mt-2 text-xs font-semibold text-cyan-300 hover:text-cyan-100" onClick={() => setStakeAmount(account ? formatUnits(account.tokenBalance, tokenDecimals) : "")}>Use full balance</button>
              <button type="submit" disabled={!account || Boolean(busy)} className="btn-primary mt-4 w-full">{busy && (busy.includes("Staking") || busy.includes("Approve")) ? busy : "Approve & stake LODE"}</button>
            </form>

            <form
              className="rounded-2xl border border-white/10 bg-white/[0.025] p-5"
              onSubmit={(event) => {
                event.preventDefault();
                if (!address || !account) return;
                void runAction("Requesting withdrawal…", async () => {
                  const amount = parseTokenAmount(withdrawAmount);
                  if (amount > account.effectiveStake) throw new Error("The amount exceeds your non-withdrawing stake.");
                  await requestLodeWithdrawal(address, amount);
                }, "Withdrawal request queued. LODE can be claimed after the 7-day delay.");
              }}
            >
              <h3 className="flex items-center gap-2 font-bold text-white"><ClockIcon className="h-4 w-4 text-cyan-300" /> Request withdrawal</h3>
              <p className="mt-1 text-sm text-slate-400">Requested LODE stops counting as eligible stake immediately.</p>
              <label className="mt-4 block text-xs font-semibold text-slate-300">
                Amount (LODE)
                <input className={fieldClass} type="number" min="0" step="any" inputMode="decimal" value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} placeholder="Amount to unstake" required />
              </label>
              <button type="button" className="mt-2 text-xs font-semibold text-cyan-300 hover:text-cyan-100" onClick={() => setWithdrawAmount(account ? formatUnits(account.effectiveStake, tokenDecimals) : "")}>Use effective stake</button>
              <button type="submit" disabled={!account || account.effectiveStake === 0n || Boolean(busy)} className="btn-ghost mt-4 w-full">{busy.includes("withdrawal") ? busy : "Queue withdrawal"}</button>
            </form>
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-white">Withdrawal requests</h3>
                <p className="mt-1 text-sm text-slate-400">Claim a request once its seven-day unlock time has passed.</p>
              </div>
              <Badge tone="idle">{account?.withdrawals.filter((request) => request.amount > 0n).length ?? 0} pending</Badge>
            </div>
            {account?.withdrawals.filter((request) => request.amount > 0n).length ? (
              <div className="mt-4 space-y-2">
                {account.withdrawals.filter((request) => request.amount > 0n).map((request) => {
                  const ready = request.availableAt.getTime() <= Date.now();
                  return (
                    <div key={request.index} className="flex flex-col gap-3 rounded-xl border border-white/5 bg-ink-900/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold text-white tnum">{fmtToken(request.amount, tokenDecimals)} LODE</p>
                        <p className="mt-1 text-xs text-slate-500">{ready ? "Available now" : `Unlocks ${request.availableAt.toLocaleString()}`}</p>
                      </div>
                      <button
                        type="button"
                        disabled={!ready || Boolean(busy)}
                        onClick={() => void runAction("Claiming withdrawal…", () => claimLodeWithdrawal(address, request.index), "Withdrawal claimed and transferred to your wallet.")}
                        className="btn-ghost"
                      >
                        {busy.includes("Claiming") ? busy : ready ? "Claim LODE" : "Locked"}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">No outstanding withdrawal requests.</p>
            )}
          </div>

          <form
            className="mt-5 rounded-2xl border border-white/10 bg-white/[0.025] p-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!address || !selectedFeed || !account) return;
              void runAction("Submitting price…", () => submitFeedPrice(address, selectedFeed.assetId, price, selectedFeed.decimals), "Price submission confirmed on-chain.");
            }}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="flex items-center gap-2 font-bold text-white"><BoltIcon className="h-4 w-4 text-cyan-300" /> Submit a feed price</h3>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
                  Enter the locally aggregated quote from your independent sources. This form timestamps the report when you submit it; it does not fetch or validate market data for you.
                </p>
              </div>
              <Badge tone={eligible ? "live" : "warn"}>{eligible ? "Eligible to report" : "Minimum stake required"}</Badge>
            </div>
            {feeds.length ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="block text-xs font-semibold text-slate-300">
                  Feed
                  <select className={fieldClass} value={selectedAssetId} onChange={(event) => setSelectedAssetId(event.target.value)}>
                    {feeds.map((feed) => <option key={feed.assetId} value={feed.assetId} disabled={feed.isPaused}>{feed.symbol}{feed.isPaused ? " (paused)" : ""}</option>)}
                  </select>
                </label>
                <label className="block text-xs font-semibold text-slate-300">
                  Price ({selectedFeed?.decimals ?? 8} decimals)
                  <input className={fieldClass} type="number" min="0" step="any" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="e.g. 0.25000000" required />
                </label>
                <button type="submit" disabled={!selectedFeed || selectedFeed.isPaused || !eligible || Boolean(busy)} className="btn-primary">{busy.includes("Submitting") ? busy : "Submit price"}</button>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">No registered feeds are available to report.</p>
            )}
            <p className="mt-3 text-xs leading-5 text-slate-500">For scheduled multi-source sampling, median aggregation, and automatic reporting, run the reference operator node client. Never report an unverified or stale quote.</p>
          </form>
        </>
      )}

      {error && (
        <div className="mt-5 flex items-start gap-2 rounded-xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100" role="alert">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p>{error}</p>
            {error.includes("No browser wallet") && (
              <p className="mt-2 text-rose-100/80">
                MetaMask:{" "}
                <a className="font-semibold underline underline-offset-2 hover:text-white" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                  install the wallet extension
                </a>{" "}
                and reload, or open the dashboard in a wallet&apos;s in-app browser.
              </p>
            )}
          </div>
        </div>
      )}
      {notice && (
        <p className="mt-5 flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100" role="status">
          <ShieldIcon className="h-4 w-4 shrink-0" /> {notice}
        </p>
      )}
      {busy && !busy.includes("Approve") && !busy.includes("Staking") && !busy.includes("withdrawal") && !busy.includes("Claiming") && !busy.includes("Submitting") && (
        <p className="mt-3 text-xs text-slate-500" role="status">{busy}</p>
      )}
      <p className="mt-4 text-xs text-slate-600">Configured chain: {CHAIN_CONFIG.chainId} · All actions are submitted directly to BOT Chain and require BOT for gas.</p>
    </section>
  );
}
