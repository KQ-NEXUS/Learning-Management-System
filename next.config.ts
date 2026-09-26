import type { NextConfig } from "next";

/**
 * F-09 — baseline security headers on every route
 * (node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md).
 * The CSP deliberately stops short of `script-src`: a script policy in Next
 * needs per-request nonces from the proxy, which makes every page dynamic —
 * a separate decision. What it does set blocks framing of any page
 * (clickjacking of one-click staff actions), plugin content and `<base>`
 * hijacking. The app only frames outward (allowlisted lesson video embeds),
 * never itself, so `frame-ancestors 'none'` costs nothing.
 */
const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  },
  // Older browsers without `frame-ancestors`.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Reset, verify and email-change links carry tokens in the URL; this never
  // sends a path or query to another origin.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
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
