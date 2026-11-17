'use client';

import { useMemo, useState } from 'react';
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
  restartAfter: string;
  syncInterval: string;
  defaultModel: string;
  rpm: string;
  ttlDays: string;
  exposeDisabled: boolean;
  upstreamTimeoutSec: string;
  slotWaitSec: string;
  retentionLogs: string;
  retentionRequests: string;
};

const DEFAULT_MODEL = 'glm-5.3-flash';

function formFrom(values: Record<string, string | null>): Form {
  return {
    bmKey: '',
    productId: values['bm.product_id'] ?? '578',
    verifyTls: values['bm.verify_tls'] !== '0',
    workers: values['engine.workers'] ?? '2',
    headless: values['engine.headless'] === '1',
    restartAfter: values['engine.restart_after'] ?? '10',
    syncInterval: values['balance.sync_interval_min'] ?? '5',
    defaultModel: values['gateway.default_model'] ?? DEFAULT_MODEL,
    rpm: values['gateway.rpm_limit'] ?? '60',
    ttlDays: values['responses.ttl_days'] ?? '7',
    exposeDisabled: values['gateway.expose_disabled'] === '1',
    upstreamTimeoutSec: String(Math.round(Number(values['gateway.upstream_timeout_ms'] ?? 300_000) / 1000)),
    slotWaitSec: String(Math.round(Number(values['gateway.slot_wait_ms'] ?? 45_000) / 1000)),
    retentionLogs: values['retention.logs_days'] ?? '14',
    retentionRequests: values['retention.requests_days'] ?? '90',
  };
}

function intOr(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

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
          <Skeleton rows={8} />
        </div>
      </Page>
    );
  }

  return <SettingsLoaded data={settings.data} models={models.data} reload={settings.reload} />;
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
  const [initial, setInitial] = useState<Form>(() => formFrom(data.values));
  const [form, setForm] = useState<Form>(initial);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [bmTest, setBmTest] = useState<BmTestResponse | null>(null);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [clearing, setClearing] = useState(false);

  const update = <K extends keyof Form>(key: K, value: Form[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const dirty = useMemo(
    () =>
      form.bmKey.trim() !== '' ||
      (Object.keys(initial) as Array<keyof Form>).some((key) => form[key] !== initial[key]),
    [form, initial],
  );

  const gateway = data.mode === 'gateway';

  const payload = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      'balance.sync_interval_min': intOr(form.syncInterval, 5, 1, 1440),
      'gateway.rpm_limit': intOr(form.rpm, 60, 1, 6000),
      'gateway.upstream_timeout_ms': intOr(form.upstreamTimeoutSec, 300, 1, 900) * 1000,
      'gateway.slot_wait_ms': intOr(form.slotWaitSec, 45, 0, 600) * 1000,
      'retention.logs_days': intOr(form.retentionLogs, 14, 1, 3650),
      'retention.requests_days': intOr(form.retentionRequests, 90, 1, 3650),
      'gateway.expose_disabled': form.exposeDisabled,
      'responses.ttl_days': intOr(form.ttlDays, 7, 1, 365),
    };
    // ADR-025: gateway mode has no BM/engine panels — never send their keys.
    if (!gateway) {
      body['bm.product_id'] = intOr(form.productId, 578, 1, 1_000_000);
      body['bm.verify_tls'] = form.verifyTls;
      body['engine.workers'] = intOr(form.workers, 2, 1, 8);
      body['engine.headless'] = form.headless;
      body['engine.restart_after'] = intOr(form.restartAfter, 10, 1, 1000);
      const key = form.bmKey.trim();
      if (key) body['bm.api_key'] = key;
    }
    const model = form.defaultModel.trim();
    if (model) body['gateway.default_model'] = model;
    return body;
  };

  const saveAll = async (): Promise<void> => {
    setSaving(true);
    try {
      const result = await apiSend<{ updated: string[] }>('/api/settings', 'PUT', payload());
      if (result.updated.length > 0) {
        toast.success(`Сохранено параметров: ${result.updated.length}`);
        reload();
        setInitialForm(form);
      } else {
        toast.success('Изменений нет');
      }
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setSaving(false);
    }
  };

  const setInitialForm = (next: Form): void => {
    setForm({ ...next, bmKey: '' });
    setInitial({ ...next, bmKey: '' });
  };

  const testBm = async (): Promise<void> => {
    setTesting(true);
    try {
      const result = await apiSend<BmTestResponse>('/api/settings/bm/test', 'POST');
      setBmTest(result);
      if (result.ok) toast.success(`BM доступен, кошелёк $${result.wallet?.balance.toFixed(2) ?? '0'}`);
      else toast.error(result.error ?? 'BM недоступен');
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setTesting(false);
    }
  };

  const clearLogs = async (): Promise<void> => {
    setClearing(true);
    try {
      const result = await apiSend<{ deleted: number; deleted_requests: number }>('/api/logs', 'DELETE');
      toast.success(`Удалено: ${fmtInt(result.deleted_requests)} запросов, ${fmtInt(result.deleted)} записей журнала`);
      setClearingLogs(false);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setClearing(false);
    }
  };

  const bmConfigured = data.secrets['bm.api_key'];
  const enabledModels = (models?.models ?? []).filter((model) => model.enabled);
  const modelOptions = enabledModels.length > 0 ? enabledModels : (models?.models ?? []);
  const hasCurrentModel = modelOptions.some((model) => model.id === form.defaultModel);

  return (
    <Page
      title="Настройки"
      subtitle={
        gateway
          ? 'режим gateway: закупка и регистрация выполняются на локальном экземпляре'
          : dirty
            ? 'есть несохранённые изменения'
            : 'все параметры сохраняются одной кнопкой'
      }
      actions={
        <Button variant="primary" loading={saving} onClick={() => void saveAll()}>
          Сохранить
        </Button>
      }
    >
      {!gateway ? (
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">BM</div>
            <div className="small faint">
              {bmConfigured ? `ключ сохранён (${data.masked['bm.api_key']})` : 'ключ не задан'}
            </div>
          </div>
          <Button size="sm" variant="secondary" loading={testing} onClick={() => void testBm()}>
            Проверить
          </Button>
        </div>

        <div className="form-grid">
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

        <div className="row" style={{ marginTop: 16 }}>
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
      ) : null}

      {!gateway ? (
      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Движок</div>
            <div className="small faint">Python-воркер регистрации; изменения применяются к следующему запуску</div>
          </div>
        </div>

        <div className="form-grid">
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
          <div className="field">
            <span className="field-label">Headless</span>
            <div className="row" style={{ height: 36 }}>
              <Switch checked={form.headless} onChange={(next) => update('headless', next)} label="Headless-режим" />
              <span className="small muted">{form.headless ? 'без окна браузера' : 'с окном (рекомендуется)'}</span>
            </div>
          </div>
        </div>
      </div>
      ) : null}

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Баланс и шлюз</div>
            <div className="small faint">проверка баланса, модели, лимиты и таймауты</div>
          </div>
        </div>

        <div className="form-grid">
          <Field
            label="Интервал синхронизации баланса, мин"
            htmlFor="balance-interval"
            hint="как часто проверять баланс аккаунтов, 1–1440"
          >
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
          <Field label="Модель по умолчанию" htmlFor="gateway-model" hint="используется, если клиент не указал model">
            <select
              id="gateway-model"
              className="select"
              value={form.defaultModel}
              onChange={(event) => update('defaultModel', event.target.value)}
            >
              {!hasCurrentModel && form.defaultModel ? (
                <option value={form.defaultModel}>{form.defaultModel} (нет в каталоге)</option>
              ) : null}
              {modelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.id}
                  {model.enabled ? '' : ' (скрыта)'}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Лимит запросов, RPM" htmlFor="gateway-rpm" hint="общий для всех ключей, 1–6000 запросов в минуту">
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
          <Field
            label="Таймаут ответа апстрима, с"
            htmlFor="gateway-timeout"
            hint="сколько ждать DeepAI до первого байта и целиком, 1–900"
          >
            <input
              id="gateway-timeout"
              className="input"
              type="number"
              min={1}
              max={900}
              value={form.upstreamTimeoutSec}
              onChange={(event) => update('upstreamTimeoutSec', event.target.value)}
            />
          </Field>
          <Field
            label="Ожидание свободного аккаунта, с"
            htmlFor="gateway-slot-wait"
            hint="сколько запрос ждёт слот, прежде чем вернуть 429 no_account_available, 0–600"
          >
            <input
              id="gateway-slot-wait"
              className="input"
              type="number"
              min={0}
              max={600}
              value={form.slotWaitSec}
              onChange={(event) => update('slotWaitSec', event.target.value)}
            />
          </Field>
          <Field
            label="Хранить Responses, дней"
            htmlFor="gateway-ttl"
            hint="срок жизни сохранённого ответа: пока он не истёк, клиент может продолжить диалог по previous_response_id; 1–365"
          >
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
        </div>

        <div className="row" style={{ marginTop: 16 }}>
          <Switch
            checked={form.exposeDisabled}
            onChange={(next) => update('exposeDisabled', next)}
            label="Отдавать скрытые модели в списке"
          />
          <span className="small muted">Показывать отключённые модели в /v1/models</span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div>
            <div className="panel-title">Данные</div>
            <div className="small faint">ретеншн, экспорт и очистка; значения по умолчанию приходят из .env.local</div>
          </div>
        </div>

        <div className="form-grid">
          <Field label="Хранить логи, дней" htmlFor="retention-logs" hint="диагностический журнал, 1–3650">
            <input
              id="retention-logs"
              className="input"
              type="number"
              min={1}
              max={3650}
              value={form.retentionLogs}
              onChange={(event) => update('retentionLogs', event.target.value)}
            />
          </Field>
          <Field label="Хранить запросы, дней" htmlFor="retention-requests" hint="журнал запросов и статистика, 1–3650">
            <input
              id="retention-requests"
              className="input"
              type="number"
              min={1}
              max={3650}
              value={form.retentionRequests}
              onChange={(event) => update('retentionRequests', event.target.value)}
            />
          </Field>
        </div>

        <div className="row row-wrap" style={{ marginTop: 16 }}>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- это скачивание файла из API, не навигация */}
          <a className="btn btn-secondary btn-sm" href="/api/accounts/export">
            Экспорт аккаунтов
          </a>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- это скачивание файла из API, не навигация */}
          <a className="btn btn-secondary btn-sm" href="/api/accounts/export?format=transfer">
            Файл переноса
          </a>
          <Button size="sm" variant="danger" onClick={() => setClearingLogs(true)}>
            Очистить логи
          </Button>
          <span className="small faint">
            экспорт — email|password; файл переноса — JSON с cookies для другого экземпляра (нужен тот же HH_SECRET)
          </span>
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
              <Button variant="danger" loading={clearing} onClick={() => void clearLogs()}>
                Очистить
              </Button>
            </>
          }
        >
          <div className="small">
            Будут удалены журнал запросов (таблица на экране «Логи») и диагностические записи. Статистика,
            которая считается по запросам, обнулится. Аккаунты, ключи и модели не затрагиваются.
          </div>
        </Modal>
      ) : null}

      {modelOptions.length === 0 ? (
        <EmptyState title="Каталог моделей пуст" hint="Синхронизируйте модели на экране «Модели»." />
      ) : null}
    </Page>
  );
}
