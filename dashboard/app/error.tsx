"use client";

import { useEffect } from "react";

/**
 * Route-level error boundary. Catches render/load failures in the app segment
 * and offers a recovery action instead of a blank screen.
 */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[dashboard] route error", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#040b16] px-4 text-slate-100">
      <div className="w-full max-w-lg rounded-3xl border border-rose-500/20 bg-rose-500/10 p-8" role="alert">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-rose-200">Something went wrong</p>
        <h1 className="mt-3 text-2xl font-black text-white">This view failed to render</h1>
        <p className="mt-2 text-sm leading-6 text-rose-100/80">
          {error.message || "An unexpected error occurred while loading the dashboard."}
        </p>
        {error.digest && <p className="mt-1 font-mono text-xs text-rose-100/50">ref: {error.digest}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white transition hover:border-cyan-300/40 hover:text-cyan-200"
          >
            Back to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
