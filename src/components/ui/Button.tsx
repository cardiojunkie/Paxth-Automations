import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm disabled:bg-stone-200 disabled:text-slate-500',
  secondary: 'border border-stone-300 bg-white text-slate-700 hover:bg-stone-50 shadow-sm disabled:bg-stone-100 disabled:text-slate-500',
  ghost: 'bg-transparent text-slate-600 hover:bg-stone-100 hover:text-slate-950 disabled:text-slate-400',
  danger: 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:bg-red-50 disabled:text-red-700',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-5 text-sm',
  icon: 'h-10 w-10 p-0',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={[
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-2 focus:ring-offset-brand-bg',
        'disabled:pointer-events-none disabled:opacity-75',
        variantClasses[variant],
        sizeClasses[size],
        className,
      ].join(' ')}
      {...props}
    />
  );
}
