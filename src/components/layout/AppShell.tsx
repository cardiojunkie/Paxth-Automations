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
              'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
              active ? 'bg-blue-600 text-white shadow-lg shadow-blue-950/35' : 'text-white/55 hover:bg-white/7 hover:text-white',
            ].join(' ')}
            title={item.label}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold">{item.label}</span>
              {item.description ? (
                <span className={['block truncate text-[10px]', active ? 'text-blue-100/70' : 'text-white/30'].join(' ')}>
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
    <div className="h-screen overflow-hidden bg-brand-bg text-white">
      <div className="flex h-full min-h-0">
        <aside className="hidden w-64 shrink-0 border-r border-white/10 bg-zinc-950/80 lg:flex lg:flex-col">
          <div className="flex h-16 items-center gap-3 border-b border-white/10 px-4">
            {logoSrc ? (
              <div className="flex h-9 w-12 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black">
                <img src={logoSrc} alt={`${productName} logo`} className="h-full w-full object-contain" />
              </div>
            ) : null}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold tracking-tight">{productName}</div>
              {versionLabel ? <div className="text-[10px] font-mono uppercase tracking-widest text-white/35">{versionLabel}</div> : null}
            </div>
          </div>
          {nav}
        </aside>

        {isMobileNavOpen ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <button
              type="button"
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              aria-label="Close navigation"
              onClick={() => setIsMobileNavOpen(false)}
            />
            <aside className="relative flex h-full w-72 flex-col border-r border-white/10 bg-zinc-950 shadow-2xl">
              <div className="flex h-16 items-center justify-between border-b border-white/10 px-4">
                <span className="text-sm font-semibold">{productName}</span>
                <Button variant="ghost" size="icon" onClick={() => setIsMobileNavOpen(false)} aria-label="Close navigation">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {nav}
            </aside>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-white/10 bg-zinc-950/70 px-4 backdrop-blur-xl sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setIsMobileNavOpen(true)} className="lg:hidden" aria-label="Open navigation">
                <Menu className="h-4 w-4" />
              </Button>
              <div className="min-w-0">
                <h1 className="truncate text-base font-semibold tracking-tight text-white sm:text-lg">{title}</h1>
                {subtitle ? <p className="truncate text-xs text-white/40">{subtitle}</p> : null}
              </div>
            </div>

            <div className="flex min-w-0 items-center gap-3">
              {statusItems ? <div className="hidden items-center gap-2 xl:flex">{statusItems}</div> : null}
              <div className="hidden min-w-0 text-right md:block">
                <div className="truncate text-xs text-white/80">{userEmail}</div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/35">{userRole}</div>
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
