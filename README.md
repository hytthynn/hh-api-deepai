# hh-api

Локальный шлюз к DeepAI Code: покупает Google-логины в BM, регистрирует аккаунты через Python + Playwright, отдаёт локальные ключи `hh-api-…` в трёх протоколах (OpenAI Chat, OpenAI Responses, Anthropic Messages), ротирует аккаунты при исчерпании лимита и показывает модели, логи и статистику.

Требования и контракты — [`docs/SPEC.md`](docs/SPEC.md), дизайн — [`docs/DESIGN.md`](docs/DESIGN.md), решения — [`docs/DECISIONS.md`](docs/DECISIONS.md), ограничения провайдера — [`docs/BUGS.md`](docs/BUGS.md), план — [`ROADMAP.md`](ROADMAP.md).

## Что нужно

| Компонент | Обязательно | Зачем |
|---|---|---|
| Node.js >= 20.9 | да | приложение |
| Python 3.11+ | для регистрации | `engine/worker.py` |
| Playwright для Python | для регистрации | браузерная автоматизация |
| Chrome или Chromium из Playwright (`playwright install chromium`) | для регистрации | OAuth-волна |
| Ключ BM (bulkmail.shop) | для покупки логинов | пополнение аккаунтов |

Шлюз и панель работают и без Python/Chrome: купленные или вручную добавленные аккаунты обслуживаются, недоступна только автопокупка с регистрацией.

## Установка

```powershell
npm install
Copy-Item .env.example .env.local
# вписать HH_SECRET (32+ байта base64) и пароль панели
npm run doctor          # проверка окружения: node, python, playwright, chrome, data/, секрет, порт
npm run db:migrate      # создаёт data/hh.db и сид каталога моделей
npm run dev             # http://127.0.0.1:3210
```

Прод-режим: `npm run build`, затем `npm start`. Порт и хост фиксированы в `package.json` (`-H 127.0.0.1 -p 3210`); наружу не выставляется, `HH_ALLOW_REMOTE=1` нужен только для осознанного исключения.

Для регистрации один раз:

```powershell
pip install playwright
python -m playwright install chromium   # браузер Playwright: рабочий вариант без установленного Chrome
# или, если нужен именно Google Chrome:
python -m playwright install chrome
```

`GET /api/engine` (или индикатор в сайдбаре) показывает `chrome_ok`: проверяется тот браузер, который реально запустит OAuth (Chrome из `HH_CHROME`/стандартных путей либо Chromium из Playwright). Пока `false`, кнопка «Добавить аккаунты» заблокирована с пояснением.

## Первый запуск

1. Открыть `http://127.0.0.1:3210` → редирект на `/login`, ввести `HH_ADMIN_PASSWORD`.
2. **Настройки → BM**: вставить API-ключ BM, нажать «Проверить». Ключ хранится только в зашифрованном виде; легаси `BM_KEY` из `.env` импортируется один раз (ADR-011).
3. **Настройки → Движок**: воркеры, headless, прокси. Смена применяется без рестарта.
4. **Аккаунты → Добавить аккаунты**: количество логинов, оценка стоимости, подтверждение. Джоба показывает прогресс по каждому item.
5. **Ключи → Создать ключ**: ключ `hh-api-…` показывается один раз, в БД лежит только `sha256(pepper||key)`.
6. Вставить сниппет из карточки ключа в IDE или SDK.

## Подключение клиентов

Базовый URL — `http://127.0.0.1:3210`, ключ — `hh-api-…`.

```bash
# OpenAI Chat Completions
curl -s http://127.0.0.1:3210/v1/chat/completions \
  -H 'Authorization: Bearer hh-api-...' -H 'Content-Type: application/json' \
  -d '{"model":"glm-5.3-flash","messages":[{"role":"user","content":"say ok"}]}'

# OpenAI Responses
curl -s http://127.0.0.1:3210/v1/responses \
  -H 'Authorization: Bearer hh-api-...' -H 'Content-Type: application/json' \
  -d '{"model":"glm-5.3-flash","input":"say ok"}'

# Anthropic Messages
curl -s http://127.0.0.1:3210/v1/messages \
  -H 'x-api-key: hh-api-...' -H 'anthropic-version: 2023-06-01' -H 'Content-Type: application/json' \
  -d '{"model":"glm-5.3-flash","max_tokens":32,"messages":[{"role":"user","content":"say ok"}]}'
```

| Клиент | Переменные |
|---|---|
| Claude Code | `ANTHROPIC_BASE_URL=http://127.0.0.1:3210`, `ANTHROPIC_API_KEY=hh-api-...` |
| Codex CLI / OpenAI SDK | `OPENAI_BASE_URL=http://127.0.0.1:3210/v1`, `OPENAI_API_KEY=hh-api-...` |
| Cline / Continue | base URL `http://127.0.0.1:3210/v1`, ключ `hh-api-...` |

Список моделей: `GET /v1/models` (27 моделей: 11 free, 16 paid). Free не расходуют Theos, paid требуют `balance > 0`. Модель по умолчанию — `glm-5.3-flash`.

Стриминг: `stream: true` во всех трёх протоколах. Ответы Chat идут байт-прозрачно с завершающим `data: [DONE]`; Responses и Messages рендерятся из чанков с точным порядком событий (§13, §14).

## Поведение при ошибках

- `429`/исчерпание Theos — аккаунт уходит в кулдаун, запрос повторяется на следующем; клиент получает `200` и заголовок `x-hh-attempts`.
- `403 machine_required` — ротация machine-id (максимум 2 попытки), аккаунт не меняется.
- `401/403 social_login_required` — аккаунт помечается `dead` после 3 неудач.
- Нет доступных аккаунтов — `429 no_account_available` в форме запрошенного протокола.
- Ответ уже начал стримиться — failover не выполняется, клиент получает `error`-событие.

## Команды

```powershell
npm run dev          # разработка, http://127.0.0.1:3210
npm run build        # прод-сборка
npm start            # прод-запуск
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # vitest: юнит + интеграционные сценарии §25.2
npm run db:generate  # миграция из src/adapters/db/schema.ts
npm run db:migrate   # применить миграции
npm run doctor       # проверка окружения
```

## Структура

```
app/            HTTP: страницы, /api/*, /v1/*, /healthz
src/core/       домен: сущности, порты, normalize/render, failover, выбор аккаунта
src/adapters/   БД, DeepAI, BM, Python-воркер
src/jobs/       provision, probe, models-sync, cron
src/server/     склейка: runtime, слоты, шлюз, admin-guard
src/ui/         компоненты, хуки, SVG-графики
engine/         Python: worker.py + oauth/dpcode
legacy/         старый HTTP-шлюз (справочно, не используется)
```

## Если что-то не работает

| Симптом | Причина | Что делать |
|---|---|---|
| `/healthz` → 503 `db_locked` | запущен второй экземпляр | закрыть лишний процесс; лок забирается у мёртвого pid автоматически |
| `chrome_ok: false` | нет ни Chrome, ни браузера Playwright | `python -m playwright install chromium` (или `chrome`), затем `GET /api/engine?refresh=1` |
| `429 no_account_available` | нет живых аккаунтов под модель | добавить/проверить аккаунты, проверить баланс |
| `401 invalid_api_key` | ключ отозван или скопирован с обрезкой | выпустить новый ключ |
| `403 social_login_required` | аккаунт email-типа | такие аккаунты не годятся, только Google/Apple OAuth |
| джоба `failed` после рестарта | процесс упал во время provision | перезапустить джобу; покупка идемпотентна по item |

## Безопасность

- Секреты только в `.env.local` и в зашифрованных `settings` (AES-256-GCM, scrypt); в git, логи и ответы не попадают.
- Cookies аккаунтов и пароли BM шифруются тем же ключом; в UI и экспорте — только маски.
- Панель закрыта паролем и httpOnly-cookie, мутации проверяют Origin; CSP с nonce.
- `data/`, `prof/`, `.env*`, `bank.jsonl`, `accounts.txt` — в `.gitignore`.

## Правовая рамка

Код собран для авторизованного red-team исследования биллинговых и lane-гейтов DeepAI Code. Использование — на свой риск и в рамках применимого законодательства. Историческое описание пайплайна и экономики — в `docs/SPEC.md` и `engine/`.