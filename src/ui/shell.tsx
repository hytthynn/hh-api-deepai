'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { apiSend } from './api';
import { fmtDuration } from './format';
import { Icon, type IconName } from './icons';
import { useApi } from './use-api';
import type { HealthResponse } from './types';

type NavItem = { href: string; label: string; icon: IconName; key: string };

export const NAV: NavItem[] = [
  { href: '/', label: 'Обзор', icon: 'overview', key: 'o' },
  { href: '/accounts', label: 'Аккаунты', icon: 'accounts', key: 'a' },
  { href: '/keys', label: 'Ключи', icon: 'keys', key: 'k' },
  { href: '/models', label: 'Модели', icon: 'models', key: 'm' },
  { href: '/logs', label: 'Логи', icon: 'logs', key: 'l' },
  { href: '/stats', label: 'Статистика', icon: 'stats', key: 's' },
  { href: '/settings', label: 'Настройки', icon: 'settings', key: 't' },
];

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const health = useApi<HealthResponse>('/healthz', { intervalMs: 15_000 });
  const pendingG = useRef(0);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape') {
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }
      if (isEditable(event.target)) return;
      if (event.key === '/') {
        const search = document.querySelector<HTMLInputElement>('[data-search]');
        if (search) {
          event.preventDefault();
          search.focus();
          search.select();
        }
        return;
      }
      if (event.key === 'g') {
        pendingG.current = Date.now();
        return;
      }
      if (Date.now() - pendingG.current < 900) {
        const item = NAV.find((entry) => entry.key === event.key.toLowerCase());
        if (item) {
          pendingG.current = 0;
          router.push(item.href);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router]);

  const down = health.error !== null;
  const uptime = health.data?.uptime_sec;
  const statusText = down
    ? 'шлюз недоступен'
    : health.data?.status === 'degraded'
      ? 'шлюз ограничен'
      : 'шлюз работает';

  const logout = async (): Promise<void> => {
    try {
      await apiSend('/api/auth/logout', 'POST');
    } finally {
      router.replace('/login');
      router.refresh();
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-mark" />
          hh-api
        </div>
        <nav className="nav" aria-label="Разделы">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={`nav-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
                <span className="nav-icon">
                  <Icon name={item.icon} size={16} />
                </span>
                {item.label}
                <span className="nav-key">{item.key}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="gateway">
            <span className={`dot${down ? ' bad' : health.data?.status === 'degraded' ? ' warn' : ''}`} />
            <span>{statusText}</span>
          </div>
          {uptime !== undefined ? (
            <div className="small faint mono">uptime {fmtDuration(uptime * 1000)}</div>
          ) : null}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void logout()} style={{ justifyContent: 'flex-start' }}>
            <Icon name="logout" size={14} />
            Выйти
          </button>
        </div>
      </aside>
      <div className="main">{children}</div>
    </div>
  );
}

export function Page({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <header className="header">
        <div className="row" style={{ gap: 12 }}>
          <h1>{title}</h1>
          {subtitle ? <span className="small faint">{subtitle}</span> : null}
        </div>
        {actions ? <div className="header-side">{actions}</div> : null}
      </header>
      <div className="content">{children}</div>
    </>
  );
}

export function useNav(): NavItem[] {
  return NAV;
}