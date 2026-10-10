# Litematica → иллюстрация

Перетаскиваешь `.litematic` — получаешь рисованную 3D-модель постройки: мультяшный свет, контуры «тушью», ортографическая камера. Всё считается в браузере, файл никуда не отправляется.

## Запуск локально

Нужен Node.js 18+.

```bash
npm install
npm run dev        # http://localhost:5173
```

Продакшн-сборка:

```bash
npm run build      # статика в dist/
npm run preview    # проверить сборку: http://localhost:4173
```

`dist/` — обычные статические файлы с относительными путями, их можно положить куда угодно.

## Деплой

**GitHub Pages (проще всего).** Запушь репозиторий на GitHub в ветку `main`, затем Settings → Pages → Source: *GitHub Actions*. Workflow `.github/workflows/deploy.yml` соберёт и выложит сайт при каждом пуше.

**Свой сервер через Docker:**

```bash
docker build -t litematica-viewer .
docker run -d -p 8080:80 --name litematica-viewer litematica-viewer   # http://<сервер>:8080
```

**Любой хостинг статики** (nginx, Netlify, Cloudflare Pages, Vercel): команда сборки `npm run build`, папка `dist`.

## Как пользоваться

1. В игре: Litematica → выделить область → `M` → Area Editor → Save Schematic.
2. Файл лежит в `.minecraft/schematics/`. Перетащи его на страницу.
3. «Срез снизу» убирает подземную часть (подбирается автоматически), «Как в игре» показывает исходные кубы.

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
public/sample.litematic   пример для кнопки «Открыть пример»
```
