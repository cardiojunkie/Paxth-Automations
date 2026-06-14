import React from 'react';

type BadgeTone = 'neutral' | 'blue' | 'green' | 'amber' | 'red';

const toneClasses: Record<BadgeTone, string> = {
  neutral: 'border-white/10 bg-white/6 text-white/70',
  blue: 'border-blue-500/25 bg-blue-500/10 text-blue-200',
  green: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200',
  amber: 'border-amber-500/25 bg-amber-500/10 text-amber-200',
  red: 'border-red-500/25 bg-red-500/10 text-red-200',
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = 'neutral', className = '', ...props }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider',
        toneClasses[tone],
        className,
      ].join(' ')}
      {...props}
    />
  );
}
