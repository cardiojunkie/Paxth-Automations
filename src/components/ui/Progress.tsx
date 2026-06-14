import React from 'react';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value: number;
}

export function Progress({ value, className = '', ...props }: ProgressProps) {
  const boundedValue = Math.max(0, Math.min(100, value));
  return (
    <div
      className={['h-2 overflow-hidden rounded-full bg-white/8', className].join(' ')}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={boundedValue}
      {...props}
    >
      <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${boundedValue}%` }} />
    </div>
  );
}
