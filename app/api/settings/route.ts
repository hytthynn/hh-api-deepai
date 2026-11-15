import { z } from 'zod';
import { api, ApiError, jsonBody, readJson } from '@/src/server/api';
import { allSettings, getSetting, setSetting } from '@/src/adapters/db/repositories/settings';
import { getModel } from '@/src/adapters/db/repositories/models';
import { changeAdminPassword } from '@/src/server/auth';
import { resetWalletCache } from '@/src/server/bm-wallet';
import { SECRET_SETTINGS } from '@/src/core/catalog';
import { env } from '@/src/lib/config';
import { logger } from '@/src/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MASKED = '••••••••';

function maskSecret(value: string | null): string {
  if (!value) return '';
  if (value.length <= 12) return MASKED;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export const GET = api(async () => {
  const rows = allSettings();
  const values: Record<string, string | null> = {};
  for (const row of rows) {
    if (SECRET_SETTINGS.has(row.key)) continue;
    values[row.key] = row.value;
  }
  return jsonBody({
    values,
    secrets: {
      'bm.api_key': getSetting('bm.api_key') !== null,
      'admin.password_hash': getSetting('admin.password_hash') !== null,
    },
    masked: {
      'bm.api_key': maskSecret(getSetting('bm.api_key')),
    },
    // Retention is an environment concern (HH_LOG_RETENTION_DAYS / HH_REQUEST_RETENTION_DAYS),
    // shown read-only in Настройки → Данные.
    retention: {
      logs_days: env.logRetentionDays,
      requests_days: env.requestRetentionDays,
    },
  });
});

const putSchema = z.object({
  'bm.api_key': z.string().trim().max(300).optional(),
  'bm.product_id': z.number().int().positive().max(1_000_000).optional(),
  'bm.verify_tls': z.boolean().optional(),
  'engine.workers': z.number().int().min(1).max(8).optional(),
  'engine.headless': z.boolean().optional(),
  'engine.proxy': z.string().trim().max(300).optional(),
  'engine.restart_after': z.number().int().min(1).max(1000).optional(),
  'balance.sync_interval_min': z.number().int().min(1).max(1440).optional(),
  'gateway.default_model': z.string().trim().min(1).max(120).optional(),
  'gateway.rpm_limit': z.number().int().min(1).max(6000).optional(),
  'gateway.expose_disabled': z.boolean().optional(),
  'responses.ttl_days': z.number().int().min(1).max(365).optional(),
  'admin.password': z.string().min(8, 'Пароль минимум 8 символов').max(200).optional(),
});

type SettingsInput = z.infer<typeof putSchema>;

function applySetting(key: Exclude<keyof SettingsInput, 'admin.password'>, value: string | number | boolean): void {
  const stored =
    typeof value === 'boolean' ? (value ? '1' : '0') : typeof value === 'number' ? String(value) : value;
  if (key === 'bm.api_key') {
    if (stored === '') return;
    setSetting(key, stored, true);
    resetWalletCache();
    return;
  }
  setSetting(key, stored);
  if (key === 'bm.product_id' || key === 'bm.verify_tls') resetWalletCache();
}

export const PUT = api(
  async (request) => {
    const input = await readJson(request, putSchema);
    const changed: string[] = [];

    if (input['gateway.default_model'] !== undefined) {
      const model = getModel(input['gateway.default_model']);
      if (!model) throw new ApiError('model_not_found', 400, `Модель "${input['gateway.default_model']}" отсутствует в каталоге`);
      if (!model.enabled) throw new ApiError('model_disabled', 400, `Модель "${model.id}" отключена`);
    }

    const secret = input['bm.api_key'];
    if (secret !== undefined) {
      applySetting('bm.api_key', secret);
      if (secret !== '') changed.push('bm.api_key');
    }
    const entries: Array<[keyof SettingsInput, string | number | boolean | undefined]> = [
      ['bm.product_id', input['bm.product_id']],
      ['bm.verify_tls', input['bm.verify_tls']],
      ['engine.workers', input['engine.workers']],
      ['engine.headless', input['engine.headless']],
      ['engine.proxy', input['engine.proxy']],
      ['engine.restart_after', input['engine.restart_after']],
      ['balance.sync_interval_min', input['balance.sync_interval_min']],
      ['gateway.default_model', input['gateway.default_model']],
      ['gateway.rpm_limit', input['gateway.rpm_limit']],
      ['gateway.expose_disabled', input['gateway.expose_disabled']],
      ['responses.ttl_days', input['responses.ttl_days']],
    ];
    for (const [key, value] of entries) {
      if (value === undefined) continue;
      applySetting(key as Exclude<keyof SettingsInput, 'admin.password'>, value);
      changed.push(key);
    }
    if (input['admin.password'] !== undefined) {
      changeAdminPassword(input['admin.password']);
      changed.push('admin.password');
    }
    if (changed.length > 0) logger.info('ui', `settings updated: ${changed.join(', ')}`);
    return jsonBody({ updated: changed });
  },
  { mutation: true },
);