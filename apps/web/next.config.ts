import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@realwise/ui", "@realwise/contracts"],
};

export default nextConfig;
