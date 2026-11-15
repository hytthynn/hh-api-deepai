'use client';

import { useState } from 'react';
import { apiSend, errorText } from '../api';
import { fmtInt } from '../format';
import { Page } from '../shell';
import { useToast } from '../toast';
import { Button, EmptyState, ErrorPanel, Field, Modal, Skeleton, Switch } from '../ui';
import { useApi } from '../use-api';
import type { BmTestResponse, ModelsResponse, SettingsResponse } from '../types';

type Form = {
  bmKey: string;
  productId: string;
  verifyTls: boolean;
  workers: string;
  headless: boolean;
  proxy: string;
  restartAfter: string;
  syncInterval: string;
  defaultModel: string;
  rpm: string;
  exposeDisabled: boolean;
  ttlDays: string;
};

export function SettingsScreen() {
  const settings = useApi<SettingsResponse>('/api/settings');
  const models = useApi<ModelsResponse>('/api/models');

  if (settings.error) {
    return (
      <Page title="Настройки">
        <ErrorPanel message={settings.error} onRetry={settings.reload} />
      </Page>
    );
  }

  if (!settings.data) {
    return (
      <Page title="Настройки">
        <div className="panel">
          <Skeleton rows={6} />
        </div>
      </Page>
    );
  }

  return <SettingsLoaded data={settings.data} models={models.data} reload={settings.reload} />;
}

function formFrom(values: Record<string, string | null>): Form {
  return {
    bmKey: '',
    productId: values['bm.product_id'] ?? '578',
    verifyTls: values['bm.verify_tls'] !== '0',
    workers: values['engine.workers'] ?? '2',
    headless: values['engine.headless'] === '1',
    proxy: values['engine.proxy'] ?? '',
    restartAfter: values['engine.restart_after'] ?? '10',
    syncInterval: values['balance.sync_interval_min'] ?? '5',
    defaultModel: values['gateway.default_model'] ?? '',
    rpm: values['gateway.rpm_limit'] ?? '60',
    exposeDisabled: values['gateway.expose_disabled'] === '1',
    ttlDays: values['responses.ttl_days'] ?? '7',
  };
}

function SettingsLoaded({
  data,
  models,
  reload,
}: {
  data: SettingsResponse;
  models: ModelsResponse | null;
  reload: () => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState<Form>(() => formFrom(data.values));
  const [busy, setBusy] = useState<string | null>(null);
  const [bmTest, setBmTest] = useState<BmTestResponse | null>(null);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const update = <K extends keyof Form>(key: K, value: Form[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async (section: string, payload: Record<string, unknown>): Promise<boolean> => {
    setBusy(section);
    try {
      const result = await apiSend<{ updated: string[] }>('/api/settings', 'PUT', payload);
      toast.success(result.updated.length > 0 ? `Сохранено: ${result.updated.join(', ')}` : 'Изменений нет');
      reload();
      return true;
    } catch (error) {
      toast.error(errorText(error));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const testBm = async (): Promise<void> => {
    setBusy('bm-test');
    try {
      const result = await apiSend<BmTestResponse>('/api/settings/bm/test', 'POST');
      setBmTest(result);
      if (result.ok) toast.success(`BM доступен, кошелёк $${result.wallet?.balance.toFixed(2) ?? '0'}`);
      else toast.error(result.error ?? 'BM недоступен');
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const clearLogs = async (): Promise<void> => {
    setClearingLogs(false);
    try {
      const result = await apiSend<{ deleted: number }>('/api/logs', 'DELETE');
      toast.success(`Удалено записей: ${fmtInt(result.deleted)}`);
    } catch (error) {
      toast.error(errorText(error));
    }
  };

  const changePassword = async (): Promise<void> => {
    setPasswordError(null);
    if (password.length < 8) {
      setPasswordError('Минимум 8 символов');
      return;
    }
    if (password !== password2) {
      setPasswordError('Пароли не совпадают');
      return;
    }
    const ok = await save('security', { 'admin.password': password });
    if (ok) {
      setPassword('');
      setPassword2('');
      toast.success('Пароль обновлён');
    }
  };

  const bmConfigured = data.secrets['bm.api_key'];
  const enabledModels = (models?.models ?? []).filter((model) => model.enabled);
  const modelOptions = enabledModels.length > 0 ? enabledModels : (models?.models ?? []);

  return (
    <Page title="Настройки" subtitle="изменения применяются сразу">
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">BM</div>
            <div className="small faint">
              {bmConfigured ? `ключ сохранён (${data.masked['bm.api_key']})` : 'ключ не задан'}
            </div>
          </div>
          <div className="row">
            <Button size="sm" variant="secondary" loading={busy === 'bm-test'} onClick={() => void testBm()}>
              Проверить
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={busy === 'bm'}
              onClick={() =>
                void save('bm', {
                  ...(form.bmKey.trim() ? { 'bm.api_key': form.bmKey.trim() } : {}),
                  'bm.product_id': Math.max(1, Number.parseInt(form.productId, 10) || 578),
                  'bm.verify_tls': form.verifyTls,
                })
              }
            >
              Сохранить
            </Button>
          </div>
        </div>

        <div className="grid-2">
          <Field
            label="API-ключ"
            htmlFor="bm-key"
            hint="хранится зашифрованным (AES-256-GCM); пустое поле — оставить без изменений"
          >
            <input
              id="bm-key"
              className="input"
              type="password"
              autoComplete="off"
              placeholder={bmConfigured ? '•••••••• (не менять)' : 'ключ bulkmail.shop'}
              value={form.bmKey}
              onChange={(event) => update('bmKey', event.target.value)}
            />
          </Field>
          <Field label="ID продукта" htmlFor="bm-product" hint="товар Google-логинов в BM">
            <input
              id="bm-product"
              className="input"
              type="number"
              value={form.productId}
              onChange={(event) => update('productId', event.target.value)}
            />
          </Field>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <Switch checked={form.verifyTls} onChange={(next) => update('verifyTls', next)} label="Проверять TLS" />
          <span className="small">Проверять TLS-сертификат BM</span>
        </div>

        {bmTest ? (
          <div className="card" style={{ marginTop: 16, padding: 12 }}>
            {bmTest.ok ? (
              <div className="stack-8">
                <div className="row small">
                  <span className="muted">Кошелёк</span>
                  <span className="spacer" />
                  <span className="mono">
                    ${bmTest.wallet?.balance.toFixed(2)} {bmTest.wallet?.currency}
                  </span>
                </div>
                <div className="row small">
                  <span className="muted">Продукт</span>
                  <span className="spacer" />
                  <span className="mono">
                    #{bmTest.product?.id} · {bmTest.product?.name}
                  </span>
                </div>
                <div className="row small">
                  <span className="muted">Цена / склад</span>
                  <span className="spacer" />
                  <span className="mono">
                    ${bmTest.product?.price.toFixed(2)} · {bmTest.product?.in_stock ? 'в наличии' : 'нет'}
                  </span>
                </div>
                <div className="row small">
                  <span className="muted">Доступные количества</span>
                  <span className="spacer" />
                  <span className="mono">{bmTest.product?.allowed_quantities.join(', ') || '—'}</span>
                </div>
              </div>
            ) : (
              <div className="small" style={{ color: 'var(--danger)' }}>
                {bmTest.code ? `${bmTest.code}: ` : ''}
                {bmTest.error}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Движок</div>
            <div className="small faint">Python-воркер регистрации; изменения применяются к следующему запуску</div>
          </div>
          <Button
            size="sm"
            variant="primary"
            loading={busy === 'engine'}
            onClick={() =>
              void save('engine', {
                'engine.workers': Math.max(1, Math.min(8, Number.parseInt(form.workers, 10) || 2)),
                'engine.headless': form.headless,
                'engine.proxy': form.proxy.trim(),
                'engine.restart_after': Math.max(1, Math.min(1000, Number.parseInt(form.restartAfter, 10) || 10)),
              })
            }
          >
            Сохранить
          </Button>
        </div>

        <div className="grid-2">
          <Field label="Воркеры" htmlFor="engine-workers" hint="параллельные браузеры, 1–8">
            <input
              id="engine-workers"
              className="input"
              type="number"
              min={1}
              max={8}
              value={form.workers}
              onChange={(event) => update('workers', event.target.value)}
            />
          </Field>
          <Field label="Перезапуск после N регистраций" htmlFor="engine-restart" hint="сбрасывает профиль браузера">
            <input
              id="engine-restart"
              className="input"
              type="number"
              min={1}
              value={form.restartAfter}
              onChange={(event) => update('restartAfter', event.target.value)}
            />
          </Field>
          <Field label="Прокси" htmlFor="engine-proxy" hint="http://user:pass@host:port, пусто — без прокси">
            <input
              id="engine-proxy"
              className="input"
              placeholder="http://user:pass@host:port"
              value={form.proxy}
              onChange={(event) => update('proxy', event.target.value)}
            />
          </Field>
          <div className="field">
            <span className="field-label">Headless</span>
            <div className="row" style={{ height: 36 }}>
              <Switch checked={form.headless} onChange={(next) => update('headless', next)} label="Headless-режим" />
              <span className="small muted">{form.headless ? 'без окна браузера' : 'с окном (рекомендуется)'}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Баланс</div>
            <Button
              size="sm"
              variant="primary"
              loading={busy === 'balance'}
              onClick={() =>
                void save('balance', {
                  'balance.sync_interval_min': Math.max(1, Math.min(1440, Number.parseInt(form.syncInterval, 10) || 5)),
                })
              }
            >
              Сохранить
            </Button>
          </div>
          <Field label="Интервал синхронизации, мин" htmlFor="balance-interval" hint="как часто проверять баланс аккаунтов">
            <input
              id="balance-interval"
              className="input"
              type="number"
              min={1}
              max={1440}
              value={form.syncInterval}
              onChange={(event) => update('syncInterval', event.target.value)}
            />
          </Field>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="panel-title">Шлюз</div>
            <Button
              size="sm"
              variant="primary"
              loading={busy === 'gateway'}
              onClick={() =>
                void save('gateway', {
                  ...(form.defaultModel ? { 'gateway.default_model': form.defaultModel } : {}),
                  'gateway.rpm_limit': Math.max(1, Math.min(6000, Number.parseInt(form.rpm, 10) || 60)),
                  'gateway.expose_disabled': form.exposeDisabled,
                  'responses.ttl_days': Math.max(1, Math.min(365, Number.parseInt(form.ttlDays, 10) || 7)),
                })
              }
            >
              Сохранить
            </Button>
          </div>
          <div className="stack-12">
            <Field label="Модель по умолчанию" htmlFor="gateway-model" hint="используется, если клиент не указал model">
              <select
                id="gateway-model"
                className="select"
                value={form.defaultModel}
                onChange={(event) => update('defaultModel', event.target.value)}
              >
                {modelOptions.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.id}
                    {model.enabled ? '' : ' (скрыта)'}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="Лимит запросов, RPM"
              htmlFor="gateway-rpm"
              hint="общий для всех ключей; 1–6000 запросов в минуту"
            >
              <input
                id="gateway-rpm"
                className="input"
                type="number"
                min={1}
                max={6000}
                value={form.rpm}
                onChange={(event) => update('rpm', event.target.value)}
              />
            </Field>
            <Field label="Хранить Responses, дней" htmlFor="gateway-ttl" hint="previous_response_id доступен в этом окне">
              <input
                id="gateway-ttl"
                className="input"
                type="number"
                min={1}
                max={365}
                value={form.ttlDays}
                onChange={(event) => update('ttlDays', event.target.value)}
              />
            </Field>
            <div className="row">
              <Switch
                checked={form.exposeDisabled}
                onChange={(next) => update('exposeDisabled', next)}
                label="Отдавать скрытые модели в списке"
              />
              <span className="small muted">Показывать отключённые модели в /v1/models</span>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Данные</div>
            <div className="small faint">ретеншн задаётся в .env.local (HH_LOG_RETENTION_DAYS / HH_REQUEST_RETENTION_DAYS)</div>
          </div>
        </div>
        <div className="grid-3">
          <div className="field">
            <span className="field-label">Логи</span>
            <span className="mono">{fmtInt(data.retention.logs_days)} дней</span>
          </div>
          <div className="field">
            <span className="field-label">Запросы</span>
            <span className="mono">{fmtInt(data.retention.requests_days)} дней</span>
          </div>
          <div className="field">
            <span className="field-label">Файлы</span>
            <span className="mono small">data/hh.db, prof/</span>
          </div>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- это скачивание файла из API, не навигация */}
          <a className="btn btn-secondary btn-sm" href="/api/accounts/export">
            Экспорт аккаунтов
          </a>
          <Button size="sm" variant="danger" onClick={() => setClearingLogs(true)}>
            Очистить логи
          </Button>
          <span className="small faint">экспорт — email|password, по одному на строку</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Безопасность</div>
            <div className="small faint">пароль панели хранится как scrypt-хеш</div>
          </div>
          <Button size="sm" variant="primary" loading={busy === 'security'} onClick={() => void changePassword()}>
            Сменить пароль
          </Button>
        </div>
        <div className="grid-2">
          <Field label="Новый пароль" htmlFor="admin-password" error={passwordError} hint="минимум 8 символов">
            <input
              id="admin-password"
              className={`input${passwordError ? ' invalid' : ''}`}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setPasswordError(null);
              }}
            />
          </Field>
          <Field label="Повторите пароль" htmlFor="admin-password-2">
            <input
              id="admin-password-2"
              className="input"
              type="password"
              autoComplete="new-password"
              value={password2}
              onChange={(event) => {
                setPassword2(event.target.value);
                setPasswordError(null);
              }}
            />
          </Field>
        </div>
      </div>

      {clearingLogs ? (
        <Modal
          title="Очистить логи"
          onClose={() => setClearingLogs(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setClearingLogs(false)}>
                Отмена
              </Button>
              <Button variant="danger" onClick={() => void clearLogs()}>
                Очистить
              </Button>
            </>
          }
        >
          <div className="small">Все записи журнала будут удалены. История запросов и статистика останутся.</div>
        </Modal>
      ) : null}

      {modelOptions.length === 0 ? <EmptyState title="Каталог моделей пуст" hint="Синхронизируйте модели на экране «Модели»." /> : null}
    </Page>
  );
}