import { isConfigured, loadOperators } from "@/lib/server-data";

export const dynamic = "force-dynamic";

/** GET /api/operators — bonded operators and their effective stake. */
export async function GET() {
  const operators = await loadOperators();
  return Response.json(
    { demo: !isConfigured(), operators },
    { headers: { "cache-control": "no-store" } },
  );
}
