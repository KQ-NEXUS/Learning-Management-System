import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The certificate renderer reads its bundled font from the project root at
  // runtime (src/server/services/certificate-font.ts), which static tracing
  // cannot see. `"/*"` targets every route's server trace; values are globs
  // relative to the project root (node_modules/next/dist/docs/01-app/
  // 03-api-reference/05-config/01-next-config-js/output.md).
  outputFileTracingIncludes: {
    "/*": ["./assets/fonts/certificate/**/*"],
  },
};

export default nextConfig;
