# AGENTS.md

Инструкции для агентов и разработчиков, работающих с этим репозиторием.

## Что это

`hh-api` — локальное Next.js-приложение: покупает Google-логины в BM (bulkmail.shop), регистрирует аккаунты провайдера через Python+Playwright, отдаёт локальные ключи `hh-api-…` с тремя протоколами (OpenAI Chat, OpenAI Responses, Anthropic Messages), ротирует аккаунты при исчерпании лимита, показывает модели, логи и статистику.

Полное ТЗ: **`docs/SPEC.md`** — единственный источник истины по требованиям и контрактам.

## Карта документов

| Файл | Содержимое | Когда читать/писать |
|---|---|---|
| `docs/SPEC.md` | ТЗ: архитектура, БД, API, протоколы, failover, приёмка | перед любой фичей; менять только с записью в `docs/DECISIONS.md` |
| `docs/DESIGN.md` | токены, компоненты, layout, правила стиля | перед любой работой по UI |
| `docs/BUGS.md` | найденные баги, ограничения провайдера, шаблон записи | при каждом баге: сначала запись, потом фикс |
| `docs/DECISIONS.md` | ADR: принятые решения и следствия | при изменении архитектуры или стека |
| `ROADMAP.md` | вехи M0–M8, чекбоксы, статус | после каждой вехи и в конце сессии |
| `README.md` | короткая инструкция запуска для владельца | при изменении установки/портов |

## Команды

```powershell
npm run dev          # разработка, http://127.0.0.1:3210
npm run build        # прод-сборка
npm start            # прод-запуск
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run test         # vitest (unit + integration)
npm run db:generate  # сгенерировать миграцию из src/adapters/db/schema.ts
npm run db:migrate   # применить миграции
npm run doctor       # проверка окружения (node, python, playwright, chrome, порт, секрет)
```

Перед коммитом обязательны: `npm run typecheck && npm run lint && npm run test`.

## Структура и границы слоёв

```
app/          HTTP: парсинг, вызов core/adapters, рендер. Без бизнес-логики.
src/core/     домен: сущности, порты, normalize/render, failover, выбор аккаунта.
              НЕ импортирует next/*, drizzle-orm, better-sqlite3, node:child_process.
src/adapters/ реализация портов: БД, DeepAI, BM, Python-воркер.
src/jobs/     runner, provision, probe, models-sync, cron.
src/ui/       компоненты, хуки, SVG-графики.
engine/       Python: worker.py + отлаженные oauth/dpcode.
```

Нарушение направления зависимостей — блокирующая ошибка ревью. Всё серверное помечать `import 'server-only'`.

## Правила кода

- TypeScript strict, без `any` (исключение — границы внешних JSON, там `unknown` + Zod).
- Валидация всех входов через Zod; ошибки — типизированные коды из `core/gateway/errors.ts`.
- Никаких `console.log` в `app/` и `src/` — только `src/lib/logger.ts` (он редактирует секреты).
- Секреты только через `settings`/`.env.local`; в логи, ответы и git — никогда.
- Один модуль = одна ответственность; файлы > 300 строк дробить.
- Никаких новых зависимостей без записи в `docs/DECISIONS.md`.
- Комментарии — только там, где объясняют «почему», а не «что».

## Правила предметной области

1. **Один активный запрос на аккаунт.** Слот обязателен; освобождение в `finally`.
2. **Failover только до первого байта клиенту.** После — `error`-событие, без тихой подмены.
3. **Free-модели не требуют баланса, paid — требуют `balance > 0`.**
4. **`machine_required` лечится ротацией machine-id, а не сменой аккаунта.**
5. **`401/403` ≠ `429`:** первые ведут к `dead` после 3 неудач, второй — к кулдауну.
6. **OAuth всегда стартует с `api.deepai.org`**, не с `deepai.org`.
7. **Апстрим-идентификаторы моделей только из `/deepai_code/models`**, без хардкода версий.
8. **Ключ `hh-api-…` показывается один раз**, в БД — только хеш.
9. **Деньги:** джоба `provision` сначала читает баланс BM, потом покупает; сумма фиксируется в `jobs.spent_usd`.
10. **Никаких лишних фич.** Всё, чего нет в `docs/SPEC.md` §2.1, не реализуется.

## Работа с багами

1. Воспроизвести, зафиксировать в `docs/BUGS.md` (ID, симптом, причина, план).
2. Написать падающий тест.
3. Исправить, тест зелёный, отметить `fixed` и указать имя теста.
4. Если ограничение на стороне провайдера — статус `upstream` и обход в коде.

## Git

- Коммит = одна логическая единица. Формат: `<scope>: <imperative>` (`gateway: add anthropic streaming`, `ui: accounts table`).
- В коммит входят изменения кода + соответствующие `docs/*.md` / `ROADMAP.md`.
- Запрещено коммитить: `data/`, `prof/`, `.env.local`, `bank.jsonl`, `accounts.txt`, `node_modules/`, `.next/`.
- Перед коммитом: `git status --short` — глазами проверить, что нет секретов.

## Definition of Done

- [ ] Требование из `docs/SPEC.md` реализовано и покрыто тестом.
- [ ] `typecheck`, `lint`, `test` — зелёные.
- [ ] Обработаны loading / empty / error состояния (для UI).
- [ ] Секреты не логируются; проверено на реальном ответе.
- [ ] `ROADMAP.md` обновлён; новый баг/решение записаны в `docs/`.
- [ ] Ручной сценарий из §25.3, относящийся к фиче, пройден.

## Чего не делать

- Не добавлять аутентификацию пользователей, роли, мультитенантность.
- Не выносить приложение в облако и не открывать порт наружу по умолчанию.
- Не переписывать `engine/oauth.py` «для красоты» — только по багу с тестом.
- Не менять формат `hh-api-…` и схему БД без миграции.
- Не добавлять `/v1/embeddings`, батчи, файлы, images.
- Не использовать Cache Components, React Query, Redux, axios, chart-библиотеки.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
