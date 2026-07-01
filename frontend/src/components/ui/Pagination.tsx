import { Button } from './Button';

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface PaginationProps {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  pageSizeOptions?: number[];
}

export function Pagination({
  meta,
  onPageChange,
  onLimitChange,
  pageSizeOptions = [10, 20, 50],
}: PaginationProps) {
  const { total, page, limit, totalPages } = meta;
  const start = total === 0 ? 0 : (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);

  if (total === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 border-t border-slate-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-slate-400">
        Showing {start}–{end} of {total}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {onLimitChange && (
          <label className="flex items-center gap-2 text-sm text-slate-400">
            Rows
            <select
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            className="px-3 py-1 text-xs"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          <span className="text-sm text-slate-400">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="secondary"
            className="px-3 py-1 text-xs"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
