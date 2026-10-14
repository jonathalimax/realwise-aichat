/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  output: "standalone",
  // Default keeps the existing real-estate URL. Set NEXT_PUBLIC_BASE_PATH at build time to serve the dashboard under another prefix.
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "/imobiliaria/app",
};
