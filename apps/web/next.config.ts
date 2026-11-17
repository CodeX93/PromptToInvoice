import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const config: NextConfig = {
  output: "standalone",
  typedRoutes: true,
  poweredByHeader: false,
  reactStrictMode: true,
  // Pins server action ids across instances of one release (set in CI).
  deploymentId: process.env.DEPLOYMENT_ID,
  transpilePackages: ["@pti/core", "@pti/db", "@pti/ai"],
  serverExternalPackages: ["pino", "postgres", "nodemailer", "pdfkit", "sharp"],
  // Fonts are read at runtime by the PDF renderer.
  outputFileTracingIncludes: { "/**": ["./assets/fonts/**"] },
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  images: { remotePatterns: [] },
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: securityHeaders }]);
  },
};

export default config;
