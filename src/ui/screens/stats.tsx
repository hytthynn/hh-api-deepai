'use client';

import { useState } from 'react';
import { BarList, ErrorBars, LineChart } from '../charts';
import { fmtInt, fmtMs, fmtPercent, fmtTheos, fmtTokens } from '../format';
import { Page } from '../shell';
import { CardSkeleton, EmptyState, ErrorPanel, Segmented, Skeleton } from '../ui';
import { useApi } from '../use-api';
import type { StatsResponse } from '../types';

type Range = '24h' | '7d' | '30d';

const RANGE_LABEL: Record<Range, string> = { '24h': '24 часа', '7d': '7 дней', '30d': '30 дней' };

export function StatsScreen() {
  const [range, setRange] = useState<Range>('24h');
  const stats = useApi<StatsResponse>(`/api/stats?range=${range}`, { intervalMs: 30_000 });

  const data = stats.data;
  const series = data?.series ?? [];

  return (
    <Page
      title="Статистика"
      subtitle={data ? `диапазон: ${RANGE_LABEL[range]}` : undefined}
      actions={
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
      }
    >
      {stats.error ? <ErrorPanel message={stats.error} onRetry={stats.reload} /> : null}

      {stats.loading && !data ? (
        <CardSkeleton />
      ) : (
        <div className="cards">
          <div className="card">
            <div className="card-label">Запросы</div>
            <div className="card-value">{fmtInt(data?.totals.requests)}</div>
            <div className="card-hint">стримов {fmtInt(data?.totals.streams)}</div>
          </div>
          <div className="card">
            <div className="card-label">Ошибки</div>
            <div className="card-value">{fmtInt(data?.totals.errors)}</div>
            <div className="card-hint">доля {fmtPercent(data?.totals.error_rate)}</div>
          </div>
          <div className="card">
            <div className="card-label">Токены</div>
            <div className="card-value">{fmtTokens((data?.totals.input_tokens ?? 0) + (data?.totals.output_tokens ?? 0))}</div>
            <div className="card-hint">
              вход {fmtTokens(data?.totals.input_tokens)} · выход {fmtTokens(data?.totals.output_tokens)}
            </div>
          </div>
          <div className="card">
            <div className="card-label">Потрачено Theos</div>
            <div className="card-value">{fmtTheos(data?.totals.theos_spent)}</div>
            <div className="card-hint">по замерам баланса до/после</div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Латентность</div>
            <div className="small faint">успешные запросы, мс</div>
          </div>
          <div className="chart-legend">
            <span>p50 {fmtMs(data?.latency.p50)}</span>
            <span>p95 {fmtMs(data?.latency.p95)}</span>
            <span>p99 {fmtMs(data?.latency.p99)}</span>
          </div>
        </div>
        {stats.loading && !data ? (
          <Skeleton rows={1} height={180} />
        ) : series.length === 0 ? (
          <EmptyState title="Нет данных за период" hint="Запросов пока не было." />
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
          {(data?.top_errors.length ?? 0) === 0 ? (
            <EmptyState title="Ошибок нет" />
          ) : (
            <BarList
              items={(data?.top_errors ?? []).map((row) => ({ label: row.code, value: row.count, error: true }))}
              format={(value) => fmtInt(value)}
            />
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="panel-title">По моделям</div>
        </div>
        {(data?.by_model.length ?? 0) === 0 ? (
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
                {data?.by_model.map((row) => (
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
        {(data?.by_account.length ?? 0) === 0 ? (
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
                {data?.by_account.map((row) => (
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
    </Page>
  );
}