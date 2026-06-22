import React, { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { LogOut, Menu, X } from 'lucide-react';
import { Button } from '../ui/Button';

export interface AppShellNavItem<T extends string = string> {
  id: T;
  label: string;
  description?: string;
  icon: LucideIcon;
}

export interface AppShellProps<T extends string = string> {
  productName: string;
  versionLabel?: string;
  logoSrc?: string;
  activeNavId: T;
  navItems: AppShellNavItem<T>[];
  onNavChange: (id: T) => void;
  title: string;
  subtitle?: string;
  statusItems?: React.ReactNode;
  userEmail: string;
  userRole: string;
  onLogout: () => void;
  children: React.ReactNode;
}

export function AppShell<T extends string = string>({
  productName,
  versionLabel,
  logoSrc,
  activeNavId,
  navItems,
  onNavChange,
  title,
  subtitle,
  statusItems,
  userEmail,
  userRole,
  onLogout,
  children,
}: AppShellProps<T>) {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  const nav = (
    <nav className="flex flex-col gap-1.5 px-3 py-4">
      {navItems.map((item) => {
        const Icon = item.icon;
        const active = item.id === activeNavId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              onNavChange(item.id);
              setIsMobileNavOpen(false);
            }}
            className={[
              'group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors',
              active
                ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100 shadow-sm'
                : 'text-slate-600 hover:bg-white/70 hover:text-slate-950',
            ].join(' ')}
            title={item.label}
          >
            <span className={['flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', active ? 'bg-white/70' : 'bg-transparent'].join(' ')}>
              <Icon className={['h-4 w-4 shrink-0', active ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'].join(' ')} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{item.label}</span>
              {item.description ? (
                <span className={['block truncate text-xs', active ? 'text-blue-600/70' : 'text-slate-400'].join(' ')}>
                  {item.description}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="h-screen overflow-hidden bg-brand-bg text-slate-800">
      <div className="flex h-full min-h-0">
        <aside className="hidden w-64 shrink-0 border-r border-stone-200 bg-[var(--paxio-surface-glass)] shadow-[var(--paxio-shadow-soft)] backdrop-blur-xl lg:flex lg:flex-col">
          <div className="flex min-h-20 items-center gap-3 border-b border-stone-200 bg-white/45 px-4">
            {logoSrc ? (
              <div className="flex h-12 w-40 items-center justify-start overflow-hidden rounded-xl border border-stone-200 bg-white/80 px-2.5 shadow-sm">
                <img src={logoSrc} alt={`${productName} logo`} className="h-full w-full object-contain" />
              </div>
            ) : null}
            <div className="min-w-0 flex-1">
              {!logoSrc ? <div className="truncate text-sm font-semibold tracking-tight text-slate-950">{productName}</div> : null}
              {versionLabel ? <div className="mt-1 text-xs font-medium text-slate-500">{versionLabel}</div> : null}
            </div>
          </div>
          {nav}
        </aside>

        {isMobileNavOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm"
              aria-label="Close navigation"
              onClick={() => setIsMobileNavOpen(false)}
            />
            <aside className="relative flex h-full w-72 flex-col border-r border-stone-200 bg-[var(--paxio-surface)] shadow-2xl">
              <div className="flex min-h-20 items-center justify-between border-b border-stone-200 px-4">
                {logoSrc ? (
                  <img src={logoSrc} alt={`${productName} logo`} className="h-11 w-36 object-contain" />
                ) : (
                  <span className="text-sm font-semibold text-slate-950">{productName}</span>
                )}
                <Button variant="ghost" size="icon" onClick={() => setIsMobileNavOpen(false)} aria-label="Close navigation">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {nav}
            </aside>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-stone-200 bg-[var(--paxio-surface-glass)] px-4 shadow-sm backdrop-blur-xl sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setIsMobileNavOpen(true)} className="lg:hidden" aria-label="Open navigation">
                <Menu className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold tracking-tight text-slate-900 sm:text-lg">{title}</h1>
                {subtitle ? <p className="truncate text-sm text-slate-500">{subtitle}</p> : null}
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-3">
              {statusItems ? <div className="hidden items-center gap-2 xl:flex">{statusItems}</div> : null}
              <div className="hidden min-w-0 text-right md:block">
                <div className="truncate text-sm text-slate-700">{userEmail}</div>
                <div className="text-xs font-medium capitalize text-slate-500">{userRole}</div>
              </div>
              <Button variant="secondary" size="sm" onClick={onLogout} title="End current session and sign in as another user" className="bg-white/80">
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Logout</span>
              </Button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        </div>
      </div>
    </div>
  );
}
