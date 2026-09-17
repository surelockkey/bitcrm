# BitCRM Mobile — архітектура застосунку для техніка

Документ описує фундамент мобільного застосунку (Expo SDK 57 / React Native 0.86 /
React 19.2 / TypeScript) для техніків BitCRM: реальний контракт API, рішення щодо
навігації, даних, офлайну, черги завантажень, push, deep links, помилок, теми й
доступності, місце для майбутніх платежів (Stripe Tap to Pay) і поетапний план.

Усе, що стосується бекенду, перевірено читанням коду. Посилання даються у форматі
`шлях:рядок`.

**Застосунок переїхав у монорепозиторій `bitcrm` (`apps/mobile`).** Бекенд тепер
лежить поруч — у `backend/` того самого дерева, — тож обидві позначки нижче
розв'язуються локально: `BE/backend/gateway/nginx.conf:228` читається як
`backend/gateway/nginx.conf:228` від кореня репозиторію. Позначки залишені, бо
номери рядків звірялися саме з тими двома робочими копіями на 2026-09-16.

| Позначка | Де було на момент звірки | Де тепер |
| --- | --- | --- |
| **BE** | `/Users/a1/Desktop/prj/bitcrm-messaging` (`main`) | `backend/` цього репозиторію |
| **TECH** | `/Users/a1/Desktop/prj/bitcrm-f-tech` (`feat/tech-0916`) | `backend/` цього репозиторію |

Типи сутностей більше не переписуються від руки: `src/features/jobs/types.ts`
імпортує `Deal`, `Address`, `Contact`, `TimelineEntry`, `DealAttachmentMeta` і
`JobSuperStatus` з `@bitcrm/types` — того самого пакета, що компілюють сервіси.

**Суміжний документ:** `docs/STACK.md` — перевірка нативного стека (версії
Stripe Terminal SDK, сумісність RN/Expo, `minSdkVersion`, що саме змушує перейти
на custom dev client). Цей файл відповідає на «що і як будуємо», `STACK.md` — на
«якими версіями й чому саме ними». Де вони перетинаються, **`STACK.md` головніший
щодо версій і нативних обмежень**.

Для `deal-service` цитати даються за **TECH**, бо саме там живуть нові
`/tech/confirm` і `/tech/arrived` — у **BE** ті самі файли коротші на 45 рядків
після рядка 173. Для решти сервісів — за **BE** (вони ідентичні в обох).

---

## 1. Інвентар API

### 1.0 Спільні правила

**Gateway.** Усе йде через nginx на `:4000`, який роздає сім upstream-ів за
префіксом шляху — `BE/backend/gateway/nginx.conf:228` (`/api/users`), `:237`
(`/api/crm`), `:246` (`/api/deals`), `:255` (`/api/inventory`), `:264`
(`/api/search`), `:273` (`/api/telephony`), `:282` (`/api/messaging`). Заголовок
`Authorization` проксюється явно (`nginx.conf:234` і далі по кожному блоку).
Префікси задані в кожному сервісі: `BE/backend/services/user/src/main.ts:23`
(`api/users`), `crm/src/main.ts:22`, `deal/src/main.ts:23`,
`inventory/src/main.ts:23`, `telephony/src/main.ts:22`,
`messaging/src/main.ts:23`.

`env.apiBaseUrl` у застосунку вже вказує на `…/api` (`src/lib/env.ts`), тож
шляхи в коді пишемо як `/users/…`, `/deals/…`, `/messaging/…` — так само, як це
робить `src/features/auth/api.ts:5`.

**`EXPO_PUBLIC_API_BASE_URL` обовʼязковий для релізної збірки.** Expo підставляє
`EXPO_PUBLIC_*` у бандл **на етапі збірки**, тому реліз, зібраний без цієї
змінної, полетів би на спільний **dev**-шлюз, і жоден запит не впав би, щоб це
показати. `resolveApiBaseUrl` тому кидає помилку, коли значення порожнє, а
`__DEV__` = false; dev-шлюз лишається запасним варіантом виключно для
`expo start`. Прапорець для попередження на екрані профілю — `env.usingDevGateway`
(«ця збірка говорить із dev-шлюзом»), а не колишній `usingApiOverride`
(«це не константа за замовчуванням»), який спрацьовував рівно навпаки.

**Авторизація.** Bearer — це Cognito **idToken**, не accessToken: сервіси
перевіряють `tokenUse: "id"`. Це вже зафіксовано в `src/lib/api/http.ts:4-9,28-30`.

**Конверт відповіді.** Кожен контролер повертає `{ success: true, data }`, а
списки додають `pagination: { nextCursor, count }` (наприклад
`TECH/backend/services/deal/src/deals/deals.controller.ts:69-73`,
`BE/backend/services/messaging/src/api/messages/messages.controller.ts:55-59`).
`http.ts` уже розпаковує `data` (`src/lib/api/http.ts:51-59`) — для сторінкових
ендпойнтів потрібен окремий helper, який поверне і `pagination`.

**Помилка «сервіс лежить».** nginx сам віддає `503` з
`{"success":false,"error":{"code":"SERVICE_UNAVAILABLE", …}}`
(`BE/backend/gateway/nginx.conf:296-307`) — окремий код, який варто показувати
інакше, ніж 500.

**Права техніка.** Роль `role-technician` описана в
`BE/apps/web/lib/permissions/system-roles.ts:210-251`. Ключове:

- `deals: view + edit + move_status` (`:214`), `dataScope.deals = assigned_only` (`:243`);
- `contacts: view + view_numbers` (`:216`);
- `containers: view` (`:222`);
- `messages: view + send`, `manage: false` (`:239`);
- `team_chat: view + send`, `manage_groups: false` (`:240`);
- `calls: { view: false, join: false }` (`:238`) — **техніку журнал дзвінків недоступний**,
  але маскований bridge працює (див. §1.6);
- `users: crud(false…)` (`:224`) — `GET /users` і `GET /users/:id/permissions` віддадуть 403.

> **Наслідок:** права **не можна прочитати з бекенду** під технікою —
> `GET /users/:id/permissions` вимагає `users.view`
> (`BE/backend/services/user/src/users/users.controller.ts:294`). Веб робить те
> саме, що маємо зробити ми: резолвить матрицю локально з `roleId`, отриманого з
> `/users/me`, плюс `permissionOverrides` — `BE/apps/web/lib/permissions/system-roles.ts:9-10`.
> Отже, таблицю ролей треба **скопіювати** в мобільний застосунок (`src/lib/permissions/`)
> і покрити тестом, який звіряє її з `system-roles.ts`.

---

### 1.1 Auth (user-service)

| Метод і шлях | Guard | Тіло / відповідь | Джерело |
| --- | --- | --- | --- |
| `POST /users/auth/login` | `@Public` | `{ email, password }` → `{ idToken, accessToken, refreshToken, expiresIn }` або challenge `{ challengeName: "NEW_PASSWORD_REQUIRED", session }` | `BE/backend/services/user/src/auth/auth.controller.ts:16`, DTO `auth/dto/login.dto.ts:5-13`, Cognito `auth/auth.service.ts:21-25` |
| `POST /users/auth/refresh` | `@Public` | `{ refreshToken }` → `{ idToken, accessToken, expiresIn }` | `auth.controller.ts:27`, DTO `auth/dto/refresh-token.dto.ts:5-10` |
| `POST /users/auth/change-password` | `@Public` | `{ email, newPassword, session }` — відповідь на challenge першого входу | `auth.controller.ts:38` |
| `POST /users/auth/password-reset` | `@Public`, 200 | `{ email }` → завжди однакова відповідь (без account enumeration) | `auth.controller.ts:49` |
| `POST /users/auth/password-reset/confirm` | `@Public`, 200 | `{ email, code, newPassword }` | `auth.controller.ts:63` |
| `GET /users/me` | будь-який автентифікований | `User` — `{ id, cognitoSub, email, firstName, lastName, roleId, department, phone?, status, permissionOverrides?, createdAt, updatedAt }` | `users/users.controller.ts:34`, сутність `BE/packages/types/src/entities/user.entity.ts:4-21` |
| `PUT /users/me` | будь-який автентифікований | `{ phone }` — тільки власний телефон; `409`, якщо номер уже зайнятий | `users.controller.ts:45-60` |
| `POST /users/by-ids` | будь-який автентифікований (свідомо **не** `users.view`) | `{ userIds: string[] }` (≤ 200) → тільки імена | `users.controller.ts:83-98` |

Це все, що треба v1: логін, мовчазний refresh, профіль, резолв імен колег на
картці роботи. `change-password` у v1 не реалізуємо — перший вхід техніка
робиться у вебі (так уже трактує це `src/features/auth/types.ts:23-27`).

---

### 1.2 Роботи техніка (deal-service)

| Метод і шлях | Permission | Деталі | Джерело |
| --- | --- | --- | --- |
| `GET /deals?techId=&limit=&cursor=&superStatus=` | `deals.view` | Список; `limit` 1…100, за замовчуванням 20; курсорна пагінація | `TECH/backend/services/deal/src/deals/deals.controller.ts:56`, DTO `deals/dto/list-deals-query.dto.ts:6-79` |
| `GET /deals/:id` | `deals.view` | Один `Deal` | `deals.controller.ts:100` |
| `PUT /deals/:id/status` | `deals.move_status` | `{ superStatus, subStatusId?, cancellationReason? }`; `cancellationReason` обов'язковий для `canceled` | `deals.controller.ts:158`, DTO `deals/dto/move-status.dto.ts:10-27` |
| `POST /deals/:id/tech/confirm` | `deals.edit` + членство в ростері (для `assigned_only`) | Порожнє тіло. Ідемпотентно на виклик: другий виклик не пише другий запис таймлайну. `400` після закриття роботи. Ставить `techConfirmedAt`/`techConfirmedBy` | `deals.controller.ts:176-197` |
| `POST /deals/:id/tech/arrived` | `deals.edit` + ростер | `{ lat?, lng?, accuracy? (0…100000), subStatusId? }` — **усі поля необов'язкові**. Ідемпотентно: перше прибуття лишається. Ставить `arrivedAt`/`arrivedBy`/`arrivedLocation`, застосовує sub-status прибуття | `deals.controller.ts:199-218`, DTO `deals/dto/mark-arrived.dto.ts:11-37` |
| `GET /deals/:id/timeline?cursor=` | `deals.view` | Стрічка активності | `deals.controller.ts:220` |
| `POST /deals/:id/notes` | `deals.edit` | `{ note }` (min 1 символ) | `deals.controller.ts:264`, DTO `deals/dto/add-note.dto.ts:4-9` |
| `PATCH /deals/:id/notes/:entryId` | `deals.edit` | Редагування нотатки | `deals.controller.ts:279` |
| `DELETE /deals/:id/notes/:entryId?timestamp=` | `deals.edit` | Видалення нотатки | `deals.controller.ts:297` |
| `GET /deals/:id/products` | `deals.view` | Позиції роботи | `deals.controller.ts:447` |
| `POST /deals/:id/products` | `deals.edit` | Додати позицію (списує з контейнера техніка) | `deals.controller.ts:373` |

**Сутність `Deal`** — `TECH/packages/types/src/entities/deal.entity.ts:8-113`. Для
екрана техніка критичні: `dealNumber:15`, `contactId:16`, `scheduledDate:20`,
`scheduledTimeSlot:24`, `allDay:26`, `address:31`, `superStatus:38`,
`assignedTechIds:45`, `sequences:52` (порядок обʼїзду per-tech), `priority:53`,
`notes:58`, `subStatusId:67`, `clientName:82`, `techConfirmedAt:101`,
`arrivedAt:108`.

`JobSuperStatus` — `TECH/packages/types/src/enums/deal-stage.enum.ts:52-59`:
`submitted | in_progress | done | pending | done_pending_approval | canceled`.

#### Три речі, які ламають наївну реалізацію

1. **Немає фільтра за датою.** `ListDealsQueryDto` не має жодного поля дати
   (`dto/list-deals-query.dto.ts:6-79`). Запит по техніку йде в GSI2, відсортований
   за `scheduledDate` **у зворотному порядку** (`deals.repository.ts:191-215`,
   ключ сортування `deals.repository.ts:315`). Тобто «мої роботи на сьогодні»
   збирається **клієнтом**: викачати всі сторінки за `techId` і згрупувати
   локально. Веб робить рівно так — `TECH/apps/web/features/deals/api.ts:49-65`
   (`fetchAllDeals` ходить по курсору, доки він є; сторінка може бути порожня при
   живому курсорі) і `TECH/apps/web/features/tech/lib.ts:102-153` (`groupJobsByDay`:
   прострочені → сьогодні → завтра → кожен наступний день → недатовані; «сьогодні»
   показується завжди, навіть порожнім, `lib.ts:137-138`; закриті роботи лишаються
   тільки в «сьогодні», `lib.ts:117`). Там-таки готові `addressLine:158-163` і
   `navigationUrl:171` (universal Google Maps URL, координати виграють у тексту
   адреси) — обидві переносяться в мобільний без змін.
   **Рішення для мобільного:** повторити ту саму логіку групування один-в-один
   (спільний тест-вектор), а в v5 попросити бекенд додати `scheduledFrom`/`scheduledTo`.

2. **`techId` треба слати явно.** Сервер підставляє власний id виклика́ча
   **тільки** коли `dataScope === 'assigned_only'`
   (`TECH/backend/services/deal/src/deals/deals.service.ts:441-443`). Диспетчер,
   який відкриє екран техніка, без явного `techId` отримає всю дошку. Веб це
   документує в `TECH/apps/web/features/tech/hooks.ts:25-30`. Отже екран «Мої
   роботи» чекає на `me.id` і не запускає запит раніше.

3. **Статуси й підстатуси — різні ендпойнти.** `PUT /deals/:id/status` вимагає
   `deals.move_status` (є в техніка), а `confirm`/`arrived` — `deals.edit`
   (теж є). Але «прибув» сам виставить підстатус In Progress, якщо каталог його
   має — дублювати `PUT /status` після `arrived` не треба
   (`deals.controller.ts:202-208`).

---

### 1.3 Вкладення роботи (фото) — deal-service

Три кроки: **presign → PUT у S3 → метадані вже записані**.

| Метод і шлях | Permission | Деталі | Джерело |
| --- | --- | --- | --- |
| `POST /deals/:id/attachments` | `deals.edit` | `{ fileName (≤255), contentType, size?, category? (≤40) }` → `{ id, uploadUrl, s3Key, headers }` | `TECH/backend/services/deal/src/deals/attachments/deal-attachments.controller.ts:16`, DTO `attachments/dto/upload-attachment.dto.ts:4-28`, сервіс `attachments/deal-attachments.service.ts:58-92` |
| *(PUT на `uploadUrl`)* | — | **Обовʼязково повторити всі `headers` з відповіді** — SSE-KMS заголовки входять у підпис, інакше S3 віддасть 403 (`deal-attachments.service.ts:65-70`) | — |
| `GET /deals/:id/attachments` | `deals.view` | Метадані списком | `deal-attachments.controller.ts:31` |
| `GET /deals/:id/attachments/:attachmentId` | `deals.view` | Presigned URL на завантаження з коротким TTL | `deal-attachments.controller.ts:39` |
| `PATCH /deals/:id/attachments/:attachmentId` | `deals.edit` | Перейменування / опис | `deal-attachments.controller.ts:47` |
| `DELETE /deals/:id/attachments/:attachmentId` | `deals.edit` | — | `deal-attachments.controller.ts:63` |

**Дозволені типи:** `image/jpeg|png|webp|heic` і `application/pdf` — регулярка в
`upload-attachment.dto.ts:12-15`. Обмеження розміру на цьому ендпойнті **немає**
(`size` лише `@IsInt() @Min(0)`), тож стиснення — рішення клієнта.

**Важливий побічний ефект:** запис метаданих і `ATTACHMENT_ADDED` у таймлайні
відбувається **на кроці presign** (`deal-attachments.service.ts:72-90`), тобто
*до* самого PUT. Якщо PUT провалиться, у роботі лишиться «привид» вкладення.
Черга завантажень (§2.4) мусить це враховувати: presign викликати **тільки тоді,
коли файл уже лежить на диску й ми справді збираємось його вивантажити**, і
ретраїти PUT з тим самим `uploadUrl`, доки він живий.

**Ендпойнта «перепідписати наявний `attachmentId`» на бекенді НЕМАЄ.** У
контролері лише пʼять маршрутів (`deal-attachments.controller.ts:16, 31, 39,
47, 63`), і кожен `POST` карбує **новий** id, новий S3-ключ і новий запис у
таймлайні. А `uploadUrl` живе лише **300 с** (`expiresIn: opts.expiresIn ?? 300`,
`packages/shared/src/storage/s3.service.ts:71-79`; `deal-attachments.service.ts`
не передає `expiresIn` взагалі), тоді як backoff черги доходить до 15 хв і далі.
Тобто протухлий підпис — це нормальний шлях для фото, знятого в підвалі, а не
рідкісний випадок.

Звідси правило черги: **перед новим presign старе вкладення видаляється** —
`DELETE /deals/:id/attachments/:attachmentId`, якому достатньо `deals.edit`, а
`role-technician` його має (`default-roles.ts:290`). Видалення прибирає і рядок
метаданих, і обʼєкт у S3 (для ніколи не завантаженого ключа це no-op), і пише
`ATTACHMENT_REMOVED`. Повторний DELETE віддає 404 — черга трактує його як успіх.
Якщо видалення не вдалося (немає звʼязку), ticket **не** обнуляється: краще ще
один дешевий 403 на мертвому URL наступного разу, ніж привид у роботі.

---

### 1.4 Месенджер (messaging-service)

#### Клієнтська гілка (SMS/MMS з клієнтом)

| Метод і шлях | Permission | Деталі | Джерело |
| --- | --- | --- | --- |
| `GET /messaging/conversations?view=&kind=&categoryId=&cursor=` | `messages.view` (scope `assigned_only` → лише треди своїх робіт і власний тред) | `view` = all/unread/flagged/archived/mine | `BE/backend/services/messaging/src/api/conversations/conversations.controller.ts:28` |
| `GET /messaging/conversations/by-job/:dealId` | `messages.view` + ростер | Тред клієнта за роботою; `404`, доки тред не створено | `conversations.controller.ts:97` |
| `GET /messaging/conversations/by-party/:kind/:id` | `messages.view` | `kind` ∈ contact / company / employee / group | `conversations.controller.ts:64` |
| `GET /messaging/conversations/:id` | `messages.view` | Тред + власна мітка прочитання | `conversations.controller.ts:158` |
| `GET /messaging/conversations/:id/messages?limit=&cursor=` | `messages.view` | Найновіші перші, `cursor` вантажить старіші; `limit` 1…100, дефолт 50 | `api/messages/messages.controller.ts:39`, DTO `api/conversations/dto/paging-query.dto.ts:9-22` |
| `GET /messaging/messages/by-job/:dealId?limit=&cursor=` | `messages.view` + ростер | Усі повідомлення, що згадували роботу | `messages.controller.ts:83` |
| `POST /messaging/conversations/:id/messages` | `messages.send` | **202**. Тіло — див. нижче | `outbound/send.controller.ts:21` |
| `POST /messaging/messages` | `messages.send` | Відкриває тред: рівно одне з `contactId` / `phone` (E.164) | `send.controller.ts:74` |
| `POST /messaging/conversations/:id/read` | `messages.view` | Позначити прочитаним | `api/conversations/conversation-management.controller.ts:41` |
| `GET /messaging/conversations/counters` | `messages.view` | `{ unreadConversations, flaggedConversations, unreadByKind }` | `conversations.controller.ts:52` |

**`SendMessageDto`** — `BE/backend/services/messaging/src/outbound/dto/send-message.dto.ts:80-148`:
`clientMessageId` (uuid, **обовʼязковий** — повтор того самого ключа повертає
перше повідомлення замість повторної відправки), `channel`
(`sms` | `in_app`; email → 501), `body`, `subject?`, `fromNumber?`, `toAddress?`,
`dealId?`, `templateId?`, `attachments?` (≤10, ≤5 МБ сумарно), `mentions?`.
Вкладення описує `SendAttachmentDto:58-77` — `{ id, fileName, contentType, size }`,
де `id` приходить з presign.

Відмови, які треба показати людині: `422 RECIPIENT_OPTED_OUT`,
`422 EMPLOYEE_HAS_NO_PHONE` (`send.controller.ts:30-33`).

#### Командна гілка (team chat)

| Метод і шлях | Permission | Джерело |
| --- | --- | --- |
| `GET /messaging/team/conversations?kind=team\|group&cursor=` | `team_chat.view` | `team/team.controller.ts:27` |
| `GET /messaging/team/counters` | `team_chat.view` | `team.controller.ts:50` — `{ unreadConversations, unreadByKind: { team, group } }` |
| `GET /messaging/team/conversations/:id` | `team_chat.view` | `team.controller.ts:63` |
| `GET /messaging/team/conversations/:id/participants` | `team_chat.view` | `team.controller.ts:73` |
| `POST /messaging/team/conversations/:id/read` | `team_chat.view` | `{ lastReadMessageSk? }` — `team.controller.ts:90` |

Надсилання в командний тред — той самий `POST /messaging/conversations/:id/messages`,
але з `channel: "in_app"` і додатковою вимогою `team_chat.send`
(`send.controller.ts:27-34`). Для `team`/`group` `in_app` зберігається одразу як
`sent` і розсилається по SSE.

#### Вкладення для повідомлень

`POST /messaging/attachments/presign`, `messages.send` —
`outbound/attachments/attachments.controller.ts:15`, DTO
`outbound/attachments/dto/request-attachment-upload.dto.ts:7-22`:
`{ fileName (1…255), contentType (типи, які тягне Twilio MMS), size (1…5 МБ) }`.
Це **інший** ендпойнт, ніж вкладення роботи (§1.3), з жорсткішим лімітом.

#### Автоматичні тексти техніка

| Метод і шлях | Permission | Тіло | Джерело |
| --- | --- | --- | --- |
| `POST /messaging/automations/on-my-way` | `messages.send` | `{ dealId, etaMinutes? (1…600), clientMessageId? }` | `automations/tech-notices.controller.ts:20`, DTO `automations/dto/on-my-way.dto.ts:5-22` |
| `POST /messaging/automations/late` | `messages.send` | `{ dealId, minutes (1…600), clientMessageId? }` | `tech-notices.controller.ts:36`, DTO `automations/dto/late.dto.ts:5-21` |

Текст рендериться на сервері з шаблону воркспейсу. **Без `clientMessageId`**
сервер дедуплікує за (правило, робота, технік, 15-хвилинний кошик) — і другий
текст «запізнююсь на 45 хв» після першого «на 15 хв» буде мовчки викинуто, хоча
клієнт отримає 202. Веб мінтить новий uuid на кожен тап і пояснює чому —
`TECH/apps/web/features/tech/hooks.ts:150-160`. Робимо так само.

#### Реальний час

`GET /messaging/events` — SSE, `BE/backend/services/messaging/src/realtime/realtime.controller.ts:33-124`.
Guard — `messages.view` **або** `team_chat.view`, перевіряється в тілі методу
(`:49-53`), бо декоратор не вміє «або». Події:
`conversation.upserted`, `message.upserted`, `counters.changed`,
`opt_out.changed`, `team_counters.changed` (`:38-42`). Heartbeat-коментар кожні
25 с (`realtime.controller.ts:14`, `:114`). Права перерезолвлюються на кожну
подію з памʼяттю 60 с (`:92-95`).

**Документований fallback** (`realtime.controller.ts:45-46`): опитувати
`GET /messaging/counters` (`realtime.controller.ts:126`) і `GET /messaging/team/counters`
кожні 30 с, а відкриту стрічку — кожні 10 с.

> **Мобільне обмеження.** Потік треба відкривати `fetch`-стрімом, бо
> `EventSource` не вміє слати заголовки (`realtime.controller.ts:38-39`), а
> токен у нас у `Authorization`. Стандартний RN `fetch` стрімити не вміє;
> `expo/fetch` (SDK 57) — вміє, це WinterCG-сумісний fetch з
> `response.body.getReader()`. Плюс сам SSE на мобільному сумнівний: фонове
> зʼєднання ОС рве. **Рішення:** v2 — polling за документованим fallback-ом
> (30 с / 10 с) + push для доставки в фоні; SSE — тільки поки екран чату
> відкритий і застосунок у foreground, і лише якщо полінг виявиться дорогим.

---

### 1.5 Склад (inventory-service)

| Метод і шлях | Permission | Джерело |
| --- | --- | --- |
| `GET /inventory/containers/my` | **будь-який автентифікований**; `404`, якщо контейнера немає | `BE/backend/services/inventory/src/containers/containers.controller.ts:36-41` |
| `GET /inventory/containers/:id/stock` | `containers.view` (у техніка є) | `containers.controller.ts:80-86`; повертає `StockItem[]` (`containers/containers.service.ts:118-120`) |

Тобто «мій фургон» — це два запити: `my` → `:id/stock`. Веб робить так само
(`TECH/apps/web/features/tech/components/my-stock-page.tsx:10-11,33`), режим
«тільки читання».

---

### 1.6 Телефонія (telephony-service)

Роль техніка має `calls.view: false` (`BE/apps/web/lib/permissions/system-roles.ts:238`),
тож журнал дзвінків закритий. Але маскований дзвінок **не має** `@RequirePermission` —
він перевіряє ростер роботи:

| Метод і шлях | Guard | Деталі | Джерело |
| --- | --- | --- | --- |
| `POST /telephony/calls/bridge` | автентифікований + технік має бути в ростері роботи | Тіло — **дескриптор, ніколи не номер**: `{ dealId, contactId, phoneIndex?, via? }`, `via` ∈ `cell` \| `softphone`. Номер клієнта резолвиться на сервері й до пристрою не доходить. Повертає `{ bridgeId, mode, callSid?, clientName }` одразу | `BE/backend/services/telephony/src/calls/calls.controller.ts:755-817`, DTO-клас `calls.controller.ts:78-90` |
| `DELETE /telephony/calls/bridge/:bridgeId` | автор або технік, якому дзвонять | Скасувати, доки дзвонить (клієнту ще не набирали) | `calls.controller.ts:819-840` |
| `GET /telephony/calls/active` | автентифікований (ungated, `calls.controller.ts:369`) | Прогрес bridge; веб опитує кожні 5 с | `calls.controller.ts:356-375` |
| `GET /telephony/config` | автентифікований | `{ technicianLine }` — спільний номер, який можна набрати з трубки без сесії | `telephony/telephony.controller.ts:17-31` |
| `GET /telephony/exts/by-deal/:dealId` | автентифікований + право дзвонити по роботі | `{ code }` — код доступу до роботи; мінтиться на першу вимогу | `exts/exts.controller.ts:34-50` |
| `POST /telephony/exts/by-deal/:dealId/rotate` | те саме | Перевипуск коду | `exts/exts.controller.ts:52-68` |

**Для мобільного `via: "cell"` — правильний дефолт**: телефон дзвонить власною
трубкою техніка, потім набирає клієнта. Softphone (`POST /telephony/token`,
`telephony.controller.ts:33`) — це Twilio Voice у браузері, у v1…v4 нам не
потрібен. Трубка дзвонить ~15 с (`calls.controller.ts:70-72`).

---

### 1.7 Клієнт (crm-service)

`GET /crm/contacts/:id` — `contacts.view`
(`BE/backend/services/crm/src/contacts/contacts.controller.ts:90`). Технік має
`contacts.view` і `contacts.view_numbers`
(`system-roles.ts:216`), тож бачить номери клієнта немаскованими. Потрібно для
картки роботи (імʼя, телефон, адреса — адреса й так є в `Deal.address`).

---

### 1.8 Чого на бекенді **немає** (і що це означає)

Перевірено пошуком по `BE/backend`:

- **Push-нотифікації.** Жодної згадки про `deviceToken`, APNs, FCM, Expo push,
  реєстрацію пристроїв. Бекенд не має куди складати токени і нічим їх не
  розсилає. Отже v2 **вимагає бекенд-роботи** (див. §2.6).
- **Платежі.** Ні Stripe, ні `PaymentIntent`, ні сутності `Payment`. На `Deal` є
  лише `paymentStatus?: string` (`TECH/packages/types/src/entities/deal.entity.ts:70`),
  який оновлюється внутрішнім ендпойнтом `PUT /deals/internal/:id/payment-status`
  (`TECH/backend/services/deal/src/deals/deals.controller.ts:471`). Тобто §3 — це
  повністю новий серверний модуль.
- **Фільтр робіт за датою** — див. §1.2.
- **Ендпойнт «мої права»** — див. §1.0.

---

## 2. Архітектура застосунку

### 2.1 Навігація — **expo-router**

**Рішення: expo-router.** Обґрунтування:

1. Він побудований поверх React Navigation — ми нічого не втрачаємо у
   можливостях, а отримуємо файловий роутинг і типізовані маршрути.
2. **Deep links працюють із коробки**: шлях у файловій системі *і є* URL. Нам
   треба вести з push-нотифікації прямо в роботу або тред (§2.7) — з
   react-navigation це ручна `linking`-конфігурація, яку легко розсинхронізувати
   з деревом екранів.
3. SDK 57 підтримує нативні таби й split view саме через expo-router
   (docs.expo.dev/versions/v57.0.0/, розділ Routing).
4. Групи `(auth)` / `(app)` дають природний захищений сегмент: поточний
   `App.tsx:18` вже робить ручний перемикач `signedIn ? Home : Login` — це рівно
   те, що `<Stack.Protected guard={…}>` виражає декларативно.

**Ціна:** `App.tsx` зникає, точкою входу стає `app/_layout.tsx`; `index.ts` і
`package.json.main` треба перевести на `expo-router/entry`. Це разова міграція
на початку v1, поки екранів два.

Дерево маршрутів v1:

```
app/
  _layout.tsx              # AuthProvider + QueryClientProvider + тема
  (auth)/login.tsx
  (app)/_layout.tsx        # нижні таби
  (app)/jobs/index.tsx     # «Мої роботи» — денний список
  (app)/jobs/[id].tsx      # картка роботи
  (app)/jobs/[id]/photos.tsx
  (app)/profile.tsx
  +not-found.tsx
```

v2 додав `(app)/(tabs)/chat.tsx` — вкладку «Messages» з тредом офісу — і
`(app)/chat/[dealId].tsx`: той самий тред, відкритий із роботи, лягає **над**
табами, тому «Назад» веде на роботу, а рядок іде з `dealId`. Окремого
`[conversationId]` немає: у техніка один тред, і список із одного рядка — це
зайвий тап (`WORKIZ_MOBILE_APP.md` §1.5: 99,5 % in-app тредів — «офіс ↔ технік»).
v3 — `(app)/stock.tsx`; v4 — `(app)/jobs/[id]/payment.tsx`.

**v5 — форма застосунку зведена до Workiz.** Власник поставив справжній Workiz
for Android 4.281 в емулятор, і виявилося, що там **рівно три нижні вкладки**:
`Home` · `Schedule` · `Messages`, а решта — у бічному меню за бургером
(`docs/import/WORKIZ_APP_SCREENS_LIVE.md` §1–§2). У нас було п'ять вкладок.
Техніки — літні люди, які роками тиснуть третю вкладку, очікуючи Messages, тому
панель стала їхньою трійкою:

```
app/(app)/(tabs)/index.tsx      # Home — дашборд, а не список (§3)
app/(app)/(tabs)/schedule.tsx   # Schedule — Timeline / Day (§4)
app/(app)/(tabs)/chat.tsx       # Messages — підпис змінився, маршрут /chat ні
app/(app)/jobs/index.tsx        # меню → Jobs (той самий денний список)
app/(app)/stock.tsx             # меню → My stock        (було вкладкою)
app/(app)/queue.tsx             # меню → Waiting to send (було вкладкою)
app/(app)/settings.tsx          # меню → Settings
app/(app)/profile.tsx           # меню → Profile         (було вкладкою)
app/(app)/timesheet/index.tsx   # меню → Timesheets
```

Маршрут `/chat` навмисно не перейменовано на `/messages`: на нього вже
посилаються пуш-сповіщення (`features/notifications/routing.ts`) і картка
роботи, а виграшу, який технік побачив би, немає.

Меню — `Modal`, а не drawer-навігатор: для нього потрібні Reanimated і Gesture
Handler, яких у застосунку немає, і меню, що відкривається кілька разів на день,
не варте двох нативних залежностей. Ціна — немає свайпу від краю; лишається все
інше, включно з Escape й апаратним «Назад» через `onRequestClose`. Лічильник
невідправленого, який раніше висів на вкладці Queue, став крапкою на бургері —
інакше він зник би з очей разом із вкладкою.

`Price book` і `Expenses` з їхнього меню ми **не** додали: за ними в нас немає ні
ендпоінта, ні екрана, ні рядка даних, а пункт меню, який нічого не відкриває,
вчить техніка, що меню бреше. У фільтрі Schedule з їхніх `Status / Tags / Type`
лишився тільки `Status` — з тієї самої причини (у `Deal` немає тегів, а
`jobTypeId` — це id без назви, яку телефон міг би показати).

---

### 2.2 Дані й стан — **@tanstack/react-query**

**Рішення: react-query** (`@tanstack/react-query` v5), не власний кеш.

Обґрунтування:

1. Бекенд **уже** спроєктований під нього: веб-клієнт на react-query, ключі
   централізовані (`TECH/apps/web/lib/query-keys.ts`), а хуки техніка —
   `TECH/apps/web/features/tech/hooks.ts:51-110` — використовують
   `invalidateQueries` + оптимістичний `setQueryData` з відкатом на помилці. Ми
   переносимо перевірену логіку, а не вигадуємо нову.
2. Потрібна саме та поведінка, яку писати руками дорого: дедуплікація однакових
   запитів, `staleTime`, фонове оновлення, ретраї, скасування, оптимістичні
   мутації з rollback.
3. Офлайн: `@tanstack/query-async-storage-persister` + `persistQueryClient` дають
   гідратацію кешу з диска на холодний старт — це рівно наша вимога «відкрив
   застосунок у підвалі й побачив сьогоднішні роботи».
4. `onlineManager` можна підключити до `@react-native-community/netinfo` — тоді
   react-query сама паузить запити без мережі й відновлює їх при поверненні.

**Чого react-query НЕ робить** і що ми пишемо самі: черга **мутацій**, які мають
пережити вбивство процесу (`persistQueryClient` зберігає кеш запитів, а не
мутації в польоті). Це §2.4.

**Список робіт інвалідувати не можна.** У `GET /deals` немає фільтра за датою
(§1.2), тому `deals.lists()` — це `fetchAllDeals`, який обходить **усі** сторінки
призначених технікові робіт (до 50 запитів по 100 штук). Один тап «Прибув» не
має коштувати перезавантаження всієї історії по мобільному інтернету. Тому:

- `confirm`, `arrived` і зміна статусу повертають оновлений `Deal` — його
  кладемо просто в кеш (`setQueryData` для `deals.detail`, `applyPatchToList`
  для рядка в кожному кешованому списку);
- нотатка, автотексти й фото нічого в рядку дня не міняють — для них
  інвалідуємо лише `deals.detail` / `deals.timeline` / `deals.attachments` тієї
  однієї роботи;
- `deals.lists()` не інвалідується **ніколи** — список оновлюється сам, коли
  екран дня стає активним. Справжнє виправлення — параметри `scheduledFrom` /
  `scheduledTo` на бекенді (§5).

Структура шару даних:

```
src/lib/api/http.ts          # вже є; додати put/patch/delete і paginated-варіант
src/lib/api/query-keys.ts    # дзеркало TECH/apps/web/lib/query-keys.ts
src/lib/permissions/         # копія матриці ролей + can()
src/features/jobs/api.ts     # чисті функції поверх http
src/features/jobs/lib.ts     # groupJobsByDay, formatSlot, compareVisitOrder — ЧИСТІ, тестовані
src/features/jobs/hooks.ts   # useMyJobs, useJob, useConfirmReceipt, useMarkArrived…
```

`lib.ts` портуємо з `TECH/apps/web/features/tech/lib.ts` разом із тестовими
векторами з `lib.test.ts` — це найдешевший спосіб гарантувати, що мобільний і веб
показують однаковий день.

---

### 2.3 Офлайн

**Що зобовʼязане працювати без мережі:**

| Сценарій | Механізм |
| --- | --- |
| Переглянути роботи на сьогодні й завтра | Персистентний кеш react-query, гідрація на старті |
| Відкрити картку роботи, адресу, телефон клієнта, нотатки | Той самий кеш (`deals.detail`), префетч детально для робіт поточного дня |
| Натиснути «Підтвердив» / «Прибув» | Черга мутацій (§2.4) з оптимістичним штампом у кеші |
| Змінити статус | Черга мутацій |
| Зняти фото | Файл лишається у файловій системі застосунку, запис у черзі завантажень |
| Додати нотатку | Черга мутацій |
| Чат | **Не** працює офлайн у v1–v4; вихідне повідомлення можна поставити в чергу в v5 |

**Сховище: `expo-sqlite`, не AsyncStorage.**

- Черга операцій — це таблиця з упорядкуванням, статусами, лічильником спроб і
  запитами «дай наступну готову до відправки». AsyncStorage (key-value) змушує
  читати-модифікувати-писати весь масив на кожну зміну — і втрачати записи при
  паралельних записах з двох екранів.
- Кеш react-query — навпаки, один блоб; для нього AsyncStorage годиться. Тому
  **обидва**: `expo-sqlite` для черг, `@react-native-async-storage/async-storage`
  для персистера react-query.
- Токени лишаються в `expo-secure-store` (вже реалізовано,
  `src/features/auth/token-store.ts`).

Схема SQLite (v1):

```sql
CREATE TABLE outbox (
  id            TEXT PRIMARY KEY,   -- uuid, він же idempotency key
  user_id       TEXT NOT NULL,      -- хто поставив у чергу; див. «Фургон» нижче
  kind          TEXT NOT NULL,      -- 'confirm' | 'arrived' | 'status' | 'note' | 'on_my_way' | 'late'
  deal_id       TEXT NOT NULL,
  payload       TEXT NOT NULL,      -- JSON
  created_at    INTEGER NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error    TEXT,
  state         TEXT NOT NULL       -- 'pending' | 'sending' | 'unknown' | 'failed' | 'done'
);
CREATE TABLE uploads (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  deal_id       TEXT NOT NULL,
  local_uri     TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size          INTEGER,
  category      TEXT,
  attachment_id TEXT,               -- id з presign, коли він уже отриманий
  upload_url    TEXT,
  upload_headers TEXT,              -- JSON; ОБОВ'ЯЗКОВО відтворити на PUT
  attempts      INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  state         TEXT NOT NULL
);
```

**Ідемпотентність — головна причина, чому черга безпечна.** `tech/confirm` і
`tech/arrived` ідемпотентні на сервері за визначенням: обидва роблять ранній
`return deal` **до** запису в таймлайн (`deals.service.ts:1023-1041` і `:1096`),
а `confirmAssignment` — це умовний запис `if_not_exists`. Автотексти
дедуплікуються за `clientMessageId`, яким ми відправляємо **id самого рядка
черги** (`messages.repository.ts:277-284`, TTL вказівника — 7 днів).

Для `notes` і `status` серверної ідемпотентності **немає взагалі**:
`AddNoteDto` — це один рядок `note` без жодного ключа (`add-note.dto.ts:4-9`), а
`addNote` безумовно дописує запис у таймлайн (`deals.service.ts:773-776`);
`PUT /deals/:id/status` при повторі з тим самим статусом усе одно пише другий
`STATUS_CHANGED`, перештамповує `closedAt` і **повторно публікує**
`deal.completed` (`deals.service.ts:700-736`). Тому `state: 'sending'` фіксуємо
**до** запиту, а не після.

**Гарантія «ніколи не надішлемо двічі» тримається на відновленні після краху.**
Наївне `UPDATE outbox SET state='pending' WHERE state='sending'` на старті
перезаряджає саме ті рядки, чий результат нікому не відомий. Тому відновлення
**залежить від kind** (`src/lib/queue/db.ts`):

| Стан після краху | Що робимо | Чому |
| --- | --- | --- |
| `sending`, kind ∈ {confirm, arrived, on_my_way, late} | → `pending` | Сервер ідемпотентний; повтор безслідний |
| `sending`, kind ∈ {note, status} | → **`unknown`** | Дубль було б **видно клієнту/диспетчеру**; автоматично не повторюємо |
| `sending` у `uploads` | → `pending` | PUT перезаписує той самий S3-ключ |

`unknown` — це не помилка, а питання до людини. На екрані черги (§2.5) рядок
стоїть **першим**, підписаний «застосунок закрився під час відправки, це могло
вже надіслатися», і дає рівно два виходи: «Відкрити роботу й перевірити» та далі
або «Надіслати ще раз», або «Воно вже в роботі» (просто прибрати з телефона).
Те саме відновлення проганяється для одного техніка при вході в сесію
(`recoverQueuesForUser`) — вихід із сесії обриває запит так само, як краш.

**Фургон із двома техніками.** Телефон передають зі зміни в зміну, а
`bitcrm-queue.db` переживає вихід із сесії. Тому кожен рядок має `user_id`, і
**обидва сховища прив'язані до того, хто зараз у сесії**: `all`, `update` і
`remove` фільтрують за `user_id`, воркер зливає лише свої рядки, екран черги
показує лише свої. Наступний технік не бачить чужих адрес і нотаток і не може
повторно надіслати чужий «Прибув» під своїми даними — а нічого не втрачено:
рядки першого чекають, доки він увійде знову.

**Воркер не працює без сесії.** `drain()` не робить нічого, поки стан авторизації
не `signedIn` — `QueueProvider` є дитиною `AuthProvider`, тож його ефекти
виконуються **першими**, і на холодному старті стан ще `loading`. Без цього
запобіжника черга зливалася без заголовка `Authorization`, отримувала 401 і
паркувала всю зміну (див. нижче про 401).

**Тексти клієнту протухають.** `on_my_way` і `late` — це твердження про «зараз».
Рядок, старший за **30 хвилин** (`CLIENT_VISIBLE_MAX_AGE_MS`), не відправляється:
він паркується з поясненням. Штамп «Прибув» позачасовий і не протухає ніколи.

---

### 2.4 Фонова черга завантажень

**Модель:** одна черга мутацій (`outbox`) + одна черга файлів (`upload_queue`),
обидві — у SQLite, обидві керуються одним воркером.

**Воркер** (`src/lib/queue/worker.ts`):

1. Прокидається на: старт застосунку, повернення у foreground (`AppState`),
   появу мережі (`NetInfo` через `onlineManager`), і після кожної успішної
   відправки (щоб злити чергу).
2. Бере записи зі `state IN ('pending','failed') AND next_attempt_at <= now`,
   **по одному** для одного `deal_id` (щоб порядок «прибув → статус → нотатка»
   не переплутався), паралельно для різних робіт.
3. На успіх — `state='done'` + `invalidateQueries` відповідних ключів.
4. На помилку — див. §2.8.

**Фото окремо**, бо це три кроки: presign → PUT → інвалідація. Presign
викликається **ліниво, у момент першої спроби PUT**, бо він одразу пише
метадані й запис у таймлайн (`deal-attachments.service.ts:72-90`) — інакше
кожне фото, яке так і не вивантажилось, лишить у роботі привид. Якщо presigned
URL протух (S3 віддав 403/400) — **видаляємо старе вкладення** (§1.3), обнуляємо
`attachment_id`, `upload_url` і `upload_headers` разом і починаємо крок заново.
Лишити `attachment_id` і перевикликати presign означало б один привид на кожне
протухання підпису, а підпис живе 300 с.

**Прибирання за собою.** Черга завантажень має такий самий sweep, як outbox: на
`state='done'` рядок і **скопійований файл** зникають через `DONE_RETENTION_MS`.
Плюс на старті — прохід `sweepOrphanedPhotos()` по `Paths.document/job-photos`,
який видаляє файли, на які не вказує жоден рядок (по **всіх** техніках фургона,
щоб не стерти чуже незавантажене). Без цього 15–20 фото на день накопичувалися
до гігабайтів, які звільняла тільки перевстановка. Прогрес пишеться в SQLite не
частіше ніж раз на 5% (`PROGRESS_STEP`), а не раз на пакет.

**Фонове виконання.** `expo-background-task` + `expo-task-manager` дають
періодичне пробудження (ОС вирішує, коли; на iOS це не гарантія, а натяк). Тому
черга **не покладається** на фон: вона гарантовано зливається при відкритті
застосунку, а фон — це бонус, який скорочує затримку.

> **Фонове вивантаження фото асиметричне — див. `docs/STACK.md` §2.1.**
> `File.createUploadTask(url, { sessionType: 'background' })` віддає передачу
> `NSURLSession` **тільки на iOS**; для Android еквівалента в документації Expo
> немає. Плюс навіть на iOS обробник завершення треба перевстановити, коли
> застосунок знову виходить у foreground.
>
> **Увага:** у expo-file-system 57 `sessionType` за замовчуванням дорівнює
> `'background'` (`NetworkTasks.types.d.ts`, `@default 'background'`), тобто
> «фон вимкнено» треба писати **явно**. Ми пишемо: `putUpload` передає
> `sessionType: 'foreground'`. Інакше на iOS JS-проміс і колбеки прогресу не
> відновлюються після перезапуску, і застосунок вважав би завершене
> вивантаження незавершеним — на одній платформі з двох. Звідси й конструкція
> цього розділу:
> **durable-черга в SQLite — не оптимізація, а єдиний механізм, який працює на
> обох платформах.** Технікам не обіцяємо «фото відправляються, поки телефон у
> кишені» на Android. Резюмування на рівні байтів (`Range`) `expo-file-system` не
> дає взагалі — якщо колись знадобиться для відео, це S3 multipart на бекенді, а
> не інша бібліотека. Легасі `FileSystem.uploadAsync()` не змішувати: імпорт із
> головного пакета кидає в рантаймі.

Тести — три рівні, і всі три потрібні:

1. **Чиста політика** (`policy.test.ts`, `worker.test.ts`): переходи станів,
   backoff, порядок, протухання, ідемпотентність — на `createMemoryStore`,
   фейковому годиннику й фейковому транспорті. Ніяких мережевих тестів.
2. **Справжній SQL** (`db.test.ts`): `expo-sqlite` підмінений **справжнім**
   рушієм — `node:sqlite` (`src/test/expo-sqlite-double.ts`). Кількість
   плейсхолдерів, імена колонок у патчі, семантика відновлення після краху й
   ізоляція за `user_id` перевіряються тими самими інструкціями, які
   виконуються на телефоні. Ручна підробка сховища погоджувалася б із будь-яким
   кодом, і дрейф схеми доїхав би до техніка непоміченим. «Перезапуск процесу» —
   це `jest.resetModules()` при тому самому відкритому хендлі.
3. **Проводка провайдера** (`queue-provider.test.tsx`): коли зливанню дозволено
   початися, чиї рядки воно чіпає і що робить із кешем react-query.

---

### 2.5 Помилки та ретраї

| Клас | Приклад | Політика |
| --- | --- | --- |
| Мережа відсутня (`ApiError` зі status 0, `src/lib/api/errors.ts`) | Немає сигналу | Не ретраїмо в UI; операція лягає в чергу, показуємо «надішлеться, коли зʼявиться звʼязок» |
| `401` | Протух idToken | Один прозорий `POST /users/auth/refresh`, потім повтор; при повторному 401 — вихід із сесії (`setUnauthorizedHandler`, `src/lib/api/http.ts:19-21`). **У черзі 401 ніколи не термінальний:** рядок лишається `pending` за backoff і чекає наступної сесії. Паркувати його означало б втратити зміну роботи через один збій токена, а зациклитися він не може — воркер не працює без сесії, а другий 401 і так виводить із неї |
| `403` | Немає права / не в ростері | **Не ретраїмо.** Запис у черзі → `state='failed'` назавжди, у UI — «недоступно для вашої ролі» |
| `400` / `422` | `RECIPIENT_OPTED_OUT`, робота вже закрита | **Не ретраїмо.** Показуємо серверне повідомлення (його вже дістає `extractMessage`, `http.ts:67-77`) |
| `409` | Номер зайнятий, повторний resend | Не ретраїмо, показуємо |
| `429`, `5xx`, `503 SERVICE_UNAVAILABLE` | Сервіс лежить | Експоненційний backoff із джитером: 2 с → 5 с → 15 с → 1 хв → 5 хв → 15 хв, стеля 6 год, необмежена кількість спроб для ідемпотентних операцій, 5 спроб для неідемпотентних |

**Правило «нічого не губимо мовчки»:** будь-який запис черги у `state='failed'`
або `state='unknown'` має бути видимим на екрані роботи (значок «не надіслано» +
тап «спробувати ще»). Черга без UI — це втрачені дані, про які ніхто не
дізнається.

**Зворотний відлік мусить рухатися.** `describeQueue(records, now)` — чиста
функція, а `records` змінюються лише після зливання черги. Тому екран черги
тримає власний годинник: тік раз на секунду, коли найближча спроба ближче
хвилини, раз на 30 с інакше, і жодного таймера, коли чекати нема чого
(`queueTickInterval`). Напис «спробую ще через 14 хв», який не міняється
годину, — це той самий обман, що й мовчазна втрата.

---

### 2.6 Push-нотифікації

**Клієнт:** `expo-notifications` + `expo-device` (перевірка «не емулятор») +
`expo-constants` (`projectId` для `getExpoPushTokenAsync`).

**Що це вимагає технічно (SDK 57):**

- Push **не працює в Expo Go на Android** починаючи з SDK 53 — потрібен
  development build. Локальні нотифікації в Expo Go лишаються.
- Android 13+ вимагає створити notification channel **до** запиту дозволу.
- Android 12+ з точним часом — дозвіл `SCHEDULE_EXACT_ALARM`.
- iOS: APNs; симулятор iOS 16+ підходить для тестів, але реальні токени — з
  пристрою.
- `getExpoPushTokenAsync({ projectId })` — `projectId` обовʼязковий (береться з
  `expoConfig.extra.eas.projectId`).

**Що мусить надати власник (не розробник):**

| Що | Навіщо | Вартість |
| --- | --- | --- |
| Apple Developer Program | Без нього не згенерувати APNs-ключ і не підписати збірку | 99 USD/рік |
| APNs Auth Key (`.p8`, Key ID, Team ID) | Доставка на iOS | входить у членство |
| Tap to Pay entitlement (пізніше, §3) | Окремий запит через Apple Developer | — |
| Google Play Developer | Публікація Android | 25 USD одноразово |
| Firebase-проєкт + **FCM V1 service account JSON** | Доставка на Android | безкоштовно |
| Expo account + EAS `projectId` | Ідентифікатор проєкту для push-токенів | безкоштовно |

**Важливо про вартість:** сам **Expo Push Service безкоштовний** — надсилати
можна з нашого бекенду HTTP-запитом на `https://exp.host/--/api/v2/push/send`
(або пакетом `expo-server-sdk`). Платний план EAS потрібен для черг збірки, а не
для push. Тобто «платного сервера» для нотифікацій не треба.

**Який саме транспорт — див. `docs/STACK.md` §2.3.** `expo-notifications`
агностичний: `getExpoPushTokenAsync()` веде через Expo Push Service,
`getDevicePushTokenAsync()` віддає нативний токен, і тоді NestJS-бекенд говорить
з FCM v1 та APNs напряму. `STACK.md` рекомендує **прямий FCM + APNs** — бекенд
уже володіє диспетчеризацією робіт, і сторонній релей у шляху «нову роботу
призначено» додає залежність і сліпу зону доставки без виграшу. Набір
облікових даних від власника той самий в обох випадках; різниця лише в тому, хто
робить сам виклик. Рішення приймаємо на старті v2 — воно міняє один модуль
(`src/features/push/register.ts`) і форму серверного відправника, не архітектуру.

**Що мусить зробити бекенд (зараз цього немає, §1.8):**

1. `POST /users/me/push-tokens` — `{ token, platform, deviceId }`, будь-який
   автентифікований; `DELETE /users/me/push-tokens/:deviceId` на виході з сесії.
   Природне місце — user-service, поряд із `PUT /users/me`
   (`BE/backend/services/user/src/users/users.controller.ts:45`), бо там уже є
   прецедент «редагує тільки власний запис, без `users.edit`».
2. Підписник на події, які вже існують у системі (`BE/backend/EVENTS.md`):
   призначення роботи на техніка, новий вхідний меседж у тред, де він учасник,
   зміна розкладу. Гілка TECH уже каталогізує `deal.tech_confirmed` /
   `deal.tech_arrived` як **неспожиті** події (коміт `67233f3`) — це готові гачки
   у зворотному напрямку (сповістити диспетчера).
3. Payload має нести deep link (§2.7) і нічого чутливого — номер клієнта в
   нотифікацію не кладемо (він і так не покидає сервер, §1.6).

---

### 2.7 Deep links

Схема застосунку: `bitcrm://` (`app.json` → `expo.scheme`), плюс універсальні
лінки на домен API пізніше.

| Ціль | URL |
| --- | --- |
| Робота | `bitcrm://jobs/<dealId>` |
| Фото роботи | `bitcrm://jobs/<dealId>/photos` |
| Тред офісу | `bitcrm://chat` — вкладка «Messages». Окремого `<conversationId>` немає: у техніка один тред, тому push `{ kind: 'conversation', conversationId }` веде сюди, а не на id |
| Тред офісу з роботи | `bitcrm://chat/<dealId>` — той самий тред **над** табами, рядок іде з `dealId` |

З expo-router ці URL **збігаються з деревом файлів** — окремої мапи не існує, що
й було головним аргументом у §2.1.

Правила:

- Push, відкритий із killed-стану, доставляє `response` через
  `Notifications.getLastNotificationResponseAsync()` — його треба прочитати
  **після** гідрації auth, інакше ми кинемо неавтентифікованого користувача в
  захищений маршрут.
- Якщо сесії немає — запамʼятати ціль, показати логін, після успіху перейти.
- Якщо роботи немає в кеші — екран показує скелет і тягне `GET /deals/:id`.

---

### 2.8 Тема

Одна палітра-джерело в `src/lib/theme/tokens.ts`; світла й темна схеми; фон
береться з токена, а не успадковується.

Обмеження реального використання (див. §2.9) диктують **високий контраст за
замовчуванням**, а не «гарний» приглушений дизайн. Базові рішення:

- текст на фоні — не менше 7:1 (AAA) для основного, 4.5:1 для допоміжного;
- статуси кодуються **кольором + текстом + формою** (ніколи самим кольором);
- темна тема — справжня темна (не сіра), бо техніки працюють і вночі.

---

### 2.9 Доступність: рукавиці й сонце

Це не «бонус», це вимога до кожного екрана:

1. **Розмір цілі ≥ 56×56 dp** для будь-якої дії на картці роботи (Apple мінімум
   44×44 pt, Android 48×48 dp — беремо з запасом на рукавиці). Головні кнопки
   («Прибув», «Дзвінок клієнту») — на всю ширину, висота ≥ 64 dp.
2. **Відстань між цілями ≥ 12 dp** — випадковий тап «Скасувати» замість
   «Прибув» коштує дорого.
3. **Жодних жестів як єдиного способу** дії: свайп може існувати, але поруч має
   бути кнопка.
4. **Контраст під сонцем**: мінімум 7:1 для основного тексту; уникати тонких
   шрифтів (мінімум вага 500 для body); не покладатися на тінь і градієнт.
5. **Шрифт масштабується**: жодних фіксованих висот у контейнерах з текстом;
   перевірка на `fontScale` 1.3.
6. **Підтвердження для незворотного**: «Скасувати роботу» — через діалог,
   «Прибув» — без діалогу (ідемпотентно, помилковий тап нешкідливий).
7. **Haptics** на успіх/помилку дії — техніка може не почути звук у шумі й не
   роздивитися екран під сонцем.
8. `accessibilityLabel` + `accessibilityRole` на кожній інтерактивній частині;
   `accessibilityLiveRegion` для «надіслано / у черзі».
9. **Жодна дія не чекає на залізо.** «Прибув» кладеться в чергу **одразу**, з
   порожнім тілом (його приймає `MarkArrivedDto`), і лише потім запитується
   координата — до 8 с (`GEOLOCATION_TIMEOUT_MS`). Коли фікс приходить, він
   дописується в payload рядка, якщо той ще `pending` (`patchActionPayload`).
   Порядок «спершу чекаємо GPS, потім пишемо» давав вісім секунд без жодної
   реакції на головній кнопці застосунку — і губив прибуття повністю, якщо в
   цьому вікні застосунок убивали.

---

### 2.9a Табель і локація техніка

**Табель** (`src/features/timeclock/`, контракт — user-service, `/api/users`):
`POST /timeclock/start`, `POST /timeclock/stop`, `GET /timeclock/current`,
`GET /timeclock?from=&to=`. Екран — `app/(app)/timesheet/`, вхід із Profile,
бо саме там його тримає Workiz: Menu → Settings → Timesheets
(`WORKIZ_MOBILE_APP.md` §1.12). Clock in на конкретну роботу — секція «Time
clock» на картці роботи, першою серед дій, як Workiz веде свою панель швидких
дій кнопкою **Start** (§1.4).

Чотири рішення, які варто пам'ятати:

1. **Лічильник рахується від мітки старту, ніколи не накопичується.** Телефон у
   кишені зупиняє `setInterval`; таймер, що додає секунду на тік, після роботи
   помиляється на хвилини. `useElapsed` рахує `Date.now() − startedAt` на
   кожному рендері й перераховує одразу на `AppState → active`.
2. **Обидві половини йдуть через outbox** (`timeclock_in`, `timeclock_out`) —
   clock in у підвалі є нормою. Але **жодна не ідемпотентна**: контракт не дає
   серверу ключа для дедупу, тож вони йдуть шляхом нотатки й зміни статусу
   (обмежені спроби → видимий рядок), а не шляхом «Прибув».
3. **Своя смуга черги** (`laneOf → 'timeclock'`): clock in несе `dealId`
   роботи, clock out — ні, тож смуги з `dealId` пустили б «out» поперед «in».
4. **Сервер ставить свій штамп при отриманні.** Рядок, що пролежав годину,
   вкоротив би зміну. Телефон додає в тіло `clientStartedAt` /
   `clientEndedAt` — `ValidationPipe({ whitelist: true })` без
   `forbidNonWhitelisted` їх мовчки зрізає, тож сьогодні це нічого не ламає, а
   щойно бекенд їх прийме — вже встановлені телефони почнуть слати правду.
   Правило Workiz «щонайменше хвилина між in і out» (§1.7) тримається на
   телефоні, щоб пара, зроблена офлайн, не приїхала нульовою.

Суми на екрані рахує телефон і **лише по завершених записах**: контракт не
каже, чи входить у серверний `totalMinutes` запис, що ще триває, а сума, яка
росте, поки на неї дивишся, розходиться з тим, що бачить офіс. Той, що триває,
показано окремим рядком.

Відповідь `GET /timeclock/current` — єдине з табеля, що переживає перезапуск
(`lib/query/persist.ts`). Телефон, який її забув, після перезапуску в підвалі
показав би «не на годиннику» і запропонував **Clock in** тому, хто зайшов на
зміну о сьомій; цей дотик — другий запис на ту саму зміну. Тиждень навмисне не
зберігається: звіт, прочитаний з диска як «цей тиждень», гірший за відсутній.
Поки відповідь ще в дорозі, кнопку старту не пропонують узагалі — але саме
`isLoading`, не `isPending`: без зв'язку react-query запит **паузить**, і
«pending» тривав би весь підвал, тобто рівно тоді, коли дотик має піти в чергу.

**Локація** (`src/features/location/`) — `POST /users/technicians/:id/location`,
`DELETE` на зупинці (запис у Redis не має TTL, інакше пін завмер би там, де
техніка закінчила). Чотири умови, і кожна вимикає відправку: техніка **на
годиннику**, перемикач «Location Tracking» у Profile увімкнено, телефон дав
дозвіл, **застосунок відкрито**. Точки **не кладуться в чергу** — координата
сорокахвилинної давнини ставить пін не там, де людина; це те саме рішення, що й
для `markDealSeen`.

Точки й `DELETE` йдуть через один `LocationSender` на техніка, який тримає їх у
строгій черзі (`tracker.ts`). Фікс, знятий ще на годиннику, приїжджає тоді, коли
дозволить мережа: доставлений після clock out, він повернув би пін назад — і той
лишився б там назавжди, бо TTL немає. І навпаки: `DELETE`, що обігнав перший
фікс після повернення застосунку, сховав би техніка з карти до наступного
heartbeat. Вихід із акаунта — **не** clock out: зміна для офісу триває, токенів
уже немає, тож пін не чіпаємо, замість того щоб слати запит, який може бути лише
401.

Останню умову обрано свідомо: фонова локація вимагає `ACCESS_BACKGROUND_LOCATION`
+ foreground service на Android (декларація в Play Console) і `Always` на iOS
(окреме обґрунтування на рев'ю) — див. `docs/STACK.md` §2.2 і
`WORKIZ_MOBILE_APP.md` §3, хвиля v3, де обидва позначені 🔑 як заблоковані
акаунтами власника; плюс `expo-task-manager`, якого в застосунку немає і який
тягне custom dev client. Там само зупиняється й сам Workiz: «Workiz will only
track a user's location while the app is open on the device» (§1.12). Тому
`app.json` **явно** вимикає обидві фонові опції та прибирає рядки `Always` з
`Info.plist` (`locationAlwaysPermission: false`), щоб збірка не просила прав,
яких застосунок не використовує.

---

### 2.10 Підсумкова структура каталогів

```
app/                          # expo-router
src/
  lib/
    api/        http.ts, errors.ts, query-keys.ts, paginate.ts
    permissions/ matrix.ts (копія system-roles), can.ts
    queue/      db.ts, outbox.ts, uploads.ts, worker.ts, backoff.ts
    theme/      tokens.ts, ThemeProvider.tsx
    net/        online.ts (NetInfo → onlineManager)
  features/
    auth/       (є) token-store, auth-context, auth-reducer, api, types
    jobs/       api.ts, lib.ts, hooks.ts, components/
    photos/     capture.ts, hooks.ts
    chat/       (v2)
    stock/      (v3)
    payments/   (v4 — див. §3)
    push/       (v2) register.ts, handlers.ts
  ui/           Button, Card, StatusPill, EmptyState, QueueBadge
docs/ARCHITECTURE.md
```

Тестуємо `jest-expo`-ом усе, що має логіку: редʼюсери, черги, мапери, хуки
(`@testing-library/react-native` дозволено додати). Екрани — smoke-тест.

---

## 3. Місце для платежів: Stripe Tap to Pay (НЕ реалізовувати зараз)

Розділ фіксує вимоги, щоб v4 не почався з нуля. **Код не пишеться.**

### 3.1 SDK

`@stripe/stripe-terminal-react-native` (публічний preview, активна розробка).
Встановлення в Expo — `npx expo install @stripe/stripe-terminal-react-native`,
але пакет **несумісний з Expo Go**: потрібен `npx expo prebuild` і
`expo run:ios` / `expo run:android`, тобто перехід на development build.
Конфіг-плагін у `app.json` з опціями `bluetoothBackgroundMode`,
`locationWhenInUsePermission`, `appDelegate: true` (обовʼязково для Tap to Pay на
Android), `tapToPayCheck: true`.

**Точні версії, сумісність з RN 0.86 і обовʼязковий `expo-build-properties`
(`android.minSdkVersion: 26`, `ios.deploymentTarget: 16.4`) — у `docs/STACK.md`
§1 і §2.5.** Коротко: Stripe вимагає minSdk 26 і явно попереджає, що пониження
не спрацює через рантайм-валідацію рівня API; дефолт Expo/RN — 24. Це не
опціональна настройка, і ставити її треба **до** першого `prebuild`, а не у v4.

Клієнтський потік: `StripeTerminalProvider` з `tokenProvider` → `initialize()` з
`useStripeTerminal` → `discoverReaders({ discoveryMethod: 'tapToPay' })` →
`connectReader` → `collectPaymentMethod` → `confirmPaymentIntent`.

### 3.2 Tap to Pay on iPhone — вимоги

- **Пристрій:** iPhone XS або новіший; iOS не старша за один рік від поточної
  (Apple веде список підтримуваних версій). Бета-версії iOS не працюють.
- **Entitlement:** `com.apple.developer.proximity-reader.payment.acceptance`
  (boolean `true`). Спочатку запитується **development entitlement** в Apple
  Developer account, після внутрішнього тестування — окремо **distribution
  entitlement**. Заявку подає власник акаунта; Stripe дає супровідний гайд, але
  сам entitlement видає Apple.
- **Merchant education:** Apple **вимагає** показати навчальний оверлей «How to
  Tap» через `ProximityReaderDiscovery` (iOS 18+, з fallback для старіших) —
  **до** подання застосунку на рев'ю. Без цього рев'ю не пройде.
- **PIN:** підтримується з iOS 16.4+. У Канаді та Фінляндії багато карток —
  offline-PIN only, вони через Tap to Pay не пройдуть; у Великій Британії частина
  емітентів вимагає вставити картку (`offline_pin_required`). Потрібен запасний
  шлях (фізичний рідер або Payment Link).
- **Географія:** US у списку загальної доступності — для нас це головне.
- Симулятор не підходить; тестувати можна тільки на пристрої.

### 3.3 Tap to Pay on Android — вимоги

Пристрій має відповідати **всім** умовам одночасно:

- не є сертифікованим PCI PTS платіжним пристроєм;
- робочий вбудований NFC і ARM-процесор;
- **не рутований**, бутлоадер заблокований і незмінений;
- **Android 13 або новіший**;
- security patch не старший за 12 місяців;
- Google Mobile Services + встановлений Google Play Store;
- keystore з апаратною підтримкою ECDH (`FEATURE_HARDWARE_KEYSTORE` ≥ 100);
- стабільний інтернет;
- незмінена ОС від виробника;
- **Developer options вимкнені** (інакше PIN не збереться:
  `TAP_TO_PAY_INSECURE_ENVIRONMENT`).

Емулятори не підтримуються. З телефонів, які реально носять техніки: Google Pixel
5+, Samsung Galaxy S22+/A-серія 5G, Motorola edge/moto g останніх поколінь.
PIN також блокують увімкнені accessibility-сервіси, запис екрана, оверлеї та
спроба зробити скриншот.

### 3.4 Що мусить зʼявитися на бекенді BitCRM

Зараз немає нічого (§1.8). Мінімальний набір:

1. **Сутність `Payment`, привʼязана до роботи.** Ставиться поряд із
   `Deal.paymentStatus` (`TECH/packages/types/src/entities/deal.entity.ts:70`),
   але як окремі рядки — робота може мати кілька спроб і часткові оплати:
   `{ id, dealId, amount, currency, status, stripePaymentIntentId, capturedAt, refundedAmount, createdBy }`.
2. **`POST /deals/:id/payments/connection-token`** — проксі до
   `POST https://api.stripe.com/v1/terminal/connection_tokens`, віддає `{ secret }`.
   **Обовʼязково автентифікований і з перевіркою ростера** — secret дає доступ до
   будь-якого рідера акаунта. Секрет ніколи не кешувати на клієнті; SDK керує
   його життєвим циклом сам.
3. **`POST /deals/:id/payments`** — створити PaymentIntent
   (`capture_method: manual`, `payment_method_types: ['card_present']`), повернути
   `client_secret`. Права: `deals.edit` + ростер, як у `tech/arrived`.
4. **`POST /deals/:id/payments/:paymentId/capture`** — capture після
   `confirmPaymentIntent` на пристрої.
5. **`POST /deals/:id/payments/:paymentId/refund`** — окреме право
   (`payments.refund`), техніку **не** давати.
6. **`POST /deals/:id/payments/:paymentId/receipt`** — квитанція клієнту; природно
   через уже наявний месенджер (`POST /messaging/conversations/:id/messages` або
   `POST /messaging/messages`, §1.4), а не новий канал.
7. **Stripe webhook** (`payment_intent.succeeded`, `.payment_failed`,
   `charge.refunded`) → оновлює `Payment` і `Deal.paymentStatus` наявним
   внутрішнім ендпойнтом
   (`TECH/backend/services/deal/src/deals/deals.controller.ts:471`).
8. **Нові ключі прав:** `payments: { view, collect, refund }` у
   `BE/apps/web/lib/permissions/system-roles.ts`; техніку — `view + collect`,
   `refund: false`.

### 3.5 Комісії

Card-present через Stripe Terminal у US — **≈ 2.7% + $0.05** за транзакцію (Tap
to Pay on iPhone/Android тарифікується як card-present, без окремої плати за
«рідер»). Це орієнтир для розмови з власником; фактичну ставку треба звірити з
чинним прайсом Stripe і умовами акаунта перед запуском v4. Додатково:
international cards і currency conversion мають надбавку; refund не повертає
комісію.

### 3.6 Куди це стає в застосунку

```
src/features/payments/
  api.ts            # connection-token, create/capture/refund, receipt
  terminal.tsx      # StripeTerminalProvider + tokenProvider
  hooks.ts          # useCollectPayment(dealId)
  components/
app/(app)/jobs/[id]/payment.tsx      # маршрут; deep link bitcrm://jobs/<id>/payment
```

Точка входу в UI — кнопка «Прийняти оплату» на картці роботи, видима тільки при
`can('payments','collect')` і тільки якщо `TapToPay` доступний на цьому пристрої
(перевірка `tapToPayCheck` з конфіг-плагіна). На несумісному телефоні — чесне
повідомлення й альтернатива (надіслати Payment Link через месенджер).

---

## 4. Дорожня карта

Розміри — у людино-днях одного розробника, з тестами.

### v1 — Фундамент (ця хвиля) — **8–11 дн**

- Міграція на expo-router, `(auth)`/`(app)` групи — 1 дн
- react-query + персистер + NetInfo/`onlineManager` — 1 дн
- Копія матриці прав + `can()` + тест звірки з `system-roles.ts` — 0.5 дн
- `jobs/lib.ts` (порт `groupJobsByDay`, `formatSlot`, `compareVisitOrder` з тестами) — 1 дн
- Екран «Мої роботи»: денний список, pull-to-refresh, `fetchAllDeals` по `techId` — 1.5 дн
- Картка роботи: адреса, клієнт, слот, статус, нотатки, таймлайн — 1.5 дн
- Дії: «Підтвердив», «Прибув» (`expo-location` **тільки foreground**, timeout 8 с,
  без фікса теж працює — `MarkArrivedDto` дозволяє порожнє тіло), зміна статусу — 1 дн
  *(фонову геолокацію у v1 не вмикаємо: вона тягне dev client, декларацію в Play
  Console і скрутне рев'ю Apple — `docs/STACK.md` §2.2)*
- Черга `outbox` у SQLite + воркер + backoff + UI-стан «у черзі / не надіслано» — 2 дн
- Дзвінок клієнту через `POST /telephony/calls/bridge` з `via: "cell"` — 0.5 дн
- Тема, токени, базові UI-компоненти під рукавиці — 1 дн

### v2 — Чат + push — **7–9 дн**

- Клієнтський тред за роботою, командний тред, надсилання з `clientMessageId` — 2.5 дн
- «Вже їду» / «Запізнююсь» через `automations/*` — 0.5 дн
- Лічильники непрочитаного (polling 30 с) + бейджі — 1 дн
- `expo-notifications`: реєстрація, канал Android, дозволи, deep links — 1.5 дн
- **Бекенд:** `POST /users/me/push-tokens` + розсилка на події — 2 дн *(окрема задача в bitcrm-messaging)*
- Вкладення в повідомленнях (presign ≤5 МБ) — 1 дн

### v3 — Склад + профіль — **3–4 дн**

- «Мій фургон»: `containers/my` → `:id/stock`, пошук, порожній стан — 1.5 дн
- Профіль: `GET /users/me`, `PUT /users/me` (телефон), вихід, версія збірки — 1 дн
- Позиції роботи (`GET/POST /deals/:id/products`) — 1 дн

### v4 — Платежі (Tap to Pay) — **10–14 дн + зовнішні залежності**

- Перехід на development build, prebuild, конфіг-плагін Stripe — 1 дн
- **Бекенд:** `Payment`, connection-token, create/capture/refund, webhook, права — 5 дн *(окрема задача)*
- Клієнт: provider, discover/connect, collect, результат, квитанція — 4 дн
- Merchant education оверлей (вимога Apple) + fallback — 1 дн
- Тестування на реальних пристроях iOS/Android — 2 дн
- **Блокери поза кодом:** Apple development + distribution entitlement,
  Stripe-акаунт із Terminal, рев'ю Apple. Планувати з запасом у тижнях, не днях.

### v5 — Офлайн-hardening — **5–7 дн**

- Черга фото: presign-on-demand, `createUploadTask`, ретрай протухлих URL — 2 дн
- `expo-background-task` для зливу черги у фоні — 1 дн
- Екран «Не надіслано» зі списком і ручним ретраєм — 1 дн
- Префетч детально для робіт поточного дня + карт/адрес — 1 дн
- **Бекенд:** `scheduledFrom`/`scheduledTo` у `ListDealsQueryDto`, щоб не качати всі сторінки — 1 дн *(окрема задача)*
- Черга вихідних повідомлень чату — 1 дн

---

## 5. Відкриті питання до власника

1. Чи всі техніки на iOS, чи парк змішаний? Від цього залежить, чи має сенс
   Tap to Pay on Android (вимоги до пристроїв там жорсткі, §3.3).
2. Чи потрібен техніку доступ до журналу дзвінків? Зараз роль це забороняє
   (`system-roles.ts:238`) — якщо потрібен, це зміна ролі на бекенді.
3. Хто володіє Apple Developer і Google Play акаунтами — без них немає ні push,
   ні платежів, ні публікації.
4. Чи прийнятний polling замість SSE у чаті (затримка до 10 с при відкритому
   екрані, push — у фоні)?
