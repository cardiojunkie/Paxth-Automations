import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
}

export function Card({ className = '', padded = true, ...props }: CardProps) {
  return (
    <div
      className={[
        'rounded-lg border border-white/10 bg-zinc-950/70 shadow-xl shadow-black/20',
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
  return <h3 className={['text-sm font-semibold text-white', className].join(' ')} {...props} />;
}
