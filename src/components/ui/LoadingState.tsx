import React from 'react';
import { Loader2 } from 'lucide-react';

export interface LoadingStateProps {
  label?: string;
  className?: string;
}

export function LoadingState({ label = 'Loading', className = '' }: LoadingStateProps) {
  return (
    <div className={['flex items-center justify-center gap-3 text-sm text-white/55', className].join(' ')}>
      <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
      <span>{label}</span>
    </div>
  );
}
