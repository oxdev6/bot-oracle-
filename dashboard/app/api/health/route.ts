import { CHAIN_CONFIG, checkRpcConnection, getConfigurationError } from "@/lib/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — deployment/RPC health for uptime monitors.
 * 200 = RPC reachable (or demo mode); 503 = configured but RPC unreachable.
 */
export async function GET() {
  const generatedAt = new Date().toISOString();
  const configError = getConfigurationError();
  if (configError) {
    return Response.json(
      { status: "degraded", configured: false, demo: true, chainId: CHAIN_CONFIG.chainId, error: configError, generatedAt },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  }

  try {
    await checkRpcConnection();
    return Response.json(
      { status: "ok", configured: true, demo: false, chainId: CHAIN_CONFIG.chainId, error: null, generatedAt },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return Response.json(
      {
        status: "error",
        configured: true,
        demo: false,
        chainId: CHAIN_CONFIG.chainId,
        error: err instanceof Error ? err.message : "RPC unreachable",
        generatedAt,
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
