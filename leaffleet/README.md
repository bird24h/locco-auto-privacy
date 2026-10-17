# LeafFleet

Панель Nissan Leaf 2014: заряд батареї, зарядки, GPS-поїздки, події й стан пристрою.
Поточний інтерфейс адаптований для телефона та Telegram Mini App.

Ця гілка підготовлена для незалежного Cloudflare Worker з D1. Вхід у ChatGPT не потрібен.
Публічна адреса відкриває оболонку й локальне демо. Дані автомобіля доступні власнику
після перевірки підпису Telegram або з окремим ключем адміністратора.

## Підключення з Cloudflare Dashboard

На екрані **Select a repository**:

| Поле | Значення |
| --- | --- |
| Repository | `bird24h/locco-auto-privacy` |
| Production branch | `leaffleet` |
| Root directory | `leaffleet` |
| Worker name | `leaffleet` |
| Build command | `npm run build` |
| Deploy command | `npm run deploy` |

Вибери **Workers**, оскільки тут є серверний код і D1.
При першому розгортанні Wrangler створює D1 `leaffleet-db` з binding `DB`.
На першому запиті API або запуску cron порожня база отримує схему версії 2 атомарно.
Наявна історія версії 2 зберігається. Стару базу версії 1 потрібно мігрувати окремо.

Після розгортання: **Worker → Settings → Variables and Secrets**.
Це параметри **runtime**, а не Build variables.

| Назва | Тип | Значення |
| --- | --- | --- |
| `ADMIN_KEY` | Secret | Випадковий ключ, мінімум 32 символи |
| `DEVICE_KEY` | Secret | Інший випадковий ключ, мінімум 32 символи; для ESP32 |
| `TELEGRAM_BOT_TOKEN` | Secret | Токен `@LeafFleetUklon_bot` з BotFather |
| `OWNER_TELEGRAM_ID` | Variable | Числовий Telegram ID власника |
| `TELEGRAM_CHAT_ID` | Secret, необов'язково | Приватний чат для сповіщень; налаштовується окремо |

Згенерувати один ключ локально:

```sh
node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex')+'\n')"
```

Запусти двічі для двох різних ключів. Значення вводяться в Cloudflare, у репозиторії їх немає.
`OWNER_TELEGRAM_ID` задається явно; автоматичного призначення першого відвідувача власником немає.
Без нього й токена вхід через Telegram закритий. `TELEGRAM_CHAT_ID` сам по собі права власника не дає.

## Кнопка Open у Telegram

Коли є робоча HTTPS-адреса Worker:

1. У BotFather: `/mybots` → `@LeafFleetUklon_bot` → Bot Settings → Configure Mini App → Enable Mini App. Вкажи адресу Worker.
2. `/setmenubutton` → бот → адреса Worker → назва `Open`.
3. Відкрий Mini App зі свого Telegram. Сервер перевіряє підпис `initData`, час запуску й `OWNER_TELEGRAM_ID`.

Підпис запуску дійсний одну годину. Після цього закрий і знову відкрий Mini App.
Токен бота й ключі сервер не передає браузеру. Сторонні Telegram-користувачі даних авто не отримують.
`oai-authenticated-user-id`, `initDataUnsafe` та параметри URL не дають доступу.

## Локальна перевірка

```sh
npm ci
npm test
npm run build
npm run dev
```

Потрібен Node.js 22.13+; рекомендовано 24. Для локального API додай ключі в ігнорований `.dev.vars`.
Локальна D1 ізольована від хмарної. Збірка використовує `wrangler deploy --dry-run` і нічого не публікує.
Панель має локальне демо. `/api/probe/*` використовує окремі таблиці й не надсилає Telegram-сповіщень.

## Поточний стан

- Інтерфейс, сервер телеметрії та перевірка Telegram підготовлені в цій гілці.
- Це вихідний код для розгортання; розгортання в особистий Cloudflare ще не підтверджено.
- Токен бота, ID власника та робоча адреса ще мають бути налаштовані в акаунтах власника.
- Відкриття на реальному iPhone у Telegram й ESP32 у машині ще не перевірені.
- Історія зі старого приватного Site автоматично не переноситься.

Початковий код панелі: приватний Site, commit `d61c09f5211d2a53c6e0e80fb2e28f7e76c511f7`.
Дизайн під час перенесення збережено. Ілюстрація зберігається частинами в `asset-source/`;
під час збірки відновлюється початковий PNG з перевіркою SHA-256.

Офіційні інструкції:
[Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/),
[D1 auto provisioning](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning),
[Telegram initData](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
