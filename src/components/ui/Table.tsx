import React from 'react';

export function TableContainer({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={['w-full overflow-x-auto rounded-lg border border-white/10 bg-zinc-950/70 custom-scrollbar', className].join(' ')}
      {...props}
    />
  );
}

export function Table({ className = '', ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={['w-full min-w-max border-collapse text-left text-sm', className].join(' ')} {...props} />;
}

export function TableHead({ className = '', ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={['border-b border-white/10 bg-white/5 text-white/45', className].join(' ')} {...props} />;
}

export function TableBody({ className = '', ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={['divide-y divide-white/5', className].join(' ')} {...props} />;
}

export function TableRow({ className = '', ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={['transition-colors hover:bg-white/[0.03]', className].join(' ')} {...props} />;
}

export function TableCell({ className = '', ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={['px-4 py-3 align-middle', className].join(' ')} {...props} />;
}

export function TableHeaderCell({ className = '', ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={['px-4 py-3 text-[10px] font-bold uppercase tracking-widest', className].join(' ')}
      {...props}
    />
  );
}
