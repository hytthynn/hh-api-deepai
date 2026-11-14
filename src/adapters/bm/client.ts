import 'server-only';
import { setTimeout as delay } from 'node:timers/promises';
import type { BmConfig, BmErrorCode, BmOrder, BmPort, BmProduct, BmWallet, ParsedLogin } from '@/src/core/ports/bm';
import { logger } from '@/src/lib/logger';

export const BM_BASE = 'https://bulkmail.shop/api/v2';
const TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;

export class BmError extends Error {
  readonly code: BmErrorCode;
  readonly status: number | null;

  constructor(code: BmErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'BmError';
    this.code = code;
    this.status = status;
  }
}

type Json = Record<string, unknown>;

function asJson(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function unwrap(body: unknown): unknown {
  const data = asJson(body);
  if (data.success === false) {
    const error = data.error ?? data.message ?? 'unknown BM error';
    throw mapBmMessage(String(error), null);
  }
  if ('data' in data) return data.data;
  return body;
}

export function mapBmMessage(message: string, status: number | null): BmError {
  const upper = message.toUpperCase();
  if (upper.includes('INSUFFICIENT_BALANCE')) {
    return new BmError('bm_insufficient_balance', 'Недостаточно средств в кошельке BM', status);
  }
  if (upper.includes('INSUFFICIENT_STOCK') || upper.includes('OUT_OF_STOCK')) {
    return new BmError('bm_insufficient_stock', 'Товар закончился на складе BM', status);
  }
  if (upper.includes('INVALID_PRODUCT') || upper.includes('PRODUCT_NOT_FOUND')) {
    return new BmError('bm_invalid_product', 'Продукт BM не найден или недоступен', status);
  }
  if (upper.includes('UNAUTHORIZED') || upper.includes('INVALID_API_KEY') || status === 401 || status === 403) {
    return new BmError('bm_unauthorized', 'BM отклонил API-ключ', status);
  }
  return new BmError('bm_http_error', message.slice(0, 300), status);
}

export function parseLogins(lines: string[]): { parsed: ParsedLogin[]; invalid: string[] } {
  const parsed: ParsedLogin[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const raw = line.trim();
    if (!raw) continue;
    const separator = raw.includes('|') ? raw.indexOf('|') : raw.indexOf(':');
    if (separator <= 0) {
      invalid.push(raw.slice(0, 120));
      continue;
    }
    const email = raw.slice(0, separator).trim();
    const password = raw.slice(separator + 1).trim();
    if (!email.includes('@') || password.length === 0) {
      invalid.push(raw.slice(0, 120));
      continue;
    }
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push({ email, password });
  }
  return { parsed, invalid };
}

export class BmClient implements BmPort {
  private readonly config: BmConfig;

  constructor(config: BmConfig) {
    this.config = config;
  }

  private async request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    if (!this.config.apiKey) throw new BmError('bm_not_configured', 'API-ключ BM не задан');
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetch(`${BM_BASE}${path}`, {
          method,
          headers: {
            'X-API-Key': this.config.apiKey,
            'User-Agent': 'hh-api/1.0',
            Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        const text = await response.text();
        if (response.status >= 500 && attempt <= MAX_RETRIES) {
          logger.warn('bm', `BM ${method} ${path} → ${response.status}, retry ${attempt}/${MAX_RETRIES}`);
          await delay(1_000 * 2 ** (attempt - 1));
          continue;
        }
        let payload: unknown = text;
        try {
          payload = text ? JSON.parse(text) : {};
        } catch {
          payload = { success: false, error: text.slice(0, 200) };
        }
        if (response.status === 422) {
          const errors = asJson(asJson(payload).errors);
          const firstKey = Object.keys(errors)[0];
          const message = firstKey ? `${firstKey}: ${String(errors[firstKey])}` : '422 validation error';
          throw new BmError('bm_http_error', message, 422);
        }
        if (!response.ok && response.status !== 400) {
          throw mapBmMessage(`BM HTTP ${response.status}`, response.status);
        }
        return unwrap(payload);
      } catch (error) {
        if (error instanceof BmError) throw error;
        if (attempt > MAX_RETRIES) {
          if (controller.signal.aborted) throw new BmError('bm_timeout', 'BM не ответил за 60 с');
          throw new BmError('bm_http_error', error instanceof Error ? error.message : String(error));
        }
        await delay(1_000 * 2 ** (attempt - 1));
      } finally {
        clearTimeout(timer);
      }
    }
  }

  async wallet(): Promise<BmWallet> {
    const data = asJson(await this.request('GET', '/wallet/balance'));
    const wallet = asJson(data.wallet);
    return {
      balance: num(data.balance ?? wallet.balance ?? data.amount),
      currency: String(data.currency ?? wallet.currency ?? 'USD'),
    };
  }

  async product(id: number): Promise<BmProduct> {
    const data = asJson(await this.request('GET', `/products/${id}`));
    const product = asJson(data.product ?? data);
    const quantities = asArray(product.allowed_quantities ?? product.allowedQuantities)
      .map((value) => num(value))
      .filter((value) => value > 0);
    return {
      id: num(product.id, id),
      name: String(product.name ?? product.title ?? `product ${id}`),
      price: num(product.price ?? product.price_usd ?? product.unit_price),
      currency: String(product.currency ?? 'USD'),
      allowedQuantities: quantities.length > 0 ? quantities : [1],
      inStock: product.in_stock !== false && product.stock !== 0,
    };
  }

  async createOrder(productId: number, quantity: number): Promise<BmOrder> {
    const data = asJson(await this.request('POST', '/orders', { product_id: productId, quantity }));
    return toOrder(data, quantity);
  }

  async getOrder(id: number): Promise<BmOrder> {
    const data = asJson(await this.request('GET', `/orders/${id}`));
    return toOrder(data, 0);
  }

  async purchases(orderId: number): Promise<string[]> {
    const data = asJson(await this.request('GET', `/purchases?order_id=${orderId}`));
    const rows = asArray(data.purchases ?? data.items ?? data);
    return rows.map(extractLine).filter((line): line is string => typeof line === 'string' && line.length > 0);
  }
}

function extractLine(raw: unknown): string | null {
  if (typeof raw === 'string') return raw;
  const item = asJson(raw);
  if (typeof item.data === 'string') return item.data;
  if (typeof item.line === 'string') return item.line;
  if (typeof item.value === 'string') return item.value;
  if (typeof item.email === 'string' && typeof item.password === 'string') return `${item.email}|${item.password}`;
  return null;
}

function toOrder(raw: Json, quantity: number): BmOrder {
  const order = asJson(raw.order ?? raw);
  const items = asArray(order.items ?? raw.items)
    .map(extractLine)
    .filter((line): line is string => typeof line === 'string' && line.length > 0);
  return {
    id: num(order.id ?? order.order_id),
    status: String(order.status ?? 'pending'),
    quantity: num(order.quantity, quantity),
    totalAmount: num(order.total_amount ?? order.total ?? order.amount),
    items,
  };
}

export function bmConfigFromSettings(get: (key: string) => string | null): BmConfig | null {
  const apiKey = get('bm.api_key');
  if (!apiKey) return null;
  return {
    apiKey,
    verifyTls: get('bm.verify_tls') !== '0',
    productId: Number(get('bm.product_id') ?? 578) || 578,
  };
}