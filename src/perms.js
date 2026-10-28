const cfg = require('./config');
const db = require('./db');

/** Admin ruxsatlari */
const PERMS = {
  employees: '👥 Hodimlarni boshqarish',
  payments: "💵 To'lovlarni qabul qilish",
  expenses: '🧾 Chiqimlarni kiritish',
  collections: "📢 Yig'im va eslatmalar",
  reports: "📊 Barcha ma'lumotlarni ko'rish",
  admins: '👑 Adminlarni boshqarish',
};

const isSuper = (id) => cfg.SUPER_ADMIN_IDS.includes(Number(id));
const isAdmin = (id) => isSuper(id) || !!db.adminGet(id);

function permsOf(id) {
  if (isSuper(id)) return new Set(Object.keys(PERMS));
  const a = db.adminGet(id);
  return new Set(a ? a.perms.split(',').filter((p) => PERMS[p]) : []);
}

/** Berilgan ruxsatlardan kamida bittasi bormi */
const can = (id, ...perms) => {
  const s = permsOf(id);
  return perms.some((p) => s.has(p));
};

function adminName(id) {
  const a = db.adminGet(id);
  if (a && a.name) return a.name;
  const e = db.empByTg(id);
  if (e) return `${e.last_name} ${e.first_name}`;
  return isSuper(id) ? 'Super admin' : `ID ${id}`;
}

/** Ruxsati bor barcha adminlarning Telegram ID lari */
function adminIdsWith(...perms) {
  const ids = new Set([...cfg.SUPER_ADMIN_IDS, ...db.adminList().map((a) => Number(a.telegram_id))]);
  return [...ids].filter((id) => can(id, ...perms));
}

/** Callback middleware: ruxsat bo'lmasa ogohlantiradi */
const guard = (...perms) => async (ctx, next) => {
  if (can(ctx.from.id, ...perms)) return next();
  await ctx.answerCallbackQuery({ text: "⛔ Sizda bu amal uchun ruxsat yo'q", show_alert: true }).catch(() => {});
  return undefined;
};

module.exports = { PERMS, isSuper, isAdmin, permsOf, can, adminName, adminIdsWith, guard };
