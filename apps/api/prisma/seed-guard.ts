import { isExplicitDevOrTest } from '../src/common/config/node-env';

/**
 * The seed runs only with an explicit `NODE_ENV=development` or `test`.
 *
 * The seed creates demo accounts with known passwords (README: "Demo
 * accounts"), sample offers and contractors — test data. Run on a
 * production database it would add an ADMIN account with the password from
 * the README. Any other value, and no `NODE_ENV` at all, is refused before
 * the seed touches the database or the encryption key — a server nobody set
 * an environment for must not get demo accounts. No override: production
 * gets its data from migrations, the application and `company:create`, not
 * from the seed.
 */
export function seedRefusal(env: Record<string, string | undefined> = process.env): string | null {
  if (isExplicitDevOrTest(env)) return null;
  const nodeEnv = (env.NODE_ENV ?? '').trim();
  const which = nodeEnv ? `NODE_ENV=${nodeEnv}` : 'NODE_ENV is not set';
  return `Seed refuses: ${which}. The seed runs only with NODE_ENV=development or test — it creates demo accounts with known passwords and test data; never run it on a production database.`;
}

/** Called as the seed's first statement: outside development/test it ends the process with exit code 1. */
export function refuseSeedOutsideDevOrTest(env: Record<string, string | undefined> = process.env): void {
  const reason = seedRefusal(env);
  if (reason) {
    console.error(`❌ ${reason}`);
    process.exit(1);
  }
}
