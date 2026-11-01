/**
 * The front end shows no login credentials.
 *
 * A login page that prints a demo login and password shows the seed ADMIN
 * password to anyone who opens the page. Developer account data stays in the
 * seed and the README, not in the interface.
 */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const SRC = resolve(__dirname, '..');

it('no seed password or admin login in the web source (outside tests)', () => {
  const hits = execSync(
    `grep -rnE "Admin1234|Disp1234|admin@spedytor\\.(pl|example\\.com)" --include=*.ts --include=*.tsx ${JSON.stringify(SRC)} || true`,
    { encoding: 'utf8' },
  ).split('\n').filter(l => l && !/\.test\.tsx?:/.test(l));
  expect(hits).toEqual([]);
});
