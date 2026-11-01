/**
 * The route planner asks Nominatim with a contact in the User-Agent, as
 * geocoding does: `NOMINATIM_CONTACT_EMAIL` reached only geocoding.service,
 * while RouteCalculatorService sent a bare "AiSpedytor/1.0" — against the
 * Nominatim usage policy.
 */
import { RouteCalculatorService } from '../../src/route-planner/osrm-calculator.service';

const KEY = 'NOMINATIM_CONTACT_EMAIL';
const saved = process.env[KEY];
afterEach(() => {
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
});

async function userAgentSent(): Promise<string> {
  const fetchMock = jest.fn(async () => ({ ok: true, json: async () => [] }));
  global.fetch = fetchMock as any;
  await (new RouteCalculatorService() as any).fetchJson('https://nominatim.openstreetmap.org/search?q=Pozna%C5%84&format=json&limit=1');
  return (fetchMock.mock.calls[0] as any)[1].headers['User-Agent'];
}

it('with NOMINATIM_CONTACT_EMAIL: the contact in the User-Agent', async () => {
  process.env[KEY] = 'contact@example.org';
  expect(await userAgentSent()).toBe('AiSpedytor/1.0 (contact@example.org)');
});

it('without it: the bare name, as before', async () => {
  delete process.env[KEY];
  expect(await userAgentSent()).toBe('AiSpedytor/1.0');
});
