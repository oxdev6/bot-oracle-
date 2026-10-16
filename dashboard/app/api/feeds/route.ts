import { isConfigured, loadFeeds } from "@/lib/server-data";

export const dynamic = "force-dynamic";

/** GET /api/feeds — registered price feeds with their latest snapshot. */
export async function GET() {
  const feeds = await loadFeeds();
  return Response.json(
    { demo: !isConfigured(), feeds },
    { headers: { "cache-control": "no-store" } },
  );
}
