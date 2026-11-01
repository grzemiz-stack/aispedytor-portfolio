/**
 * `npm run company:create -- --company-name … --tax-id … --email … --first-name … --last-name …`
 *
 * Creates a company and its first ADMIN — the way to the first company while
 * registration through the API is off (`REGISTRATION_ENABLED`), also in
 * production, where the seed refuses. The same rules as `POST /auth/register`:
 * `RegisterCompanyDto` validation (as the ValidationPipe in main.ts: fields
 * outside the DTO are rejected), then `AuthService.registerCompany` (tax ID,
 * e-mail taken, encryption). Needs the built `dist/` (`npm run build`).
 *
 * The password comes from stdin only (the first line) — never from an
 * argument, which stays in the shell history and the process list:
 *   read -rs PW && printf '%s\n' "$PW" | npm run company:create -- --company-name …
 * Prints the company and ADMIN ids, never tokens or the password. The refresh
 * token that registration creates is deleted at once — nobody received it.
 *
 * Optional fields as in the DTO: --regon, --street, --city, --postal-code,
 * --country (PL by default), --billing-email, --phone, --website.
 * And --cost-per-km: the company cost per km WITHOUT tolls, in the company
 * currency (from the country) — the basis of offer costs in negotiation and
 * the route planner. The same rules as PATCH /companies/me: > 0, at most 2
 * decimals.
 */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterCompanyDto } from '../auth/dto/register-company.dto';
import { DECIMAL_10_2_MAX } from '../common/db-limits';

type AuthForCli = {
  registerCompany(dto: RegisterCompanyDto): Promise<{ userId: string; companyId: string }>;
  logout(userId: string): Promise<unknown>;
  /** Saves the new company's cost per km (main: Prisma). */
  setCostPerKm(companyId: string, costPerKm: number): Promise<unknown>;
};

/** `--cost-per-km`: przecinek albo kropka; > 0, ≤ 2 miejsca po przecinku, w kolumnie DECIMAL(10,2). */
function parseCostPerKm(text: string): number {
  const t = text.trim().replace(',', '.');
  const n = Number(t);
  if (!/^\d+(\.\d{1,2})?$/.test(t) || !(n > 0) || n > DECIMAL_10_2_MAX) {
    throw new Error('Invalid fields: costPerKm (a number above 0 with at most 2 decimals, in the company currency, without tolls)');
  }
  return n;
}

const camel = (flag: string) => flag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** `--kebab-case value` → `{ camelCase: value }`. Refuses a password among the arguments. */
export function parseCompanyArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!flag.startsWith('--')) throw new Error(`Unexpected argument: ${flag}`);
    if (flag === '--password') throw new Error('The password is read from stdin, never from the arguments.');
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    out[camel(flag.slice(2))] = value;
  }
  return out;
}

/** Validates as the API does and registers. Returns the ids only; the registration tokens never leave. */
export async function createCompany(
  fields: Record<string, string>,
  password: string,
  auth: AuthForCli,
): Promise<{ companyId: string; userId: string; costPerKmSet: boolean }> {
  const { costPerKm: costText, ...registration } = fields;
  // Before registering — a bad rate must not leave a company without it.
  const costPerKm = costText !== undefined ? parseCostPerKm(costText) : undefined;
  const dto = plainToInstance(RegisterCompanyDto, { ...registration, password });
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) throw new Error(`Invalid fields: ${errors.map((e) => e.property).join(', ')}`);
  const { companyId, userId } = await auth.registerCompany(dto);
  await auth.logout(userId);
  if (costPerKm !== undefined) await auth.setCostPerKm(companyId, costPerKm);
  return { companyId, userId, costPerKmSet: costPerKm !== undefined };
}

/**
 * The output for the administrator. Without a cost per km it says what the
 * company will not see until an ADMIN sets one — otherwise the first
 * negotiation and planner screens show no cost without an explanation.
 */
export function createdLines(r: { companyId: string; userId: string; costPerKmSet: boolean }): string[] {
  const lines = [`Company created: companyId=${r.companyId}, ADMIN userId=${r.userId}. Log in with the e-mail given.`];
  if (!r.costPerKmSet) {
    lines.push(
      'No cost per km set (--cost-per-km): negotiation and the route planner show no offer cost or margin ' +
        '(OFFER_COST_RATE_MISSING on the screen) until an ADMIN sets it in the company settings ' +
        '("Koszt kilometra") or with PATCH /api/companies/me.',
    );
  }
  return lines;
}

async function readPassword(): Promise<string> {
  if (process.stdin.isTTY) throw new Error("Pipe the password on stdin, e.g.: read -rs PW && printf '%s\\n' \"$PW\" | npm run company:create -- …");
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data.split(/\r?\n/)[0];
}

async function main(): Promise<void> {
  const fields = parseCompanyArgs(process.argv.slice(2));
  const password = await readPassword();
  // Loaded only here: the test calls createCompany without Nest or a database.
  const { NestFactory } = await import('@nestjs/core');
  const { Module } = await import('@nestjs/common');
  const { ConfigModule } = await import('@nestjs/config');
  const { validateEnv } = await import('../common/config/secrets');
  const { PrismaModule } = await import('../prisma/prisma.module');
  const { EncryptionModule } = await import('../common/encryption/encryption.module');
  const { AuthModule } = await import('../auth/auth.module');
  const { AuthService } = await import('../auth/auth.service');
  const { PrismaService } = await import('../prisma/prisma.service');

  @Module({ imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), PrismaModule, EncryptionModule, AuthModule] })
  class CreateCompanyModule {}

  const app = await NestFactory.createApplicationContext(CreateCompanyModule, { logger: ['error', 'warn'] });
  try {
    const auth = app.get(AuthService);
    const prisma = app.get(PrismaService);
    const r = await createCompany(fields, password, {
      registerCompany: (dto) => auth.registerCompany(dto),
      logout: (userId) => auth.logout(userId),
      setCostPerKm: (companyId, costPerKm) => prisma.company.update({ where: { id: companyId }, data: { costPerKm } }),
    });
    for (const line of createdLines(r)) console.log(line);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    const status = (err as { status?: number })?.status;
    console.error(`company:create failed${status ? ` (${status})` : ''}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
