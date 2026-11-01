/**
 * Network guard for unit tests (jest `setupFiles`).
 *
 * A unit test that reaches a real service is not repeatable (it fails
 * without a network or when the service is slow) and loads someone else's
 * free service (Nominatim, OSRM, Trans.eu). Every connection to a host other
 * than this machine fails at once, with a message that says what to do:
 *   - `fetch` rejects;
 *   - any TCP connection (`http`, `https`, axios, database drivers) throws
 *     when it is opened.
 * Loopback (127.0.0.1, ::1, localhost) and Unix sockets stay open: a test
 * may start its own server. A test that needs an answer from outside stubs
 * it (`global.fetch = jest.fn(...)`, `jest.spyOn(axios, 'get')`) and so
 * says what it pretends.
 *
 * The integration tests (test/integration, real PostgreSQL on 127.0.0.1)
 * use their own jest config and are not guarded here.
 */
import * as net from 'node:net';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '[::1]']);

export class NetworkBlockedError extends Error {
  constructor(readonly target: string) {
    super(
      `A unit test tried to reach the network: ${target}. ` +
        'Stub it instead, e.g. global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({}) })).',
    );
    this.name = 'NetworkBlockedError';
  }
}

export const isLoopback = (host: string | undefined): boolean => host == null || host === '' || LOOPBACK.has(host.toLowerCase());

const realFetch = globalThis.fetch;
globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (!isLoopback(url.hostname)) throw new NetworkBlockedError(url.host);
  return realFetch(input, init);
};

type ConnectArgs = Parameters<net.Socket['connect']>;
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: ConnectArgs) {
  const [first, second] = args as unknown[];
  let host: string | undefined;
  let unixPath = false;
  if (Array.isArray(first)) {
    // Internal form used by `net.connect(options)`: [normalizedOptions, callback].
    const opts = first[0] as net.NetConnectOpts & { host?: string; path?: string };
    unixPath = typeof opts?.path === 'string';
    host = opts?.host;
  } else if (first && typeof first === 'object') {
    const opts = first as { host?: string; path?: string };
    unixPath = typeof opts.path === 'string';
    host = opts.host;
  } else if (typeof first === 'number' || (typeof first === 'string' && /^\d+$/.test(first))) {
    host = typeof second === 'string' ? second : undefined;
  } else if (typeof first === 'string') {
    unixPath = true;
  }
  if (!unixPath && !isLoopback(host)) throw new NetworkBlockedError(String(host));
  return realConnect.apply(this, args);
} as typeof net.Socket.prototype.connect;
