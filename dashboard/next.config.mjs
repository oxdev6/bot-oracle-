/**
 * The dashboard runs as a Next.js server (not a static export) so it can host
 * the cached `/api/*` route handlers that shield the BOT RPC from every browser.
 * Deploy with `next start` / Vercel; `serve.js` is only for the legacy static
 * export and is no longer used in production.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  images: { unoptimized: true },
};

export default nextConfig;
