'use client';

import { useState } from 'react';
import { apiGet, apiSend, errorText } from '../api';
import { fmtDateTime, fmtInt, fmtTokens } from '../format';
import { Icon } from '../icons';
import { Page } from '../shell';
import { useToast } from '../toast';
import { Button, CopyButton, EmptyState, ErrorPanel, Field, Modal, Skeleton } from '../ui';
import { useApi } from '../use-api';
import type { ApiKeyRow, KeyRevealResponse, KeysResponse } from '../types';

export function KeysScreen({ initialCreating = false }: { initialCreating?: boolean }) {
  const toast = useToast();
  const keys = useApi<KeysResponse>('/api/keys', { intervalMs: 30_000 });
  const [creating, setCreating] = useState(initialCreating);
  const [deleting, setDeleting] = useState<ApiKeyRow | null>(null);
  const [revealingId, setRevealingId] = useState<number | null>(null);
  const [revealed, setRevealed] = useState<{ name: string; key: string } | null>(null);

  const reveal = async (row: ApiKeyRow): Promise<void> => {
    setRevealingId(row.id);
    try {
      const result = await apiGet<KeyRevealResponse>(`/api/keys/${row.id}`);
      setRevealed({ name: result.record.name, key: result.key });
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setRevealingId(null);
    }
  };

  const remove = async (): Promise<void> => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    const snapshot = keys.data;
    if (snapshot) keys.setData({ keys: snapshot.keys.filter((row) => row.id !== target.id) });
    try {
      await apiSend(`/api/keys/${target.id}`, 'DELETE');
      toast.success('Ключ удалён');
    } catch (error) {
      keys.reload();
      toast.error(errorText(error));
    }
  };

  const rows = keys.data?.keys ?? [];

  return (
    <Page
      title="Ключи"
      subtitle={keys.data ? `${rows.length} ключей` : undefined}
      actions={
        <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
          <Icon name="plus" size={14} />
          Создать ключ
        </Button>
      }
    >
      {keys.error ? <ErrorPanel message={keys.error} onRetry={keys.reload} /> : null}

      <div className="table-wrap">
        {keys.loading && !keys.data ? (
          <div style={{ padding: 12 }}>
            <Skeleton rows={4} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Ключей нет"
            hint="Создайте hh-api-ключ и подключите его в OpenAI-совместимом клиенте."
            action={
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                Создать ключ
              </Button>
            }
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Имя</th>
                <th>Ключ</th>
                <th className="num">Лимит токенов</th>
                <th>Создан</th>
                <th>Последний запрос</th>
                <th style={{ width: 170 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    {row.name}
                    <div className="small faint mono">#{row.id}</div>
                  </td>
                  <td className="mono small">
                    {row.prefix}…{row.last4}
                  </td>
                  <td className="num mono">{row.token_limit === null ? 'без лимита' : fmtInt(row.token_limit)}</td>
                  <td className="mono small">{fmtDateTime(row.created_at)}</td>
                  <td className="mono small">{row.last_used_at ? fmtDateTime(row.last_used_at) : '—'}</td>
                  <td>
                    <div className="table-actions">
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={revealingId === row.id}
                        onClick={() => void reveal(row)}
                        title="Показать ключ"
                      >
                        <Icon name="keys" size={14} />
                        Показать
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setDeleting(row)}>
                        Удалить
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating ? (
        <CreateKeyModal
          onClose={() => {
            setCreating(false);
            keys.reload();
          }}
        />
      ) : null}

      {revealed ? (
        <Modal
          title="Ключ"
          onClose={() => setRevealed(null)}
          wide
          footer={
            <Button variant="primary" onClick={() => setRevealed(null)}>
              Закрыть
            </Button>
          }
        >
          <div className="key-box">
            <div className="small faint">{revealed.name} — полный ключ из защищённого хранилища.</div>
            <div className="key-value">{revealed.key}</div>
            <div className="row">
              <CopyButton text={revealed.key} label="Скопировать ключ" />
            </div>
          </div>
        </Modal>
      ) : null}

      {deleting ? (
        <Modal
          title="Удалить ключ"
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
            Ключ <span className="mono">{deleting.name}</span> будет удалён навсегда: запросы с ним сразу получат 401,
            восстановить его нельзя.
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}

function CreateKeyModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [tokenLimit, setTokenLimit] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<{ key: string; record: ApiKeyRow } | null>(null);

  const submit = async (): Promise<void> => {
    if (name.trim().length === 0) {
      setError('Укажите название');
      return;
    }
    const limit = tokenLimit.trim() === '' ? null : Number.parseInt(tokenLimit, 10);
    if (limit !== null && (!Number.isFinite(limit) || limit < 1)) {
      setError('Лимит токенов: целое число больше нуля или пусто');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await apiSend<{ key: string; record: ApiKeyRow }>('/api/keys', 'POST', {
        name: name.trim(),
        tokenLimit: limit,
      });
      setCreated(result);
      toast.success('Ключ создан');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  if (created) {
    return (
      <Modal
        title="Ключ создан"
        onClose={onClose}
        wide
        footer={
          <Button variant="primary" onClick={onClose}>
            Готово
          </Button>
        }
      >
        <div className="key-box">
          <div className="small faint">
            Ключ сохранён зашифрованным — его можно посмотреть на экране «Ключи» в любой момент.
          </div>
          <div className="key-value">{created.key}</div>
          <div className="row">
            <CopyButton text={created.key} label="Скопировать ключ" />
            <span className="small faint">
              {created.record.name} ·{' '}
              {created.record.token_limit === null
                ? 'без лимита токенов'
                : `лимит ${fmtTokens(created.record.token_limit)} токенов`}
            </span>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Создать ключ"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" loading={loading} onClick={() => void submit()}>
            Создать
          </Button>
        </>
      }
    >
      <Field label="Название" htmlFor="key-name" hint="например: claude-code, codex, cline" error={error}>
        <input
          id="key-name"
          className={`input${error ? ' invalid' : ''}`}
          value={name}
          autoFocus
          onChange={(event) => {
            setName(event.target.value);
            if (error) setError(null);
          }}
        />
      </Field>
      <Field
        label="Лимит токенов"
        htmlFor="key-token-limit"
        hint="суммарная квота за всё время; пусто — без лимита"
      >
        <input
          id="key-token-limit"
          className="input"
          type="number"
          min={1}
          placeholder="без лимита"
          value={tokenLimit}
          onChange={(event) => setTokenLimit(event.target.value)}
        />
      </Field>
    </Modal>
  );
}