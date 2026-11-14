'use client';

import { useCallback, useState } from 'react';
import { apiGet, apiSend, errorText } from '../api';
import { fmtAgo, fmtDateTime, fmtInt } from '../format';
import { Icon } from '../icons';
import { Page } from '../shell';
import { useToast } from '../toast';
import { Button, EmptyState, ErrorPanel, Skeleton, Switch } from '../ui';
import { useApi } from '../use-api';
import type { Job, JobResponse, ModelRow, ModelsResponse } from '../types';

const TERMINAL: Job['status'][] = ['done', 'failed', 'cancelled'];

export function ModelsScreen() {
  const toast = useToast();
  const models = useApi<ModelsResponse>('/api/models', { intervalMs: 60_000 });
  const [syncing, setSyncing] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const pollJob = useCallback(
    async (jobId: number): Promise<void> => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const payload = await apiGet<JobResponse>(`/api/jobs/${jobId}`);
        if (TERMINAL.includes(payload.job.status)) {
          models.reload();
          if (payload.job.status === 'failed') toast.error(payload.job.error ?? 'Синхронизация не удалась');
          else toast.success('Каталог моделей обновлён');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      }
      toast.warn('Синхронизация идёт дольше обычного — проверьте логи');
      models.reload();
    },
    [models, toast],
  );

  const sync = async (): Promise<void> => {
    try {
      const result = await apiSend<{ jobId: number }>('/api/models/sync', 'POST');
      setSyncing(result.jobId);
      toast.success('Синхронизация запущена');
      await pollJob(result.jobId);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSyncing(null);
    }
  };

  const toggle = async (model: ModelRow, enabled: boolean): Promise<void> => {
    setBusy(model.id);
    const snapshot = models.data;
    if (snapshot) {
      models.setData({
        ...snapshot,
        models: snapshot.models.map((row) => (row.id === model.id ? { ...row, enabled } : row)),
      });
    }
    try {
      await apiSend(`/api/models/${encodeURIComponent(model.id)}`, 'PATCH', { enabled });
    } catch (error) {
      models.reload();
      toast.error(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const rows = models.data?.models ?? [];
  const free = rows.filter((row) => row.free);
  const paid = rows.filter((row) => !row.free);

  return (
    <Page
      title="Модели"
      subtitle={
        models.data
          ? `последняя синхронизация: ${models.data.last_sync_at ? fmtDateTime(models.data.last_sync_at) : 'никогда'}`
          : undefined
      }
      actions={
        <Button variant="primary" size="sm" loading={syncing !== null} onClick={() => void sync()}>
          <Icon name="refresh" size={14} />
          Синхронизировать
        </Button>
      }
    >
      {models.error ? <ErrorPanel message={models.error} onRetry={models.reload} /> : null}

      {models.loading && !models.data ? (
        <div className="table-wrap" style={{ padding: 12 }}>
          <Skeleton rows={8} />
        </div>
      ) : rows.length === 0 ? (
        <div className="table-wrap">
          <EmptyState
            title="Каталог пуст"
            hint="Нажмите «Синхронизировать», чтобы получить список моделей из /deepai_code/models."
            action={
              <Button variant="primary" size="sm" onClick={() => void sync()}>
                Синхронизировать
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <ModelGroup
            title="Free"
            hint="не требуют баланса на аккаунте"
            rows={free}
            busy={busy}
            onToggle={(model, enabled) => void toggle(model, enabled)}
          />
          <ModelGroup
            title="Paid"
            hint="требуют balance > 0"
            rows={paid}
            busy={busy}
            onToggle={(model, enabled) => void toggle(model, enabled)}
          />
          <div className="small faint">
            Каталог получен из апстрима; id и лимиты не хардкодятся. Отключённые модели не отдаются в /v1/models и не
            принимаются в запросах.
          </div>
        </>
      )}
    </Page>
  );
}

function ModelGroup({
  title,
  hint,
  rows,
  busy,
  onToggle,
}: {
  title: string;
  hint: string;
  rows: ModelRow[];
  busy: string | null;
  onToggle: (model: ModelRow, enabled: boolean) => void;
}) {
  if (rows.length === 0) return null;
  const enabled = rows.filter((row) => row.enabled).length;
  return (
    <div className="panel" style={{ padding: 0 }}>
      <div className="panel-head" style={{ padding: '16px 20px', marginBottom: 0 }}>
        <div>
          <div className="panel-title">{title}</div>
          <div className="small faint">{hint}</div>
        </div>
        <span className="small mono faint">
          {enabled}/{rows.length} в API
        </span>
      </div>
      <div className="table-wrap" style={{ border: 'none', borderTop: '1px solid var(--border)', borderRadius: 0 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Модель</th>
              <th className="num">Контекст</th>
              <th className="num">Max output</th>
              <th>Модальности</th>
              <th>Статус</th>
              <th style={{ width: 80 }}>В API</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((model) => (
              <tr key={model.id}>
                <td>
                  <div className="mono">{model.id}</div>
                  {model.display_name && model.display_name !== model.id ? (
                    <div className="small faint">{model.display_name}</div>
                  ) : null}
                </td>
                <td className="num mono">{model.context_window ? fmtInt(model.context_window) : '—'}</td>
                <td className="num mono">{model.max_tokens ? fmtInt(model.max_tokens) : '—'}</td>
                <td className="small mono faint">{model.modalities.join(', ') || '—'}</td>
                <td>
                  <span className={`badge badge-${model.enabled ? 'active' : 'disabled'}`}>
                    {model.enabled ? 'в api' : 'скрыта'}
                  </span>
                  <div className="small faint">sync {fmtAgo(model.synced_at)}</div>
                </td>
                <td>
                  <Switch
                    checked={model.enabled}
                    disabled={busy === model.id}
                    label={`Доступна в API: ${model.id}`}
                    onChange={(next) => onToggle(model, next)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}