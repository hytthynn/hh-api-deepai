# DeepAI Code — автогенерация бесплатных аккаунтов + OpenAI-совместимый шлюз

> **Актуальный проект — `hh-api`** (Next.js + Python-воркер). ТЗ: [`docs/SPEC.md`](docs/SPEC.md),
> план: [`ROADMAP.md`](ROADMAP.md), правила: [`AGENTS.md`](AGENTS.md).
> Скрипты переехали в `engine/`, старый HTTP-шлюз — в `legacy/`. Ниже — исходная документация
> пайплайна, она описывает поведение провайдера и остаётся справочником.

Бесплатный доступ к **Claude Opus 5.5, GPT-6.1 Sol, Gemini 4 Argon, Fable 5.2, Kimi K3** и ещё 11 моделям без карты, без API-ключа и без десктоп-приложения.

Один аккаунт = **65 Theos** (обновляются каждые 24 часа) + **11 моделей без расхода Theos вообще**.

## Как это работает

```
24h Google-логин  →  Google OAuth  →  DeepAI аккаунт  →  cookies  →  /deepai_code/chat/completions
   (покупка)          api.deepai.org      (создаётся сам)            (OpenAI-формат)
```

Три гейта, которые надо пройти:

| Гейт | Что нужно | Почему |
|---|---|---|
| `lane_version_unsupported` (426) | `X-DeepAI-Code-Theos: 4` | без него любой запрос отбивается |
| `social_login_required` (403) | OAuth через Google/Apple | email-аккаунты DeepAI не пускают в Code |
| `machine_required` (403) | `X-DeepAI-Code-Machine: sha256(MachineGuid)` | привязка к «машине», иначе не выдают free Theos |

**Критично: стартовать OAuth с `api.deepai.org`, а не с `deepai.org`.** На `deepai.org` allauth ломается (`Social Network Login Failure, Code: unknown`) — это не бан и не IP, это неверный контур:

```js
// deepai.org/static/.../main.js
network_to_url = {google: "/accounts/google/login/?process=login"};
app_base_url   = "https://api.deepai.org";
```

## Быстрый старт

```bash
# 1. Google-логины (24h). Либо свои email|password в accounts.txt, либо покупка:
python redeem.py --buy 5                 # bulkmail.shop лот #578 ($0.0166/шт)
python redeem.py --file codes.txt        # готовые строки email|password

# 2. Волна OAuth (Chrome, headful предпочтительнее)
python wave.py --limit 20 --workers 2

# 3. Проверка + распределение по моделям
python probe.py --all

# 4. Шлюз
python shim.py --port 8770 --bank bank.jsonl
curl localhost:8770/v1/models
```

## API шлюза

Полностью OpenAI-совместимый:

```bash
curl -X POST localhost:8770/v1/chat/completions \
  -H 'Content-Type: application/json' -d '{
    "model": "claude-opus-5-5",
    "messages": [{"role":"user","content":"say ok"}],
    "max_tokens": 64
  }'
```

- авторизация не требуется (или `Bearer any`, если так удобнее клиенту);
- `stream: true` поддержан (SSE passthrough);
- имена моделей — как в `/v1/models` (см. таблицу ниже);
- шлюз сам ротирует аккаунты при `401/403/429`, ставит lane/machine/beacon-заголовки.

## Модели (проверено на живом аккаунте)

**Без расхода Theos — неограниченно (11):**
`glm-5.3-flash`, `deepseek-v4.1-flash`, `mimo-2.6-flash`, `qwen-3.8-flash`,
`minimax-m3.1-flash`, `muse-ember`, `solar-mini-4`, `gpt-6-luna`, `mimo-2.6-pro`,
`glyph-cluster`, `deepai-cyber`

**Платные Theos — но Theos бесплатные, 65/сутки (16):**
`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-fable-5-2`, `gpt-6.1-sol`, `gpt-6.1-terra`,
`gpt-6-astra`, `gemini-4-argon`, `gemini-4-hydrogen`, `gemini-4-carbon`, `glm-5.3`,
`kimi-k3`, `kimi-k3.1-pro`, `minimax-m3`, `muse-spark-1.3`, `muse-wonder`, `qwen-3.8-max-prime`

Замер: 11 коротких запросов (opus/sonnet/sol/argon/fable/k3/...) списали **0.70 Theos**.
То есть 65 Theos ≈ 100–300 коротких ответов или ~4–6 длинных задач на Opus 5.5.

Контекст у frontier-моделей: 1 000 000 токенов, `max_tokens` до 128k (у Claude — 64k).
Vision: `input: ["text","image"]` у всех, кроме `solar-mini-4` / `glyph-cluster` / `deepai-cyber`.

## Экономика

- лот 24h-Google-логин: **$0.0166** → аккаунт с 65 Theos/сутки + безлимитный flash-пул;
- выход OAuth-волны: **~44/50** (88%) на свежих логинах, IAP вылезает редко (аккаунты уже прогреты вендором);
- скорость: 20–26 с на аккаунт последовательно, 4 аккаунта/мин на 2 воркерах;
- Theos обновляются каждый день в то же время (`refresh_at`), аккаунт живёт, пока жив Google-логин
  (24 часа) — но **выданный доступ переживает протухание логина**: работаем по cookies, пароль больше не нужен.

Практический вывод: 20 аккаунтов ≈ $0.33 и ≈ 1300 Theos/сутки + 20 параллельных безлимитных пулов.

## Структура

```
redeem.py     покупка/разбор Google-логинов  -> accounts.txt
oauth.py      один аккаунт: OAuth + cookies   -> bank.jsonl
wave.py       волна с резюмом по bank.jsonl
probe.py      проверка theos/чата, замер расхода
shim.py       OpenAI-совместимый HTTP-шлюз (stdlib, без зависимостей кроме requests)
bank.jsonl    cookies + machine-id на аккаунт
```

## Питфолы (стоили прогонов)

- **26 с на аккаунт, но Chrome умирает после ~14 подряд** — перезапускать контекст каждые 10 аккаунтов,
  профиль на аккаунт (`prof/<local-part>`), `--disable-dev-shm-usage --disable-gpu`.
- **sppedbump `workspacetermsofservice`** («добро пожаловать в ваш новый аккаунт») — обязательно жать
  «Понятно», иначе цикл стоит; затем обычный consent «Continue».
- **Не переиспользовать `state`**: каждый логин идёт со свежим стартом на `api.deepai.org`, повторный
  callback с тем же code даёт `Social Network Login Failure`.
- **Пул 24h-логинов протухает за сутки**: пачка, отредемленная вчера, даёт `signin/rejected` или
  `challenge/recaptcha`. Коды проверять перед покупкой, OAuth гнать в том же окне.
- **reCAPTCHA Enterprise на Google-логине не решается** через 2captcha (токен не принимается) — не тратить время.
- Cookies нужны `sessionid` + `csrftoken` домена `.deepai.org` — их хватает и для `api.deepai.org`.
- `deepseek-v4.1-flash-1017` в API называется `deepseek-v4.1-flash` (с суффиксом — `model_not_found`).

## Правовая рамка

Код собран для авторизованного red-team исследования биллинговых и lane-гейтов DeepAI Code.
Использование — на свой риск и в рамках применимого законодательства.