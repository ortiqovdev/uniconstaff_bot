# Unicon Staff — hodimlar kassasi boti

Unicon Soft hodimlari yig'gan pullarni hisobga olish uchun Telegram bot.
Node.js 22.13+ (tavsiya: 24), [grammY](https://grammy.dev) va o'rnatilgan `node:sqlite` (alohida baza serveri kerak emas).

## Imkoniyatlar

**Hodim** (`/start`):
- Admin faqat telefon raqam va bo'limni (🏢 Boshqarma / 🏙 Shahar) kiritadi. Hodim botga kirib **o'z** raqamini
  yuboradi va yetishmayotgan ma'lumotlarni (familiya, ism, lavozim) o'zi to'ldiradi.
- Menyu: 💳 To'lovlarim · 🧾 Harajatlar · 👤 Mening ma'lumotlarim · 🔄 Yangilash.
- Yangi yig'im e'lonida **💵 Naqd** yoki **💳 Karta orqali** (chek skrinshoti bilan) to'lash; admin tasdiqlaguncha
  to'lov ⏳ kutish holatida turadi. Tasdiqlansa yoki rad etilsa — avtomatik xabar.
- To'lanmagan yig'im bo'lsa — har kuni `REMINDER_TIMES` (standart 10:00 va 18:00) da eslatma.

**Admin** (`/admin` — yashirin buyruq):
- 👥 Hodimlar — qo'shish (bir nechta raqam birdaniga), tahrirlash, ⏸ to'xtatish, o'chirish.
- 💰 Pul yig'ish — bo'lim tanlab (hamma / boshqarma / shahar) yig'im boshlash; hodim ustiga bosib naqd to'lovni
  belgilash, bekor qilish yoki yig'imdan chiqarish; naqd/karta so'rovlarini tasdiqlash; karta rekvizitlari.
- 💵 Naqd olish — barcha qarzdorlar; hodim nomi bosilsa to'lov naqd qabul qilinadi.
- 🧾 Chiqim — summa, sabab, yig'im, chek rasmi.
- ✉️ Xabar yuborish — hammaga yoki qarzdorlarga.
- 📊 Hisobot — kassa, qarzdorlar, kassa logi va Excel (Boshqarma, Shahar, Monitoring, Harajatlar).
- 👑 Adminlar — har bir admin uchun alohida ruxsatlar («👁 Direktor» — faqat ko'rish).

**Super admin** (`SUPER_ADMIN_IDS`) uchun yashirin buyruqlar:
- `/backup` — bazaning hozirgi nusxasini fayl qilib yuboradi. Har kuni `BACKUP_TIME` (standart 23:00) da avtomatik yuboriladi.
- `/restore` — zaxira `.db` faylga **javob (reply)** qilib yozilsa, baza shu fayldan tiklanadi va bot qayta ishga tushadi
  (eski baza nusxasi `*.before-restore-*` nomi bilan saqlanadi).

## Lokal ishga tushirish

```bash
cp .env.example .env   # BOT_TOKEN va SUPER_ADMIN_IDS ni to'ldiring
npm install
npm start
```

Telegram ID ni [@userinfobot](https://t.me/userinfobot) dan bilish mumkin.

## Render.com'ga deploy

Bot long polling bilan ishlaydi va SQLite faylda saqlaydi, shuning uchun Render'da:
- servis turi — **Background Worker** (port kerak emas);
- **Persistent Disk** shart — usiz har deploy/qayta ishga tushishda baza o'chib ketadi;
- disk faqat pullik tariflarda bor (Starter worker + 1 GB disk).

> ⚠️ Bepul Web Service mos emas: 15 daqiqadan keyin uxlab qoladi (eslatmalar bormaydi) va diski vaqtinchalik.

1. Render → **New → Blueprint** → shu repozitoriyni tanlang. `render.yaml` worker va diskni o'zi yaratadi.
2. So'ralganda maxfiy qiymatlarni kiriting: `BOT_TOKEN`, `SUPER_ADMIN_IDS`.
3. **Muhim:** bir token bilan faqat bitta bot ishlashi mumkin — Render'da ishga tushirishdan oldin lokal botni to'xtating.
4. Ma'lumotlarni ko'chirish: lokal bazaning nusxasini botga yuboring va unga javoban `/restore` yozing.

Qo'lda sozlash (Blueprint'siz): New → Background Worker, Build: `npm ci --omit=dev`, Start: `npm start`,
Disk: mount path `/var/data`, muhit o'zgaruvchilari — `.env.example` dagidek, `DB_PATH=/var/data/unicon.db`.

## Muhit o'zgaruvchilari

| Nomi | Tavsif | Standart |
|---|---|---|
| `BOT_TOKEN` | @BotFather tokeni | — |
| `SUPER_ADMIN_IDS` | Super admin Telegram ID lari, vergul bilan | — |
| `DB_PATH` | Baza fayli | `data/unicon.db` |
| `ADMIN_COMMAND` | Admin panel buyrug'i | `admin` |
| `REMINDER_TIMES` | Eslatma vaqtlari | `10:00,18:00` |
| `BACKUP_TIME` | Kunlik zaxira vaqti (bo'sh — o'chiq) | `23:00` |
| `TZ_OFFSET_MIN` | Vaqt zonasi, daqiqada (Toshkent = 300) | `300` |
| `COMPANY_NAME` | Kompaniya nomi | `Unicon Soft` |

## Tuzilma

```
src/
  index.js        ishga tushirish
  bot.js          bot va marshrutlash
  config.js       muhit o'zgaruvchilari
  db.js           SQLite sxema, migratsiyalar va so'rovlar
  ui.js           tugmalar, formatlash, sana/summa
  fields.js       hodim ma'lumotlari maydonlari
  perms.js        admin ruxsatlari
  state.js        ko'p bosqichli formalar
  notify.js       eslatma, so'rov va xabarlar
  scheduler.js    kunlik eslatma va zaxira
  backup.js       zaxira nusxa va tiklash
  export.js       Excel hisobot
  handlers/employee.js
  handlers/admin/*.js
render.yaml       Render Blueprint
```
