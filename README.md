# DSH-GeminApi

Плагины и маркет-индекс для **DeepSeek Harness** (DSH).

Репозиторий содержит:

| путь | что это |
|---|---|
| `package.json`, `lib/`, `locale/`, `icon.svg`, `cordis.patch.yml` | сам бандл `dsh-plugin-geminapi-quotas` — устанавливается через интерфейс плагинов DSH |
| `market/index.json` | индекс формата 1 для «Discover» вкладки страницы Plugins |
| `tools/build-index.mjs` | пересборка индекса с закреплением текущего коммита |
| `tools/dsh-api.cjs` | вызов Remote-методов запущенного DSH через локальный Web-карьер |

Пакет плагина — это корень репозитория, поэтому установка не зависит от
подкаталога: pnpm разрешает корневой `package.json` напрямую.

### Проверка через API

```bash
# какие источники индексов настроены
node tools/dsh-api.cjs pluginMarket/listIndexes

# что видит вкладка Discover
node tools/dsh-api.cjs pluginMarket/search '{"url":"https://onarous.github.io/DSH-GeminApi/market/index.json","query":{"sort":{"kind":"index"},"offset":0,"limit":50}}'

# состояние бандлов профиля
node tools/dsh-api.cjs pluginManager/listBundles
```

Web-карьер DSH (`127.0.0.1:27979`) проверяет подписанную cookie, ключ для
которой лежит в `~/.dsh/.credentials.yaml`; скрипт читает его оттуда.

## Установка через интерфейс DSH

1. Откройте **Plugins → Discover**.
2. В **Index sources** добавьте адрес индекса:

   ```
   https://onarous.github.io/DSH-GeminApi/market/index.json
   ```

   Запасной адрес (тот же файл через CDN jsDelivr):

   ```
   https://cdn.jsdelivr.net/gh/Onarous/DSH-GeminApi@main/market/index.json
   ```

3. Найдите **GeminApi Quotas** и нажмите **Install**.

DSH установит бандл из этого репозитория, зафиксировав коммит, и включит его
в профиле. Обновление плагина выполняется через **Update available** на
странице Plugins (удаление + установка новой версии).

### Что нужно для работы

Плагин читает адрес API и ключ из настроек профиля:

- **API URL** — `apiUrl` в `cordis.patch.yml` плагина (по умолчанию `https://gem.onarous.ru`);
- **API-ключ** — переменная окружения `LOCALANTIGRAVITY_API_KEY` или
  `~/.dsh/.credentials.yaml` (`LOCALANTIGRAVITY_API_KEY`).

Ключ можно задать прямо в конфигурации плагина (`apiKey`), либо переопределить
из интерфейса в боковой панели плагина.

## Что даёт плагин

1. **Индикатор квот в шапке сессии** — бейдж с остатком квоты и выпадающим
   меню по клику.
2. **Вкладка в правой боковой панели** — KPI по Gemini/Claude (5 часов и
   неделя), карточки аккаунтов с прогресс-барами, каталог моделей с поиском,
   автообновление и панель настроек.
3. **Серверный прокси без CORS** — `/api/geminapi/quotas`,
   `/api/geminapi/refresh`, `/api/geminapi/status`.
4. **Инструмент `parallel_task`** — одна цель целиком уходит в GeminApi:
   планирование, параллельное выполнение и финальная синтезация.
5. **Инструмент `dsh_subagent`** — штатные continuable-субагенты DSH с
   рабочей папкой, инструментами и разрешениями родителя.

## Версии

Индекс указывает на конкретный коммит, поэтому установка всегда
воспроизводима. Новые релизы:

```bash
# 1. изменить плагин, поднять версию в package.json
# 2. закоммитить изменения плагина
git commit -am "Release 1.4.0"
# 3. пересобрать индекс и запушить
node tools/build-index.mjs
git commit -am "Update market index"
git push
```

Индекс закрепляет **последний коммит, затронувший пакет плагина**
(`package.json`, `lib/`, `locale/`, `icon.svg`, `cordis.patch.yml`), а не `HEAD`:
сам индекс тоже лежит в этом репозитории, и при закреплении `HEAD` любой
коммит с одним индексом ломал бы закрепление. Время публикации берётся из
даты коммита, поэтому пересборка даёт побайтово тот же документ и CI-проверка
никогда не срабатывает ложно.

Индекс валидируется тем же валидатором, который использует сам DSH
(`@deepseek-ai/dsh-plugin-market-index`):

```bash
node -e "import('@deepseek-ai/dsh-plugin-market-index').then(m=>{const d=JSON.parse(require('fs').readFileSync('market/index.json','utf8'));m.parseMarketIndex(d,'https://onarous.github.io/DSH-GeminApi/market/index.json');console.log('VALID')})"
```

## Лицензия

MIT
