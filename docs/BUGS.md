# Журнал багов и найденных ограничений

Формат записи: `ID | дата | статус | компонент | симптом | причина | фикс | тест`.
Статусы: `open`, `fixed`, `wontfix`, `upstream`.

## Известные ограничения провайдера (перенесено из README, проверено на живых аккаунтах)

| ID | Статус | Компонент | Симптом | Причина | Обход/фикс |
|---|---|---|---|---|---|
| B-001 | upstream | upstream/oauth | `Social Network Login Failure, Code: unknown` | OAuth стартует с `deepai.org`, а не с `api.deepai.org` | Всегда стартовать `https://api.deepai.org/accounts/google/login/?process=login` |
| B-002 | upstream | upstream/oauth | 403 `social_login_required` | Email-аккаунты DeepAI не пускают в Code | Только Google/Apple OAuth; такие аккаунты помечать `dead` |
| B-003 | fixed | engine | 403 `machine_required` на каждом запросе | machine-id не совпадает или отсутствует | Заголовок `X-DeepAI-Code-Machine: sha256(MachineGuid + salt)`, ротация при ошибке (§16.2) |
| B-004 | upstream | engine | 426 `lane_version_unsupported` | Нет `X-DeepAI-Code-Theos: 4` | Заголовок обязателен во всех вызовах `deepai_code/*` |
| B-005 | upstream | engine | 409 `session_busy` | Одна coding-сессия на аккаунт | Слот на аккаунт + кулдаун по `Retry-After` |
| B-006 | fixed | engine | Chrome умирает после ~14 аккаунтов подряд | Утечка контекстов Playwright | Перезапуск Python-воркера каждые 10 аккаунтов (`engine.restart_after`) |
| B-007 | fixed | engine | Цикл OAuth стоит на «добро пожаловать в ваш новый аккаунт» | Speedbump Workspace ToS | Клик «Понятно»/«I understand», затем обычный consent |
| B-008 | fixed | engine | Повторный callback с тем же `code` → ALLAUTH_FAIL | Переиспользование `state` | Каждый логин — свежий старт, без реюза state |
| B-009 | upstream | bm | `signin/rejected` или `challenge/recaptcha` на пачке логинов | Пул 24h-логинов протух | Гонять OAuth в том же окне, что и покупку |
| B-010 | upstream | engine | reCAPTCHA Enterprise не принимает токен 2captcha | Детект автоматизации | Не пытаться решать; помечать `GOOGLE_CAPTCHA` и не жечь повторы |
| B-011 | upstream | upstream | `model_not_found` для `deepseek-v4.1-flash-1017` | В API id без суффикса | Использовать id из `/deepai_code/models`, не хардкодить версии |
| B-012 | fixed | gateway | Два процесса слушают один порт на Windows | `SO_REUSEADDR` | `SO_EXCLUSIVEADDRUSE` (для TS-версии: проверка занятости порта при старте + `locks` в БД) |

## Найдено в ходе разработки hh-api

| ID | Дата | Статус | Компонент | Симптом | Причина | Фикс | Тест |
|---|---|---|---|---|---|---|---|
| B-013 | 2026-11-14 | fixed | core/gateway/render-anthropic, render-responses | Имя инструмента дублируется: `get_timeget_time` в `tool_use.name` и `function_call.name` | Первый чанк стрима уже содержит полное имя, а последующие чанки дописывались конкатенацией вместе с ним | Имя выставляется при создании блока, дописывание — только для последующих чанков без первого | `tests/unit/render-anthropic.test.ts`, `tests/unit/render-responses.test.ts` |
| B-014 | 2026-11-14 | fixed | server/runtime, lib/logger, lib/locks | `GET /healthz` → 503 `db_locked` с pid собственного процесса, все `/api/*` → 503, записи в `logs` не появляются | Next компилирует `instrumentation` и каждый route handler в отдельный module graph: модульные `booted`/`sink` дублируются, второй граф проигрывает гонку за lock и видит «чужой» pid; после kill процесса строка `locks` живёт ещё 90 с | Общее состояние (runtime bundle, log sink, токен-бакеты, слоты, engine pool, wallet cache, login-попытки) переведено на `globalState()` поверх `globalThis`; `acquireLock` забирает лок у своего pid, у мёртвого pid и у протухшей строки | `tests/unit/locks.test.ts` + ручной smoke: `/healthz` 200, вход, создание ключа, `/v1/models` |
| B-015 | 2026-11-14 | fixed | server/gateway/run, handlers-chat | Слот аккаунта не освобождался после успешного non-stream ответа и после завершения стрима | `release()` возвращался только для стрима и не вызывался на JSON-успехе; `streamFromGenerator` не имел хука на закрытие | `release()` вызывается inline на JSON-успехе; `chatPassthrough` получает `release` и вызывает его в `finish()`, `streamFromGenerator` получил `onClose` | `tests/integration/gateway.test.ts` (1, 6, 9, 12: `slots.busyIds().size === 0`) |
| B-016 | 2026-11-14 | fixed | core/gateway/normalize | `/v1/messages` с `tool_choice: {"type":"tool","name":"x"}` → 400 `tool_choice: invalid value` | Anthropic-форма `tool_choice` (объект) не была описана в Zod-схеме нормализатора | Объектная форма маппится в `{type:'function', function:{name}}` | `tests/unit/normalize.test.ts` |
| B-017 | 2026-11-14 | wontfix | build | Turbopack: `A Node.js API is used (process.stderr) which is not supported in the Edge Runtime` и 3× `Dynamic filesystem access causes tracing of the whole project` | `instrumentation.register()` пишет в stderr в catch-ветке; `src/lib/config.ts` читает `.env.local` по абсолютному пути | Предупреждения приняты: instrumentation исполняется только в node-рантайме (`NEXT_RUNTIME !== 'nodejs'` → early return), путь к env-файлу фиксирован | — |
| B-018 | 2026-11-14 | fixed | jobs/provision, api/jobs | `POST /api/jobs` при `GET /api/engine → chrome_ok:false` принял джобу, джоба купила логин (`spent_usd=0.01656921`) и только потом попыталась запустить браузер | Проверки готовности движка не было ни в API, ни в job: покупка шла до попытки запуска Chrome | `assertEngineReady()` в `runProvisionJob` и `engineHealth()` в `POST /api/jobs` до создания job; покупка не выполняется, job `failed` с `engine_not_ready` | `tests/unit/jobs.test.ts` («fails before purchase when Chrome is unavailable») |
| B-019 | 2026-11-14 | fixed | jobs/runner, jobs/provision, adapters/engine | `POST /api/jobs/4/cancel` вернул `cancelled:true`, но job 4 дошёл до `done` (`ok:1`), item зарегистрирован, worker не остановлен | Cancel-route вызывал `cancelJob` только при `!isRunning`, а `isRunning` жил в module-local карте; `requestCancel` никто не читал, in-flight `register` не прерывался | Статус `cancelled` пишется в БД всегда; runner-состояние на `globalState()`; `requestCancel` abort-ит `AbortController` рана; `EngineWorker.send` принимает `AbortSignal` и убивает дерево процессов; item возвращается в `purchased` | `tests/unit/jobs.test.ts` («aborts an in-flight registration…», «persists cancelled status…») |
| B-020 | 2026-11-14 | fixed | engine/worker, engine/dpcode, scripts/doctor | `GET /api/engine` → `chrome_ok:false` на машине, где регистрация уже проходила: OAuth запускал Chromium из Playwright, а preflight (B-018) блокировал закупку | `worker.hello()` и `dpcode.CHROME` смотрели только на захардкоженный `C:/Program Files/Google/Chrome/Application/chrome.exe`; путь Playwright-браузера не учитывался | `dpcode.chrome_path()` перебирает `HH_CHROME` и стандартные пути; `worker.browser_executable()` при отсутствии Chrome берёт `p.chromium.executable_path` (тот же бинарь, что и `launch_persistent_context`); `worker.py --selftest` — единый источник для `doctor` и health | `tests/integration/engine-selftest.test.ts` |

## Шаблон для новой записи

```
### B-013 | 2026-11-20 | open | gateway/stream

**Симптом.** Клиент получает 200 и пустой стрим при ошибке апстрима на втором чанке.
**Причина.** Ошибка после первого байта проглатывалась в `try/finally`.
**Фикс.** Отправлять `event: error` и закрывать поток (§16.3).
**Тест.** `tests/integration/stream-abort.test.ts`.
```