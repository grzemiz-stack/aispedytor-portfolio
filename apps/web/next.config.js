const { withSentryConfig } = require('@sentry/nextjs/config');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app does not use next/image. Without the optimizer /_next/image answers
  // 404. On Next 14 that cut off the Image Optimization API advisories (the
  // AVIF RCE among them); on 15.5 they are fixed and a smaller surface remains.
  // docs/known-issues.md "Dependency advisories".
  images: { unoptimized: true },
  // No `X-Powered-By: Next.js`.
  poweredByHeader: false,
  // Security headers. A full CSP for scripts is deliberately not here — Next
  // needs a nonce or 'unsafe-inline' (docs/known-issues.md).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

// Sentry 10: the old `disableServerWebpackPlugin` / `disableClientWebpackPlugin`
// no longer exist (they did nothing anyway — the wrapper runs only with a DSN).
// Source maps go to Sentry only with SENTRY_AUTH_TOKEN; no build telemetry.
const sentryConfig = {
  silent: true,
  telemetry: false,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
};

module.exports = process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryConfig)
  : nextConfig;
