# Litematica → иллюстрация

Перетаскиваешь `.litematic` — получаешь рисованную 3D-модель постройки: мультяшный свет, контуры «тушью». Всё считается в браузере; на сервер файл попадает, только если нажать «Поделиться».

## Запуск локально

Нужен Node.js 22+.

```bash
npm install
npm run dev        # http://localhost:5173
npm run api        # сервер «Поделиться» на :5231 (vite проксирует /api); без MySQL кнопка просто скрыта
```

Запускать из папки проекта (терминал или npm-конфигурация IDE с `litematica-viewer/package.json`).
Если порт 5173 занят, `npm run dev` остановится с ошибкой — значит, там уже висит другой dev-сервер, его надо остановить.

Продакшн-сборка:

```bash
npm run build      # статика в dist/
npm run preview    # проверить сборку: http://localhost:4173
```

`dist/` — обычные статические файлы с относительными путями, их можно положить куда угодно.

## Деплой

**Render — Web Service** (нужен для «Поделиться»; статический сайт API не запустит):

- Build Command: `npm ci && npm run build`
- Start Command: `npm start`
- Environment: `DATABASE_URL=mysql://user:pass@host:3306/db` (или `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`),
  при необходимости `DB_SSL=true`; `SITE_URL=https://<адрес сайта>` для превью ссылок.

Таблицы создаются сами при старте (миграции в `server/migrations.js`, всё с префиксом `litemat_app_`), в логе:
`🗄  MySQL подключён…`. Нет переменных или база недоступна — сайт работает, кнопки «Поделиться» нет.

**Только просмотр, без «Поделиться»** — любой хостинг статики (GitHub Pages через `.github/workflows/deploy.yml`,
Render Static Site, Netlify…): команда сборки `npm run build`, папка `dist`.

**Docker:** `docker build -t litematica-viewer . && docker run -d -p 8080:8080 -e DATABASE_URL=… litematica-viewer`

## Как пользоваться

1. В игре: Litematica → выделить область → `M` → Area Editor → Save Schematic.
2. Файл лежит в `.minecraft/schematics/`. Перетащи его на страницу.
3. «Как в игре» показывает исходные кубы. «Поделиться» сохраняет файл на сервере и даёт ссылку `/?s=<id>`.

## Обновить цвета блоков под новую версию

```bash
pip install pillow
python3 tools/build_colors.py 1.21.10    # имя ветки из InventivetalentDev/minecraft-assets
```

Неизвестные блоки (моды, новые версии) не ломают рендер: цвет угадывается по названию, форма — куб.

## Структура

```
src/litematic.js   чтение .litematic (gzip → NBT → блоки)
src/convert.js     правила «блок → геометрия», цвета, автосрез
src/greedy.js      склейка граней
src/main.js        сцена three.js, toon-шейдинг, контуры, интерфейс
src/progress.js    прогресс-бар без зависаний вкладки
src/history.js     недавние файлы в IndexedDB
server/            Express: раздаёт dist/ и API ссылок; MySQL, миграции
public/sample.litematic   пример для кнопки «Открыть пример»
```
