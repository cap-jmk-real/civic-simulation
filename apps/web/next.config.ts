import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@ip-sim/core", "@ip-sim/wasm"],
  webpack: (config) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    config.module.rules.push({
      test: /\.wasm$/,
      type: "webassembly/async",
    });
    return config;
  },
};

export default nextConfig;
