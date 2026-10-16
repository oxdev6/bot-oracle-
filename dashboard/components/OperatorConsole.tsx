"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, parseUnits, type Address, type EIP1193Provider } from "viem";
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

const fieldClass =
  "mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-400/50";

const WALLET_LINKS = [
  { name: "MetaMask", url: "https://metamask.io/download/" },
  { name: "Coinbase Wallet", url: "https://www.coinbase.com/wallet/downloads" },
  { name: "Rabby", url: "https://rabby.io/" },
  { name: "Brave Wallet", url: "https://brave.com/wallet/" },
  { name: "OKX Wallet", url: "https://www.okx.com/web3" },
  { name: "Trust Wallet", url: "https://trustwallet.com/browser-extension" },
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
        setError("No browser wallet is available in this browser. Install a wallet extension, or open this dashboard in your wallet's browser, then select Connect wallet again.");
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
    <section className="mt-12 rounded-3xl border border-cyan-400/15 bg-slate-950/70 p-5 shadow-[0_30px_80px_-55px_rgba(34,211,238,0.8)] sm:p-7">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">Operator console</p>
          <h2 className="mt-2 text-2xl font-black text-white">Manage your node on-chain</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Stake LODE, manage the 7-day withdrawal queue, and report prices directly to the aggregator.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void connect()}
          disabled={Boolean(busy)}
          className="shrink-0 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-wait disabled:opacity-60"
        >
          {busy || (address ? `${address.slice(0, 6)}…${address.slice(-4)} · Change wallet` : "Connect wallet")}
        </button>
      </div>

      {walletChoices.length > 0 && (
        <div className="mt-5 rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.04] p-4">
          <p className="text-sm font-semibold text-white">Choose a wallet</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {walletChoices.map((wallet) => (
              <button
                key={wallet.info.uuid}
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void connectWith(wallet)}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-4 py-3 text-left text-sm font-semibold text-white transition hover:border-cyan-300/40 hover:bg-white/[0.08] hover:text-cyan-100 disabled:opacity-50"
              >
                {wallet.info.icon ? (
                  <img src={wallet.info.icon} alt="" className="h-6 w-6 rounded-md" />
                ) : (
                  <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-cyan-400 to-blue-600 text-[11px] font-black text-slate-950">{wallet.info.name.slice(0, 1).toUpperCase()}</span>
                )}
                {wallet.info.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {walletChoices.length === 0 && !address && (
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
          <p className="text-sm font-semibold text-white">Popular wallets</p>
          <p className="mt-1 text-xs text-slate-400">Install any of these, then select Connect wallet. Your keys never leave your wallet.</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
            {WALLET_LINKS.map((wallet) => (
              <a key={wallet.name} href={wallet.url} target="_blank" rel="noreferrer" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-slate-200 transition hover:border-cyan-300/40 hover:text-cyan-100">
                {wallet.name} ↗
              </a>
            ))}
          </div>
        </div>
      )}

      {!address ? (
        <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-sm leading-6 text-slate-400">
          Connect an injected EVM wallet to see your LODE balance, stake, and withdrawal requests. Transactions are signed by your wallet; the dashboard never asks for a private key.
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-xs text-slate-500">Wallet balance</p>
              <p className="mt-2 font-bold text-white">{account ? `${fmtToken(account.tokenBalance, tokenDecimals)} LODE` : accountLoading ? "Loading…" : "Unavailable"}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-xs text-slate-500">Effective stake</p>
              <p className="mt-2 font-bold text-white">{account ? `${fmtToken(account.effectiveStake, tokenDecimals)} LODE` : accountLoading ? "Loading…" : "Unavailable"}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-xs text-slate-500">Minimum to report</p>
              <p className="mt-2 font-bold text-white">{account ? `${fmtToken(account.minStake, tokenDecimals)} LODE` : accountLoading ? "Loading…" : "Unavailable"}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-xs text-slate-500">Operator status</p>
              <p className={`mt-2 font-bold ${eligible ? "text-emerald-300" : "text-amber-200"}`}>{account ? eligible ? "Eligible" : "Not eligible" : accountLoading ? "Loading…" : "Unavailable"}</p>
            </div>
          </div>

          {account && account.nativeBalance < 10n ** 16n && (
            <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-100">
              Your BOT gas balance is low. Fund this wallet with BOT before sending transactions.
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
              <h3 className="font-bold text-white">Stake LODE</h3>
              <p className="mt-1 text-sm text-slate-400">First-time staking asks your wallet to approve the exact amount.</p>
              <label className="mt-4 block text-xs font-semibold text-slate-300">
                Amount (LODE)
                <input className={fieldClass} type="number" min="0" step="any" inputMode="decimal" value={stakeAmount} onChange={(event) => setStakeAmount(event.target.value)} placeholder="e.g. 1000" required />
              </label>
              <button type="button" className="mt-2 text-xs font-semibold text-cyan-300 hover:text-cyan-100" onClick={() => setStakeAmount(account ? formatUnits(account.tokenBalance, tokenDecimals) : "")}>Use full balance</button>
              <button type="submit" disabled={!account || Boolean(busy)} className="mt-4 w-full rounded-xl bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">{busy && (busy.includes("Staking") || busy.includes("Approve")) ? busy : "Approve & stake LODE"}</button>
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
              <h3 className="font-bold text-white">Request withdrawal</h3>
              <p className="mt-1 text-sm text-slate-400">Requested LODE stops counting as eligible stake immediately.</p>
              <label className="mt-4 block text-xs font-semibold text-slate-300">
                Amount (LODE)
                <input className={fieldClass} type="number" min="0" step="any" inputMode="decimal" value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} placeholder="Amount to unstake" required />
              </label>
              <button type="button" className="mt-2 text-xs font-semibold text-cyan-300 hover:text-cyan-100" onClick={() => setWithdrawAmount(account ? formatUnits(account.effectiveStake, tokenDecimals) : "")}>Use effective stake</button>
              <button type="submit" disabled={!account || account.effectiveStake === 0n || Boolean(busy)} className="mt-4 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-bold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50">{busy.includes("withdrawal") ? busy : "Queue withdrawal"}</button>
            </form>
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.025] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-white">Withdrawal requests</h3>
                <p className="mt-1 text-sm text-slate-400">Claim a request once its seven-day unlock time has passed.</p>
              </div>
              <span className="text-xs text-slate-500">{account?.withdrawals.filter((request) => request.amount > 0n).length ?? 0} pending</span>
            </div>
            {account?.withdrawals.filter((request) => request.amount > 0n).length ? (
              <div className="mt-4 space-y-2">
                {account.withdrawals.filter((request) => request.amount > 0n).map((request) => {
                  const ready = request.availableAt.getTime() <= Date.now();
                  return (
                    <div key={request.index} className="flex flex-col gap-3 rounded-xl border border-white/5 bg-slate-950/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold text-white">{fmtToken(request.amount, tokenDecimals)} LODE</p>
                        <p className="mt-1 text-xs text-slate-500">{ready ? "Available now" : `Unlocks ${request.availableAt.toLocaleString()}`}</p>
                      </div>
                      <button
                        type="button"
                        disabled={!ready || Boolean(busy)}
                        onClick={() => void runAction("Claiming withdrawal…", () => claimLodeWithdrawal(address, request.index), "Withdrawal claimed and transferred to your wallet.")}
                        className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:border-cyan-300/40 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
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
                <h3 className="font-bold text-white">Submit a feed price</h3>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
                  Enter the locally aggregated quote from your independent sources. This form timestamps the report when you submit it; it does not fetch or validate market data for you.
                </p>
              </div>
              <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${eligible ? "bg-emerald-500/10 text-emerald-200" : "bg-amber-500/10 text-amber-200"}`}>{eligible ? "Eligible to report" : "Minimum stake required"}</span>
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
                <button type="submit" disabled={!selectedFeed || selectedFeed.isPaused || !eligible || Boolean(busy)} className="rounded-xl bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50">{busy.includes("Submitting") ? busy : "Submit price"}</button>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">No registered feeds are available to report.</p>
            )}
            <p className="mt-3 text-xs leading-5 text-slate-500">For scheduled multi-source sampling, median aggregation, and automatic reporting, run the reference operator node client. Never report an unverified or stale quote.</p>
          </form>
        </>
      )}

      {error && (
        <div className="mt-5 rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100" role="alert">
          <p>{error}</p>
          {error.includes("No browser wallet") && (
            <p className="mt-2 text-rose-100/80">
              MetaMask:{" "}
              <a className="font-semibold underline underline-offset-2 hover:text-white" href="https://metamask.io/download/" target="_blank" rel="noreferrer">
                install the wallet extension
              </a>
              {" "}and reload, or open the dashboard in MetaMask Mobile&apos;s browser.
            </p>
          )}
        </div>
      )}
      {notice && <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100" role="status">{notice}</p>}
      {busy && !busy.includes("Approve") && !busy.includes("Staking") && !busy.includes("withdrawal") && !busy.includes("Claiming") && !busy.includes("Submitting") && (
        <p className="mt-3 text-xs text-slate-500" role="status">{busy}</p>
      )}
      <p className="mt-4 text-xs text-slate-600">Configured chain: {CHAIN_CONFIG.chainId} · All actions are submitted directly to BOT Chain and require BOT for gas.</p>
    </section>
  );
}
