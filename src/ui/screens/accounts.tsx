'use client';

import { useEffect, useMemo, useState } from 'react';
import { apiGet, apiSend, errorText } from '../api';
import { fmtAgo, fmtDateTime, fmtInt, fmtTheos, fmtUntil } from '../format';
import { Icon } from '../icons';
import { Page } from '../shell';
import { useToast } from '../toast';
import { Button, EmptyState, ErrorPanel, Field, Modal, Progress, Skeleton, StatusBadge } from '../ui';
import { useApi, useNow } from '../use-api';
import type {
  AccountPublic,
  AccountsResponse,
  BmTestResponse,
  EngineResponse,
  ImportResponse,
  Job,
  JobResponse,
  JobsListResponse,
} from '../types';

const STATUS_FILTERS = [
  { value: 'all', label: 'Все' },
  { value: 'active', label: 'active' },
  { value: 'cooldown', label: 'cooldown' },
  { value: 'exhausted', label: 'exhausted' },
  { value: 'pending', label: 'pending' },
  { value: 'dead', label: 'dead' },
  { value: 'disabled', label: 'off' },
] as const;

const STAGE_LABEL: Record<string, string> = {
  queued: 'в очереди',
  purchased: 'куплен',
  registering: 'регистрация',
  probing: 'проверка',
  ok: 'готов',
  failed: 'ошибка',
};

const TERMINAL: Job['status'][] = ['done', 'failed', 'cancelled'];

export function AccountsScreen({ initialProvision = false }: { initialProvision?: boolean }) {
  const toast = useToast();
  const [status, setStatus] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [provisionOpen, setProvisionOpen] = useState(initialProvision);
  const [importOpen, setImportOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<AccountPublic | null>(null);
  const now = useNow(1_000);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const path = useMemo(
    () => `/api/accounts?status=${status}&q=${encodeURIComponent(query)}&page=${page}&per=50`,
    [status, query, page],
  );
  const accounts = useApi<AccountsResponse>(path, { intervalMs: 10_000 });
  const engine = useApi<EngineResponse>('/api/engine', { intervalMs: 60_000 });

  const patchStatus = async (account: AccountPublic, next: 'active' | 'disabled'): Promise<void> => {
    setBusyId(account.id);
    const snapshot = accounts.data;
    if (snapshot) {
      accounts.setData({
        ...snapshot,
        rows: snapshot.rows.map((row) => (row.id === account.id ? { ...row, status: next } : row)),
      });
    }
    try {
      const result = await apiSend<{ account: AccountPublic | null }>(`/api/accounts/${account.id}`, 'PATCH', {
        status: next,
      });
      if (result.account && snapshot) {
        accounts.setData({
          ...snapshot,
          rows: snapshot.rows.map((row) => (row.id === account.id ? result.account! : row)),
        });
      }
      toast.success(next === 'active' ? 'Аккаунт включён' : 'Аккаунт отключён');
    } catch (error) {
      accounts.reload();
      toast.error(errorText(error));
    } finally {
      setBusyId(null);
    }
  };

  const check = async (account: AccountPublic): Promise<void> => {
    setBusyId(account.id);
    try {
      const result = await apiSend<{
        ok: boolean;
        reason: string | null;
        balance: number | null;
        account: AccountPublic | null;
      }>(`/api/accounts/${account.id}/check`, 'POST');
      if (result.account && accounts.data) {
        accounts.setData({
          ...accounts.data,
          rows: accounts.data.rows.map((row) => (row.id === account.id ? result.account! : row)),
        });
      }
      if (result.ok) toast.success(`Баланс: ${fmtTheos(result.balance)} Theos`);
      else toast.warn(`Проверка не прошла: ${result.reason ?? 'неизвестная причина'}`);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusyId(null);
    }
  };

  const checkAll = async (): Promise<void> => {
    try {
      const result = await apiSend<{ jobId: number; total?: number }>('/api/accounts/check-all', 'POST');
      toast.success(`Проверка запущена${result.total ? `: ${result.total} аккаунтов` : ''}`);
      setTimeout(() => accounts.reload(), 3_000);
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const remove = async (): Promise<void> => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    try {
      await apiSend(`/api/accounts/${target.id}`, 'DELETE');
      toast.success('Аккаунт удалён');
      accounts.reload();
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const chromeOk = engine.data?.chrome_ok ?? false;
  const chromePath = engine.data?.health?.chrome ?? '';
  const rows = accounts.data?.rows ?? [];
  const total = accounts.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 50));

  return (
    <Page
      title="Аккаунты"
      subtitle={accounts.data ? `всего ${fmtInt(total)}` : undefined}
      actions={
        <>
          <Button variant="ghost" size="sm" onClick={() => void checkAll()}>
            <Icon name="check" size={14} />
            Проверить все
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
            <Icon name="plus" size={14} />
            Импорт
          </Button>
          <Button variant="primary" size="sm" onClick={() => setProvisionOpen(true)} disabled={!chromeOk}>
            <Icon name="plus" size={14} />
            Добавить аккаунты
          </Button>
        </>
      }
    >
      {engine.data && !chromeOk ? (
        <div className="card" style={{ borderColor: 'var(--warn)', background: 'var(--warn-ghost)' }}>
          <div className="card-label" style={{ color: 'var(--warn)' }}>
            Регистрация недоступна
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            Chrome не найден{chromePath ? ` (${chromePath})` : ''}. Установите Google Chrome, задайте{' '}
            <span className="mono">HH_CHROME</span> или выполните{' '}
            <span className="mono">python -m playwright install chromium</span>. Ручное добавление и существующие
            аккаунты работают.
          </div>
        </div>
      ) : null}

      <div className="toolbar">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            className={`chip${status === filter.value ? ' active' : ''}`}
            onClick={() => {
              setStatus(filter.value);
              setPage(1);
            }}
          >
            {filter.label}
          </button>
        ))}
        <span className="spacer" />
        <input
          className="input search"
          data-search
          placeholder="Поиск по email"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {accounts.error ? <ErrorPanel message={accounts.error} onRetry={accounts.reload} /> : null}

      <div className="table-wrap">
        {accounts.loading && !accounts.data ? (
          <div style={{ padding: 12 }}>
            <Skeleton rows={8} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Аккаунтов нет"
            hint={query ? 'Ничего не найдено по этому запросу.' : 'Купите логины в BM, импортируйте готовый список или добавьте вручную.'}
            action={
              <Button variant="primary" size="sm" onClick={() => setProvisionOpen(true)} disabled={!chromeOk}>
                Добавить аккаунты
              </Button>
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Статус</th>
                <th className="num">Баланс</th>
                <th>Refresh</th>
                <th>Последний запрос</th>
                <th style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((account) => (
                <tr key={account.id}>
                  <td>
                    <div className="mono">{account.email}</div>
                    <div className="small faint">
                      #{account.id} · {account.source}
                      {account.bmOrderId ? ` · order ${account.bmOrderId}` : ''}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={account.status} />
                    {account.status === 'cooldown' ? (
                      <div className="small faint mono" style={{ marginTop: 2 }}>
                        {fmtUntil(account.cooldownUntil, now)}
                      </div>
                    ) : null}
                  </td>
                  <td className="num">
                    {fmtTheos(account.balance)}
                    {account.granted > 0 ? <div className="small faint">granted {fmtTheos(account.granted)}</div> : null}
                  </td>
                  <td className="mono small">{account.refreshAt ? fmtUntil(Date.parse(account.refreshAt), now) : '—'}</td>
                  <td className="mono small">{account.lastUsedAt ? fmtAgo(account.lastUsedAt, now) : '—'}</td>
                  <td>
                    <div className="table-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busyId === account.id}
                        onClick={() => void check(account)}
                        title="Проверить баланс"
                      >
                        <Icon name="refresh" size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === account.id}
                        onClick={() => void patchStatus(account, account.status === 'disabled' ? 'active' : 'disabled')}
                        title={account.status === 'disabled' ? 'Включить' : 'Отключить'}
                      >
                        {account.status === 'disabled' ? 'Вкл' : 'Выкл'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(account)} title="Удалить">
                        <Icon name="trash" size={14} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
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

      {provisionOpen ? (
        <ProvisionModal
          chromeOk={chromeOk}
          onClose={() => {
            setProvisionOpen(false);
            accounts.reload();
          }}
        />
      ) : null}

      {importOpen ? (
        <ImportModal
          onClose={() => {
            setImportOpen(false);
            accounts.reload();
          }}
        />
      ) : null}

      {deleting ? (
        <Modal
          title="Удалить аккаунт"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                Отмена
              </Button>
              <Button variant="danger" onClick={() => void remove()}>
                Удалить
              </Button>
            </>
          }
        >
          <div className="small">
            Аккаунт <span className="mono">{deleting.email}</span> будет удалён вместе с cookies и паролем.
            Действие необратимо.
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}

/* ------------------------------------------------------------------ */
/* Import                                                              */
/* ------------------------------------------------------------------ */

function ImportModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  const submit = async (): Promise<void> => {
    if (text.trim().length === 0) {
      setError('Вставьте хотя бы одну строку');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload = await apiSend<ImportResponse>('/api/accounts/import', 'POST', { text });
      setResult(payload);
      toast.success(`Импортировано: ${payload.created}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="Импорт аккаунтов"
      onClose={onClose}
      wide
      footer={
        result ? (
          <Button variant="primary" onClick={onClose}>
            Готово
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Отмена
            </Button>
            <Button variant="primary" loading={loading} onClick={() => void submit()}>
              Импортировать
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="stack-12">
          <div className="row small">
            <span className="muted">Создано</span>
            <span className="spacer" />
            <span className="mono">{fmtInt(result.created)}</span>
          </div>
          <div className="row small">
            <span className="muted">Пропущено (уже есть)</span>
            <span className="spacer" />
            <span className="mono">{fmtInt(result.skipped.length)}</span>
          </div>
          <div className="row small">
            <span className="muted">Некорректных строк</span>
            <span className="spacer" />
            <span className="mono">{fmtInt(result.invalid.length)}</span>
          </div>
          {result.skipped.length > 0 || result.invalid.length > 0 ? (
            <div className="table-wrap" style={{ maxHeight: 240, overflow: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Строка</th>
                    <th>Причина</th>
                  </tr>
                </thead>
                <tbody>
                  {result.skipped.map((email) => (
                    <tr key={`skipped-${email}`}>
                      <td className="mono small">{email}</td>
                      <td className="small faint">уже существует</td>
                    </tr>
                  ))}
                  {result.invalid.map((line) => (
                    <tr key={`invalid-${line}`}>
                      <td className="mono small">{line}</td>
                      <td className="small faint">не email|пароль</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : (
        <Field
          label="Список логинов"
          htmlFor="import-text"
          hint="email|password или email:password, по одному на строку; дубликаты пропускаются"
          error={error}
        >
          <textarea
            id="import-text"
            className={`input mono${error ? ' invalid' : ''}`}
            rows={12}
            style={{ resize: 'vertical' }}
            placeholder="user@gmail.com|secret123"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (error) setError(null);
            }}
          />
        </Field>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Provision                                                           */
/* ------------------------------------------------------------------ */

function ProvisionModal({
  chromeOk,
  onClose,
}: {
  chromeOk: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const [quantity, setQuantity] = useState('1');
  const [workers, setWorkers] = useState('2');
  const [bm, setBm] = useState<BmTestResponse | null>(null);
  const [bmError, setBmError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [settings, jobs] = await Promise.all([
          apiSend<BmTestResponse>('/api/settings/bm/test', 'POST'),
          apiGet<JobsListResponse>('/api/jobs'),
        ]);
        if (cancelled) return;
        setBm(settings);
        if (!settings.ok) setBmError(settings.error ?? 'BM недоступен');
        const running = jobs.jobs.find(
          (job) => job.type === 'provision' && (job.status === 'running' || job.status === 'queued'),
        );
        if (running) setJobId(running.id);
      } catch (error) {
        if (!cancelled) setBmError(errorText(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const price = bm?.product?.price ?? null;
  const units = Number.parseInt(quantity, 10) || 0;
  const estimate = price !== null ? price * units : null;

  const submit = async (): Promise<void> => {
    setFormError(null);
    if (units < 1 || units > 50) {
      setFormError('Количество: от 1 до 50');
      return;
    }
    const workersValue = Math.max(1, Math.min(8, Number.parseInt(workers, 10) || 2));
    setSubmitting(true);
    try {
      const result = await apiSend<{ jobId: number }>('/api/jobs', 'POST', {
        type: 'provision',
        quantity: units,
        workers: workersValue,
      });
      setJobId(result.jobId);
      toast.success(`Закупка #${result.jobId} запущена`);
    } catch (error) {
      setFormError(errorText(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={jobId === null ? 'Добавить аккаунты' : `Закупка #${jobId}`}
      onClose={onClose}
      wide
      footer={
        jobId === null ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Отмена
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              disabled={!chromeOk || units < 1 || bm?.ok === false}
              onClick={() => void submit()}
            >
              Купить и зарегистрировать
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Закрыть
          </Button>
        )
      }
    >
      {jobId === null ? (
        <>
          {!chromeOk ? (
            <ErrorPanel message="Chrome не найден — регистрация недоступна. Установите Google Chrome, задайте HH_CHROME или выполните python -m playwright install chromium." />
          ) : null}
          {bmError ? <ErrorPanel message={`BM: ${bmError}`} /> : null}

          <div className="grid-2">
            <Field label="Количество" htmlFor="quantity" hint="от 1 до 50 логинов">
              <input
                id="quantity"
                className="input"
                type="number"
                min={1}
                max={50}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </Field>
            <Field label="Воркеры" htmlFor="workers" hint="параллельные регистрации, 1–8">
              <input
                id="workers"
                className="input"
                type="number"
                min={1}
                max={8}
                value={workers}
                onChange={(event) => setWorkers(event.target.value)}
              />
            </Field>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div className="row">
              <span className="small muted">Оценка стоимости</span>
              <span className="spacer" />
              <span className="mono">
                {estimate === null ? '—' : `$${estimate.toFixed(2)}`}
                {price !== null ? <span className="small faint"> ({units} × ${price.toFixed(2)})</span> : null}
              </span>
            </div>
            <div className="row small faint" style={{ marginTop: 4 }}>
              <span>Кошелёк BM</span>
              <span className="spacer" />
              <span className="mono">{bm?.wallet ? `$${bm.wallet.balance.toFixed(2)}` : '—'}</span>
            </div>
            {bm?.product ? (
              <div className="row small faint" style={{ marginTop: 4 }}>
                <span>Склад</span>
                <span className="spacer" />
                <span>{bm.product.in_stock ? 'в наличии' : 'нет в наличии'}</span>
              </div>
            ) : null}
          </div>

          {formError ? <ErrorPanel message={formError} /> : null}
        </>
      ) : (
        <JobProgress jobId={jobId} />
      )}
    </Modal>
  );
}

function JobProgress({ jobId }: { jobId: number }) {
  const poll = useApi<JobResponse>(`/api/jobs/${jobId}`, { intervalMs: 1_500 });
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const job = poll.data?.job;
  const items = poll.data?.items ?? [];
  const running = job ? !TERMINAL.includes(job.status) : false;

  const cancel = async (): Promise<void> => {
    setCancelling(true);
    setCancelError(null);
    try {
      await apiSend(`/api/jobs/${jobId}/cancel`, 'POST');
      poll.reload();
    } catch (err) {
      setCancelError(errorText(err));
    } finally {
      setCancelling(false);
    }
  };

  if (poll.error && !poll.data) return <ErrorPanel message={poll.error} onRetry={poll.reload} />;

  return (
    <div className="stack-16">
      {cancelError ? <ErrorPanel message={cancelError} /> : null}
      {job ? (
        <div className="stack-8">
          <div className="row">
            <span className={`badge badge-${job.status === 'failed' ? 'dead' : job.status === 'done' ? 'active' : 'pending'}`}>
              {job.status}
            </span>
            <span className="small faint">
              ok {job.ok} · failed {job.failed} · ${job.spentUsd.toFixed(2)}
            </span>
            <span className="spacer" />
            {running ? (
              <Button size="sm" variant="danger" loading={cancelling} onClick={() => void cancel()}>
                Отменить
              </Button>
            ) : null}
          </div>
          <Progress value={job.done} total={job.total} />
          {job.error ? <div className="small" style={{ color: 'var(--danger)' }}>{job.error}</div> : null}
        </div>
      ) : (
        <Skeleton rows={1} height={40} />
      )}

      <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
        {items.length === 0 ? (
          <div className="small faint" style={{ padding: 16 }}>
            Ожидаем выдачу логинов из BM…
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Стадия</th>
                <th className="num">Попытка</th>
                <th>Ошибка</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="mono small">{item.email ?? '—'}</td>
                  <td>
                    <span className={`badge badge-${item.stage === 'failed' ? 'dead' : item.stage === 'ok' ? 'active' : 'pending'}`}>
                      {STAGE_LABEL[item.stage] ?? item.stage}
                    </span>
                  </td>
                  <td className="num small">{item.attempts || '—'}</td>
                  <td className="small faint" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.error ?? ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {job && TERMINAL.includes(job.status) ? (
        <div className="small faint">
          Завершено {job.finishedAt ? fmtDateTime(job.finishedAt) : ''}. Аккаунты обновятся в таблице после закрытия.
        </div>
      ) : null}
    </div>
  );
}