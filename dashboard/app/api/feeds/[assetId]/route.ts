import { loadFeedDetail } from "@/lib/server-data";

export const dynamic = "force-dynamic";

/** GET /api/feeds/[assetId] — one feed's snapshot plus its round history. */
export async function GET(_request: Request, context: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await context.params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(assetId)) {
    return Response.json({ feed: null, rounds: [], error: "assetId must be a 32-byte hex string." }, { status: 400 });
  }
  const data = await loadFeedDetail(assetId);
  const status = data.feed ? 200 : 404;
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}
