'use client';

import Link from 'next/link';
import { useState } from 'react';
import { apiSend, errorText } from '../api';
import { LineChart } from '../charts';
import { fmtInt, fmtPercent, fmtTheos, fmtTime, fmtUsd } from '../format';
import { Icon } from '../icons';
import { Page } from '../shell';
import { useToast } from '../toast';
import { Button, CardSkeleton, EmptyState, ErrorPanel, Skeleton } from '../ui';
import { useApi, useNow } from '../use-api';
import type { OverviewResponse, StatsResponse } from '../types';

export function OverviewScreen() {
  const toast = useToast();
  const overview = useApi<OverviewResponse>('/api/overview', { intervalMs: 15_000 });
  const stats = useApi<StatsResponse>('/api/stats?range=24h', { intervalMs: 60_000 });
  const now = useNow(15_000);
  const [syncing, setSyncing] = useState(false);

  const syncModels = async (): Promise<void> => {
    setSyncing(true);
    try {
      await apiSend('/api/models/sync', 'POST');
      toast.success('Синхронизация моделей запущена');
      setTimeout(() => overview.reload(), 1_500);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSyncing(false);
    }
  };

  const accounts = overview.data?.accounts;
  const totals = stats.data?.totals;
  const series = stats.data?.series ?? [];
  const warnings = overview.data?.runtime.warnings ?? [];

  return (
    <Page
      title="Обзор"
      subtitle={overview.data ? `обновлено ${fmtTime(now)}` : undefined}
      actions={
        <Button variant="ghost" size="sm" onClick={() => { overview.reload(); stats.reload(); }}>
          <Icon name="refresh" size={14} />
          Обновить
        </Button>
      }
    >
      {overview.error ? <ErrorPanel message={overview.error} onRetry={overview.reload} /> : null}
      {overview.data?.runtime.locked ? (
        <ErrorPanel message="Другой экземпляр hh-api держит блокировку БД. Cron и задачи остановлены." />
      ) : null}

      {warnings.length > 0 ? (
        <div className="card" style={{ borderColor: 'var(--warn)', background: 'var(--warn-ghost)' }}>
          <div className="card-label" style={{ color: 'var(--warn)' }}>
            Предупреждения запуска
          </div>
          <ul style={{ margin: '8px 0 0', paddingLeft: 18 }} className="small">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {overview.loading && !overview.data ? (
        <CardSkeleton />
      ) : (
        <div className="cards">
          <div className="card">
            <div className="card-label">Активные аккаунты</div>
            <div className="card-value">{fmtInt(accounts?.active)}</div>
            <div className="card-hint">
              всего {fmtInt(accounts?.total)} · cooldown {fmtInt(accounts?.cooldown)} · dead {fmtInt(accounts?.dead)}
            </div>
          </div>
          <div className="card">
            <div className="card-label">Суммарный баланс</div>
            <div className="card-value">
              {fmtTheos(overview.data?.balance_theos)} <span className="small faint">Theos</span>
            </div>
            <div className="card-hint">
              BM-кошелёк: {overview.data?.bm.configured ? fmtUsd(overview.data.bm.wallet_usd) : 'ключ не задан'}
            </div>
          </div>
          <div className="card">
            <div className="card-label">Запросы 24 ч</div>
            <div className="card-value">{fmtInt(totals?.requests)}</div>
            <div className="card-hint">сегодня: {fmtInt(overview.data?.today.requests)}</div>
          </div>
          <div className="card">
            <div className="card-label">Доля ошибок</div>
            <div className="card-value">{fmtPercent(totals?.error_rate)}</div>
            <div className="card-hint">
              ошибок {fmtInt(totals?.errors)} · p95 {fmtInt(overview.data?.today.p95_ms)} мс
            </div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Запросы за 24 часа</div>
            <div className="small faint">по часам, по всей панели</div>
          </div>
          <div className="chart-legend">
            <span>
              <span className="legend-line" />
              запросы
            </span>
          </div>
        </div>
        {stats.loading && !stats.data ? (
          <Skeleton rows={1} height={180} />
        ) : series.length === 0 ? (
          <EmptyState title="Пока нет запросов" hint="Отправьте первый запрос через /v1/chat/completions." />
        ) : (
          <LineChart
            points={series.map((point) => ({ t: point.t, value: point.requests, secondary: point.errors }))}
            label="запросы"
            format={(value) => fmtInt(value)}
          />
        )}
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Последние ошибки</div>
            <Link href="/logs" className="btn btn-ghost btn-sm">
              Все логи
            </Link>
          </div>
          {overview.loading && !overview.data ? (
            <Skeleton rows={3} height={32} />
          ) : (overview.data?.recent_errors.length ?? 0) === 0 ? (
            <EmptyState title="Ошибок нет" hint="За последнее время ошибок не зафиксировано." />
          ) : (
            <div className="list">
              {overview.data?.recent_errors.map((row) => (
                <div className="list-item" key={`${row.ts}-${row.message}`}>
                  <span className="mono small faint nowrap">{fmtTime(row.ts)}</span>
                  <span className="badge badge-exhausted">{row.scope}</span>
                  <span className="log-msg small" style={{ flex: 1 }}>
                    {row.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Быстрые действия</div>
          </div>
          <div className="stack-12">
            <Link href="/accounts?provision=1" className="btn btn-primary" style={{ width: '100%' }}>
              <Icon name="plus" size={14} />
              Добавить аккаунты
            </Link>
            <Link href="/keys?new=1" className="btn btn-secondary" style={{ width: '100%' }}>
              <Icon name="keys" size={14} />
              Создать ключ
            </Link>
            <Button variant="secondary" loading={syncing} onClick={() => void syncModels()} style={{ width: '100%' }}>
              <Icon name="refresh" size={14} />
              Синхронизировать модели
            </Button>
            {overview.data?.runtime.models_sync_due ? (
              <div className="small faint">Каталог моделей давно не синхронизировался.</div>
            ) : null}
            <div className="divider" />
            <div className="small faint">
              cooldown: {fmtInt(accounts?.cooldown)} · exhausted: {fmtInt(accounts?.exhausted)} · pending:{' '}
              {fmtInt(accounts?.pending)} · off: {fmtInt(accounts?.disabled)}
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}