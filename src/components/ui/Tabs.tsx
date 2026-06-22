import React from 'react';

export interface TabItem<T extends string = string> {
  id: T;
  label: string;
}

export interface TabsProps<T extends string = string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  ariaLabel?: string;
}

export function Tabs<T extends string = string>({ items, value, onChange, className = '', ariaLabel = 'Section tabs' }: TabsProps<T>) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex = index;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else return;

    event.preventDefault();
    onChange(items[nextIndex].id);
  };

  return (
    <div role="tablist" aria-label={ariaLabel} className={['inline-flex rounded-lg border border-[var(--paxio-border)] bg-[var(--paxio-bg-soft)] p-1', className].join(' ')}>
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={value === item.id}
          tabIndex={value === item.id ? 0 : -1}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
          className={[
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-[var(--paxio-accent)]/45 focus:ring-offset-2 focus:ring-offset-brand-bg',
            value === item.id ? 'bg-[var(--paxio-surface)] text-[var(--paxio-primary)] shadow-sm' : 'text-slate-600 hover:text-slate-900',
          ].join(' ')}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
