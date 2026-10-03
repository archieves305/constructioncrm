import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    // geolocation=(self) so the canvassing "Near me" property search can read
    // the device GPS; camera/mic stay fully disabled.
    value: "camera=(), microphone=(), geolocation=(self), browsing-topics=()",
  },
  // Starter CSP. Tighten once we've inventoried inline scripts/fonts/images.
  // `frame-ancestors 'none'` supersedes X-Frame-Options on modern browsers.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

/**
 * Documents the app shows inside its own pages: the file preview and the
 * agreement on the signing page are an <iframe> of one of these responses.
 * The site-wide rule above ("never framed, by anyone") made the browser refuse
 * them, so the frame stayed blank. These responses may be framed by this
 * origin and no other. When two entries set the same header for a path, the
 * later one wins, so this list must stay after the site-wide entry.
 */
const FRAMED_BY_SELF = ["/api/files/:id", "/api/sign/:token/pdf"];

const sameOriginFrameHeaders = securityHeaders.map((h) =>
  h.key === "X-Frame-Options"
    ? { key: h.key, value: "SAMEORIGIN" }
    : h.key === "Content-Security-Policy"
      ? { key: h.key, value: h.value.replace("frame-ancestors 'none'", "frame-ancestors 'self'") }
      : h,
);

const nextConfig: NextConfig = {
  allowedDevOrigins: ["richards-mac-studio", "richards-mac-studio:4000"],
  // The Roofr report reader loads pdfjs at run time from node_modules; bundling it breaks its worker lookup.
  serverExternalPackages: ["pdfjs-dist"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      ...FRAMED_BY_SELF.map((source) => ({ source, headers: sameOriginFrameHeaders })),
    ];
  },
};

export default nextConfig;
