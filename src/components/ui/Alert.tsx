import React from 'react';

type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const toneClasses: Record<AlertTone, string> = {
  info: 'border-blue-200 bg-blue-50 text-blue-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-red-900',
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
