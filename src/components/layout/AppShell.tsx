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
    <nav className="flex flex-col gap-1 px-3 py-4">
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
              'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
              active ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-100' : 'text-slate-600 hover:bg-stone-100 hover:text-slate-950',
            ].join(' ')}
            title={item.label}
          >
            <Icon className={['h-4 w-4 shrink-0', active ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'].join(' ')} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{item.label}</span>
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
        <aside className="hidden w-64 shrink-0 border-r border-stone-200 bg-white/90 lg:flex lg:flex-col">
          <div className="flex h-16 items-center gap-3 border-b border-stone-200 px-4">
            {logoSrc ? (
              <div className="flex h-9 w-12 items-center justify-center overflow-hidden rounded-lg border border-stone-200 bg-white">
                <img src={logoSrc} alt={`${productName} logo`} className="h-full w-full object-contain" />
              </div>
            ) : null}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold tracking-tight text-slate-950">{productName}</div>
              {versionLabel ? <div className="text-xs text-slate-400">{versionLabel}</div> : null}
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
            <aside className="relative flex h-full w-72 flex-col border-r border-stone-200 bg-white shadow-2xl">
              <div className="flex h-16 items-center justify-between border-b border-stone-200 px-4">
                <span className="text-sm font-semibold text-slate-950">{productName}</span>
                <Button variant="ghost" size="icon" onClick={() => setIsMobileNavOpen(false)} aria-label="Close navigation">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {nav}
            </aside>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-stone-200 bg-white/85 px-4 backdrop-blur-xl sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setIsMobileNavOpen(true)} className="lg:hidden" aria-label="Open navigation">
                <Menu className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold tracking-tight text-slate-950 sm:text-lg">{title}</h1>
                {subtitle ? <p className="truncate text-sm text-slate-500">{subtitle}</p> : null}
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-3">
              {statusItems ? <div className="hidden items-center gap-2 xl:flex">{statusItems}</div> : null}
              <div className="hidden min-w-0 text-right md:block">
                <div className="truncate text-sm text-slate-700">{userEmail}</div>
                <div className="text-xs font-medium capitalize text-slate-400">{userRole}</div>
              </div>
              <Button variant="secondary" size="sm" onClick={onLogout} title="End current session and sign in as another user">
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
