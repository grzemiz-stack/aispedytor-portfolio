/**
 * The runtime environment — what is on without its own flag.
 *
 * Only an EXPLICIT `NODE_ENV=development` or `test`. No NODE_ENV, an empty one
 * or any other name (production, staging, prod…) counts as production: a
 * server nobody set an environment for must not be open. Jest sets
 * `NODE_ENV=test` itself when the variable is empty.
 */
export function isExplicitDevOrTest(env: Record<string, string | undefined>): boolean {
  const nodeEnv = (env.NODE_ENV ?? '').trim().toLowerCase();
  return nodeEnv === 'development' || nodeEnv === 'test';
}

/** A turning-on flag: only `true` (any case); `1`, `yes` and the like are not. */
export function flagOn(value: string | undefined): boolean {
  return (value ?? '').trim().toLowerCase() === 'true';
}
