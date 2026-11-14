'use client';

import { useEffect, useMemo, useState } from 'react';
import { fmtTime } from '../format';
import { Icon } from '../icons';
import { Page } from '../shell';
import { Button, EmptyState, ErrorPanel, Field, Skeleton, Switch } from '../ui';
import { useApi } from '../use-api';
import type { LogsResponse } from '../types';

const ROW_HEIGHT = 30;
const VIEWPORT = 520;
const OVERSCAN = 6;

const LEVELS = [
  { value: '', label: 'все уровни' },
  { value: 'debug', label: 'debug' },
  { value: 'info', label: 'info' },
  { value: 'warn', label: 'warn' },
  { value: 'error', label: 'error' },
] as const;

export function LogsScreen() {
  const [level, setLevel] = useState('');
  const [scope, setScope] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [live, setLive] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const path = useMemo(() => {
    const params = new URLSearchParams({ per: '200' });
    if (level) params.set('level', level);
    if (scope.trim()) params.set('scope', scope.trim());
    if (query) params.set('q', query);
    return `/api/logs?${params.toString()}`;
  }, [level, scope, query]);

  const logs = useApi<LogsResponse>(path, { intervalMs: live ? 5_000 : 0 });
  const rows = logs.data?.rows ?? [];

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const visibleCount = Math.ceil(VIEWPORT / ROW_HEIGHT) + OVERSCAN * 2;
  const slice = rows.slice(start, start + visibleCount);

  return (
    <Page
      title="Логи"
      subtitle={logs.data ? `окно ${rows.length} строк` : undefined}
      actions={
        <>
          <div className="row small faint">
            <Switch checked={live} onChange={setLive} label="Автообновление" />
            <span>автообновление</span>
          </div>
          <Button variant="ghost" size="sm" onClick={logs.reload}>
            <Icon name="refresh" size={14} />
            Обновить
          </Button>
        </>
      }
    >
      <div className="panel">
        <div className="toolbar">
          <Field label="Уровень" htmlFor="log-level">
            <select id="log-level" className="select" value={level} onChange={(event) => setLevel(event.target.value)}>
              {LEVELS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Scope" htmlFor="log-scope" hint="gateway, accounts, jobs, bm, engine, system, ui">
            <input
              id="log-scope"
              className="input"
              style={{ width: 180 }}
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            />
          </Field>
          <Field label="Поиск" htmlFor="log-search">
            <input
              id="log-search"
              className="input search"
              data-search
              placeholder="текст сообщения"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
          <span className="spacer" />
          {logs.error ? <span className="small" style={{ color: 'var(--danger)' }}>{logs.error}</span> : null}
        </div>
      </div>

      {logs.error ? <ErrorPanel message={logs.error} onRetry={logs.reload} /> : null}

      <div className="table-wrap">
        {logs.loading && !logs.data ? (
          <div style={{ padding: 12 }}>
            <Skeleton rows={12} height={24} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Логов нет"
            hint={query || level || scope ? 'Под выбранные фильтры ничего не попало.' : 'События появятся после первого запроса.'}
          />
        ) : (
          <div className="log-list">
            <div className="log-row" style={{ background: 'var(--bg)', color: 'var(--fg-muted)', fontWeight: 600 }}>
              <span>Время</span>
              <span>Уровень</span>
              <span>Scope</span>
              <span>Сообщение</span>
            </div>
            <div
              style={{ height: VIEWPORT, overflowY: 'auto' }}
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            >
              <div style={{ height: rows.length * ROW_HEIGHT, position: 'relative' }}>
                <div style={{ position: 'absolute', top: start * ROW_HEIGHT, left: 0, right: 0 }}>
                  {slice.map((row) => (
                    <div
                      key={row.id}
                      className="log-row"
                      style={{ height: ROW_HEIGHT }}
                      title={row.meta ?? undefined}
                    >
                      <span className="faint">{fmtTime(row.ts)}</span>
                      <span className={`log-level ${row.level}`}>{row.level}</span>
                      <span className="muted">{row.scope}</span>
                      <span className="log-msg">
                        {row.message}
                        {row.requestId ? <span className="faint"> · {row.requestId}</span> : null}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}