'use client';

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  limit: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

export default function Pagination({ page, totalPages, total, limit, onPageChange, onLimitChange }: PaginationProps) {
  // Generate page numbers to show (max 5 around current)
  const pages: number[] = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  for (let i = start; i <= end; i++) pages.push(i);

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mt-4 px-1">
      <div className="text-sm text-gray-500">
        Strona {page} z {totalPages} ({total} wyników)
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={limit}
          onChange={(e) => onLimitChange(parseInt(e.target.value))}
          className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {[10, 20, 50, 100].map((n) => (
            <option key={n} value={n}>{n} / strona</option>
          ))}
        </select>

        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Poprzednia
          </button>

          {start > 1 && (
            <>
              <button onClick={() => onPageChange(1)} className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 hover:bg-gray-50 transition">1</button>
              {start > 2 && <span className="text-gray-400 px-1">...</span>}
            </>
          )}

          {pages.map((p) => (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                p === page
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'border-gray-300 hover:bg-gray-50'
              }`}
            >
              {p}
            </button>
          ))}

          {end < totalPages && (
            <>
              {end < totalPages - 1 && <span className="text-gray-400 px-1">...</span>}
              <button onClick={() => onPageChange(totalPages)} className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 hover:bg-gray-50 transition">{totalPages}</button>
            </>
          )}

          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Następna
          </button>
        </div>
      </div>
    </div>
  );
}
