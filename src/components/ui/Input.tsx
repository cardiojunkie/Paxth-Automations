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
        <label htmlFor={inputId} className="text-[10px] font-bold uppercase tracking-widest text-white/55">
          {label}
        </label>
      ) : null}
      <input
        id={inputId}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={describedBy}
        className={[
          'w-full rounded-lg border border-white/10 bg-zinc-950/70 px-3 py-2.5 text-sm text-white outline-none transition-colors',
          'placeholder:text-white/25 focus:border-blue-500/60 focus:ring-2 focus:ring-blue-500/20',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error ? 'border-red-400/45 focus:border-red-400/70 focus:ring-red-500/20' : '',
          className,
        ].join(' ')}
        {...props}
      />
      {helpText ? <p id={`${inputId}-help`} className="text-[11px] leading-relaxed text-white/38">{helpText}</p> : null}
      {error ? <p id={`${inputId}-error`} className="text-[11px] font-medium leading-relaxed text-red-300">{error}</p> : null}
    </div>
  );
}
