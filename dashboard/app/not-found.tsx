import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#040b16] px-4 text-slate-100">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-950/70 p-8 text-center">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">404</p>
        <h1 className="mt-3 text-2xl font-black text-white">Page not found</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          The page or feed you were looking for does not exist. Check the feed id or return to the dashboard.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-cyan-200"
        >
          Back to dashboard
        </Link>
      </div>
    </div>
  );
}
