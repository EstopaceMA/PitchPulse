import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Production runs the minimal server.js in a container (see Dockerfile).
  output: "standalone",
  // Set per image build so open tabs hard-reload after a redeploy instead of requesting missing assets.
  deploymentId: process.env.DEPLOYMENT_VERSION,
  cacheComponents: true,
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

export default nextConfig;
