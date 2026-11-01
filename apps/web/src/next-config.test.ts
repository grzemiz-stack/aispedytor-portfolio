/**
 * Next config: the image optimizer is off (docs/known-issues.md,
 * "Dependency advisories").
 *
 * With `images.unoptimized` Next answers 404 on /_next/image before it
 * processes anything (checked on 14 and on 15.5). The Next 14 Image
 * Optimization API advisories had no entry point; on 15.5 they are fixed, and
 * an unused optimizer is a smaller surface. If next/image is ever added, this
 * test makes you revisit that first.
 */
const nextConfig = require('../next.config.js');

describe('next.config.js', () => {
  it('turns the image optimizer off (/_next/image = 404)', () => {
    expect(nextConfig.images).toEqual({ unoptimized: true });
  });
});

/**
 * Web security headers: no framing (X-Frame-Options + CSP frame-ancestors),
 * nosniff, Referrer-Policy. A full CSP for scripts — deliberately not here
 * (Next needs a nonce or 'unsafe-inline', plus Sentry and the API address):
 * described in docs/known-issues.md.
 */
describe('security headers', () => {
  it('no X-Powered-By: Next.js', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it('every path gets nosniff, no framing, a referrer policy', async () => {
    const rules = await nextConfig.headers();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe('/:path*');
    expect(Object.fromEntries(rules[0].headers.map((h: { key: string; value: string }) => [h.key, h.value]))).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "frame-ancestors 'none'",
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
  });
});
