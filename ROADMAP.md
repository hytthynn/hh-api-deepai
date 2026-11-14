# ROADMAP

Статус: **M0 завершён, M1 не начат**.

Легенда: `[ ]` не начато, `[x]` готово, `[~]` в работе.

---

## M0. Документация и решения — `done`

- [x] `docs/SPEC.md` — ТЗ v1.0 (архитектура, БД, API, протоколы, failover, приёмка)
- [x] `docs/DESIGN.md` — дизайн-система (чёрный + лайм)
- [x] `docs/DECISIONS.md` — 10 ADR
- [x] `docs/BUGS.md` — ограничения провайдера B-001…B-012
- [x] `AGENTS.md` — правила работы (< 200 строк)
- [x] `ROADMAP.md`
- [x] `.env.example`, `.gitignore` (node, next, data, prof, .env.local)
- [x] Перенос Python в `engine/`, легаси-шлюз в `legacy/`, `HH_ENGINE_NO_BANK`

Коммит: `docs: spec, design, decisions, roadmap` + `engine: move python pipeline`.

---

## M1. Каркас и данные — `todo`

- [ ] `create-next-app` (TS, App Router, Tailwind 4.3), strict tsconfig, ESLint
- [ ] `package.json` скрипты: `dev/build/start/typecheck/lint/test/db:generate/db:migrate/doctor`
- [ ] `src/lib/config.ts` — разбор `.env.local` через Zod, падение без `HH_SECRET`
- [ ] `src/lib/crypto.ts` — AES-256-GCM + scrypt, тесты round-trip
- [ ] `src/adapters/db/{client,schema,migrate}.ts` — все таблицы §8, WAL, PRAGMA
- [ ] Первая миграция `drizzle/0000_init.sql`, `npm run db:migrate` идемпотентен
- [ ] `src/lib/logger.ts` + `redact.ts` — запись в `logs` и stdout, тесты редактирования
- [ ] `src/lib/locks.ts` — singleton-защита, тест «второй инстанс не стартует cron»
- [ ] Перенос Python в `engine/`, `HH_ENGINE_NO_BANK`, правка путей (`ROOT`, `PROF_ROOT`)
- [ ] `.env.example`, `.gitignore` (node_modules, .next, data, prof, .env.local)
- [ ] `scripts/doctor.mjs`
- [ ] `app/layout.tsx`, `globals.css` с токенами из `docs/DESIGN.md`, сайдбар-заглушка
- [ ] `app/healthz/route.ts`

**Приёмка:** `npm run build && npm run test` зелёные; `migrate` создаёт `data/hh.db`; `doctor` печатает 7 `ok`; `/healthz` отдаёт 200.

Коммиты: `chore: scaffold next app`, `db: schema and migrations`, `lib: crypto and logger`, `engine: move python worker`.

---

## M2. Аккаунты и регистрация — `todo`

- [ ] `adapters/upstream/headers.ts` — lane/machine/instance/beacon
- [ ] `adapters/upstream/deepai.ts` — theos, models, chat, классификация ошибок
- [ ] `adapters/engine/protocol.ts` + `pool.ts` — NDJSON, handshake, таймауты, kill
- [ ] `core/accounts/select.ts`, `state.ts`, `balance.ts` + тесты
- [ ] Репозитории accounts/settings, шифрование cookies и паролей
- [ ] `POST /api/accounts`, `PATCH`, `DELETE`, `POST /api/accounts/:id/check`
- [ ] `POST /api/accounts/check-all` + фоновый cron баланса (5 мин)
- [ ] UI: таблица аккаунтов, фильтры, бейджи, действия, проверка баланса
- [ ] Импорт легаси `bank.jsonl` (одноразовый скрипт, идемпотентный)

**Приёмка:** ручное добавление аккаунта → `active` и верный баланс; проверка всех обновляет `balance_samples`; UI показывает таймер кулдауна.

Коммиты: `accounts: upstream client and balance`, `engine: worker pool`, `ui: accounts screen`.

---

## M3. BM и джобы — `todo`

- [ ] `adapters/bm/client.ts` — balance, product, orders, purchases; ретраи
- [ ] `POST /api/settings/bm/test`, экран настроек BM
- [ ] `jobs/runner.ts` — очередь, статусы, отмена, восстановление после рестарта
- [ ] `jobs/provision.ts` — покупка → разбор → регистрация → probe
- [ ] `POST/GET /api/jobs`, `POST /api/jobs/:id/cancel`
- [ ] UI: модалка «Добавить аккаунты» с оценкой стоимости и прогрессом items
- [ ] Тесты: разбор строк BM, дедуп, частичный успех, refund, отмена

**Приёмка:** реальная покупка 1 логина и регистрация 1 аккаунта; job `done`, `spent_usd` совпадает с BM; повторный запуск не создаёт дублей.

Коммиты: `bm: client and settings`, `jobs: provision pipeline`, `ui: provision dialog`.

---

## M4. Ключи и шлюз Chat — `todo`

- [ ] `core/gateway/normalize.ts` (chat), `errors.ts`, `sse.ts`
- [ ] `core/gateway/failover.ts` — таблица §16.2, лимит 8, кулдауны
- [ ] `POST /api/keys`, `GET /api/keys`, `DELETE /api/keys/:id`, показ ключа один раз
- [ ] Аутентификация шлюза (3 заголовка), rate limit, `x-request-id`
- [ ] `GET /v1/models`, `GET /v1/models/:id`
- [ ] `POST /v1/chat/completions` — non-stream, stream, tools, usage
- [ ] Слоты, lease, abort по разрыву клиента
- [ ] Запись `requests` батчами; тесты failover и конкурентности
- [ ] UI: экран ключей + сниппеты для Claude Code / Codex / Cline / SDK

**Приёмка:** `curl` из §A работает; при 429 первого аккаунта ответ 200 со второго; `x-hh-attempts: 2`; отзыв ключа → 401.

Коммиты: `gateway: chat completions`, `gateway: failover and slots`, `ui: keys screen`.

---

## M5. Responses и Anthropic — `todo`

- [ ] `render-responses.ts` — non-stream, stream (§13), `previous_response_id`, `store:false`
- [ ] `render-anthropic.ts` — non-stream, stream (§14), tool_use/input_json_delta, `ping`
- [ ] `POST /v1/messages/count_tokens`
- [ ] Таблицы `responses`, TTL, `GET/DELETE /v1/responses/:id`
- [ ] Тесты: точный порядок событий, отсутствие `[DONE]` в Anthropic, маппинг stop_reason
- [ ] Проверка реальным Claude Code и Codex CLI

**Приёмка:** `claude -p "say ok"` и Codex CLI отвечают через шлюз; в логах `endpoint=messages|responses`.

Коммиты: `gateway: responses api`, `gateway: anthropic messages`, `gateway: protocol tests`.

---

## M6. Модели, логи, статистика — `todo`

- [ ] `POST /api/models/sync` + автосинк при старте/24 ч, сид каталога
- [ ] `PATCH /api/models/:id`, UI-таблица Free/Paid с тумблерами
- [ ] `GET /api/logs` — фильтры, курсор, ретеншн
- [ ] `GET /api/stats` — агрегаты и серии §20.2
- [ ] SVG-графики (линия, бары), карточки обзора
- [ ] UI: логи (live-хвост), статистика, обзор
- [ ] Cron ретеншна и `PRAGMA optimize`

**Приёмка:** синхронизация даёт 27 моделей (11 free / 16 paid); выключенная модель исчезает из `/v1/models`; статистика за 24 ч заполняет все поля.

Коммиты: `models: sync and catalog`, `stats: aggregation and charts`, `ui: logs and stats`.

---

## M7. Полировка и эксплуатация — `todo`

- [ ] Экран настроек полностью (движок, баланс, шлюз, данные, безопасность)
- [ ] Смена пароля администратора, экспорт аккаунтов без секретов
- [ ] Баннеры: второй инстанс, нет Python, нет BM-ключа, 5 подряд ошибок апстрима
- [ ] Graceful shutdown, остановка Python-процессов, дренаж слотов
- [ ] `scripts/start.ps1`, `README.md` (установка, подключение IDE)
- [ ] ESLint-правило `no-console` в `src/`, `app/`
- [ ] Прогон 12 сценариев §25.2

**Приёмка:** чек-лист §25.3 выполнен полностью.

Коммиты: `ui: settings and banners`, `ops: graceful shutdown and scripts`, `docs: readme`.

---

## M8. Приёмка — `todo`

- [ ] 20 аккаунтов: закупка → регистрация → баланс → запросы
- [ ] Нагрузка: 50 стримов, слоты возвращены, память в бюджете
- [ ] Failover на реальном исчерпании Theos
- [ ] Финальный аудит: секреты в git/logs/ответах отсутствуют
- [ ] Тег `v1.0.0`, финальный `ROADMAP.md`

---

## Открытые вопросы

Нет. Все развилки закрыты в `docs/DECISIONS.md` (ADR-001…ADR-010).