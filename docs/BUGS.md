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
| — | — | — | — | — | — | — | — |

## Шаблон для новой записи

```
### B-013 | 2026-11-20 | open | gateway/stream

**Симптом.** Клиент получает 200 и пустой стрим при ошибке апстрима на втором чанке.
**Причина.** Ошибка после первого байта проглатывалась в `try/finally`.
**Фикс.** Отправлять `event: error` и закрывать поток (§16.3).
**Тест.** `tests/integration/stream-abort.test.ts`.
```