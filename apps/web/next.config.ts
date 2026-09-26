import type { NextConfig } from "next";

const config: NextConfig = {
  // The workspace packages ship TypeScript source; Next compiles them like app code.
  transpilePackages: ["@jevjob/core", "@jevjob/jev"],
};

export default config;
