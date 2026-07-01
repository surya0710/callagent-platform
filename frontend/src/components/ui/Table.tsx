import { ReactNode } from 'react';

export function Table({
  headers,
  children,
  empty,
  embedded,
}: {
  headers: string[];
  children: ReactNode;
  empty?: boolean;
  embedded?: boolean;
}) {
  if (empty) {
    return (
      <div className="rounded-lg border border-dashed border-slate-700 p-10 text-center text-slate-400">
        No records found
      </div>
    );
  }

  return (
    <div
      className={`max-w-full overflow-x-auto ${embedded ? '' : 'rounded-lg border border-slate-800'}`}
    >
      <table className="w-full min-w-[960px] text-left text-sm">
        <thead className="bg-slate-900 text-slate-400">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">{children}</tbody>
      </table>
    </div>
  );
}

export function LoadingState() {
  return <div className="py-12 text-center text-slate-400">Loading...</div>;
}

export function ErrorState({ message }: { message: string }) {
  return <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-4 text-red-300">{message}</div>;
}
