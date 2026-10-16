"use server";

import { revalidateAll } from "@/lib/server-data";

/**
 * Refresh the dashboard's cached on-chain reads.
 *
 * This is a Server Action, so Next.js enforces the same-origin check for us —
 * the browser can trigger a real refresh without holding the server-only
 * `REVALIDATE_SECRET`. The caching layer has no time-based revalidation
 * (`revalidate: false`), so this is the only way the dashboard's data changes
 * between page loads.
 */
export async function refreshDashboard(): Promise<void> {
  revalidateAll();
}
