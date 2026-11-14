'use client';

import { useState } from 'react';
import { apiSend, errorText } from '../api';
import { fmtDateTime, fmtInt } from '../format';
import { Icon } from '../icons';
import { Page } from '../shell';
import { useToast } from '../toast';
import { Button, CopyButton, EmptyState, ErrorPanel, Field, Modal, Skeleton } from '../ui';
import { useApi } from '../use-api';
import type { ApiKeyRow, KeysResponse } from '../types';

const BASE_URL = 'http://127.0.0.1:3210';

function snippets(key: string): Array<{ title: string; body: string }> {
  return [
    {
      title: 'Claude Code',
      body: `$env:ANTHROPIC_BASE_URL="${BASE_URL}"\n$env:ANTHROPIC_AUTH_TOKEN="${key}"\nclaude`,
    },
    {
      title: 'Codex CLI (~/.codex/config.toml)',
      body: `model = "gpt-6.1-sol"\nmodel_provider = "hhapi"\n\n[model_providers.hhapi]\nname = "hh-api"\nbase_url = "${BASE_URL}/v1"\nwire_api = "responses"\nenv_key = "HH_API_KEY"`,
    },
    {
      title: 'Cline / Roo / Continue',
      body: `Provider: OpenAI Compatible\nBase URL: ${BASE_URL}/v1\nAPI Key:  ${key}\nModel:    glm-5.3-flash`,
    },
    {
      title: 'OpenAI SDK (Python)',
      body: `from openai import OpenAI\n\nclient = OpenAI(\n    base_url="${BASE_URL}/v1",\n    api_key="${key}",\n)\n\nclient.chat.completions.create(\n    model="glm-5.3-flash",\n    messages=[{"role": "user", "content": "say ok"}],\n)`,
    },
  ];
}

export function KeysScreen({ initialCreating = false }: { initialCreating?: boolean }) {
  const toast = useToast();
  const keys = useApi<KeysResponse>('/api/keys', { intervalMs: 30_000 });
  const [creating, setCreating] = useState(initialCreating);
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);

  const revoke = async (): Promise<void> => {
    if (!revoking) return;
    const target = revoking;
    setRevoking(null);
    const snapshot = keys.data;
    if (snapshot) {
      keys.setData({ keys: snapshot.keys.map((row) => (row.id === target.id ? { ...row, revoked_at: Date.now() } : row)) });
    }
    try {
      await apiSend(`/api/keys/${target.id}`, 'DELETE');
      toast.success('Ключ отозван');
    } catch (error) {
      keys.reload();
      toast.error(errorText(error));
    }
  };

  const rows = keys.data?.keys ?? [];
  const active = rows.filter((row) => row.revoked_at === null);

  return (
    <Page
      title="Ключи"
      subtitle={keys.data ? `${active.length} активных из ${rows.length}` : undefined}
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
            hint="Создайте hh-api-ключ и подключите его в Claude Code, Codex CLI или OpenAI-совместимом клиенте."
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
                <th>Создан</th>
                <th>Последний запрос</th>
                <th className="num">RPM</th>
                <th style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={row.revoked_at ? { opacity: 0.5 } : undefined}>
                  <td>
                    {row.name}
                    <div className="small faint mono">#{row.id}</div>
                  </td>
                  <td className="mono small">
                    {row.prefix}…{row.last4}
                  </td>
                  <td className="mono small">{fmtDateTime(row.created_at)}</td>
                  <td className="mono small">{row.last_used_at ? fmtDateTime(row.last_used_at) : '—'}</td>
                  <td className="num mono">{fmtInt(row.rpm_limit)}</td>
                  <td>
                    <div className="table-actions">
                      {row.revoked_at ? (
                        <span className="small faint">отозван</span>
                      ) : (
                        <Button size="sm" variant="danger" onClick={() => setRevoking(row)}>
                          Отозвать
                        </Button>
                      )}
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

      {revoking ? (
        <Modal
          title="Отозвать ключ"
          onClose={() => setRevoking(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRevoking(null)}>
                Отмена
              </Button>
              <Button variant="danger" onClick={() => void revoke()}>
                Отозвать
              </Button>
            </>
          }
        >
          <div className="small">
            Ключ <span className="mono">{revoking.name}</span> сразу перестанет работать: запросы с ним получат 401.
            Восстановить его нельзя, только создать новый.
          </div>
        </Modal>
      ) : null}
    </Page>
  );
}

function CreateKeyModal({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [rpm, setRpm] = useState('60');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<{ key: string; record: ApiKeyRow } | null>(null);

  const submit = async (): Promise<void> => {
    if (name.trim().length === 0) {
      setError('Укажите название');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await apiSend<{ key: string; record: ApiKeyRow }>('/api/keys', 'POST', {
        name: name.trim(),
        rpmLimit: Math.max(1, Math.min(6000, Number.parseInt(rpm, 10) || 60)),
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
          <div className="small faint">Полный ключ показывается один раз — сохраните его сейчас.</div>
          <div className="key-value">{created.key}</div>
          <div className="row">
            <CopyButton text={created.key} label="Скопировать ключ" />
            <span className="small faint">
              {created.record.name} · rpm {created.record.rpm_limit}
            </span>
          </div>
        </div>

        <div className="stack-8">
          {snippets(created.key).map((snippet) => (
            <div key={snippet.title} className="stack-8">
              <div className="row">
                <span className="small strong">{snippet.title}</span>
                <span className="spacer" />
                <CopyButton text={snippet.body} />
              </div>
              <pre className="snippet" style={{ margin: 0 }}>
                {snippet.body}
              </pre>
            </div>
          ))}
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
      <Field label="Лимит RPM" htmlFor="key-rpm" hint="запросов в минуту с этого ключа, 1–6000">
        <input id="key-rpm" className="input" type="number" min={1} max={6000} value={rpm} onChange={(event) => setRpm(event.target.value)} />
      </Field>
    </Modal>
  );
}