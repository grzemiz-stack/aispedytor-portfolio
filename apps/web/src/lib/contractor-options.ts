/**
 * Contractors to choose in the offer form (decisions §3b).
 *
 * `GET /contractors` is paginated (at most 100 per page) — every page is read
 * so a contractor past the first hundred does not vanish from the list. Active
 * ones only; a blacklisted contractor stays on the list, marked (an offer
 * from it is real — the block works when accepting).
 */
export interface ContractorOption {
  id: string;
  name: string;
  isBlacklisted: boolean;
}

type Page = { data: Array<{ id: string; name: string; isActive?: boolean; isBlacklisted?: boolean }>; totalPages?: number };

const PAGE_LIMIT = 100;
/** A safety limit: at most 50 pages (5000 contractors). */
const MAX_PAGES = 50;

export async function loadContractorOptions(getPage: (page: number, limit: number) => Promise<Page>): Promise<ContractorOption[]> {
  const out: ContractorOption[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await getPage(page, PAGE_LIMIT);
    for (const c of r.data) {
      if (c.isActive === false) continue;
      out.push({ id: c.id, name: c.name, isBlacklisted: c.isBlacklisted === true });
    }
    if (!r.totalPages || page >= r.totalPages) break;
  }
  return out;
}

export function contractorOptionLabel(c: ContractorOption): string {
  return c.isBlacklisted ? `${c.name} — czarna lista` : c.name;
}
