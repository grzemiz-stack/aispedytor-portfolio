/**
 * Sentry in the web app sends no request data and no console breadcrumbs —
 * the browser, the Next server and Edge.
 *
 * Independent of the DSN: there is no production yet, the buyer sets the DSN
 * — the configuration has to be safe before anyone fills it in.
 * - `scrubEvent` (beforeSend and beforeSendTransaction): no request body,
 *   headers, cookies or query; addresses without their query — in the event,
 *   the trace data and the spans; breadcrumbs (fetch/xhr) — the address
 *   without the query when recorded;
 * - console breadcrumbs are off (not cleaned): in the browser
 *   `breadcrumbsIntegration({ console: false })`, on the server and in Edge
 *   without the `Console` integration;
 * - Replay masks all text and inputs, blocks media (explicitly, not by default).
 * The Trans.eu callback (`code`/`state`) goes to the API, not the web app —
 * the web app only gets `/settings?transeu=connected|error`.
 */
import { scrubBreadcrumb, scrubEvent, REPLAY_PRIVACY } from './lib/sentry-options';

const SECRET = 'wartownik-123';

describe('scrubEvent', () => {
  it('drops the request body, headers, cookies, query and strips the query from every url', () => {
    const event: any = {
      request: { url: `https://app.example.com/settings?code=${SECRET}`, data: { password: SECRET }, headers: { Authorization: `Bearer ${SECRET}` }, cookies: { s: SECRET }, query_string: `code=${SECRET}` },
      contexts: { trace: { data: { 'http.query': `?code=${SECRET}`, 'url.full': `https://api.example.com/x?t=${SECRET}` } } },
      spans: [{ data: { 'http.url': `https://api.example.com/offers?q=${SECRET}`, 'http.method': 'GET' } }],
    };
    const out = scrubEvent(event);
    expect(JSON.stringify(out)).not.toContain(SECRET);
    expect(out.request).toEqual({ url: 'https://app.example.com/settings' });
    expect(out.spans[0].data).toEqual({ 'http.url': 'https://api.example.com/offers', 'http.method': 'GET' });
  });

  it('a breadcrumb keeps its url without the query', () => {
    expect(scrubBreadcrumb({ category: 'xhr', data: { url: `/api/x?y=${SECRET}`, status_code: 200 } })).toEqual({ category: 'xhr', data: { url: '/api/x', status_code: 200 } });
  });
});

/** Opcje `Sentry.init` z danego pliku konfiguracji, przy ustawionym DSN. */
function initOptions(file: string): any {
  const init = jest.fn();
  const fakeIntegration = (name: string) => (opts?: unknown) => ({ name, opts });
  jest.isolateModules(() => {
    jest.doMock('@sentry/nextjs', () => ({
      init,
      captureRouterTransitionStart: jest.fn(),
      breadcrumbsIntegration: fakeIntegration('Breadcrumbs'),
      replayIntegration: fakeIntegration('Replay'),
      browserTracingIntegration: fakeIntegration('BrowserTracing'),
    }));
    const before = process.env.NEXT_PUBLIC_SENTRY_DSN;
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'http://key@127.0.0.1:9/1';
    try {
      require(file);
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
      else process.env.NEXT_PUBLIC_SENTRY_DSN = before;
    }
  });
  expect(init).toHaveBeenCalledTimes(1);
  return init.mock.calls[0][0];
}

const DEFAULTS = [{ name: 'Console' }, { name: 'Breadcrumbs' }, { name: 'Dedupe' }];

describe.each([
  ['browser', './instrumentation-client'],
  ['Next server', '../sentry.server.config'],
  ['Edge', '../sentry.edge.config'],
])('%s config', (_name, file) => {
  it('scrubs events and transactions, cleans breadcrumbs, no console breadcrumbs', () => {
    const o = initOptions(file);
    // Behaviour, not identity (isolateModules loads a separate copy of the module).
    const leaky = () => ({ request: { url: `/x?c=${SECRET}`, data: SECRET, headers: { a: SECRET } }, spans: [{ data: { 'url.full': `/y?d=${SECRET}` } }] });
    for (const hook of [o.beforeSend, o.beforeSendTransaction]) expect(JSON.stringify(hook(leaky()))).not.toContain(SECRET);
    expect(JSON.stringify(o.beforeBreadcrumb({ data: { url: `/z?e=${SECRET}` } }))).not.toContain(SECRET);
    expect(o.sendDefaultPii).toBe(false);
    const integrations = o.integrations(DEFAULTS);
    expect(integrations.some((i: any) => i.name === 'Console')).toBe(false);
    const crumbs = integrations.filter((i: any) => i.name === 'Breadcrumbs');
    // Browser: Breadcrumbs without the console; server and Edge — the default Breadcrumbs (no console there anyway).
    expect(crumbs.every((i: any) => i.opts === undefined || i.opts.console === false)).toBe(true);
  });
});

it('browser: Replay masks all text and inputs and blocks media; tracing on', () => {
  const names = initOptions('./instrumentation-client').integrations(DEFAULTS).map((i: any) => [i.name, i.opts]);
  expect(names).toEqual([
    ['Dedupe', undefined],
    ['Breadcrumbs', { console: false }],
    ['Replay', REPLAY_PRIVACY],
    ['BrowserTracing', undefined],
  ]);
  expect(REPLAY_PRIVACY).toEqual({ maskAllText: true, maskAllInputs: true, blockAllMedia: true });
});

it('browser: Session Replay is off by default — 0 % of sessions and 0 % of sessions with an error (audit 3, H6)', () => {
  const opts = initOptions('./instrumentation-client');
  expect([opts.replaysSessionSampleRate, opts.replaysOnErrorSampleRate]).toEqual([0, 0]);
});
