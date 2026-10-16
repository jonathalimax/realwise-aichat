// One shared dashboard codebase, one container per niche, one path prefix per niche on the same domain.
const PREFIXES = { imobiliaria: "/imobiliaria/app", farmacia: "/farmacia/app", concessionaria: "/concessionaria/app" };
const defaultNiche = process.env.NEXT_PUBLIC_DEFAULT_NICHE in PREFIXES ? process.env.NEXT_PUBLIC_DEFAULT_NICHE : "imobiliaria";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || PREFIXES[defaultNiche];

/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  devIndicators: false,
  output: "standalone",
  // Build/run an instance per niche with NEXT_PUBLIC_DEFAULT_NICHE=imobiliaria|farmacia|concessionaria (and
  // NEXT_DIST_DIR=.next-<niche> so instances can build side by side). NEXT_PUBLIC_BASE_PATH overrides the prefix.
  basePath,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  env: { NEXT_PUBLIC_BASE_PATH: basePath, NEXT_PUBLIC_DEFAULT_NICHE: defaultNiche },
};
