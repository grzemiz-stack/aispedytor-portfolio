/**
 * No error disappears silently.
 *
 * An empty `catch {}` / `.catch(() => {})` / `.catch(() => ({ data: [] }))`
 * turns an error into an empty screen: "no data" instead of "could not load",
 * a button that does nothing, a load plan that does not recalculate. Every
 * error gets a sentence for the user (usually apiErrorText).
 *
 * The only exception comes with a reason: a comment "celowo bez komunikatu: …"
 * ("no message on purpose") on one of the two lines above the block.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SRC = resolve(__dirname, '..');
const MARK = 'celowo bez komunikatu';

const SILENT = [
  /catch\s*(\([^)]*\))?\s*\{\s*\}/g,                 // catch {} / catch (e) {}
  /catch\s*(\([^)]*\))?\s*\{\s*\/\/[^\n]*\n\s*\}/g, // catch { // ignore }
  /catch\s*(\([^)]*\))?\s*\{\s*\/\*[^]*?\*\/\s*\}/g, // catch { /* … */ }
  /\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*\{\s*\}\s*\)/g,  // .catch(() => {})
  /\.catch\(\s*\(\s*\)\s*=>\s*\(\s*\{\s*data\b/g,    // .catch(() => ({ data: [] }))
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

function silentCatches(source: string): number[] {
  const lines: number[] = [];
  for (const re of SILENT) {
    for (const m of Array.from(source.matchAll(re))) {
      const line = source.slice(0, m.index).split('\n').length;
      const above = source.split('\n').slice(Math.max(0, line - 3), line).join('\n');
      if (!above.includes(MARK)) lines.push(line);
    }
  }
  return lines;
}

it('the detector sees each silent form and respects the reason marker', () => {
  expect(silentCatches('try { x(); } catch {}')).toHaveLength(1);
  expect(silentCatches('try { x(); } catch (e) {}')).toHaveLength(1);
  expect(silentCatches('try { x(); } catch {\n  // ignore\n}')).toHaveLength(1);
  expect(silentCatches('p.catch(() => {})')).toHaveLength(1);
  expect(silentCatches('p.catch(() => ({ data: [] }))')).toHaveLength(1);
  expect(silentCatches('p.catch((err) => setError(apiErrorText(err)))')).toHaveLength(0);
  expect(silentCatches(`// ${MARK}: powód\np.catch(() => {})`)).toHaveLength(0);
});

it('no silent catch in app/ and components/ without a stated reason', () => {
  const hits = [...files(join(SRC, 'app')), ...files(join(SRC, 'components'))].flatMap(f =>
    silentCatches(readFileSync(f, 'utf8')).map(line => `${relative(SRC, f)}:${line}`),
  );
  expect(hits).toEqual([]);
});

const read = (f: string) => readFileSync(join(SRC, f), 'utf8');
const between = (src: string, from: string, to: string) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

it('list loads, the active toggle, notes, star and status change show their errors', () => {
  expect(between(read('app/(dashboard)/contractors/page.tsx'), 'const load = useCallback', '}, [page')).toMatch(/\.catch\(\(err\) => setLoadError\(/);
  expect(between(read('app/(dashboard)/fleet/page.tsx'), 'const load = useCallback', '}, [page')).toMatch(/\.catch\(\(err\) => setLoadError\(/);
  expect(between(read('app/(dashboard)/contractors/[id]/page.tsx'), 'async function toggleActive', 'finally')).toMatch(/setToggleError\(apiErrorText\(/);
  const email = read('app/(dashboard)/email/page.tsx');
  expect(between(email, 'async function handleSaveNotes', 'finally')).toMatch(/setActionError\(apiErrorText\(/);
  expect(between(email, 'async function handleStar', 'return (')).toMatch(/setActionError\(apiErrorText\(/);
  expect(between(read('app/(dashboard)/offers/page.tsx'), 'async function handleStatusChange', 'async function handleAiScore')).toMatch(/setActionError\(apiErrorText\(/);
});

it('every error state set is also rendered', () => {
  const pairs: [string, string][] = [
    ['app/(dashboard)/ltl-matching/page.tsx', 'loadPlanError'],
    ['app/(dashboard)/offers/page.tsx', 'actionError'],
    ['app/(dashboard)/settings/page.tsx', 'loadError'],
    ['app/(dashboard)/settings/page.tsx', 'integrationsError'],
    ['app/(dashboard)/email/page.tsx', 'pageError'],
    ['app/(dashboard)/email/page.tsx', 'actionError'],
    ['app/(dashboard)/analytics/page.tsx', 'loadError'],
    ['app/(dashboard)/contractors/page.tsx', 'loadError'],
    ['app/(dashboard)/contractors/[id]/page.tsx', 'toggleError'],
    ['app/(dashboard)/fleet/page.tsx', 'loadError'],
    ['app/(dashboard)/offers/new/page.tsx', 'statsError'],
    ['app/(dashboard)/page.tsx', 'failedSections'],
    ['components/negotiation-panel.tsx', 'actionError'],
  ];
  for (const [f, state] of pairs) {
    expect([f, state, new RegExp(`\\{[^}]*\\b${state}\\b[^}]*&&`).test(read(f))]).toEqual([f, state, true]);
  }
});

it('route planner: a geocoding failure is not reported as "not found", an unknown waypoint is not dropped', () => {
  const src = read('app/(dashboard)/route-planner/page.tsx');
  const geocode = between(src, 'async function geocode', '\n}\n');
  expect(geocode).not.toMatch(/catch/);
  expect(geocode).toMatch(/if \(!res\.ok\) throw/);
  expect(src).toMatch(/Nie znaleziono punktu pośredniego/);
});
