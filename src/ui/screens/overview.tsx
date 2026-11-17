'use client';

import Link from 'next/link';
import { useState } from 'react';
import { apiSend, errorText } from '../api';
import { BarList, ErrorBars, LineChart } from '../charts';
import { fmtInt, fmtMs, fmtPercent, fmtTheos, fmtTime, fmtTokens, fmtUsd } from '../format';
import { Icon } from '../icons';
import { Page } from '../shell';
import { useToast } from '../toast';
import { Button, CardSkeleton, EmptyState, ErrorPanel, Segmented, Skeleton } from '../ui';
import { useApi, useNow } from '../use-api';
import type { OverviewResponse, StatsResponse } from '../types';

type Range = '24h' | '7d' | '30d';

const RANGE_LABEL: Record<Range, string> = { '24h': '24 часа', '7d': '7 дней', '30d': '30 дней' };

export function OverviewScreen() {
  const toast = useToast();
  const overview = useApi<OverviewResponse>('/api/overview', { intervalMs: 15_000 });
  const [range, setRange] = useState<Range>('24h');
  const stats = useApi<StatsResponse>(`/api/stats?range=${range}`, { intervalMs: 60_000 });
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
      subtitle={overview.data ? `обновлено ${fmtTime(now)} · ${RANGE_LABEL[range]}` : undefined}
      actions={
        <>
          <Segmented<Range>
            label="Диапазон"
            value={range}
            onChange={setRange}
            options={[
              { value: '24h', label: '24 ч' },
              { value: '7d', label: '7 д' },
              { value: '30d', label: '30 д' },
            ]}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              overview.reload();
              stats.reload();
            }}
          >
            <Icon name="refresh" size={14} />
            Обновить
          </Button>
        </>
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
        <CardSkeleton count={6} />
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
              {overview.data?.runtime.mode === 'gateway'
                ? 'режим gateway · регистрация локально'
                : `BM-кошелёк: ${overview.data?.bm.configured ? fmtUsd(overview.data.bm.wallet_usd) : 'ключ не задан'}`}
            </div>
          </div>
          <div className="card">
            <div className="card-label">Запросы</div>
            <div className="card-value">{fmtInt(totals?.requests)}</div>
            <div className="card-hint">стримов {fmtInt(totals?.streams)}</div>
          </div>
          <div className="card">
            <div className="card-label">Ошибки</div>
            <div className="card-value">{fmtInt(totals?.errors)}</div>
            <div className="card-hint">доля {fmtPercent(totals?.error_rate)}</div>
          </div>
          <div className="card">
            <div className="card-label">Токены</div>
            <div className="card-value">{fmtTokens((totals?.input_tokens ?? 0) + (totals?.output_tokens ?? 0))}</div>
            <div className="card-hint">
              вход {fmtTokens(totals?.input_tokens)} · выход {fmtTokens(totals?.output_tokens)}
            </div>
          </div>
          <div className="card">
            <div className="card-label">Потрачено Theos</div>
            <div className="card-value">{fmtTheos(totals?.theos_spent)}</div>
            <div className="card-hint">по замерам баланса до/после</div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Запросы и ошибки</div>
            <div className="small faint">{RANGE_LABEL[range]}, по интервалам</div>
          </div>
          <div className="chart-legend">
            <span>p50 {fmtMs(stats.data?.latency.p50)}</span>
            <span>p95 {fmtMs(stats.data?.latency.p95)}</span>
            <span>p99 {fmtMs(stats.data?.latency.p99)}</span>
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
            <div className="panel-title">Ошибки по интервалам</div>
          </div>
          {series.length === 0 ? (
            <EmptyState title="Нет данных" />
          ) : (
            <ErrorBars points={series.map((point) => ({ t: point.t, value: point.errors }))} format={(value) => fmtInt(value)} />
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Топ ошибок</div>
          </div>
          {(stats.data?.top_errors.length ?? 0) === 0 ? (
            <EmptyState title="Ошибок нет" />
          ) : (
            <BarList
              items={(stats.data?.top_errors ?? []).map((row) => ({ label: row.code, value: row.count, error: true }))}
              format={(value) => fmtInt(value)}
            />
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">По моделям</div>
        </div>
        {(stats.data?.by_model.length ?? 0) === 0 ? (
          <EmptyState title="Нет данных" />
        ) : (
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Модель</th>
                  <th className="num">Запросы</th>
                  <th className="num">Ошибки</th>
                  <th className="num">p95</th>
                </tr>
              </thead>
              <tbody>
                {stats.data?.by_model.map((row) => (
                  <tr key={row.model}>
                    <td className="mono">{row.model}</td>
                    <td className="num mono">{fmtInt(row.requests)}</td>
                    <td className="num mono" style={row.errors > 0 ? { color: 'var(--danger)' } : undefined}>
                      {fmtInt(row.errors)}
                    </td>
                    <td className="num mono">{fmtMs(row.p95)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">По аккаунтам</div>
        </div>
        {(stats.data?.by_account.length ?? 0) === 0 ? (
          <EmptyState title="Нет данных" />
        ) : (
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th className="num">Запросы</th>
                  <th className="num">Ошибки</th>
                  <th className="num">Баланс</th>
                </tr>
              </thead>
              <tbody>
                {stats.data?.by_account.map((row) => (
                  <tr key={row.email}>
                    <td className="mono">{row.email}</td>
                    <td className="num mono">{fmtInt(row.requests)}</td>
                    <td className="num mono" style={row.errors > 0 ? { color: 'var(--danger)' } : undefined}>
                      {fmtInt(row.errors)}
                    </td>
                    <td className="num mono">{fmtTheos(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Последние ошибки</div>
            <Link href="/logs" className="btn btn-ghost btn-sm">
              Логи запросов
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
            {overview.data?.runtime.mode === 'gateway' ? (
              <Link href="/accounts?import=1" className="btn btn-primary" style={{ width: '100%' }}>
                <Icon name="plus" size={14} />
                Импорт файла переноса
              </Link>
            ) : (
              <Link href="/accounts?provision=1" className="btn btn-primary" style={{ width: '100%' }}>
                <Icon name="plus" size={14} />
                Добавить аккаунты
              </Link>
            )}
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