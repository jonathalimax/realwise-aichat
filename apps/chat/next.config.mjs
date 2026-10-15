// Production URL scheme (same domain for every niche, see docs/pharmacy/URLS.md):
//   /<slug>/chat                 customer chat
//   /<slug>/pedido/<token>       order tracking
// Static files are requested from /_c/_next/static/... (assetPrefix) so the reverse proxy can tell this app's
// assets from the marketing app's: it routes /_c/* here and strips the /_c prefix. Next also answers /_c/* by
// itself (rewrite below), so the app works with or without the strip, and directly on :3005 in dev.
const ASSET_PREFIX = "/_c";

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  devIndicators: false,
  output: "standalone",
  distDir: process.env.NEXT_DIST_DIR || ".next",
  assetPrefix: ASSET_PREFIX,
  async rewrites() {
    // public/ files (clara-avatar.jpg, icon.svg) are requested as /_c/<file>.
    return { beforeFiles: [{ source: `${ASSET_PREFIX}/:path((?!_next/).*)`, destination: "/:path" }], afterFiles: [], fallback: [] };
  },
  async redirects() {
    // Links already shared by real-estate customers: /client/conversation/<slug>[?c=&t=] -> /<slug>/chat (308, query kept).
    return [
      { source: "/client/conversation", destination: "/", permanent: true },
      { source: "/client/conversation/", destination: "/", permanent: true },
      { source: "/client/conversation/:slug((?!pedido$)[^/]+)", destination: "/:slug/chat", permanent: true },
      { source: "/client/conversation/:slug((?!pedido$)[^/]+)/", destination: "/:slug/chat", permanent: true },
    ];
  },
};
