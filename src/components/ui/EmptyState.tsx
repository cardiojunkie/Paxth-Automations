import React from 'react';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div
      className={[
        'flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-white/10 p-8 text-center',
        className,
      ].join(' ')}
    >
      {icon ? <div className="mb-4 text-white/25">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-white/80">{title}</h3>
      {description ? <p className="mt-2 max-w-sm text-xs leading-relaxed text-white/40">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
