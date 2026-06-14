import React from 'react';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  wrapperClassName?: string;
  helpText?: React.ReactNode;
  error?: React.ReactNode;
}

export function Textarea({ label, className = '', wrapperClassName = '', id, helpText, error, ...props }: TextareaProps) {
  const generatedId = React.useId();
  const textareaId = id || props.name || generatedId;
  const describedBy = [
    props['aria-describedby'],
    helpText ? `${textareaId}-help` : null,
    error ? `${textareaId}-error` : null,
  ].filter(Boolean).join(' ') || undefined;

  return (
    <div className={['block space-y-2', wrapperClassName].join(' ')}>
      {label ? (
        <label htmlFor={textareaId} className="text-[10px] font-bold uppercase tracking-widest text-white/55">
          {label}
        </label>
      ) : null}
      <textarea
        id={textareaId}
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
      {helpText ? <p id={`${textareaId}-help`} className="text-[11px] leading-relaxed text-white/38">{helpText}</p> : null}
      {error ? <p id={`${textareaId}-error`} className="text-[11px] font-medium leading-relaxed text-red-300">{error}</p> : null}
    </div>
  );
}
