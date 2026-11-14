# ТЗ: hh-api — локальный шлюз с автозакупкой и автрегистрацией аккаунтов

| Поле | Значение |
|---|---|
| Версия | 1.0 |
| Дата | 2026-11-14 |
| Статус | Утверждено к реализации |
| Кодовое имя | `hh-api` |
| Репозиторий | `deepai-code-autoreg` (локальный, Windows) |
| Рантайм | Next.js 16.4.x (App Router) + Python 3.11+ воркер |
| Язык интерфейса | Русский |
| Порт по умолчанию | `3210`, только `127.0.0.1` |
| Валюта расчётов | USD (BM), Theos (провайдер) |

---

## 1. Цель

Локальное однопользовательское веб-приложение, которое:

1. покупает одноразовые Google-логины в BM (bulkmail.shop) по API-ключу из настроек;
2. автоматически регистрирует по ним аккаунты провайдера (DeepAI Code) через Google OAuth в реальном Chrome;
3. хранит cookies/machine-id и показывает баланс по каждому аккаунту;
4. выдаёт локальные ключи `hh-api-...`, совместимые одновременно с OpenAI Chat Completions, OpenAI Responses и Anthropic Messages;
5. при исчерпании лимита/ошибке аккаунта прозрачно переключает запрос на следующий;
6. показывает каталог моделей, подтянутый из провайдера, логи и статистику.

Продукт ставится на машину владельца, запускается одной командой и не требует облака.

---

## 2. Границы

### 2.1 Входит в объём

- Покупка логинов и регистрация аккаунтов пачкой с прогрессом по каждому аккаунту.
- Ручное добавление аккаунта (email + пароль), удаление, отключение.
- Проверка баланса: по одному, все сразу, по расписанию.
- Три протокола шлюза: `/v1/chat/completions`, `/v1/responses`, `/v1/messages`.
- Управление ключами доступа, каталог моделей, логи, статистика.
- Единый локальный запуск, миграции БД, healthcheck.

### 2.2 Не входит в объём

- Мультипользовательность, роли, биллинг клиентов, облачный деплой.
- Регистрация email-ящиков, решение reCAPTCHA, покупка прокси.
- `/v1/embeddings`, `/v1/images`, `/v1/audio`, `/v1/files`, батчи, fine-tuning.
- Прокси-режим для внешних API, кэширование ответов моделей.
- Мобильная версия, i18n, светлая тема.

### 2.3 Жёсткие ограничения

- Приложение слушает только loopback. Публикация наружу — вне продукта.
- Секреты (BM-ключ, пароли аккаунтов, cookies, локальные ключи) не хранятся в открытом виде.
- Ни один секрет не попадает в логи, ответы API и git.
- Лимиты закупки не ограничиваются продуктом (решение владельца), но фактическая сумма и остаток кошелька показываются до и после запуска.

---

## 3. Термины

| Термин | Значение |
|---|---|
| Провайдер | `api.deepai.org`, раздел `deepai_code` |
| BM | `bulkmail.shop`, API v2, продавец Google-логинов |
| Логин | пара `email\|password` со сроком жизни ~24 ч |
| Аккаунт | зарегистрированный профиль провайдера: cookies + machine-id + баланс |
| Theos | внутренняя валюта провайдера, 65/сутки на аккаунт, `refresh_at` |
| Free-модель | модель, не расходующая Theos (11 шт., см. §19) |
| Paid-модель | модель, списывающая Theos (16 шт., см. §19) |
| Слот | право одного активного запроса на аккаунт (апстрим допускает 1 сессию) |
| HH-ключ | локальный ключ `hh-api-…`, проксирующий запросы к провайдеру |

---

## 4. Пользовательские сценарии

**S1. Первый запуск.** Владелец открывает `http://127.0.0.1:3210`, вводит пароль администратора из `.env.local`, попадает на обзор. Все разделы пустые, в шапке баннер «BM-ключ не задан».

**S2. Настройка BM.** Настройки → поле «API-ключ BM» → «Проверить» → показывается баланс кошелька и имя продукта `id 578`. Ключ сохраняется зашифрованным.

**S3. Закупка и регистрация.** Аккаунты → «Добавить аккаунты» → количество `20`, воркеров `2`, headless выключен → «Запустить». Показывается расчёт: `20 × $0.0166 ≈ $0.33`, остаток кошелька. Через 8–12 минут в таблице 17–18 активных аккаунтов, у каждого баланс 65 Theos, у 2–3 — статус `failed` с причиной (`GOOGLE_CAPTCHA`, `IAP`).

**S4. Подключение IDE.** Ключи → «Создать ключ» → имя `claude-code` → ключ `hh-api-…` показывается один раз, копируется. Владелец вставляет `ANTHROPIC_BASE_URL=http://127.0.0.1:3210` и `ANTHROPIC_AUTH_TOKEN=hh-api-…` в `~/.claude/settings.json`. Claude Code работает.

**S5. Исчерпание лимита.** Аккаунт A отдаёт `429`/`insufficient`. Запрос автоматически уходит на аккаунт B; клиент получает `200` и не замечает переключения. В логах — запись `gateway warn: failover A→B (429)`. В статистике видно `attempts=2`.

**S6. Диагностика.** Логи → фильтр `level=error`, `scope=gateway` за 24 ч. Видно 3 ошибки `machine_required`, все вылечены ротацией machine-id. Статистика показывает p95 latency 1.8 с и 0.42 Theos за сутки.

---

## 5. Архитектура

### 5.1 Процессы

```
┌──────────────────────────── Next.js (Node 22, порт 3210) ───────────────────────────┐
│  UI (RSC + client components)        /api/*  (admin, cookie-сессия)                  │
│  /v1/*  (gateway, HH-ключ)                                                           │
│                                                                                      │
│  core/  ── домен, без импортов Next и БД                                             │
│  adapters/db (Drizzle + better-sqlite3, WAL)                                          │
│  adapters/upstream (DeepAI client: cookies, lane-заголовки, retry-классификация)      │
│  adapters/bm (bulkmail.shop v2)                                                      │
│  adapters/engine (пул Python-процессов, NDJSON over stdio)                            │
│  jobs/  ── runner в том же процессе, стартует из instrumentation.ts                  │
└──────────────────────────────────────────────────────────────────────────────────────┘
              │ spawn (stdio)                         │ HTTPS
              ▼                                       ▼
   engine/worker.py  ── playwright ── Chrome   api.deepai.org / bulkmail.shop
```

Один процесс Node. Воркеры регистрации — дочерние Python-процессы. Состояние — только в SQLite; легаси-файлов (`bank.jsonl`, `accounts.txt`, `legacy/`) в проекте нет (ADR-020).

### 5.2 Почему Python-воркер

OAuth-контур провайдера отлажен в `oauth.py` (последовательность identifier → password → speedbump → consent, обработка `ALLAUTH_FAIL`/`IAP`/`GOOGLE_CAPTCHA`). Перенос на TS не даёт функционального выигрыша: детект Google одинаков для обоих биндингов Playwright, а переотладка стоит недель. Воркер изолирует браузер от биллинговой логики и позволяет перезапускать Chrome без рестарта веба.

### 5.3 Поток запроса шлюза

1. Аутентификация ключа (`Authorization: Bearer`, `x-api-key`, `api-key`) → `api_keys` по SHA-256 с перцем.
2. Rate limit ключа (token bucket, `rpm_limit`).
3. Валидация тела (Zod по протоколу) → нормализация в `ChatRequest`.
4. Выбор аккаунта под модель (free/paid, статус, кулдаун, слот).
5. Вызов апстрима с lane/machine/beacon/instance-заголовками.
6. Классификация ответа: успех → стрим/JSON; ретраибельный → следующий аккаунт; фатальный → ответ клиенту.
7. Запись `requests`, `logs`; освобождение слота.

Подробно — §16.

---

## 6. Стек и версии

| Слой | Выбор | Версия |
|---|---|---|
| Runtime | Node.js LTS | 22.x (минимум 20.9) |
| Framework | Next.js, App Router, TypeScript strict | 16.4.6 |
| UI | React | 19.x |
| Стили | Tailwind CSS | 4.3.x |
| Иконки | lucide-react | 0.5xx |
| БД | SQLite + better-sqlite3, WAL | ^12 |
| ORM/миграции | Drizzle ORM + drizzle-kit | ^0.44 |
| Валидация | Zod | ^4 |
| Тесты | Vitest + Playwright (для e2e UI, опционально) | latest |
| Воркер | Python + playwright + requests | 3.11+ / 1.45+ |
| Логи | собственный writer (stdout + таблица `logs`) | — |

Запрещено добавлять: state-менеджеры (Redux/Zustand), UI-киты (MUI/shadcn), chart-библиотеки, axios, ORM-альтернативы. Графики — SVG вручную.

Cache Components из Next 16.4 **не включаем**: все страницы динамические (`export const dynamic = 'force-dynamic'`), данные читаются из SQLite на каждом запросе.

---

## 7. Структура репозитория

```
.
├─ app/
│  ├─ (auth)/login/page.tsx
│  ├─ (dashboard)/
│  │  ├─ layout.tsx                # сайдбар + шапка
│  │  ├─ page.tsx                  # обзор
│  │  ├─ accounts/page.tsx
│  │  ├─ keys/page.tsx
│  │  ├─ models/page.tsx
│  │  ├─ logs/page.tsx
│  │  ├─ stats/page.tsx
│  │  └─ settings/page.tsx
│  ├─ api/
│  │  ├─ auth/{login,logout,session}/route.ts
│  │  ├─ overview/route.ts
│  │  ├─ accounts/route.ts
│  │  ├─ accounts/[id]/route.ts
│  │  ├─ accounts/[id]/check/route.ts
│  │  ├─ accounts/check-all/route.ts
│  │  ├─ jobs/route.ts
│  │  ├─ jobs/[id]/route.ts
│  │  ├─ keys/route.ts
│  │  ├─ keys/[id]/route.ts
│  │  ├─ models/route.ts
│  │  ├─ models/sync/route.ts
│  │  ├─ logs/route.ts
│  │  ├─ stats/route.ts
│  │  ├─ requests/route.ts
│  │  └─ settings/route.ts
│  ├─ v1/
│  │  ├─ models/route.ts
│  │  ├─ models/[id]/route.ts
│  │  ├─ chat/completions/route.ts
│  │  ├─ responses/route.ts
│  │  ├─ responses/[id]/route.ts
│  │  ├─ messages/route.ts
│  │  └─ messages/count_tokens/route.ts
│  ├─ healthz/route.ts
│  ├─ layout.tsx
│  └─ globals.css
├─ src/
│  ├─ core/
│  │  ├─ entities/{account,api-key,model,request-log,job}.ts
│  │  ├─ ports/{accounts,keys,models,logs,requests,upstream,engine,bm}.ts
│  │  ├─ gateway/
│  │  │  ├─ normalize.ts          # 3 протокола → ChatRequest
│  │  │  ├─ render-chat.ts
│  │  │  ├─ render-responses.ts
│  │  │  ├─ render-anthropic.ts
│  │  │  ├─ failover.ts           # чистая машина состояний
│  │  │  ├─ errors.ts
│  │  │  └─ sse.ts
│  │  └─ accounts/{select.ts,state.ts,balance.ts}
│  ├─ adapters/
│  │  ├─ db/{client.ts,schema.ts,repositories/*.ts,migrate.ts}
│  │  ├─ upstream/{deepai.ts,headers.ts,cookies.ts}
│  │  ├─ bm/client.ts
│  │  └─ engine/{pool.ts,protocol.ts}
│  ├─ jobs/{runner.ts,provision.ts,probe.ts,models-sync.ts,cron.ts}
│  ├─ lib/{config.ts,crypto.ts,logger.ts,redact.ts,rate-limit.ts,ids.ts,locks.ts}
│  ├─ ui/{components/*,hooks/*,charts/*}
│  └─ instrumentation.ts
├─ engine/
│  ├─ worker.py                   # NDJSON-протокол
│  ├─ dpcode.py                   # machine-id, lane-заголовки, сессия, theos, models
│  ├─ oauth.py                    # один аккаунт: OAuth → cookies
│  └─ requirements.txt
├─ drizzle/                       # сгенерированные SQL-миграции
├─ data/hh.db                     # runtime, gitignored
├─ docs/{SPEC.md,DESIGN.md,BUGS.md,DECISIONS.md}
├─ scripts/doctor.mjs
├─ tests/{unit,integration,fixtures}
├─ AGENTS.md
├─ ROADMAP.md
├─ .env.example
└─ package.json
```

Правила зависимостей:

- `src/core/**` не импортирует `next/*`, `drizzle-orm`, `better-sqlite3`, `node:child_process`.
- `src/adapters/**` реализует порты из `core/ports`; наружу не отдаёт строки БД.
- `app/**` — только композиция: парсинг HTTP, вызов core/adapters, рендер.
- Всё серверное помечается `import 'server-only'`.

---

## 8. Модель данных

SQLite, `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`. Все временные метки — unix ms (`INTEGER`). Шифрование — §22.3.

```sql
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,             -- для encrypted=1: v1.<iv>.<tag>.<ct> base64
  encrypted   INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE,
  password_enc    TEXT,
  cookies_enc     TEXT,
  machine         TEXT,                  -- sha256(MachineGuid + salt)
  status          TEXT NOT NULL DEFAULT 'pending',
                  -- pending|active|cooldown|exhausted|dead|disabled
  balance         REAL NOT NULL DEFAULT 0,
  granted         REAL NOT NULL DEFAULT 0,
  refresh_at      TEXT,                  -- ISO8601 из провайдера
  lane_version    INTEGER,
  last_used_at    INTEGER,
  last_checked_at INTEGER,
  cooldown_until  INTEGER NOT NULL DEFAULT 0,
  fail_count      INTEGER NOT NULL DEFAULT 0,
  success_count   INTEGER NOT NULL DEFAULT 0,
  source          TEXT NOT NULL DEFAULT 'manual',  -- manual|bm|import
  bm_order_id     INTEGER,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  notes           TEXT
);
CREATE INDEX idx_accounts_pick ON accounts(status, cooldown_until, last_used_at);

CREATE TABLE balance_samples (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ts          INTEGER NOT NULL,
  balance     REAL NOT NULL,
  granted     REAL NOT NULL,
  refresh_at  TEXT
);
CREATE INDEX idx_balance_account_ts ON balance_samples(account_id, ts);

CREATE TABLE api_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,             -- hh-api-ab12cd34
  last4        TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,      -- sha256(pepper || key)
  rpm_limit    INTEGER NOT NULL DEFAULT 60,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER
);

CREATE TABLE models (
  id             TEXT PRIMARY KEY,
  display_name   TEXT NOT NULL,
  free           INTEGER NOT NULL DEFAULT 0,
  premier        INTEGER NOT NULL DEFAULT 0,
  context_window INTEGER,
  max_tokens     INTEGER,
  modalities     TEXT NOT NULL DEFAULT 'text',   -- csv: text,image
  enabled        INTEGER NOT NULL DEFAULT 1,
  synced_at      INTEGER NOT NULL
);

CREATE TABLE requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            INTEGER NOT NULL,
  request_id    TEXT NOT NULL,
  api_key_id    INTEGER REFERENCES api_keys(id) ON DELETE SET NULL,
  endpoint      TEXT NOT NULL,           -- chat|responses|messages|count_tokens|models
  model         TEXT,
  stream        INTEGER NOT NULL DEFAULT 0,
  account_id    INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  attempts      INTEGER NOT NULL DEFAULT 1,
  http_status   INTEGER,
  latency_ms    INTEGER,
  first_byte_ms INTEGER,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  theos_before  REAL,
  theos_after   REAL,
  error_code    TEXT,
  client        TEXT,
  detail        TEXT
);
CREATE INDEX idx_requests_ts ON requests(ts DESC);
CREATE INDEX idx_requests_model_ts ON requests(model, ts DESC);

CREATE TABLE logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  level       TEXT NOT NULL,             -- debug|info|warn|error
  scope       TEXT NOT NULL,             -- gateway|engine|bm|accounts|jobs|ui|system
  message     TEXT NOT NULL,
  account_id  INTEGER,
  request_id  TEXT,
  meta        TEXT
);
CREATE INDEX idx_logs_ts ON logs(ts DESC);
CREATE INDEX idx_logs_scope_level ON logs(scope, level, ts DESC);

CREATE TABLE jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL,             -- provision|probe|models_sync
  status      TEXT NOT NULL,             -- queued|running|cancelled|done|failed
  params      TEXT NOT NULL,
  total       INTEGER NOT NULL DEFAULT 0,
  done        INTEGER NOT NULL DEFAULT 0,
  ok          INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  spent_usd   REAL NOT NULL DEFAULT 0,
  error       TEXT,
  created_at  INTEGER NOT NULL,
  started_at  INTEGER,
  finished_at INTEGER
);

CREATE TABLE job_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  email      TEXT,
  stage      TEXT NOT NULL,              -- queued|purchasing|purchased|registering|probing|ok|failed
  attempts   INTEGER NOT NULL DEFAULT 0,
  error      TEXT,
  account_id INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_job_items_job ON job_items(job_id);

CREATE TABLE bm_orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  bm_order_id  INTEGER UNIQUE,
  product_id   INTEGER NOT NULL,
  quantity     INTEGER NOT NULL,
  unit_price   REAL,
  total_usd    REAL,
  status       TEXT NOT NULL,            -- pending|completed|cancelled|refunded
  items        INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  finished_at  INTEGER
);

CREATE TABLE responses (
  id          TEXT PRIMARY KEY,          -- resp_<24 base36>
  api_key_id  INTEGER,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  request     TEXT NOT NULL,             -- JSON исходного запроса
  response    TEXT NOT NULL              -- JSON отданного ответа
);
CREATE INDEX idx_responses_expires ON responses(expires_at);

CREATE TABLE locks (
  name TEXT PRIMARY KEY,
  pid  INTEGER NOT NULL,
  ts   INTEGER NOT NULL
);
```

Ретеншн (ежедневно в 04:00 локального времени): `logs` > 14 дней, `requests` > 90 дней, `balance_samples` > 30 дней, `responses` с истёкшим `expires_at`, `jobs` старше 30 дней вместе с items. Затем `PRAGMA optimize` и `VACUUM` (только при свободном месте > 20%).

---

## 9. Конфигурация

`.env.local` (не коммитится):

```env
HH_PORT=3210
HH_HOST=127.0.0.1
HH_SECRET=            # 32+ случайных байта, base64; без него приложение не стартует
HH_ADMIN_PASSWORD=    # пароль входа в UI; пусто → генерируется при первом старте и печатается в консоль
HH_DB_PATH=./data/hh.db
HH_ENGINE_DIR=./engine
HH_PYTHON=python
HH_LOG_RETENTION_DAYS=14
HH_REQUEST_RETENTION_DAYS=90
HH_DEFAULT_RPM=60
HH_UPSTREAM_TIMEOUT_MS=300000
HH_SLOT_WAIT_MS=45000
HH_MEASURE_THEOS=0
```

`HH_SECRET` — мастер-ключ: из него scrypt-ом (N=2^15, r=8, p=1, salt=`hh-api-v1`) выводится 32-байтовый ключ AES-256-GCM и перец для хеширования HH-ключей. Смена `HH_SECRET` делает нечитаемыми все сохранённые секреты — в UI есть предупреждение и кнопка «Экспорт аккаунтов» (без паролей).

Настройки в БД (`settings`, шифруются помеченные 🔒):

| Ключ | Тип | По умолчанию | Описание |
|---|---|---|---|
| `bm.api_key` 🔒 | string | — | ключ BM, `sk_live_…` |
| `bm.product_id` | int | `578` | продукт «24h Google-логин» |
| `bm.verify_tls` | bool | `1` | проверка сертификата |
| `engine.workers` | int | `2` | параллельные Chrome-контексты |
| `engine.headless` | bool | `0` | headful устойчивее к детекту |
| `engine.proxy` | string | — | `http://user:pass@host:port` |
| `engine.restart_after` | int | `10` | перезапуск Python-воркера после N аккаунтов |
| `balance.sync_interval_min` | int | `5` | период фоновой проверки баланса |
| `gateway.default_model` | string | `glm-5.3-flash` | модель при `model` вне каталога и в `count_tokens` |
| `gateway.expose_disabled` | bool | `0` | отдавать ли выключенные модели в `/v1/models` |
| `responses.ttl_days` | int | `7` | срок хранения Responses |

---

## 10. Внутренний API (admin)

Префикс `/api`. Аутентификация — httpOnly cookie `hh_session` (HMAC-SHA256 от `HH_SECRET`, TTL 7 дней, `SameSite=Lax`). Все мутации требуют заголовок `Origin: http://127.0.0.1:3210` либо его отсутствие при прямом curl. Ошибки — `{"error":{"code":"...","message":"..."}}`.

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/api/auth/login` | `{password}` → cookie; 5 попыток / 10 мин на IP |
| POST | `/api/auth/logout` | сброс cookie |
| GET | `/api/auth/session` | `{authenticated:true}` |
| GET | `/api/overview` | счётчики, баланс, последние ошибки |
| GET | `/api/accounts` | `?status=&q=&page=&per=50` |
| POST | `/api/accounts` | `{email,password}` — ручное добавление |
| PATCH | `/api/accounts/:id` | `{status:"disabled"\|"active"}` |
| DELETE | `/api/accounts/:id` | удаление вместе с cookies |
| POST | `/api/accounts/:id/check` | проверка баланса одного |
| POST | `/api/accounts/check-all` | фоновая проверка всех |
| POST | `/api/jobs` | `{type:"provision",quantity,productId?,workers?,headless?,proxy?}` → `{jobId}` |
| GET | `/api/jobs/:id` | прогресс + items |
| POST | `/api/jobs/:id/cancel` | отмена: `cancelled` сразу, in-flight регистрация прерывается, item возвращается в `purchased` (ADR-018) |
| GET | `/api/keys` | список без секретов |
| POST | `/api/keys` | `{name,rpmLimit}` → `{key:"hh-api-…"}` (единственный раз) |
| DELETE | `/api/keys/:id` | отзыв (`revoked_at`) |
| GET | `/api/models` | каталог из БД |
| POST | `/api/models/sync` | синхронизация из провайдера |
| PATCH | `/api/models/:id` | `{enabled:boolean}` |
| GET | `/api/logs` | `?level=&scope=&accountId=&q=&before=&per=100` |
| GET | `/api/requests` | `?model=&status=&from=&to=&page=` |
| GET | `/api/stats` | `?range=24h\|7d\|30d` |
| GET | `/api/settings` | значения; 🔒-поля маскируются `sk_live_…ab12` |
| PUT | `/api/settings` | частичное обновление; пустая строка для 🔒 = «не менять» |
| POST | `/api/settings/bm/test` | проверка ключа: баланс кошелька + продукт |

`GET /api/overview`:

```json
{
  "accounts": {"total": 18, "active": 16, "cooldown": 1, "exhausted": 1, "dead": 0},
  "balance_theos": 1040.0,
  "bm": {"configured": true, "wallet_usd": 12.41},
  "today": {"requests": 842, "errors": 7, "error_rate": 0.0083, "p95_ms": 2140,
            "input_tokens": 412300, "output_tokens": 88210, "theos_spent": 0.42},
  "recent_errors": [
    {"ts": 1763120012345, "scope": "gateway", "message": "failover B→C (429)", "request_id": "req_1f3a"}
  ]
}
```

---

## 11. Шлюз: аутентификация и общие правила

Базовый URL: `http://127.0.0.1:3210` (UI и API на одном origin).

Ключ принимается из любого из заголовков, в порядке приоритета:

1. `Authorization: Bearer hh-api-…`
2. `x-api-key: hh-api-…` (Anthropic)
3. `api-key: hh-api-…` (Azure-стиль)

Формат ключа: `hh-api-` + 48 символов `[A-Za-z0-9]`, генерируется из 32 случайных байт (`crypto.randomBytes(32).toString('base64url')` без `-`/`_` → в base62-алфавит, 48 символов). В БД — только `sha256(pepper || key)`; сравнение `timingSafeEqual`. Отображение: `hh-api-a1b2c3d4…wxyz` (`prefix` = первые 12 символов, `last4`).

Ошибки аутентификации:

| Условие | HTTP | Тело (OpenAI) | Тело (Anthropic) |
|---|---|---|---|
| нет ключа | 401 | `{"error":{"message":"Missing API key","type":"invalid_request_error","code":"missing_api_key"}}` | `{"type":"error","error":{"type":"authentication_error","message":"Missing API key"}}` |
| ключ неверен/отозван | 401 | `... "type":"invalid_request_error","code":"invalid_api_key"` | `... "type":"authentication_error","message":"Invalid API key"` |
| rpm превышен | 429 | `... "type":"rate_limit_error","code":"rate_limit_exceeded"` + `Retry-After` | `... "type":"rate_limit_error"` |
| нет аккаунтов | 429 | `... "type":"rate_limit_error","code":"no_account_available"` + `Retry-After: 30` | то же |

Каждый ответ шлюза содержит `x-request-id: req_<12 base36>`, `x-hh-attempts: <n>`, `x-hh-account: <masked email>`. Заголовки не раскрывают cookies и полный email (маска `a***@d***.us`).

Ответы `GET /v1/models` (OpenAI-формат):

```json
{"object":"list","data":[
  {"id":"glm-5.3-flash","object":"model","created":1763000000,"owned_by":"deepai",
   "context_window":1000000,"max_tokens":131072,"hh":{"free":true,"premier":false,"modalities":["text","image"]}}
]}
```

`GET /v1/models/:id` — тот же объект либо `404 model_not_found`. В список попадают только `enabled=1` (или все при `gateway.expose_disabled=1`).

`GET /healthz` (без ключа, только loopback): `{"ok":true,"accounts":{"active":16,"total":18},"db":"ok","engine":{"python":"3.12.4","playwright":"1.49.0"},"uptime_s":4210}`.

---

## 12. Шлюз: OpenAI Chat Completions

`POST /v1/chat/completions`. `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.

Принимаемые поля: `model`, `messages`, `stream`, `stream_options.include_usage`, `max_tokens`, `max_completion_tokens`, `temperature`, `top_p`, `stop`, `n`, `presence_penalty`, `frequency_penalty`, `seed`, `user`, `tools`, `tool_choice`, `parallel_tool_calls`, `response_format`, `reasoning_effort`, `service_tier`, `metadata`.

Ограничения: `n` допускается только `1` (иначе 400 `unsupported_parameter`); `logprobs=true` → 400; неизвестные поля игнорируются, но сохраняются в `requests.detail` при `HH_DEBUG_BODY=1`.

`response_format: {"type":"json_schema","json_schema":{"name","schema","strict"}}` транслируется в апстрим как есть; при отказе апстрима `400` возвращается клиенту без ретрая.

Стриминг — прозрачный passthrough SSE от апстрима с добавлением `data: [DONE]`, если его нет. При `stream_options.include_usage=true` финальный чанк с `usage` сохраняется как есть.

Нон-стрим ответ:

```json
{"id":"chatcmpl-<24 base36>","object":"chat.completion","created":1763120012,
 "model":"claude-opus-5-5","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},
 "finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":1,"total_tokens":13}}
```

Маппинг `finish_reason`: апстрим `stop|length|tool_calls|content_filter` → как есть; отсутствует → `stop`.

---

## 13. Шлюз: OpenAI Responses

`POST /v1/responses`, `GET/DELETE /v1/responses/:id`, `POST /v1/responses/:id/cancel`.

Вход:

- `input` — строка либо массив items (`message`, `function_call`, `function_call_output`, `reasoning`).
- `instructions` — system-сообщение (приоритет выше `input`-system).
- `max_output_tokens`, `temperature`, `top_p`, `stream`, `store` (по умолчанию `true`), `previous_response_id`, `tools`, `tool_choice`, `parallel_tool_calls`, `text.format`, `reasoning.effort`, `metadata`, `truncation`.

Трансляция в Chat Completions:

| Responses | Chat |
|---|---|
| `instructions` | `{"role":"system","content":instructions}` |
| `input: "text"` | `{"role":"user","content":"text"}` |
| `message{role,content[]}` с `input_text` | склейка текстовых частей в `content` |
| `input_image` (`image_url` или data URL) | `{"type":"image_url","image_url":{"url":...}}` |
| `function_call{call_id,name,arguments}` | assistant `tool_calls[]` |
| `function_call_output{call_id,output}` | `{"role":"tool","tool_call_id":call_id,"content":output}` |
| `tools[{type:"function",name,description,parameters}]` | `{"type":"function","function":{name,description,parameters}}` |
| `text.format = {type:"json_schema",name,schema,strict}` | `response_format` |
| `max_output_tokens` | `max_tokens` |

Ответ (нон-стрим): `object:"response"`, `status:"completed"`, `output[]` с `message` (`output_text`) и/или `function_call`, `usage{input_tokens,output_tokens,total_tokens}`, `output_text` — convenience-поле с конкатенацией текста, `previous_response_id`, `store`.

`previous_response_id`: при наличии в БД записи — её `response.output` подставляется в начало `input` (как элементы Responses-формата), `instructions` не наследуется. Отсутствующий id → 404 `previous_response_not_found`. `store:false` → запись не создаётся, `previous_response_id` в ответе `null`.

Стриминг — последовательность событий (порядок обязателен):

```
response.created
response.in_progress
response.output_item.added        (type=message, id=msg_…)
response.content_part.added       (part: output_text)
response.output_text.delta        × N
response.output_text.done
response.content_part.done
response.output_item.done
response.completed                (response с usage)
```

Для tool-call: `response.output_item.added` (`type=function_call`) → `response.function_call_arguments.delta` (`delta` — фрагмент JSON) → `response.function_call_arguments.done` → `response.output_item.done` → `response.completed`. Ошибка после старта стрима — `event: error` с `{"type":"error","code":...,"message":...}` и закрытие.

---

## 14. Шлюз: Anthropic Messages

`POST /v1/messages` и `POST /v1/messages/count_tokens`. Заголовки `anthropic-version` (принимается любой, по умолчанию `2023-06-01`), `anthropic-beta` (игнорируется).

Вход: `model`, `max_tokens` (обязателен, 1..131072), `messages`, `system` (строка или массив текстовых блоков), `temperature`, `top_p`, `top_k` (игнорируется), `stop_sequences`, `stream`, `tools`, `tool_choice`, `thinking` (игнорируется, в лог `debug`), `metadata`.

Трансляция:

| Anthropic | Chat |
|---|---|
| `system` | system-сообщение (блоки склеиваются через `\n\n`) |
| `messages[].role: "system"` (так Claude Code присылает env-промпт) | приклеивается к system-сообщению через `\n\n` в порядке прихода, само сообщение в chat не попадает (B-024) |
| `content: "text"` | строка |
| блок `{"type":"text","text":…}` | текстовая часть |
| блок `{"type":"image","source":{"type":"base64","media_type","data"}}` | `image_url` с `data:<media_type>;base64,<data>` |
| блок `{"type":"tool_use","id","name","input"}` в assistant | `tool_calls[{id,type:"function",function:{name,arguments:JSON.stringify(input)}}]` |
| блок `{"type":"tool_result","tool_use_id","content"}` в user | `{"role":"tool","tool_call_id":tool_use_id,"content":text}` (все результаты — отдельными сообщениями до пользовательского текста) |
| `tools[{name,description,input_schema}]` | `{"type":"function","function":{"name","description","parameters":input_schema}}` |
| `tool_choice: "auto"\|"any"\|{"type":"tool","name"}` | `"auto"\|"required"\|{"type":"function","function":{"name"}}` |
| `stop_sequences` | `stop` |

Ответ:

```json
{"id":"msg_<24 base36>","type":"message","role":"assistant","model":"claude-opus-5-5",
 "content":[{"type":"text","text":"ok"}],
 "stop_reason":"end_turn","stop_sequence":null,
 "usage":{"input_tokens":12,"output_tokens":1}}
```

`stop_reason`: `stop`→`end_turn`; `length`→`max_tokens`; `tool_calls`→`tool_use`; `stop` по stop_sequence→`stop_sequence`; `content_filter`→`refusal`.

Стриминг (точный порядок, `ping` после `message_start`):

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_…","type":"message","role":"assistant","content":[],"model":"…","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":12,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: ping
data: {"type":"ping"}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"ok"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":1}}

event: message_stop
data: {"type":"message_stop"}
```

Для инструментов: `content_block_start` с `{"type":"tool_use","id":"toolu_…","name":"…","input":{}}`, затем `input_json_delta` c `partial_json` (фрагменты `arguments` из апстрима как есть), затем `content_block_stop`. `[DONE]` не отправляется. `ping` — каждые 15 с простоя.

`POST /v1/messages/count_tokens`: `{input_tokens: <ceil(chars/4)>}`; в ответе заголовок `x-hh-approx: 1`. Точность не гарантируется (используется для индикации контекста в Claude Code).

---

## 15. Нормализация и рендеринг

`ChatRequest` (внутренняя модель):

```ts
type ChatRequest = {
  model: string;
  messages: Array<{ role: 'system'|'user'|'assistant'|'tool'; content: string |
    Array<{type:'text';text:string}|{type:'image_url';image_url:{url:string}}>;
    tool_call_id?: string; tool_calls?: Array<{id:string;type:'function';
    function:{name:string;arguments:string}}> }>;
  stream: boolean;
  maxTokens?: number;
  temperature?: number; topP?: number; stop?: string[];
  tools?: Array<{ type:'function'; function:{ name:string; description?:string;
    parameters: Record<string,unknown> } }>;
  toolChoice?: 'auto'|'none'|'required'|{type:'function';function:{name:string}};
  responseFormat?: Record<string, unknown>;
  parallelToolCalls?: boolean;
  protocol: 'chat'|'responses'|'messages';
};
```

Инварианты: сообщения `tool` всегда следуют после assistant с `tool_calls`; пустой `content` у assistant допустим только при наличии `tool_calls`; изображения поддерживаются только моделями с `modalities` включающим `image`, иначе 400 `unsupported_content` с перечнем подходящих моделей.

Один рендерер на протокол в `core/gateway/render-*.ts`; рендерер получает нормализованный результат апстрима (`{text, toolCalls, finishReason, usage}`) и/или поток дельт, и не знает про HTTP.

---

## 16. Failover и управление аккаунтами

### 16.1 Выбор аккаунта

```
кандидаты = accounts WHERE status IN ('active','exhausted')
            AND cooldown_until <= now
            AND cookies_enc IS NOT NULL
если model.free = 0: кандидаты = кандидаты WHERE balance > 0
сортировка: (status='active' DESC), last_used_at ASC NULLS FIRST
```

Слот: `Map<accountId, {leaseUntil, requestId}>` в памяти процесса. Один активный запрос на аккаунт (§5: апстрим держит одну coding-сессию). Ожидание свободного слота — до `HH_SLOT_WAIT_MS` (45 с), опрос 100 мс, затем 429 `no_account_available`. Просроченный слот (> 900 с) отбирается с логом `warn`.

### 16.2 Классификация ответа апстрима

| Ответ | Действие | Кулдаун |
|---|---|---|
| `200` | успех, `success_count++`, `last_used_at=now` | — |
| `400`, `422` (кроме `session_busy`) | вернуть клиенту как есть, без ретрая | — |
| `401`, `403` (кроме `machine_required`, `social_login_required`, `check_in_refused`) | `fail_count++`; при `fail_count>=3` → `dead`, иначе cooldown | 10 мин |
| `403` + `check_in_refused` | check-in временно закрыт: следующий аккаунт, `fail_count` не меняется; в `probe` аккаунт проверяется чатом (B-026) | 2 мин |
| `social_login_required` | `dead` (логин протух, нужна перерегистрация) | — |
| `machine_required` | ротация machine-id (соль `email + random`), повтор на том же аккаунте, максимум 2 раза | 5 с |
| `409` / `session_busy` | следующий аккаунт | `Retry-After` или 3 с (клэмп 1..60) |
| `426` / `lane_version_unsupported` | обновить `lane_version=4`, повторить 1 раз | 5 с |
| `429` | следующий аккаунт | `Retry-After` или 120 с |
| `5xx`, таймаут, `ECONNRESET` | следующий аккаунт | 30 с |
| тело содержит `insufficient`, `balance`, `theos`, `quota` | `status='exhausted'`, следующий аккаунт, фоновая проверка баланса | — |

Лимит попыток на запрос: 8. После исчерпания — 503 `all_accounts_failed` с последней ошибкой в `message` и `x-hh-attempts`.

### 16.3 Правила стриминга

- Failover разрешён только до отправки первого байта клиенту. Если апстрим ответил не-200 — переключаемся молча.
- После первого SSE-чанка смена аккаунта запрещена: ошибка отправляется событием `error` (Responses/Anthropic) или `data: {"error":…}` (Chat), соединение закрывается.
- Отключение клиента (`request.signal.aborted`) прерывает апстрим через `AbortController`, слот освобождается в `finally`.
- Обрыв клиента — не ошибка шлюза (B-025): в `requests` пишется одна строка с `http_status=200`, `error_code=NULL`, `detail="client disconnected mid-stream"` для всех трёх протоколов; `stream_error`/502 остаётся только для реального разрыва апстрима.
- Таймаут простоя стрима — 300 с; при превышении — `error: upstream_timeout`.

### 16.4 Состояния аккаунта

```
pending ──probe ok──▶ active ──429/5xx──▶ cooldown ──истёк──▶ active
   │                    │                    │
   │                    ├──balance=0──▶ exhausted ──balance>0/refresh_at──▶ active
   │                    └──3×401/403 (кроме check_in_refused)──▶ dead
   └──probe fail──▶ dead
любое ──вручную──▶ disabled ──вручную──▶ active
```

`exhausted` участвует в выборке для free-моделей (Theos не тратятся) и исключается для paid.

### 16.5 Баланс

- Источник: `GET https://api.deepai.org/deepai_code/theos` с lane-заголовками.
- Ответ: `{enabled, balance:"65.00000", granted:"65.00000", refresh_at:"ISO8601", lane_version}` → парсинг в `Number`, запись `accounts.balance/granted/refresh_at` и `balance_samples`.
- Фон: каждые `balance.sync_interval_min` минут, параллельно 4, только `status IN ('active','cooldown','exhausted')`.
- Вручную: кнопка у аккаунта и «Проверить все».
- Расход Theos считается по `balance_samples`: `spent = Σ max(0, prev.balance − cur.balance)` за интервал; рост баланса трактуется как refresh и в расход не входит.
- При `balance=0` и `refresh_at` в будущем аккаунт остаётся `exhausted`; после `refresh_at + 60 с` — плановая проверка.
- `403 check_in_refused` от `/theos` не означает мёртвую сессию (B-026): те же cookies обслуживают `/models` и `/chat/completions`. Probe в этом случае делает короткий чат, при `200` помечает аккаунт `active` (в том числе возвращает `dead` в строй) и не увеличивает `fail_count`.

---

## 17. Закупка и регистрация

### 17.1 Задача `provision`

`POST /api/jobs {type:"provision", quantity, productId?, workers?, headless?, proxy?}`.

Шаги:

0. Preflight: `GET /api/engine` (handshake воркера) — без `chrome_ok:true` job не создаётся и деньги не тратятся (`engine_not_ready`, 400).
1. `POST /api/settings/bm/test` неявно: `GET /wallet/balance`; при ошибке — job `failed` без списаний.
2. `GET /products/578` → имя, цена, `allowed_quantities`; показать оценку `quantity × price`.
3. `POST /orders {product_id, quantity}`.
4. Если `status=pending` — опрос `GET /orders/:id` каждые 3 с, максимум 40 раз (120 с). Пустые items и истёкший `deliver_by` → job `failed` с текстом «BM вернул refund».
5. Каждая строка `email|password` (или `email:password`) → `job_items(stage='purchased')`, дедуп по `accounts.email`.
6. Пул из `workers` Python-процессов берёт items и вызывает `register`.
7. Успех: cookies сохранены, `probe` (theos + короткий чат на free-модели) → `accounts.status='active'`, `job_items.stage='ok'`.
8. Итог: `jobs.status='done'` (даже при частичных ошибках), `spent_usd = total_amount`.

Повторный запуск с теми же логинами не создаёт дублей: `accounts.email UNIQUE`, item пропускается со `stage='ok'` и пометкой `reused`.

Отмена: `status='cancelled'` пишется в БД до остановки раннера, затем in-flight `register` прерывается (`AbortSignal`, worker убивает Chrome); незавершённый item возвращается в `stage='purchased'`, уже купленные логины остаются в `job_items` и могут быть дорегистрированы новым запуском (`POST /api/jobs {type:"provision", resumeJobId}` — необязательное поле).

### 17.2 Интеграция BM

Клиент `src/adapters/bm/client.ts`, базовый URL `https://bulkmail.shop/api/v2`, заголовок `X-API-Key`, `User-Agent: hh-api/1.0`, таймаут 60 с, 3 ретрая на 5xx/сеть с экспоненциальной паузой 1/2/4 с.

| Метод | Путь | Использование |
|---|---|---|
| GET | `/wallet/balance` | баланс кошелька |
| GET | `/products/:id` | валидация продукта и цены |
| POST | `/orders` | покупка |
| GET | `/orders/:id` | ожидание выдачи |
| GET | `/purchases?order_id=` | резервный путь получения строк |

Разбор: `data.items[]` (строки) приоритетнее `purchases.data[].data`. Строка разбивается по первому `|`, иначе по первому `:`; обязателен `@` в email. Невалидные строки → `job_items.error='bad_line'`.

Ошибки: `success:false` → `error`-строка; `INSUFFICIENT_BALANCE`/`INSUFFICIENT_STOCK` → job `failed` с человеческим текстом; `422 errors{}` — первый ключ в сообщение.

### 17.3 Конвейер регистрации

На аккаунт: `purchased → registering → probing → ok|failed`.

Запуск: `python engine/worker.py`, окружение `HH_ENGINE_NO_BANK=1`, `HH_ENGINE_DIR`, `PYTHONIOENCODING=utf-8`.

Защита: `engine.restart_after=10` аккаунтов на процесс; при `launch_err` — перезапуск процесса; параллелизм не выше `engine.workers`; глобальный лимит одновременных Chrome — `workers`.

Ретраи: `GOOGLE_CAPTCHA`, `IAP`, `GOOGLE_REJECTED`, `ALLAUTH_FAIL` — без повтора (брак логина), `stage='failed'`, `attempts=1`. `TIMEOUT`, `exc:*`, `launch_err:*` — до 2 повторов с новым процессом. `machine_required` после регистрации лечится на шлюзе, не в джобе.

---

## 18. Python-воркер: контракт

`engine/worker.py` — NDJSON по stdin/stdout, служебные сообщения — в stderr (тоже NDJSON). Один процесс обрабатывает одну операцию за раз. Кодировка UTF-8, `ensure_ascii=False`.

Handshake при старте:

```json
{"event":"hello","python":"3.12.4","playwright":"1.49.0","chrome":"C:/Program Files/Google/Chrome/Application/chrome.exe","chrome_ok":true,"chrome_source":"chrome"}
```

`chrome` — тот бинарь, который реально запустит OAuth: Chrome из `HH_CHROME`/стандартных путей (`chrome_source:"chrome"`) либо Chromium из Playwright (`chrome_source:"playwright"`). `chrome_ok:false` (и `chrome_source:"none"`) — браузера нет, provision блокируется (ADR-018, B-020). `python engine/worker.py --selftest` печатает тот же hello и выходит.

Команда:

```json
{"id":"7f3a","op":"register","email":"a@b.us","password":"p","headless":false,
 "proxy":null,"timeout_ms":180000}
```

Событие прогресса:

```json
{"id":"7f3a","event":"stage","stage":"oauth","detail":"accounts.google.com/signin/v2"}
```

Результат:

```json
{"id":"7f3a","event":"result","ok":true,"stage":"ok",
 "cookies":[{"name":"sessionid","value":"…","domain":".deepai.org"},
            {"name":"csrftoken","value":"…","domain":".deepai.org"}],
 "machine":"<sha256 hex>","theos_status":200,
 "theos":{"enabled":true,"balance":"65.00000","granted":"65.00000",
          "refresh_at":"2026-11-15T12:00:00+00:00","lane_version":6},
 "ms":21400}
```

Ошибка: `{"id":"7f3a","event":"result","ok":false,"stage":"GOOGLE_CAPTCHA","detail":"…","ms":18300}`.

Правила:

- `id` уникален в рамках процесса; ответы на чужие id игнорируются.
- Таймаут операции на стороне Node (`timeout_ms` + 10 с) → `SIGTERM`, через 5 с `taskkill /T /F` (Windows) / `kill -9`.
- Воркер не пишет на диск (`HH_ENGINE_NO_BANK=1`); cookies возвращаются только в результате.
- Секреты не попадают в stderr; допускаются только коды стадий и URL без query.
- Смена поведения `oauth.one()` запрещена без обновления этого контракта и `docs/BUGS.md`.

Изменения в `engine/`: `worker.py` (новый), в `dpcode.py` — флаг `NO_BANK`, в `oauth.py` — возврат результата без записи в банк, `PROF_ROOT` = `<repo>/prof` (gitignored), `ROOT` = родитель `engine/` для путей данных.

---

## 19. Модели

Каталог — `GET https://api.deepai.org/deepai_code/models` с живого аккаунта: `{models:[{id,premier,contextWindow,maxTokens,input:[...]}]}`.

Синхронизация: вручную (`POST /api/models/sync`) и автоматически при старте, если `models` пуста или `synced_at` старше 24 ч. При недоступности всех аккаунтов — ошибка в UI, старый каталог сохраняется.

Правила:

- `free=1`, если `premier=false`; `premier=1` — если `premier=true`. `modalities` = `input.join(',')`.
- `display_name` — `id` в человекочитаемом виде (первая буква заглавная, дефисы → пробелы), ручное переименование не предусмотрено.
- Выключенная модель (`enabled=0`) отсутствует в `/v1/models` и даёт 404 `model_not_found` при вызове.
- Запрос неизвестной модели → 404 с `message`, содержащим до 5 ближайших id (Левенштейн ≤ 3).
- Free-модели не требуют баланса. Paid-модели требуют `balance > 0`.

Базовый каталог (сид при первом запуске, обновляется синхронизацией):

Free (11): `glm-5.3-flash`, `deepseek-v4.1-flash`, `mimo-2.6-flash`, `qwen-3.8-flash`, `minimax-m3.1-flash`, `muse-ember`, `solar-mini-4`, `gpt-6-luna`, `mimo-2.6-pro`, `glyph-cluster`, `deepai-cyber`.

Paid (16): `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-fable-5-2`, `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-astra`, `gemini-4-argon`, `gemini-4-hydrogen`, `gemini-4-carbon`, `glm-5.3`, `kimi-k3`, `kimi-k3.1-pro`, `minimax-m3`, `muse-spark-1.3`, `muse-wonder`, `qwen-3.8-max-prime`.

---

## 20. Логи и статистика

### 20.1 Логи

Пишутся в stdout (для терминала) и в `logs`. Поля: `ts`, `level`, `scope`, `message`, `account_id?`, `request_id?`, `meta` (JSON, ≤ 2 КБ). Уровни: `debug` (только при `HH_LOG_LEVEL=debug`), `info`, `warn`, `error`.

Обязательные события: старт/стоп приложения, миграции, синхронизация моделей, проверка баланса (агрегированно), каждый failover (`warn`), каждая фатальная ошибка шлюза (`error`), стадии джобы (`info`), ошибка BM (`error`).

Редактирование секретов: значения полей `password`, `cookies`, `authorization`, `x-api-key`, `api_key`, `sessionid`, `csrftoken` заменяются на `«redacted»` рекурсивно до сериализации (`src/lib/redact.ts`).

UI `/logs`: фильтры `level`, `scope`, `account`, полнотекстовый `q` (LIKE), пагинация по `before=id`, автообновление 2 с (тумблер), «Копировать JSON», подсветка `error` красным, `warn` янтарным.

### 20.2 Статистика

`GET /api/stats?range=24h|7d|30d`:

```json
{
  "range":"24h",
  "totals":{"requests":842,"errors":7,"error_rate":0.0083,"streams":611,
            "input_tokens":412300,"output_tokens":88210,"theos_spent":0.42},
  "latency":{"p50":980,"p95":2140,"p99":3900},
  "series":[{"t":1763033600000,"requests":31,"errors":0,"tokens":1820}],
  "by_model":[{"model":"glm-5.3-flash","requests":520,"errors":1,"p95":1200}],
  "by_account":[{"email":"a***@d***.us","requests":120,"errors":0,"balance":64.3}],
  "top_errors":[{"code":"session_busy","count":4},{"code":"upstream_timeout","count":2}]
}
```

`series` — 24 точки (час) для `24h`, 7 (день) для `7d`, 30 (день) для `30d`. Пустые интервалы заполняются нулями. p95 считается по `latency_ms` успешных запросов.

Визуализация — SVG: линейный график (линия `#C6FF3D`, заливка 8% opacity), столбцы ошибок `#FF4D4D`, горизонтальные бары по моделям. Без сторонних библиотек.

---

## 21. UI/UX

Дизайн-система — `docs/DESIGN.md`. Кратко: тёмная тема, фон `#0A0A0A`, панели `#111111`, границы `#1F1F1F`, акцент лайм `#C6FF3D`, текст `#EDEDED`, приглушённый `#8A8A8A`. Радиус 10 px, границы 1 px, без теней и градиентов. Числа и ключи — моноширинный шрифт.

Каркас: сайдбар 240 px (лого `hh-api`, пункты: Обзор, Аккаунты, Ключи, Модели, Логи, Статистика, Настройки; внизу индикатор «шлюз работает»), контент — max-width 1280 px, шапка с заголовком страницы и действиями.

Экраны:

1. **Вход** — центрированная карточка 360 px, поле пароля, ошибка под полем.
2. **Обзор** — 4 карточки (активные аккаунты, суммарный баланс, запросы 24 ч, доля ошибок), график запросов, список последних ошибок, быстрые действия («Добавить аккаунты», «Создать ключ», «Синхронизировать модели»).
3. **Аккаунты** — таблица: email (маска), статус (бейдж), баланс, `refresh_at` (относительное время), последний запрос, действия (проверить, отключить, удалить). Фильтры-чипы по статусу, поиск. Строка `cooldown` показывает таймер. Кнопка «Добавить аккаунты» открывает панель: количество, продукт, воркеры, headless, прокси, оценка стоимости, кнопка «Купить и зарегистрировать». Прогресс — таблица items со стадиями и счётчиком `ok/failed`, кнопка «Отменить».
4. **Ключи** — таблица (имя, префикс, создан, последний запрос, rpm, отозвать), модалка создания, после создания — блок с полным ключом, кнопка «Скопировать» и готовые сниппеты для Claude Code, Codex CLI, Cline, OpenAI SDK.
5. **Модели** — две группы (Free / Paid), колонки: id, контекст, max output, модальности, статус, тумблер «Доступна в API», кнопка «Синхронизировать», время последней синхронизации.
6. **Логи** — панель фильтров, виртуализированный список (окно 200 строк), моноширинный текст, бейдж уровня.
7. **Статистика** — селектор диапазона, карточки, график, таблицы по моделям и аккаунтам.
8. **Настройки** — секции: BM (ключ, продукт, «Проверить»), Движок (воркеры, headless, прокси, перезапуск), Баланс (интервал), Шлюз (модель по умолчанию, TTL Responses), Данные (ретеншн, экспорт аккаунтов, очистка логов), Безопасность (смена пароля).

Состояния: скелетоны при загрузке, пустые состояния с одним действием, ошибки — inline-панель с текстом и кнопкой «Повторить». Все мутации — оптимистичное обновление с откатом при ошибке. Тосты — правый нижний угол, 4 с.

Клавиатура: `g o/a/k/m/l/s`, `/` — фокус в поиск, `Esc` — закрыть модалку. Контраст текста ≥ 4.5:1, фокус-ринг `2px #C6FF3D`.

---

## 22. Безопасность

1. **Сеть.** `server.listen(port, '127.0.0.1')`; `HH_ALLOW_REMOTE=1` требует явного подтверждения в UI и печатает предупреждение. Никаких CORS-заголовков: браузерные клиенты с других origin получают отказ.
2. **Сессия UI.** Cookie `hh_session` = `base64url(payload).hmac`, payload `{sub:"admin",iat,exp}`; `HttpOnly`, `SameSite=Lax`, `Path=/`, без `Secure` (localhost). Сравнение HMAC — `timingSafeEqual`. Пароль хранится как scrypt-хеш в `.env.local` (или в `settings.admin_password_hash`, если задан через UI).
3. **Шифрование.** AES-256-GCM, ключ = scrypt(`HH_SECRET`, `"hh-api-v1"`, 32, N=2^15, r=8, p=1). Формат `v1.<iv_b64>.<tag_b64>.<ct_b64>`. Шифруются: `bm.api_key`, `accounts.password_enc`, `accounts.cookies_enc`, `settings` с `encrypted=1`.
4. **HH-ключи.** Хранится только `sha256(pepper || key)`, `pepper = scrypt(HH_SECRET,"hh-api-pepper",32)`. Полный ключ показывается один раз. Отзыв — `revoked_at`, проверка на каждом запросе.
5. **Rate limit.** Token bucket на ключ: `rpm_limit` (по умолчанию 60), окно 60 с, состояние в памяти, сброс при рестарте. Превышение — 429 с `Retry-After`.
6. **CSRF.** Мутации `/api/*` принимают только `POST/PUT/PATCH/DELETE` с `Origin`, равным `http://127.0.0.1:<port>`, либо без `Origin` (curl). Отсутствие/несовпадение — 403 `csrf_failed`.
7. **Заголовки.** `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, CSP `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'`.
8. **Логи.** Только через `logger`, который прогоняет `redact`. Прямой `console.log` в `src/` и `app/` запрещён (правило ESLint `no-console`, исключение — `scripts/`).
9. **Файлы.** `data/` и `prof/` в `.gitignore`; права на `data/hh.db` — только владелец (Windows ACL по умолчанию достаточно, документируется в README).
10. **Внешние вызовы.** Только `api.deepai.org` и `bulkmail.shop`; прокси — из настроек. TLS-проверка обязательна (кроме явного `bm.verify_tls=0` для отладки).

---

## 23. Производительность и надёжность

| Метрика | Бюджет |
|---|---|
| Оверхед шлюза (не-стрим, p95) | ≤ 25 мс к апстриму |
| Первый SSE-байт | без буферизации, ≤ 50 мс после апстрима |
| `/v1/models` | ≤ 15 мс |
| Страница UI (TTFB, локально) | ≤ 120 мс |
| Память Node (idle) | ≤ 220 МБ |
| Параллельные стримы | 50 без деградации (слоты ограничены аккаунтами) |
| Потеря слотов | 0 при разрыве клиента |

Требования:

- `better-sqlite3` в режиме WAL; все запросы — prepared statements; запись `requests`/`logs` батчами по 20 или раз в 250 мс.
- `next build` без ошибок TS; `output: 'standalone'` не обязателен (локальный запуск через `next start`).
- Graceful shutdown: `SIGINT`/`SIGTERM` → остановка cron, дренаж слотов ≤ 5 с, закрытие БД, убийство Python-процессов.
- При старте: проверка миграций, `HH_SECRET`, `locks` (второй инстанс на той же БД получает баннер и не запускает cron/джобы).
- `AbortController` на все внешние вызовы; таймауты: апстрим 300 с, BM 60 с, theos 30 с, models 30 с.

---

## 24. Локальный запуск

Первичная установка (PowerShell, из корня):

```powershell
npm ci
copy .env.example .env.local
# вписать HH_SECRET (32+ байта) и HH_ADMIN_PASSWORD
npm run db:migrate
npm run doctor        # проверяет Node, Python, playwright, Chrome, права на data/
npm run build
npm start             # http://127.0.0.1:3210
```

Разработка: `npm run dev`. Проверки: `npm run typecheck && npm run lint && npm run test`.

`npm run doctor` проверяет и печатает:

```
node 22.14.0            ok
python 3.12.4           ok
playwright 1.49.0       ok
chrome C:\...\chrome.exe ok
data/ writable          ok
port 3210 free          ok
HH_SECRET set           ok
```

Отсутствие Python/playwright/Chrome — предупреждение: шлюз работает, регистрация недоступна (кнопка «Добавить аккаунты» блокируется с пояснением).

Готовые скрипты клиентов (показываются в UI при создании ключа):

```powershell
# Claude Code
$env:ANTHROPIC_BASE_URL="http://127.0.0.1:3210"
$env:ANTHROPIC_AUTH_TOKEN="hh-api-…"
claude
```

```toml
# ~/.codex/config.toml
model = "gpt-6.1-sol"
model_provider = "hhapi"
[model_providers.hhapi]
name = "hh-api"
base_url = "http://127.0.0.1:3210/v1"
wire_api = "responses"
env_key = "HH_API_KEY"
```

Cline/Roo/Continue/Zed/Aider — base URL `http://127.0.0.1:3210/v1`, ключ `hh-api-…`, провайдер «OpenAI Compatible».

---

## 25. Тестирование и приёмка

### 25.1 Юнит-тесты (Vitest)

- `crypto`: round-trip AES-GCM, неверный тег → ошибка, детерминизм ключа из `HH_SECRET`.
- `keys`: формат `^hh-api-[A-Za-z0-9]{48}$`, хеш, `timingSafeEqual`, отзыв.
- `normalize`: 13 фикстур (chat/responses/messages, текст, изображение, tool_use/tool_result, system-блоки, Claude Code `role:"system"` в `messages`).
- `render-anthropic`: порядок событий стрима, `stop_reason`, `input_json_delta`.
- `render-responses`: `previous_response_id`, `store:false`, `function_call`.
- `failover`: таблица §16.2 (по одному кейсу на строку), лимит 8 попыток, `machine_required` ×3 → dead.
- `select`: приоритет free при `balance=0`, round-robin по `last_used_at`, пропуск `disabled`.
- `redact`: пароли/cookies/ключи вырезаются на любой глубине.
- `bm.parse`: `email|pass`, `email:pass`, мусор, дубли.

### 25.2 Интеграционные тесты

Мок апстрима (`tests/fixtures/upstream.ts`, `node:http`) с режимами: `ok`, `stream`, `429`, `409`, `machine_required`, `balance_zero`, `slow`, `drop`. Шлюз поднимается на `3211`, БД — `:memory:` (better-sqlite3) или временный файл.

Обязательные сценарии:

1. `POST /v1/chat/completions` non-stream → 200, `x-hh-attempts: 1`.
2. Первый аккаунт 429, второй ok → 200, `attempts=2`, первый в `cooldown`.
3. Все 429 → 503 `all_accounts_failed`.
4. `balance=0` + paid-модель → аккаунт `exhausted`, запрос на следующий.
5. `balance=0` + free-модель → 200 на том же аккаунте.
6. Стрим: первый байт, затем обрыв апстрима → `error`-событие, слот освобождён.
7. Anthropic `/v1/messages` стрим → точный порядок событий, нет `[DONE]`.
8. Responses стрим → `response.completed` с usage; `previous_response_id` возвращает историю.
9. Клиент оборвал соединение → апстрим aborted, слот свободен в течение 1 с.
10. Ключ отозван → 401.
11. `/v1/models` содержит только enabled.
12. Параллельно 20 стримов на 4 аккаунтах → все 200, `queued` не превышает лимит, слоты возвращены.

### 25.3 Приёмка

- [x] `npm run build` — 0 ошибок, 0 предупреждений TS (принятые Turbopack-предупреждения — B-017).
- [x] `npm run test` — все сценарии §25.1–25.2 зелёные: 100 тестов, 13 файлов.
- [x] `npm run doctor` — все пункты `ok` (при остановленном сервере; при запущенном порт 3210 законно занят).
- [x] Реальная закупка 1 логина и регистрация 1 аккаунта: статус `active`; баланс `0` Theos вместо 65 — ограничение провайдера B-022.
- [x] Реальная проверка баланса: `POST /api/accounts/check-all` → job `probe` (10 и 11), все `ok`; после докупки аккаунтов 4–5 cron `balance sync: 5/5 ok`, цифры совпадают с `/api/accounts` (ADR-019).
- [x] Claude Code 2.1.325: `claude -p "hi" --model glm-5.3-flash --output-format text` через `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN` → exit 0, ответ; `/api/requests` — `endpoint=messages`, 200, stream. Первоначально live-прогон выявил B-024 (`messages[].role=system`), после фикса повторный прогон прошёл.
- [x] Codex CLI 0.169.0: `codex exec --skip-git-repo-check hi` с `CODEX_HOME/config.toml` (`wire_api="responses"`, `base_url=http://127.0.0.1:3210/v1`) → exit 0, ответ; `/api/requests` — `endpoint=responses`, 200, stream.
- [!] Cline/Continue: обычный чат и стрим → ответ. Заблокировано: расширения не установлены; чат и стрим проверены curl-эквивалентом.
- [!] Искусственное исчерпание (аккаунт с `balance=0`) → переключение, в статистике `attempts=2`. Заблокировано B-022: у всех аккаунтов `balance=0`, поэтому paid-модель отсекается выбором аккаунта (429, `attempts=0`); failover на `insufficient` покрыт моками.
- [x] Перезапуск приложения: ключи, аккаунты, логи на месте (jobs 4–15, 5 аккаунтов после двух рестартов); активные джобы помечаются `failed` с причиной `restart` (`failStaleJobs`, тест в `tests/unit/jobs.test.ts`).
- [x] Отзыв ключа немедленно даёт 401: живой запрос отозванным `hh-api-…` → 401 `invalid_api_key`.
- [x] Обрыв клиента на стриме (B-025): после фикса `chat` и `messages`, прерванные `AbortController` после первого кадра, дают по одной строке в `requests` с `http_status=200`, `error_code=NULL`, `detail="client disconnected mid-stream"`; `stream_error`/502 остаётся только для разрыва апстрима (тест 6).
- [!] Пул 20 аккаунтов и сценарий §25.2.12 (20 стримов на 4 аккаунтах): на момент приёмки 5 аккаунтов из 20; прогон на доступном пуле — 50 запросов с шагом 150 мс, 43×200 / 7×429 по штатному ожиданию слота (M8).
- [x] В `git status` нет `data/`, `prof/`, `.env.local`.

---

## 26. Риски и меры

| Риск | Вероятность | Мера |
|---|---|---|
| Google ужесточает детект Playwright, выход регистраций падает | высокая | headful по умолчанию, свежие логины, лимит 2 воркера, быстрый отказ по коду стадии, ручное добавление как обход |
| Провайдер меняет контракт `deepai_code` | средняя | весь контракт в `adapters/upstream`, фикстуры ответов, `/healthz` с проверкой theos, алерт в UI при 5 подряд ошибках |
| BM меняет поля выдачи | средняя | парсер поддерживает `items[]` и `purchases[]`, ошибки видны в job_items |
| Утечка cookies/паролей | низкая | AES-GCM, redact, `.gitignore`, ключ только в `.env.local` |
| Гонка слотов при параллельных стримах | средняя | слот в одном процессе, `finally`-освобождение, тест §25.2.12 |
| Рост БД | низкая | ретеншн, `PRAGMA optimize`, лимит 2 КБ на `meta` |

---

## 27. Порядок работ

Соответствует `ROADMAP.md`: M0 каркас → M1 БД/крипто → M2 аккаунты и Python-воркер → M3 BM/джобы → M4 шлюз Chat → M5 Responses/Anthropic → M6 модели/логи/статистика → M7 UI → M8 приёмка. Каждая веха = отдельный коммит (или серия) с обновлением `ROADMAP.md` и `docs/BUGS.md`.

---

## Приложение A. Проверки curl

```bash
curl -s http://127.0.0.1:3210/healthz

curl -s http://127.0.0.1:3210/v1/models -H "Authorization: Bearer hh-api-…"

curl -s -X POST http://127.0.0.1:3210/v1/chat/completions \
  -H "Authorization: Bearer hh-api-…" -H "Content-Type: application/json" \
  -d '{"model":"glm-5.3-flash","messages":[{"role":"user","content":"say ok"}],"max_tokens":32}'

curl -N -X POST http://127.0.0.1:3210/v1/chat/completions \
  -H "Authorization: Bearer hh-api-…" -H "Content-Type: application/json" \
  -d '{"model":"glm-5.3-flash","messages":[{"role":"user","content":"count to 3"}],"stream":true}'

curl -s -X POST http://127.0.0.1:3210/v1/messages \
  -H "x-api-key: hh-api-…" -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-5-5","max_tokens":64,"messages":[{"role":"user","content":"say ok"}]}'

curl -s -X POST http://127.0.0.1:3210/v1/responses \
  -H "Authorization: Bearer hh-api-…" -H "Content-Type: application/json" \
  -d '{"model":"gpt-6.1-sol","input":"say ok","max_output_tokens":64}'
```

## Приложение B. Матрица совместимости клиентов

| Клиент | Протокол | Base URL | Заголовок ключа | Примечание |
|---|---|---|---|---|
| Claude Code | Anthropic | `http://127.0.0.1:3210` | `Authorization: Bearer` | `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN`, путь `/v1/messages` добавляет сам |
| Codex CLI | Responses | `http://127.0.0.1:3210/v1` | `Authorization: Bearer` | `wire_api="responses"` |
| Cline / Roo Code | Chat | `http://127.0.0.1:3210/v1` | `Authorization: Bearer` | провайдер OpenAI Compatible |
| Continue | Chat | `http://127.0.0.1:3210/v1` | `Authorization: Bearer` | `apiBase` без `/chat/completions` |
| Zed | Chat | `http://127.0.0.1:3210/v1` | `Authorization: Bearer` | `openai_compatible` |
| Aider | Chat | `http://127.0.0.1:3210/v1` | `OPENAI_API_KEY` | `OPENAI_API_BASE` |
| OpenAI SDK | Chat/Responses | `http://127.0.0.1:3210/v1` | `api_key` | `baseURL` |
| Anthropic SDK | Messages | `http://127.0.0.1:3210` | `api_key` | `baseURL` без `/v1` |