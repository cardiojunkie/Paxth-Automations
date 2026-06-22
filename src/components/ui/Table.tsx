import React from 'react';

export function TableContainer({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={['w-full overflow-x-auto rounded-xl border border-stone-200 bg-[var(--paxio-surface-glass)] shadow-[var(--paxio-shadow-soft)] backdrop-blur-sm custom-scrollbar', className].join(' ')}
      {...props}
    />
  );
}

export function Table({ className = '', ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={['w-full min-w-max border-collapse text-left text-sm text-slate-800', className].join(' ')} {...props} />;
}

export function TableHead({ className = '', ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={['sticky top-0 z-10 border-b border-[var(--paxio-border)] bg-[var(--paxio-bg-soft)] text-slate-600', className].join(' ')} {...props} />;
}

export function TableBody({ className = '', ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={['divide-y divide-stone-100', className].join(' ')} {...props} />;
}

export function TableRow({ className = '', ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={['transition-colors hover:bg-[var(--paxio-bg-soft)]', className].join(' ')} {...props} />;
}

export function TableCell({ className = '', ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={['px-4 py-3 align-middle', className].join(' ')} {...props} />;
}

export function TableHeaderCell({ className = '', ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={['px-4 py-3 text-xs font-semibold', className].join(' ')}
      {...props}
    />
  );
}
