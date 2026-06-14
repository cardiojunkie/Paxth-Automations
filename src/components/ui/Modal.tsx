import React from 'react';
import { X } from 'lucide-react';
import { Button } from './Button';

export interface ModalProps {
  open: boolean;
  title?: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
  className?: string;
}

export function Modal({ open, title, description, children, footer, onClose, className = '' }: ModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <section
        className={[
          'flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-white/10 bg-zinc-950 shadow-2xl',
          className,
        ].join(' ')}
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div>
            {title ? <h2 className="text-sm font-semibold text-white">{title}</h2> : null}
            {description ? <p className="mt-1 text-xs text-white/45">{description}</p> : null}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close modal">
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 custom-scrollbar">{children}</div>
        {footer ? <footer className="border-t border-white/10 px-5 py-4">{footer}</footer> : null}
      </section>
    </div>
  );
}
