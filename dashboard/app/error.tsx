"use client";

import { useEffect } from "react";
import { AlertIcon } from "@/components/icons";

/**
 * Route-level error boundary. Catches render/load failures in the app segment
 * and offers a recovery action instead of a blank screen.
 */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[dashboard] route error", error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4 text-slate-100">
      <div className="card w-full max-w-lg animate-fade-up border-rose-500/25 p-8 shadow-card" role="alert">
        <span aria-hidden className="flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-400/30 bg-rose-500/10 text-rose-200">
          <AlertIcon className="h-6 w-6" />
        </span>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.22em] text-rose-200">Something went wrong</p>
        <h1 className="mt-2 text-2xl font-black text-white">This view failed to render</h1>
        <p className="mt-2 text-sm leading-6 text-rose-100/80">
          {error.message || "An unexpected error occurred while loading the dashboard."}
        </p>
        {error.digest && <p className="mt-1 font-mono text-xs text-rose-100/50">ref: {error.digest}</p>}
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={reset} className="btn-primary">Try again</button>
          <a href="/" className="btn-ghost">Back to dashboard</a>
        </div>
      </div>
    </div>
  );
}
