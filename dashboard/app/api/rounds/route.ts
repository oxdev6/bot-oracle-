import { isConfigured, loadRounds } from "@/lib/server-data";

export const dynamic = "force-dynamic";

/** GET /api/rounds — recent closed rounds (newest first). */
export async function GET() {
  const rounds = await loadRounds();
  return Response.json(
    { demo: !isConfigured(), rounds },
    { headers: { "cache-control": "no-store" } },
  );
}
