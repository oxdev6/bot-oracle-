import Link from "next/link";
import { BoltIcon } from "@/components/icons";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 text-slate-100">
      <div className="card w-full max-w-lg animate-fade-up p-8 text-center shadow-glow">
        <span aria-hidden className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-gradient text-slate-950">
          <BoltIcon className="h-6 w-6" />
        </span>
        <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-300">404</p>
        <h1 className="mt-2 text-2xl font-black text-white">Page not found</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          The page or feed you were looking for does not exist. Check the feed id or return to the dashboard.
        </p>
        <Link href="/" className="btn-primary mt-6">Back to dashboard</Link>
      </div>
    </div>
  );
}
