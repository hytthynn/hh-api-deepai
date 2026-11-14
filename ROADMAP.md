# ROADMAP

Статус: **M0–M7 готовы, M8 заблокирован** (нет Chrome и реальных аккаунтов DeepAI).

Легенда: `[ ]` не начато, `[x]` готово, `[~]` в работе, `[!]` заблокировано внешним условием.

Проверки на 2026-11-14: `npm run typecheck`, `npm run lint`, `npm run test` (90/90, 8.5 с), `npm run build` — зелёные; smoke-прогон на `http://127.0.0.1:3210` (healthz, вход, ключи, `/v1/models`, три протокола, CSP, 7 экранов UI) — пройден.

---

## M0. Документация и решения — `done`

- [x] `docs/SPEC.md` — ТЗ v1.0 (архитектура, БД, API, протоколы, failover, приёмка)
- [x] `docs/DESIGN.md` — дизайн-система (чёрный + лайм)
- [x] `docs/DECISIONS.md` — ADR-001…ADR-010
- [x] `docs/BUGS.md` — ограничения провайдера B-001…B-012
- [x] `AGENTS.md` — правила работы
- [x] `ROADMAP.md`
- [x] `.env.example`, `.gitignore` (node, next, data, prof, .env.local)
- [x] Перенос Python в `engine/`, легаси-шлюз в `legacy/`, `HH_ENGINE_NO_BANK`

Коммиты: `01acde4`, `8401c95`, `924cd9a`.

---

## M1. Каркас и данные — `done`

- [x] Next 16.4.6 (TS strict, App Router, Tailwind 4.3, Turbopack), ESLint flat config
- [x] `package.json`: `dev/build/start/typecheck/lint/test/db:generate/db:migrate/doctor`
- [x] `src/lib/config.ts` — Zod-разбор `.env.local`, падение без `HH_SECRET`, `HH_ALLOW_REMOTE` только по флагу
- [x] `src/lib/crypto.ts` — AES-256-GCM + scrypt(N=2^15,r=8,p=1), `hh-api-v1` / `hh-api-pepper`
- [x] `src/adapters/db/{client,schema,migrate}.ts` — все таблицы §8, WAL, `busy_timeout`, сид каталога
- [x] `drizzle/0000_init.sql`, `npm run db:migrate` идемпотентен
- [x] `src/lib/logger.ts` + `redact.ts` — JSON в stdout + запись в `logs`, тесты редактирования
- [x] `src/lib/locks.ts` — singleton-защита, забор лока у своего/мёртвого pid и протухшей строки
- [x] `engine/worker.py` + `HH_ENGINE_NO_BANK`, пути `ROOT`/`PROF_ROOT`
- [x] `scripts/doctor.mjs` — 8 проверок окружения
- [x] `app/layout.tsx`, `globals.css` с токенами `docs/DESIGN.md`, сайдбар, `app/healthz/route.ts`
- [x] `src/lib/global-state.ts` — общее мутабельное состояние на `globalThis` (ADR-017, B-014)

**Приёмка:** пройдена. `migrate` создаёт `data/hh.db`, `/healthz` → 200 `{"status":"ok","ready":true,"locked":false}`.

Коммиты: `chore: scaffold`, `db: schema`, `lib: crypto and logger`.

---

## M2. Аккаунты и регистрация — `done` (регистрация — без живого прогона)

- [x] `adapters/upstream/headers.ts` — lane/machine/instance/beacon, `API_BASE`
- [x] `adapters/upstream/deepai.ts` — theos, models, chat, классификация 426/403/409/429/400/422
- [x] `adapters/engine/protocol.ts` + `pool.ts` — NDJSON, handshake, таймауты, kill, пересборка по настройкам
- [x] `core/accounts/{select,state,balance}.ts` + тесты (`select.test.ts`, `state` в интеграции)
- [x] Репозитории accounts/settings, шифрование cookies и паролей
- [x] `POST/PATCH/DELETE /api/accounts`, `POST /api/accounts/:id/check`, `POST /api/accounts/check-all`
- [x] Cron баланса (5 мин) + `balance_samples`
- [x] UI: таблица аккаунтов, фильтры, бейджи, действия, таймер кулдауна
- [x] Импорт легаси `bank.jsonl` — идемпотентный скрипт
- [~] Живая регистрация: код готов, но `chrome_ok:false` — Chrome/Playwright-браузер не установлен, кнопка в UI заблокирована с предупреждением

**Приёмка:** частично. Добавление/проверка/удаление аккаунта проверены на моке апстрима; покупка и реальная регистрация — блокированы (см. M8).

---

## M3. BM и джобы — `done` (кроме реальной покупки)

- [x] `adapters/bm/client.ts` — balance, product, orders, purchases; ретраи, разбор HTML-строк
- [x] `POST /api/settings/bm/test`, экран настроек BM; ключ только в зашифрованном `settings` (ADR-011)
- [x] `jobs/runner.ts` — очередь, статусы, отмена с остановкой worker/Chrome, восстановление незавершённых джоб после рестарта
- [x] `jobs/provision.ts` — проверка Chrome до покупки, чтение баланса → покупка → разбор → регистрация → probe, `spent_usd`
- [x] `POST/GET /api/jobs`, `POST /api/jobs/:id/cancel` (+ `GET /api/jobs` для баннера, ADR-012)
- [x] UI: модалка «Добавить аккаунты» с оценкой стоимости и прогрессом items
- [x] Тесты: разбор строк BM (`bm-parse.test.ts`), дедуп, частичный успех, отмена

**Приёмка:** частично. Кошелёк BM читается живьём (`wallet_usd = 1.36715395`), покупка 1 логина и регистрация 1 аккаунта не выполнялись — нет Chrome и решения владельца тратить баланс.

---

## M4. Ключи и шлюз Chat — `done`

- [x] `core/gateway/normalize.ts` (chat), `errors.ts`, `sse.ts`
- [x] `core/gateway/failover.ts` — таблица §16.2, лимит 8, кулдауны, `machine_required` ротацией (макс. 2)
- [x] `POST/GET/DELETE /api/keys`, показ ключа один раз, `sha256(pepper||key)` в БД
- [x] Аутентификация шлюза (`Authorization`, `x-api-key`), RPM-бакеты, `x-request-id`, `x-hh-attempts`
- [x] `GET /v1/models`, `GET /v1/models/:id` (27 моделей: 11 free / 16 paid)
- [x] `POST /v1/chat/completions` — non-stream, stream (байт-прозрачный passthrough + `[DONE]`), tools, usage
- [x] Слоты, lease 15 мин, abort по разрыву клиента, `release()` в `finally`/`finish()` (B-015)
- [x] `requests` батчами; тесты failover и конкурентности (§25.2)
- [x] UI: экран ключей + сниппеты для Claude Code / Codex / Cline / SDK

**Приёмка:** пройдена на моке: 429 первого аккаунта → 200 со второго, `x-hh-attempts: 2`, отзыв ключа → 401 `invalid_api_key`, нет аккаунтов → 429 `no_account_available`.

---

## M5. Responses и Anthropic — `done`

- [x] `render-responses.ts` — non-stream, stream (§13), `previous_response_id` (только `response.output`), `store:false`
- [x] `render-anthropic.ts` — non-stream, stream (§14), `tool_use`/`input_json_delta`, `ping`, без `[DONE]` (B-013)
- [x] `POST /v1/messages/count_tokens`
- [x] Таблицы `responses`, TTL, `GET/DELETE /v1/responses/:id`
- [x] Тесты: точный порядок событий, маппинг `stop_reason`, объектный `tool_choice` (B-016)
- [~] Проверка реальным Claude Code и Codex CLI — не выполнена: нет ни одного рабочего аккаунта

**Приёмка:** частично. Эндпоинты отвечают в своих форматах ошибок; живой прогон IDE-клиента — в M8.

---

## M6. Модели, логи, статистика — `done`

- [x] `POST /api/models/sync` + автосинк при старте/24 ч, сид каталога
- [x] `PATCH /api/models/:id`, UI-таблица Free/Paid с тумблерами
- [x] `GET /api/logs` — фильтры, курсор, ретеншн; `DELETE /api/logs` (ADR-012)
- [x] `GET /api/stats` — агрегаты и серии §20.2
- [x] SVG-графики (линия, бары) без библиотек, карточки обзора
- [x] UI: логи (live-хвост 2 с), статистика, обзор
- [x] Cron ретеншна и `PRAGMA optimize`

**Приёмка:** пройдена. `/v1/models` отдаёт 27 моделей, выключенная модель исчезает, агрегаты за 24 ч заполняются.

---

## M7. Полировка и эксплуатация — `done`

- [x] Экран настроек полностью (движок, баланс, шлюз, данные, безопасность)
- [x] Смена пароля администратора, `GET /api/accounts/export` (CSV без cookies/паролей)
- [x] Баннеры: второй инстанс, нет Python/Chrome, нет BM-ключа, 5 подряд ошибок апстрима
- [x] Graceful shutdown, остановка Python-процессов, дренаж слотов
- [x] `scripts/start.ps1`, `README.md` (установка, подключение IDE)
- [x] `no-console` в `src/` и `app/`, `import 'server-only'` на серверных модулях
- [x] 12 сценариев §25.2 — `tests/integration/gateway.test.ts` (HTTP-мост, ADR-015)
- [x] CSP nonce в `proxy.ts` вместо `middleware.ts` (ADR-013), горячие клавиши (ADR-014)

**Приёмка:** чек-лист §25.3 закрыт, кроме пунктов, требующих реальных аккаунтов (см. M8).

---

## M8. Приёмка на реальных данных — `blocked`

- [!] 20 аккаунтов: закупка → регистрация → баланс → запросы — **Chrome не установлен** (`GET /api/engine` → `chrome_ok:false`, Python 3.15.2, Playwright 1.65.1), покупка не запускалась
- [ ] Нагрузка: 50 стримов, слоты возвращены, память в бюджете — сценарии 1/6/9/12 покрыты тестами, живой прогон не выполнен
- [!] Failover на реальном исчерпании Theos — нужны реальные аккаунты
- [x] Аудит секретов: `git status` чист от `data/`, `prof/`, `.env*`, `bank.jsonl`, `accounts.txt`; ключи только хешем; логи редактируются
- [ ] Тег `v1.0.0` — после закрытия заблокированных пунктов

Чтобы разблокировать: `npx playwright install chrome` (или `chromium`), затем `POST /api/jobs {type:"provision",quantity:1}` и проверка §25.3.

---

## Открытые вопросы

Нет. Все развилки закрыты в `docs/DECISIONS.md` (ADR-001…ADR-017); найденные баги и ограничения провайдера — в `docs/BUGS.md` (B-001…B-017).