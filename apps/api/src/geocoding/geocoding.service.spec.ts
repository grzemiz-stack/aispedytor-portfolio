import { GeocodingService, MIN_INTERVAL_MS, NOT_FOUND_TTL_DAYS } from './geocoding.service';

/**
 * No network: `fetch` is mocked, and the clock and sleep are replaced through
 * the service's fields — the test never waits a real second.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-29T12:00:00Z').getTime();

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function setup(opts: { cached?: any; contact?: string | undefined } = {}) {
  const prisma: any = {
    geocodeCache: {
      findUnique: jest.fn().mockResolvedValue(opts.cached ?? null),
      upsert: jest.fn().mockResolvedValue(undefined),
    },
  };
  const config: any = { get: jest.fn().mockReturnValue('contact' in opts ? opts.contact : 'contact@example.org') };
  const service = new GeocodingService(prisma, config);
  let clock = NOW;
  const sleeps: number[] = [];
  service.now = () => clock;
  service.sleep = async ms => {
    sleeps.push(ms);
    clock += ms;
  };
  const fetchMock = jest.spyOn(global, 'fetch' as any) as jest.Mock;
  return { service, prisma, fetchMock, sleeps, advance: (ms: number) => (clock += ms) };
}

afterEach(() => jest.restoreAllMocks());

describe('GeocodingService.lookup', () => {
  it('cache hit does not touch the network', async () => {
    const { service, fetchMock } = setup({
      cached: { query: 'poznań, pl', found: true, lat: 52.4, lng: 16.9, fetchedAt: new Date(NOW - 400 * DAY_MS) },
    });
    fetchMock.mockImplementation(() => {
      throw new Error('network must not be called');
    });
    await expect(service.lookup('Poznań, PL')).resolves.toEqual({
      status: 'found',
      coords: { lat: 52.4, lng: 16.9 },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a remembered miss younger than the TTL is not asked again', async () => {
    const { service, fetchMock } = setup({
      cached: { found: false, lat: null, lng: null, fetchedAt: new Date(NOW - (NOT_FOUND_TTL_DAYS - 1) * DAY_MS) },
    });
    await expect(service.lookup('Xyzzy')).resolves.toEqual({ status: 'not_found' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a remembered miss older than the TTL is asked again', async () => {
    const { service, fetchMock } = setup({
      cached: { found: false, lat: null, lng: null, fetchedAt: new Date(NOW - (NOT_FOUND_TTL_DAYS + 1) * DAY_MS) },
    });
    fetchMock.mockResolvedValue(jsonResponse([{ lat: '52.4', lon: '16.9' }]));
    await expect(service.lookup('Xyzzy')).resolves.toMatchObject({ status: 'found' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stores a hit with coordinates', async () => {
    const { service, prisma, fetchMock } = setup();
    fetchMock.mockResolvedValue(jsonResponse([{ lat: '52.4064', lon: '16.9252' }]));
    await service.lookup('Poznań, PL');
    const arg = prisma.geocodeCache.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ query: 'poznań, pl' });
    expect(arg.create).toMatchObject({ found: true, lat: 52.4064, lng: 16.9252 });
    expect(arg.create.fetchedAt).toEqual(new Date(NOW));
  });

  it('stores a miss as found=false without coordinates', async () => {
    const { service, prisma, fetchMock } = setup();
    fetchMock.mockResolvedValue(jsonResponse([]));
    await expect(service.lookup('Xyzzy')).resolves.toEqual({ status: 'not_found' });
    expect(prisma.geocodeCache.upsert.mock.calls[0][0].create).toMatchObject({ found: false, lat: null, lng: null });
  });

  it.each([
    ['HTTP 503', () => Promise.resolve(jsonResponse({}, 503))],
    ['HTTP 429', () => Promise.resolve(jsonResponse({}, 429))],
    ['network failure', () => Promise.reject(new Error('ECONNRESET'))],
    ['unreadable coordinates', () => Promise.resolve(jsonResponse([{ lat: 'abc', lon: '1' }]))],
  ])('%s is an error and is NOT cached as a miss', async (_label, response) => {
    const { service, prisma, fetchMock } = setup();
    fetchMock.mockImplementation(response);
    await expect(service.lookup('Poznań, PL')).resolves.toEqual({ status: 'error' });
    expect(prisma.geocodeCache.upsert).not.toHaveBeenCalled();
  });

  it('coordinate 0 is a coordinate, not a miss', async () => {
    const { service, prisma, fetchMock } = setup();
    fetchMock.mockResolvedValue(jsonResponse([{ lat: '51.4779', lon: '0' }]));
    await expect(service.lookup('Greenwich, GB')).resolves.toEqual({
      status: 'found',
      coords: { lat: 51.4779, lng: 0 },
    });
    expect(prisma.geocodeCache.upsert.mock.calls[0][0].create).toMatchObject({ found: true, lng: 0 });
  });

  it('a cached coordinate 0 is a hit', async () => {
    const { service, fetchMock } = setup({ cached: { found: true, lat: 51.4779, lng: 0, fetchedAt: new Date(NOW) } });
    await expect(service.geocode('Greenwich, GB')).resolves.toEqual({ lat: 51.4779, lng: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes the key: case and whitespace do not make a new query', async () => {
    const { service, prisma, fetchMock } = setup();
    fetchMock.mockResolvedValue(jsonResponse([]));
    await service.lookup('  Poznań,   PL ');
    expect(prisma.geocodeCache.findUnique).toHaveBeenCalledWith({ where: { query: 'poznań, pl' } });
  });

  it('empty query is a miss without any lookup', async () => {
    const { service, prisma, fetchMock } = setup();
    await expect(service.lookup('   ')).resolves.toEqual({ status: 'not_found' });
    expect(prisma.geocodeCache.findUnique).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GeocodingService — Nominatim rules', () => {
  it('sends the contact from NOMINATIM_CONTACT_EMAIL in the User-Agent', async () => {
    const { service, fetchMock } = setup();
    fetchMock.mockResolvedValue(jsonResponse([]));
    await service.lookup('Poznań');
    expect(fetchMock.mock.calls[0][1].headers['User-Agent']).toBe('AiSpedytor/1.0 (contact@example.org)');
  });

  it('without the contact it still identifies the app', async () => {
    const { service, fetchMock } = setup({ contact: undefined });
    fetchMock.mockResolvedValue(jsonResponse([]));
    await service.lookup('Poznań');
    expect(fetchMock.mock.calls[0][1].headers['User-Agent']).toBe('AiSpedytor/1.0');
  });

  it('keeps at least MIN_INTERVAL_MS between network calls', async () => {
    const { service, fetchMock, sleeps } = setup();
    fetchMock.mockResolvedValue(jsonResponse([]));
    await Promise.all([service.lookup('A'), service.lookup('B'), service.lookup('C')]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // The first request goes out at once; each next one waits the full interval.
    expect(sleeps).toEqual([MIN_INTERVAL_MS, MIN_INTERVAL_MS]);
  });

  it('does not wait when the previous call was long enough ago', async () => {
    const { service, fetchMock, sleeps, advance } = setup();
    fetchMock.mockResolvedValue(jsonResponse([]));
    await service.lookup('A');
    advance(5000);
    await service.lookup('B');
    expect(sleeps).toEqual([]);
  });

  it('a failed call does not break the queue for the next ones', async () => {
    const { service, fetchMock } = setup();
    fetchMock
      .mockImplementationOnce(() => Promise.reject(new Error('boom')))
      .mockResolvedValueOnce(jsonResponse([{ lat: '1', lon: '2' }]));
    const [a, b] = await Promise.all([service.lookup('A'), service.lookup('B')]);
    expect(a).toEqual({ status: 'error' });
    expect(b).toEqual({ status: 'found', coords: { lat: 1, lng: 2 } });
  });
});
