'use client';

import { useEffect, useMemo, useState } from 'react';
import { fmtDateTime, fmtInt, fmtMs, fmtRoute } from '../format';
import { Icon } from '../icons';
import { Page } from '../shell';
import { Button, EmptyState, ErrorPanel, Field, Skeleton, Switch } from '../ui';
import { useApi } from '../use-api';
import type { KeysResponse, RequestsResponse } from '../types';

const ROUTES = [
  { value: '', label: 'все маршруты' },
  { value: 'chat', label: 'openai' },
  { value: 'responses', label: 'responses' },
  { value: 'messages', label: 'anthropic' },
] as const;

const STATUSES = [
  { value: '', label: 'все' },
  { value: 'ok', label: 'успешные' },
  { value: 'error', label: 'ошибки' },
] as const;

export function LogsScreen() {
  const [route, setRoute] = useState('');
  const [status, setStatus] = useState('');
  const [keyId, setKeyId] = useState('');
  const [model, setModel] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [live, setLive] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(model.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [model]);

  const keys = useApi<KeysResponse>('/api/keys');

  const path = useMemo(() => {
    const params = new URLSearchParams({ per: '50', page: String(page) });
    if (route) params.set('endpoint', route);
    if (status) params.set('status', status);
    if (keyId) params.set('keyId', keyId);
    if (query) params.set('model', query);
    return `/api/requests?${params.toString()}`;
  }, [route, status, keyId, query, page]);

  const requests = useApi<RequestsResponse>(path, { intervalMs: live ? 5_000 : 0 });
  const rows = requests.data?.rows ?? [];
  const total = requests.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 50));

  return (
    <Page
      title="Логи запросов"
      subtitle={requests.data ? `всего ${fmtInt(total)}` : undefined}
      actions={
        <>
          <div className="row small faint">
            <Switch checked={live} onChange={setLive} label="Автообновление" />
            <span>автообновление</span>
          </div>
          <Button variant="ghost" size="sm" onClick={requests.reload}>
            <Icon name="refresh" size={14} />
            Обновить
          </Button>
        </>
      }
    >
      <div className="panel">
        <div className="toolbar">
          <Field label="Маршрут" htmlFor="log-route">
            <select
              id="log-route"
              className="select"
              value={route}
              onChange={(event) => {
                setRoute(event.target.value);
                setPage(1);
              }}
            >
              {ROUTES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ключ" htmlFor="log-key">
            <select
              id="log-key"
              className="select"
              value={keyId}
              onChange={(event) => {
                setKeyId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">все ключи</option>
              {(keys.data?.keys ?? []).map((key) => (
                <option key={key.id} value={key.id}>
                  {key.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Результат" htmlFor="log-status">
            <select
              id="log-status"
              className="select"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              {STATUSES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Модель" htmlFor="log-model">
            <input
              id="log-model"
              className="input search"
              data-search
              placeholder="например glm-5.3-flash"
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </Field>
        </div>
      </div>

      {requests.error ? <ErrorPanel message={requests.error} onRetry={requests.reload} /> : null}

      <div className="table-wrap">
        {requests.loading && !requests.data ? (
          <div style={{ padding: 12 }}>
            <Skeleton rows={12} height={24} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Запросов нет"
            hint={
              route || status || keyId || query
                ? 'Под выбранные фильтры ничего не попало.'
                : 'Запросы появятся после первого обращения к /v1.'
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Время</th>
                <th>Ключ</th>
                <th>Аккаунт</th>
                <th>Маршрут</th>
                <th>Модель</th>
                <th className="num">Токены</th>
                <th>Успех</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const success = (row.httpStatus ?? 0) < 400 && row.errorCode === null;
                return (
                  <tr key={row.id}>
                    <td className="mono small">
                      {fmtDateTime(row.ts)}
                      <div className="small faint">{fmtMs(row.latencyMs)}</div>
                    </td>
                    <td className="small">
                      {row.keyName ?? (row.apiKeyId ? `#${row.apiKeyId}` : '—')}
                    </td>
                    <td className="mono small">{row.accountEmail ?? '—'}</td>
                    <td>
                      <span className="badge badge-pending">{fmtRoute(row.endpoint)}</span>
                    </td>
                    <td className="mono small">{row.model ?? '—'}</td>
                    <td className="num mono">{fmtInt(row.inputTokens + row.outputTokens)}</td>
                    <td>
                      {success ? (
                        <span className="badge badge-active">ok</span>
                      ) : (
                        <span className="badge badge-dead" title={row.errorCode ?? undefined}>
                          {row.errorCode ? row.errorCode.replace(/_/g, ' ') : `HTTP ${row.httpStatus ?? '—'}`}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="row small faint">
        <span className="mono">
          {rows.length > 0 ? `${(page - 1) * 50 + 1}–${(page - 1) * 50 + rows.length}` : '0'} из {fmtInt(total)}
        </span>
        <span className="spacer" />
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
          <Icon name="chevron-left" size={14} />
          Назад
        </Button>
        <span className="mono">
          {page} / {pages}
        </span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>
          Вперёд
          <Icon name="chevron-right" size={14} />
        </Button>
      </div>
    </Page>
  );
}