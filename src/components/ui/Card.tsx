import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
}

export function Card({ className = '', padded = true, ...props }: CardProps) {
  return (
    <div
      className={[
        'rounded-lg border border-stone-200 bg-white text-slate-800 shadow-sm',
        padded ? 'p-5' : '',
        className,
      ].join(' ')}
      {...props}
    />
  );
}

export function CardHeader({ className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={['mb-4 flex items-start justify-between gap-4', className].join(' ')} {...props} />;
}

export function CardTitle({ className = '', ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={['text-sm font-semibold text-slate-950', className].join(' ')} {...props} />;
}
