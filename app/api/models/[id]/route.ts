import { z } from 'zod';
import { api, ApiError, jsonBody, readJson } from '@/src/server/api';
import { getModel, setModelEnabled } from '@/src/adapters/db/repositories/models';
import { logger } from '@/src/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';


export const PATCH = api<{ id: string }>(
  async (request, params) => {
    let id = params.id;
    try {
      id = decodeURIComponent(id);
    } catch {
      id = params.id;
    }
    if (!getModel(id)) throw new ApiError('not_found', 404, `Модель ${id} не найдена`);
    const body = await readJson(request, z.object({ enabled: z.boolean() }));
    setModelEnabled(id, body.enabled);
    logger.info('ui', `model ${id} ${body.enabled ? 'enabled' : 'disabled'}`);
    return jsonBody({ id, enabled: body.enabled });
  },
  { mutation: true },
);