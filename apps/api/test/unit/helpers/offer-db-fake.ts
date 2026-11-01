/**
 * A fake offer table that COMPUTES like the database: `where` filters (equality,
 * `{ not: null }`, `{ gte, lt }`, `{ startsWith }`, `{ in }`; any other operator throws), `aggregate` (_sum, _avg,
 * _min, _max, _count), `groupBy` (by, _count, _avg, orderBy _count desc,
 * take), `count`, `findMany` (select, orderBy createdAt desc, take).
 * Only as much as the dashboard (offers.getStats) and analytics use — so that
 * tests pin down the numbers, not the calls.
 */
export type OfferRow = Record<string, any>;

function matches(row: OfferRow, where: Record<string, any> = {}): boolean {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond === undefined) return true;
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('not' in cond && cond.not === null && (v === null || v === undefined)) return false;
      if ('gte' in cond && !(v >= cond.gte)) return false;
      if ('lt' in cond && !(v < cond.lt)) return false;
      if ('startsWith' in cond && !(typeof v === 'string' && v.startsWith(cond.startsWith))) return false;
      if ('in' in cond && !cond.in.includes(v)) return false;
      // An operator this fake does not know would match everything — fail loudly instead.
      const unknown = Object.keys(cond).filter((op) => !['not', 'gte', 'lt', 'startsWith', 'in'].includes(op));
      if (unknown.length > 0) throw new Error(`offerDbFake: unsupported where operator ${unknown.join(', ')} on ${k}`);
      return true;
    }
    return v === cond;
  });
}

const num = (v: any) => (v === null || v === undefined ? null : Number(v));

function agg(rows: OfferRow[], spec: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const op of ['_sum', '_avg', '_min', '_max']) {
    if (!spec[op]) continue;
    out[op] = {};
    for (const field of Object.keys(spec[op])) {
      const vals = rows.map(r => num(r[field])).filter((v): v is number => v !== null);
      out[op][field] = vals.length === 0 ? null
        : op === '_sum' ? vals.reduce((a, b) => a + b, 0)
        : op === '_avg' ? vals.reduce((a, b) => a + b, 0) / vals.length
        : op === '_min' ? Math.min(...vals) : Math.max(...vals);
    }
  }
  if (spec._count) {
    out._count = spec._count === true ? rows.length
      : Object.fromEntries(Object.keys(spec._count).map(f => [f, rows.filter(r => f === 'id' || num(r[f]) !== null).length]));
  }
  return out;
}

export function offerDbFake(offers: OfferRow[], companies: OfferRow[] = []) {
  const prisma: any = {
    company: {
      findUnique: jest.fn(async ({ where }: any) => companies.find(c => c.id === where.id) ?? null),
    },
    offer: {
      count: jest.fn(async ({ where }: any = {}) => offers.filter(r => matches(r, where)).length),
      aggregate: jest.fn(async ({ where, ...spec }: any) => agg(offers.filter(r => matches(r, where)), spec)),
      groupBy: jest.fn(async ({ by, where, orderBy, take, ...spec }: any) => {
        const groups = new Map<string, OfferRow[]>();
        for (const r of offers.filter(x => matches(x, where))) {
          const key = JSON.stringify(by.map((b: string) => r[b]));
          groups.set(key, [...(groups.get(key) ?? []), r]);
        }
        let out = [...groups.entries()].map(([key, rows]) => ({
          ...Object.fromEntries(by.map((b: string, i: number) => [b, JSON.parse(key)[i]])),
          ...agg(rows, spec),
        }));
        if (orderBy?._count?.id === 'desc') out = out.sort((a: any, b: any) => (b._count.id ?? b._count) - (a._count.id ?? a._count));
        return take ? out.slice(0, take) : out;
      }),
      findMany: jest.fn(async ({ where, select, orderBy, take }: any = {}) => {
        let rows = offers.filter(r => matches(r, where));
        if (orderBy?.createdAt === 'desc') rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
        if (take) rows = rows.slice(0, take);
        return select ? rows.map(r => Object.fromEntries(Object.keys(select).map(k => [k, r[k]]))) : rows;
      }),
      findFirst: jest.fn(async ({ where, orderBy }: any = {}) => {
        let rows = offers.filter(r => matches(r, where));
        if (orderBy?.createdAt === 'desc') rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
        return rows[0] ?? null;
      }),
    },
  };
  return prisma;
}
