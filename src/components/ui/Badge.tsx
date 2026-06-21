import React from 'react';

type BadgeTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'border-stone-200 bg-stone-50 text-slate-700',
  blue: 'border-blue-200 bg-blue-50 text-blue-800',
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  red: 'border-red-200 bg-red-50 text-red-800',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'neutral', className = '', ...props }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        toneClasses[tone],
        className,
      ].join(' ')}
      {...props}
    />
  );
}
