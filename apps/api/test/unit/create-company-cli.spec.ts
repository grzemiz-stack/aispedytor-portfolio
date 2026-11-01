/**
 * The first-company script `company:create`.
 *
 * With registration off it is the only way to the first company in
 * production (the seed refuses there). The same rules as `POST /auth/register`:
 * `RegisterCompanyDto` validation, then `AuthService.registerCompany` (tax ID,
 * e-mail taken, encryption). The password from stdin only — not an argument
 * (shell history, process list). Output: the company and ADMIN ids, no tokens;
 * the refresh token from registration is deleted at once (nobody got it).
 */
import { createCompany, createdLines, parseCompanyArgs } from '../../src/cli/create-company';

const ARGS = ['--company-name', 'Firma Sp. z o.o.', '--tax-id', '5260250274', '--email', 'jan@firma.example.com', '--first-name', 'Jan', '--last-name', 'Kowalski'];
const PASSWORD = 'Correct-horse-1';

function fakeAuth() {
  return {
    registerCompany: jest.fn(async (_dto: object) => ({ accessToken: 'ACCESS', refreshToken: 'REFRESH', userId: 'u-1', companyId: 'c-1' })),
    logout: jest.fn(async (_userId: string) => ({ message: 'ok' })),
    setCostPerKm: jest.fn(async (_companyId: string, _costPerKm: number) => undefined),
  };
}

describe('parseCompanyArgs', () => {
  it('--kebab-case value → camelCase fields', () => {
    expect(parseCompanyArgs([...ARGS, '--country', 'DE'])).toEqual({
      companyName: 'Firma Sp. z o.o.', taxId: '5260250274', email: 'jan@firma.example.com', firstName: 'Jan', lastName: 'Kowalski', country: 'DE',
    });
  });

  it('a password in the arguments is refused', () => {
    expect(() => parseCompanyArgs([...ARGS, '--password', PASSWORD])).toThrow(/stdin/);
  });

  it('a flag without a value is refused', () => {
    expect(() => parseCompanyArgs(['--company-name'])).toThrow(/--company-name/);
    expect(() => parseCompanyArgs(['--company-name', '--tax-id', '5260250274'])).toThrow(/--company-name/);
  });
});

describe('createCompany', () => {
  it('registers with the same DTO as the API, deletes the unused refresh token, returns ids (and whether a rate was set), no tokens', async () => {
    const auth = fakeAuth();
    const r = await createCompany(parseCompanyArgs(ARGS), PASSWORD, auth);
    expect(r).toEqual({ companyId: 'c-1', userId: 'u-1', costPerKmSet: false });
    expect(auth.registerCompany.mock.calls[0][0]).toEqual({ ...parseCompanyArgs(ARGS), password: PASSWORD });
    expect(auth.logout).toHaveBeenCalledWith('u-1');
  });

  it('missing fields → error naming them, nothing registered', async () => {
    const auth = fakeAuth();
    await expect(createCompany({ companyName: 'Firma' }, PASSWORD, auth)).rejects.toThrow(/taxId.*email.*firstName.*lastName/s);
    expect(auth.registerCompany).not.toHaveBeenCalled();
  });

  it('a password under 8 characters → error, nothing registered', async () => {
    const auth = fakeAuth();
    await expect(createCompany(parseCompanyArgs(ARGS), 'short', auth)).rejects.toThrow(/password/);
    expect(auth.registerCompany).not.toHaveBeenCalled();
  });

  it('an unknown field → error (as forbidNonWhitelisted in the API)', async () => {
    const auth = fakeAuth();
    await expect(createCompany({ ...parseCompanyArgs(ARGS), role: 'ADMIN' }, PASSWORD, auth)).rejects.toThrow(/role/);
    expect(auth.registerCompany).not.toHaveBeenCalled();
  });

  it('the service error (e.g. REGISTER_EMAIL_TAKEN) passes through', async () => {
    const auth = fakeAuth();
    auth.registerCompany.mockRejectedValueOnce(Object.assign(new Error('REGISTER_EMAIL_TAKEN'), { status: 409 }));
    await expect(createCompany(parseCompanyArgs(ARGS), PASSWORD, auth)).rejects.toThrow('REGISTER_EMAIL_TAKEN');
  });
});

describe('--cost-per-km (offer cost = the company cost per km × km + toll)', () => {
  it('a valid rate is saved for the new company after registering; it is not passed to the registration DTO', async () => {
    const auth = fakeAuth();
    await createCompany({ ...parseCompanyArgs(ARGS), costPerKm: '4.20' }, PASSWORD, auth);
    expect(auth.registerCompany.mock.calls[0][0]).not.toHaveProperty('costPerKm');
    expect(auth.setCostPerKm).toHaveBeenCalledWith('c-1', 4.2);
  });

  it('a comma as the decimal separator is accepted', async () => {
    const auth = fakeAuth();
    await createCompany({ ...parseCompanyArgs(ARGS), costPerKm: '4,5' }, PASSWORD, auth);
    expect(auth.setCostPerKm).toHaveBeenCalledWith('c-1', 4.5);
  });

  it.each(['abc', '0', '-1', '4.123', '100000000'])('%p → error naming costPerKm, nothing registered', async (v) => {
    const auth = fakeAuth();
    await expect(createCompany({ ...parseCompanyArgs(ARGS), costPerKm: v }, PASSWORD, auth)).rejects.toThrow(/costPerKm/);
    expect(auth.registerCompany).not.toHaveBeenCalled();
  });

  it('without the flag no rate is set', async () => {
    const auth = fakeAuth();
    await createCompany(parseCompanyArgs(ARGS), PASSWORD, auth);
    expect(auth.setCostPerKm).not.toHaveBeenCalled();
  });
});

/**
 * The `company:create` output: without `--cost-per-km` it says what the
 * company will not see until an ADMIN sets a cost per km — otherwise the
 * first negotiation and planner screens show no cost without an explanation.
 */
describe('createdLines', () => {
  it('with the flag: one line with the ids, nothing about the cost', async () => {
    const r = await createCompany({ ...parseCompanyArgs(ARGS), costPerKm: '4,20' }, PASSWORD, fakeAuth());
    const lines = createdLines(r);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Company created: companyId=.+, ADMIN userId=.+\. Log in with the e-mail given\.$/);
  });

  it('without the flag: a second line — no cost or margin in negotiation and the planner until an ADMIN sets it', async () => {
    const r = await createCompany(parseCompanyArgs(ARGS), PASSWORD, fakeAuth());
    expect(createdLines(r)[1]).toBe(
      'No cost per km set (--cost-per-km): negotiation and the route planner show no offer cost or margin ' +
        '(OFFER_COST_RATE_MISSING on the screen) until an ADMIN sets it in the company settings ' +
        '("Koszt kilometra") or with PATCH /api/companies/me.',
    );
  });
});
