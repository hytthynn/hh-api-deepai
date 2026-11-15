const numberFormat = new Intl.NumberFormat('ru-RU');

export function fmtInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return numberFormat.format(Math.round(value));
}

export function fmtDecimal(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits).replace('.', ',');
}

export function fmtUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `$${value.toFixed(2)}`;
}

export function fmtTheos(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return fmtDecimal(value, 2);
}

export function fmtPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(2)}%`;
}

export function fmtTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

/** Route label shown in the request log: one of the three public protocols. */
export function fmtRoute(endpoint: string): string {
  if (endpoint === 'chat' || endpoint === 'count_tokens') return 'openai';
  if (endpoint === 'responses') return 'responses';
  if (endpoint === 'messages') return 'anthropic';
  return endpoint;
}

export function fmtMs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return '—';
  if (value < 1_000) return `${Math.round(value)} мс`;
  return `${(value / 1_000).toFixed(2)} с`;
}

const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function fmtTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  return timeFormat.format(new Date(ts));
}

export function fmtDateTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  return dateTimeFormat.format(new Date(ts));
}

function plural(value: number, one: string, few: string, many: string): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function fmtAgo(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return '—';
  const diff = Math.max(0, now - ts);
  const sec = Math.round(diff / 1000);
  if (sec < 10) return 'только что';
  if (sec < 60) return `${sec} ${plural(sec, 'секунду', 'секунды', 'секунд')} назад`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} ${plural(min, 'минуту', 'минуты', 'минут')} назад`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `${hours} ${plural(hours, 'час', 'часа', 'часов')} назад`;
  const days = Math.round(hours / 24);
  return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
}

export function fmtUntil(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return '—';
  const diff = ts - now;
  if (diff <= 0) return 'сейчас';
  const sec = Math.ceil(diff / 1000);
  if (sec < 60) return `через ${sec} с`;
  const min = Math.ceil(sec / 60);
  if (min < 60) return `через ${min} ${plural(min, 'минуту', 'минуты', 'минут')}`;
  const hours = Math.ceil(min / 60);
  return `через ${hours} ${plural(hours, 'час', 'часа', 'часов')}`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '—';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec} с`;
  const min = Math.floor(sec / 60);
  const rest = sec % 60;
  return `${min} мин ${rest} с`;
}

export function truncate(value: string, max = 80): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}