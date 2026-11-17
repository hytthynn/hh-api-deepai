# ROADMAP

Статус: **M0–M8 готовы** — 5 живых аккаунтов, три протокола, стрим, слоты, рестарт, Claude Code 2.1.325 и Codex CLI 0.169.0 проверены на реальном апстриме; UI переработан под ключи с квотой и показом, импорт аккаунтов с автоматическим входом, журнал запросов и объединённый «Обзор», настройки сохраняются одной кнопкой, вёрстка адаптивна; пул 20 аккаунтов, paid-баланс и Cline/Continue остаются ограничениями окружения (M8).

Легенда: `[ ]` не начато, `[x]` готово, `[~]` в работе, `[!]` заблокировано внешним условием.

Проверки на 2026-11-16: `npm run typecheck`, `npm run lint`, `npm run test` (114/114, 16 файлов, 10.8 с), `npm run build` — зелёные; smoke настроек и очистки логов на `127.0.0.1:3210`: GET подставил env-фолбэки (14/90/60/300000/45000), PUT сохранил 5 параметров и они прочитались обратно, значения возвращены к дефолтам одной кнопкой «Сохранить», `DELETE /api/logs` → `{deleted: 3116, deleted_requests: 263}`, `/api/requests` → 0 и экран «Логи» пуст; Playwright-проверка вёрстки на 1280/1024/768/390/320 px (все экраны, модалки добавления аккаунтов/ключа/очистки логов и вход) — горизонтального переполнения нет, на телефоне навигация горизонтальная, на десктопе сайдбар 240 px сохранён.

Проверки на 2026-11-15: `npm run typecheck`, `npm run lint`, `npm run test` (110/110, 15 файлов, 10.3 с), `npm run build` — зелёные; smoke import на `127.0.0.1:3210`: 202, job `login` обработал 2/2 (`GOOGLE_REJECTED` на тестовых логинах), активная задача вернула 409 `job_running`, тестовые строки удалены; `npm run doctor` — все пункты `ok`; smoke на `http://127.0.0.1:3210`: `/healthz` 200, вход, `chrome_ok:true`, ключ, `/v1/models` (27), живые `chat/completions` + stream `[DONE]`, `responses`, `messages`, `count_tokens` — 200, CSP nonce, рестарт с сохранением данных; Claude Code 2.1.325 (`messages`) и Codex CLI 0.169.0 (`responses`) live exit 0; 3 аккаунта, 3 параллельных запроса, 50 запросов, TTFB в `requests.first_byte_ms` (см. M8).

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
- [x] Импорт легаси `bank.jsonl` не нужен: источник истины — SQLite, легаси-контур удалён (ADR-020)
- [x] Живая регистрация: аккаунт `AmieNolan3j7hm@ecolu.us` зарегистрирован через Chromium из Playwright (job 4), probe `ok`, `balance=0` (free-модели доступны)

**Приёмка:** пройдена. Добавление/проверка/удаление аккаунта — на моке апстрима; покупка, регистрация и probe — на живом BM и живом DeepAI (3 логина, 3 аккаунта).

---

## M3. BM и джобы — `done` (кроме реальной покупки)

- [x] `adapters/bm/client.ts` — balance, product, orders, purchases; ретраи, разбор HTML-строк
- [x] `POST /api/settings/bm/test`, экран настроек BM; ключ только в зашифрованном `settings` (ADR-011)
- [x] `jobs/runner.ts` — очередь, статусы, отмена с остановкой worker/Chrome, восстановление незавершённых джоб после рестарта
- [x] `jobs/provision.ts` — проверка Chrome до покупки, чтение баланса → покупка → разбор → регистрация → probe, `spent_usd`
- [x] `POST/GET /api/jobs`, `POST /api/jobs/:id/cancel` (+ `GET /api/jobs` для баннера, ADR-012)
- [x] UI: модалка «Добавить аккаунты» с оценкой стоимости и прогрессом items
- [x] Тесты: разбор строк BM (`bm-parse.test.ts`), дедуп, частичный успех, отмена (`jobs.test.ts`: preflight, cancel, abort worker, resume)

**Приёмка:** пройдена на 3 логинах: кошелёк BM читается живьём, покупка `0.01656921` → регистрация → probe (job 4), затем `0.03313842` за 2 логина параллельно в 2 воркерах (job 9); `POST /api/jobs` с `resumeJobId` проходит preflight и не тратит деньги (job 5). Кошелёк `1.35058474` → `1.31744632` USD, что совпадает с суммой `spent_usd` обоих джоб.

---

## M4. Ключи и шлюз Chat — `done`

- [x] `core/gateway/normalize.ts` (chat), `errors.ts`, `sse.ts`
- [x] `core/gateway/failover.ts` — таблица §16.2, лимит 8, кулдауны, `machine_required` ротацией (макс. 2)
- [x] `POST/GET/DELETE /api/keys`, `sha256(pepper||key)` в БД (показ ключа — ADR-021, квота и физическое удаление — ADR-022)
- [x] Аутентификация шлюза (`Authorization`, `x-api-key`), RPM-бакет шлюза (ADR-022), `x-request-id`, `x-hh-attempts`
- [x] `GET /v1/models`, `GET /v1/models/:id` (27 моделей: 11 free / 16 paid)
- [x] `POST /v1/chat/completions` — non-stream, stream (байт-прозрачный passthrough + `[DONE]`), tools, usage
- [x] Слоты, lease 15 мин, abort по разрыву клиента, `release()` в `finally`/`finish()` (B-015)
- [x] `requests` батчами; тесты failover и конкурентности (§25.2)
- [x] UI: экран ключей (сниппеты клиентов позже убраны, см. M8)

**Приёмка:** пройдена на моке (429 первого аккаунта → 200 со второго, `x-hh-attempts: 2`, удаление ключа → 401 `invalid_api_key`, нет аккаунтов → 429 `no_account_available`) и на живом аккаунте: non-stream и stream `glm-5.3-flash` → 200, `[DONE]` в конце.

---

## M5. Responses и Anthropic — `done`

- [x] `render-responses.ts` — non-stream, stream (§13), `previous_response_id` (только `response.output`), `store:false`
- [x] `render-anthropic.ts` — non-stream, stream (§14), `tool_use`/`input_json_delta`, `ping`, без `[DONE]` (B-013)
- [x] `POST /v1/messages/count_tokens`
- [x] Таблицы `responses`, TTL, `GET/DELETE /v1/responses/:id`
- [x] Тесты: точный порядок событий, маппинг `stop_reason`, объектный `tool_choice` (B-016)
- [~] Проверка реальным Claude Code и Codex CLI — не выполнена: нужен живой клиент, `/v1/messages` и `/v1/responses` на живом аккаунте уже отвечают 200

**Приёмка:** пройдена: эндпоинты отвечают в своих форматах ошибок, `responses`/`messages`/`count_tokens` на живом аккаунте → 200. Живой прогон IDE-клиента — в M8.

---

## M6. Модели, логи, статистика — `done`

- [x] `POST /api/models/sync` + автосинк при старте/24 ч, сид каталога
- [x] `PATCH /api/models/:id`, UI-таблица Free/Paid с тумблерами
- [x] `GET /api/logs` — фильтры, курсор, ретеншн; `DELETE /api/logs` (ADR-012)
- [x] `GET /api/stats` — агрегаты и серии §20.2
- [x] SVG-графики (линия, бары) без библиотек, карточки обзора
- [x] UI: логи (live-хвост 2 с), статистика, обзор (оба экрана переработаны в M8: журнал запросов и объединённый «Обзор»)
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

## M8. Приёмка на реальных данных — `done`

- [~] 20 аккаунтов: 5 из 20 — job 4 (1 логин, `spent_usd=0.01656921`), job 9 (2 логина, `0.03313842`, 2 воркера параллельно), jobs 12 и 14 (по 1 логину, `0.01656921` каждый); все пять `active`, `balance=0`, lane 6; кошелёк BM `1.25116948` USD, следующий логин `0.01656921`
- [x] Мультиаккаунт: 3 параллельных стрима → 200 на разных аккаунтах, `x-hh-attempts: 1`; распределение `requests.account_id` за сессию 25/21/22; маска `x-hh-account` не различает Clareta/Carree, поэтому принадлежность проверялась по `account_id`
- [x] Слоты: при трёх занятых аккаунтах 4-й запрос ждал 19.2 с и получил 200 после освобождения слота; волна из 6 стримов — 3 стартуют сразу (TTFB 2.9–3.8 с), 3 ждут 15.8–23.7 с, все 200; 50 запросов с шагом 150 мс — 43×200, 7×429 `no_account_available` ровно после 45.0 с ожидания с `Retry-After: 30`; после прогона probe → 200, `attempts=1` (слоты возвращены)
- [x] Проба всех аккаунтов (аналог `probe.py --all`, но по БД): job 10 и 11 (3/3 `ok`), после докупки — cron `balance sync: 5/5 ok`, `balance=0`, lane 6
- [x] Память: RSS Node 137.8 МБ → 142.0 МБ после 50-запросного прогона (+4.2), в бюджете §23 (≤220 МБ)
- [!] Пул 20 аккаунтов и тест §25.2.12 (20 стримов на 4 аккаунтах): 5 из 20 аккаунтов (5 активных слотов); полный прогон заблокирован без докупки аккаунтов. 50 запросов с шагом 150 мс были отправлены на доступном пуле: 43×200/7×429 после штатного ожидания слота.
- [x] TTFB в БД: после B-021 стримы пишут `requests.first_byte_ms` (первый живой запрос: `latency_ms=3254`, `first_byte_ms=2855`), поэтому ожидание слота отделяется от работы апстрима
- [x] Claude Code 2.1.325 через `/v1/messages`: live CLI exit 0, ответ получен; B-024 (системное сообщение в `messages[]`) выявлен и исправлен, повторный live-прогон успешен.
- [x] Codex CLI 0.169.0 через `/v1/responses` (`wire_api="responses"`): live CLI exit 0, ответ получен; потоковый запрос записан с 200.
- [!] Cline/Continue live: IDE-плагины не установлены, обычный чат и стрим подтверждены HTTP smoke.
- [!] Реальное переключение при недостатке Theos: блокировано B-022 — все аккаунты имеют `balance=0`; free запросы успешно обслуживаются, paid-модели дают `no_account_available` до попытки. Failover на upstream `insufficient` проверяется интеграционными моками.
- [x] Обрыв клиента (B-025): живой прогон после фикса — `chat` и `messages` прерваны через `AbortController` после первого кадра; в `/api/requests` строки 113/114: `http_status=200`, `error_code=NULL`, `detail="client disconnected mid-stream"`, слоты возвращены, в логах `info client disconnected mid-stream`.
- [x] B-026: `403 check_in_refused` от `/theos` больше не считается ошибкой авторизации — `classifyFailure` отдаёт временный `upstream_check_in_refused` (cooldown 2 мин, без `fail_count`), probe проверяет такой аккаунт чатом и возвращает `active`; аккаунты 1–3, ложно помеченные `dead`, восстановлены, пул 5/5 `active`
- [x] Чистка репозитория: удалены `legacy/`, `bank.jsonl`, `accounts.txt`, `bank.example.jsonl`, `engine/{wave,redeem,probe}.py`, `__pycache__`, `shim*.log`; `.gitignore`, `eslint.config.mjs`, README и SPEC приведены в соответствие (ADR-020)
- [x] Ключи: показ полного ключа (`key_enc`, ADR-021), суммарная квота `token_limit` без выбора периода, `token_quota_exceeded` (429), физическое удаление вместо отзыва, RPM перенесён в «Настройки» как `gateway.rpm_limit` (ADR-022); сниппеты клиентов из UI убраны
- [x] Аккаунты: полный email в таблице, панель добавления без продукта/прокси/headless, импорт готового списка `email|password` через `POST /api/accounts/import` (`created/skipped/invalid`) — каждый новый аккаунт сразу проходит вход (job `login`, ADR-023)
- [x] Логи: экран показывает только журнал запросов (`requests`) — время, ключ, аккаунт, маршрут `openai`/`responses`/`anthropic`, модель, токены, успех; фильтры и пагинация
- [x] Обзор: экран «Статистика» удалён, агрегаты и серии перенесены на `/` (диапазоны `24 ч`/`7 д`/`30 д`); `GET /api/stats` остаётся источником данных
- [x] Настройки: одна кнопка «Сохранить» на всю страницу, блоки «Баланс» и «Шлюз» объединены, смена пароля и поле прокси убраны; ретеншн логов/запросов, RPM, таймаут апстрима и ожидание слота редактируются из UI с env-фолбэком (ADR-024)
- [x] «Очистить логи» чистит оба журнала: `DELETE /api/logs` удаляет `logs` и `requests`, ответ `{deleted,deleted_requests}`; тест `tests/integration/settings-logs.test.ts`
- [x] Адаптация UI: до 1100 px — верхняя навигация и 2 колонки, до 720 px — одна колонка, скролл таблиц, модалки/тосты по краям; проверено Playwright на 1280/1024/768/390/320 px (все экраны и модалки, без горизонтального переполнения), правила в `docs/DESIGN.md`
- [x] Сохранность при рестарте: два production restart, все аккаунты (сейчас 5), jobs 4–15 и логи остались в SQLite; API-ключи хранятся хешем + `key_enc` (ADR-021), удалённый ключ немедленно даёт 401 (ADR-022).
- [x] Smoke API-ключи удалены (id 4–20, 22–24, отозванные до миграции 0001); активны 2 ключа, созданные до ADR-021, поэтому «Показать» для них отдаёт 409 `key_not_revealable`; реальные credentials/account cookies не печатались в smoke-вывод.
- [x] Аудит секретов: `git status` чист от `data/`, `prof/`, `.env*`; ключи только хешем; логи редактируются
- [x] Тег `v1.0.0` — принят владельцем запуск; пул вырос до 5 аккаунтов (jobs 12 и 14 по 1 логину), ограничения пула, Cline/Continue и реального upstream exhaustion перечислены выше.

Маска `x-hh-account` по §16 (`a***@d***.us`) не различает адреса на одном домене с одной первой буквой (`C***@e***.us` у Clareta и Carree), поэтому принадлежность запроса проверяется по `requests.account_id`, а не по заголовку.

Чтобы вернуться к §25.2.12: `POST /api/jobs {type:"provision",quantity:15}` (preflight проходит, `spent_usd` фиксируется; 15 × `0.01656921` ≈ `0.2485` USD при кошельке `1.25116948`), затем нагрузочный прогон на 20 аккаунтах.

---

## Открытые вопросы

Нет. Все развилки закрыты в `docs/DECISIONS.md` (ADR-001…ADR-024); найденные баги и ограничения провайдера — в `docs/BUGS.md` (B-001…B-027).