import React from 'react';

type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const toneClasses: Record<AlertTone, string> = {
  info: 'border-blue-500/20 bg-blue-500/10 text-blue-100',
  success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100',
  warning: 'border-amber-500/20 bg-amber-500/10 text-amber-100',
  danger: 'border-red-500/20 bg-red-500/10 text-red-100',
};

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: AlertTone;
}

export function Alert({ tone = 'info', className = '', ...props }: AlertProps) {
  return (
    <div
      className={['rounded-lg border px-4 py-3 text-sm leading-relaxed', toneClasses[tone], className].join(' ')}
      role={tone === 'danger' ? 'alert' : 'status'}
      {...props}
    />
  );
}
