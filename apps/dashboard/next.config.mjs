const defaultNiche = process.env.NEXT_PUBLIC_DEFAULT_NICHE === "farmacia" ? "farmacia" : "imobiliaria";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || `/${defaultNiche}/app`;

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  devIndicators: false,
  output: "standalone",
  // One shared dashboard, one prefix per niche: /imobiliaria/app (default) or /farmacia/app.
  // Build/run an instance per niche with NEXT_PUBLIC_DEFAULT_NICHE=farmacia (and NEXT_DIST_DIR=.next-farmacia
  // so two instances can build side by side). NEXT_PUBLIC_BASE_PATH still overrides the prefix.
  basePath,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  env: { NEXT_PUBLIC_BASE_PATH: basePath, NEXT_PUBLIC_DEFAULT_NICHE: defaultNiche },
};
