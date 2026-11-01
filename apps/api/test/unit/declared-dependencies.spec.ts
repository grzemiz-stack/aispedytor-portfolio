/**
 * Every package the API code imports is declared in apps/api/package.json
 * (audit C2: `body-parser` and `dotenv` worked only through hoisting from the
 * workspace root — a different install layout would break the start or the
 * seed).
 *
 * src/ — runtime imports need `dependencies`; prisma/ (seed) and type-only
 * imports may come from `devDependencies`; a type-only import is satisfied by
 * the package or by its `@types/` package. Node built-ins are skipped.
 */
import { builtinModules } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const API = resolve(__dirname, '../..');
const pkg = JSON.parse(readFileSync(join(API, 'package.json'), 'utf8'));
const deps = new Set(Object.keys(pkg.dependencies ?? {}));
const allDeps = new Set([...deps, ...Object.keys(pkg.devDependencies ?? {})]);
const builtins = new Set(builtinModules);

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'migrations' ? [] : files(p);
    return /\.ts$/.test(e.name) && !/\.spec\.ts$/.test(e.name) ? [p] : [];
  });
}

/** Package name of a bare import: `@scope/name/sub` → `@scope/name`, `name/sub` → `name`. */
const packageOf = (spec: string) => (spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]);
const typesPackage = (name: string) => `@types/${name.startsWith('@') ? name.slice(1).replace('/', '__') : name}`;

interface Found { file: string; name: string; typeOnly: boolean }

function imports(file: string): Found[] {
  const code = readFileSync(file, 'utf8');
  const out: Found[] = [];
  for (const m of code.matchAll(/^\s*import\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/gm)) {
    const spec = m[2] ?? m[3] ?? m[4];
    if (!spec || spec.startsWith('.') || spec.startsWith('node:') || builtins.has(packageOf(spec))) continue;
    out.push({ file: relative(API, file), name: packageOf(spec), typeOnly: Boolean(m[1]) });
  }
  return out;
}

function undeclared(dirs: string[], runtimeNeeds: Set<string>): string[] {
  return dirs.flatMap((d) => files(join(API, d))).flatMap(imports)
    .filter(({ name, typeOnly }) => (typeOnly ? !allDeps.has(name) && !allDeps.has(typesPackage(name)) : !runtimeNeeds.has(name)))
    .map(({ file, name }) => `${file}: ${name}`);
}

it('src/: every runtime import is in dependencies, every type import declared', () => {
  expect(undeclared(['src'], deps)).toEqual([]);
});

it('prisma/ (seed): every import is declared', () => {
  expect(undeclared(['prisma'], allDeps)).toEqual([]);
});

it('the scan finds imports at all (body-parser in src/, dotenv in prisma/)', () => {
  const names = ['src', 'prisma'].flatMap((d) => files(join(API, d))).flatMap(imports).map((f) => f.name);
  expect(names).toEqual(expect.arrayContaining(['body-parser', 'dotenv', '@nestjs/common', '@prisma/client']));
});
