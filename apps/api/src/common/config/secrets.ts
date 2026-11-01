/**
 * Application secrets — no fallback values (docs/decisions.md §8).
 *
 * A missing JWT_SECRET or ENCRYPTION_KEY, or a known unsafe value (including
 * the placeholders once shipped in .env.example, the old `fallback-secret`
 * and an all-zero key), means the application does not start. A fallback in
 * the code would let anyone who has seen the repository forge tokens or
 * decrypt the data.
 */

/** JWT HS256: at least 32 random characters. */
const JWT_MIN_LENGTH = 32;
/** Values known from the code or from .env.example — never a secret. */
const KNOWN_PLACEHOLDERS = [/^fallback-secret$/i, /^change-this/i, /^changeme/i, /^secret$/i];

export function jwtSecretProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return 'JWT_SECRET is not set';
  if (KNOWN_PLACEHOLDERS.some(re => re.test(value))) return 'JWT_SECRET is a placeholder value, not a secret';
  if (value.length < JWT_MIN_LENGTH) return `JWT_SECRET is shorter than ${JWT_MIN_LENGTH} characters`;
  return null;
}

export function encryptionKeyProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return 'ENCRYPTION_KEY is not set';
  if (!/^[0-9a-fA-F]{64}$/.test(value)) return 'ENCRYPTION_KEY must be 64 hexadecimal characters (32 bytes)';
  if (/^0+$/.test(value)) return 'ENCRYPTION_KEY made of zeros only is not a key';
  return null;
}

/** All problems at once — the operator sees the full list, not just the first error. */
export function secretProblems(env: Record<string, unknown>): string[] {
  return [jwtSecretProblem(env.JWT_SECRET), encryptionKeyProblem(env.ENCRYPTION_KEY)].filter(
    (p): p is string => p !== null,
  );
}

const HOW_TO =
  'Generate: JWT_SECRET=$(openssl rand -base64 48), ENCRYPTION_KEY=$(openssl rand -hex 32). ' +
  'Note: changing ENCRYPTION_KEY on an existing database makes the encrypted data unreadable.';

/** `ConfigModule.forRoot({ validate })` — an exception here = the application does not start. */
export function validateEnv(env: Record<string, unknown>): Record<string, unknown> {
  const problems = secretProblems(env);
  if (problems.length > 0) {
    throw new Error(`Unsafe configuration — the application does not start:\n- ${problems.join('\n- ')}\n${HOW_TO}`);
  }
  return env;
}

/** Checked read — the same rule outside ConfigModule (seed, services). */
export function requireJwtSecret(value: unknown): string {
  const p = jwtSecretProblem(value);
  if (p) throw new Error(`${p}. ${HOW_TO}`);
  return value as string;
}

export function requireEncryptionKey(value: unknown): Buffer {
  const p = encryptionKeyProblem(value);
  if (p) throw new Error(`${p}. ${HOW_TO}`);
  return Buffer.from(value as string, 'hex');
}
