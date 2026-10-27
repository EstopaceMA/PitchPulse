import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Production runs the minimal server.js in a container (see Dockerfile).
  output: "standalone",
  // Set per image build so open tabs hard-reload after a redeploy instead of requesting missing assets.
  deploymentId: process.env.DEPLOYMENT_VERSION,
  cacheComponents: true,
  // Hide the on-screen Next.js badge in development; compile and runtime errors still surface.
  devIndicators: false,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default createNextIntlPlugin()(nextConfig);
