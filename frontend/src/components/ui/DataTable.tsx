import { ReactNode, useMemo } from 'react';
import { Pagination, PaginationMeta } from './Pagination';
import { Table } from './Table';

interface DataTableProps {
  headers: string[];
  children: ReactNode;
  empty?: boolean;
  emptyMessage?: string;
  meta?: PaginationMeta;
  onPageChange?: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  pageSizeOptions?: number[];
}

export function DataTable({
  headers,
  children,
  empty,
  emptyMessage = 'No records found',
  meta,
  onPageChange,
  onLimitChange,
  pageSizeOptions,
}: DataTableProps) {
  if (empty) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 p-10 text-center text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-slate-800">
      <Table headers={headers} embedded>
        {children}
      </Table>
      {meta && onPageChange && (
        <Pagination
          meta={meta}
          onPageChange={onPageChange}
          onLimitChange={onLimitChange}
          pageSizeOptions={pageSizeOptions}
        />
      )}
    </div>
  );
}

interface ClientDataTableProps<T> {
  headers: string[];
  data: T[];
  page: number;
  limit: number;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  pageSizeOptions?: number[];
  emptyMessage?: string;
  rowKey: (item: T) => string;
  renderRow: (item: T) => ReactNode;
}

export function ClientDataTable<T>({
  headers,
  data,
  page,
  limit,
  onPageChange,
  onLimitChange,
  pageSizeOptions,
  emptyMessage,
  rowKey,
  renderRow,
}: ClientDataTableProps<T>) {
  const meta = useMemo<PaginationMeta>(() => {
    const total = data.length;
    return {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }, [data.length, page, limit]);

  const pageData = useMemo(() => {
    const start = (page - 1) * limit;
    return data.slice(start, start + limit);
  }, [data, page, limit]);

  return (
    <DataTable
      headers={headers}
      empty={data.length === 0}
      emptyMessage={emptyMessage}
      meta={meta}
      onPageChange={onPageChange}
      onLimitChange={onLimitChange}
      pageSizeOptions={pageSizeOptions}
    >
      {pageData.map((item) => (
        <tr key={rowKey(item)} className="text-slate-300">
          {renderRow(item)}
        </tr>
      ))}
    </DataTable>
  );
}
