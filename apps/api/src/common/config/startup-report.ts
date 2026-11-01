import { flagOn, isExplicitDevOrTest } from './node-env';

type Env = Record<string, string | undefined>;

/**
 * What the API says about itself at start: the environment, Swagger and
 * registration — from the same rule as `swaggerEnabled` / `registrationEnabled`
 * (`node-env.ts`), with the reason something is on. A warning when
 * `NODE_ENV=development` comes with a `FRONTEND_URL` that is not localhost —
 * that looks like a server with a development setting.
 */
export function startupReport(env: Env = process.env): { lines: string[]; warnings: string[] } {
  const nodeEnv = (env.NODE_ENV ?? '').trim();
  const devOrTest = isExplicitDevOrTest(env);
  const environment = !nodeEnv
    ? 'NODE_ENV is not set (treated as production)'
    : devOrTest || nodeEnv.toLowerCase() === 'production'
      ? `NODE_ENV=${nodeEnv}`
      : `NODE_ENV=${nodeEnv} (treated as production)`;
  const state = (flag: string) =>
    devOrTest ? `on (NODE_ENV=${nodeEnv})` : flagOn(env[flag]) ? `on (${flag}=true)` : null;

  const swagger = state('SWAGGER_ENABLED');
  const registration = state('REGISTRATION_ENABLED');
  const lines = [
    `Environment: ${environment}`,
    `Swagger: ${swagger ?? 'off (set SWAGGER_ENABLED=true to turn it on)'}`,
    `Registration (POST /api/auth/register): ${registration ?? 'off — create the first company with npm run company:create'}`,
  ];

  const warnings: string[] = [];
  const frontend = env.FRONTEND_URL?.trim();
  if (nodeEnv.toLowerCase() === 'development' && frontend && !isLocalhost(frontend)) {
    warnings.push(`NODE_ENV=development but FRONTEND_URL=${frontend} is not localhost — on a server set NODE_ENV=production (development turns on Swagger, registration and the seed)`);
  }
  return { lines, warnings };
}

function isLocalhost(url: string): boolean {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Called in main.ts after `app.listen`: lines as log, warnings as warn. */
export function logStartupReport(logger: { log(m: string): void; warn(m: string): void }, env: Env = process.env): void {
  const { lines, warnings } = startupReport(env);
  for (const l of lines) logger.log(l);
  for (const w of warnings) logger.warn(w);
}
