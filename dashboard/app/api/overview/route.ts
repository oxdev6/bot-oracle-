import { loadOverview } from "@/lib/server-data";

export const dynamic = "force-dynamic";

/**
 * GET /api/overview — aggregated dashboard payload.
 * 200 = live or demo data; 502 = configured but the upstream RPC failed.
 */
export async function GET() {
  const data = await loadOverview();
  const status = data.error ? 502 : 200;
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
