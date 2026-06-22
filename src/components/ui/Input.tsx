import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  wrapperClassName?: string;
  helpText?: React.ReactNode;
  error?: React.ReactNode;
}

export function Input({ label, className = '', wrapperClassName = '', id, helpText, error, ...props }: InputProps) {
  const generatedId = React.useId();
  const inputId = id || props.name || generatedId;
  const describedBy = [
    props['aria-describedby'],
    helpText ? `${inputId}-help` : null,
    error ? `${inputId}-error` : null,
  ].filter(Boolean).join(' ') || undefined;

  return (
    <div className={['block space-y-2', wrapperClassName].join(' ')}>
      {label ? (
        <label htmlFor={inputId} className="text-sm font-medium text-slate-700">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={describedBy}
        className={[
          'w-full rounded-lg border border-[var(--paxio-border)] bg-[var(--paxio-surface)] px-3 py-2.5 text-sm text-slate-900 outline-none transition-colors',
          'placeholder:text-slate-500 focus:border-[var(--paxio-primary)] focus:ring-2 focus:ring-[var(--paxio-accent)]/30',
          'disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-slate-600',
          error ? 'border-red-300 focus:border-red-500 focus:ring-red-100' : '',
          className,
        ].join(' ')}
        {...props}
      />
      {helpText ? <p id={`${inputId}-help`} className="text-xs leading-relaxed text-slate-500">{helpText}</p> : null}
      {error ? <p id={`${inputId}-error`} className="text-xs font-medium leading-relaxed text-red-600">{error}</p> : null}
    </div>
  );
}
