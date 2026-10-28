const cfg = require('../../config');
const db = require('../../db');
const P = require('../../perms');
const state = require('../../state');
const { LINE, esc, money, btn, kb, show } = require('../../ui');

async function adminMenu(ctx) {
  state.clear(ctx.from.id);
  const id = ctx.from.id;
  const t = db.totals();
  const emps = db.empCounts();
  const open = db.colOpen().length;
  const debts = db.debts();
  const pending = db.reqPendingCount();
  const c = (...p) => P.can(id, ...p);

  const text = `🛠 <b>${esc(cfg.COMPANY)} — Admin panel</b>\n${LINE}\n`
    + `👤 ${esc(P.adminName(id))} · ${P.isSuper(id) ? '👑 Super admin' : '🛡 Admin'}\n${LINE}\n`
    + `💰 Kassa qoldig'i: <b>${money(t.bal)}</b>\n`
    + `👥 Faol hodimlar: <b>${emps.active}</b> (🏢 ${emps.boshqarma} · 🏙 ${emps.shahar}) · ro'yxatdan o'tgan: ${emps.registered}\n`
    + `📢 Ochiq yig'imlar: <b>${open}</b>\n`
    + `❌ Qarzdorliklar: <b>${debts.length - debts.filter((d) => d.pending).length}</b> ta\n`
    + `⏳ Tasdiqlash kutayotgan to'lovlar: <b>${pending}</b> ta`;

  await show(ctx, text, kb([
    [c('employees', 'reports') && btn('👥 Hodimlar', 'a:emp:list:a:0', 'primary'),
      c('collections', 'payments', 'reports') && btn(`💰 Pul yig'ish${pending ? ` (⏳ ${pending})` : ''}`, 'a:col:list:0', pending ? 'danger' : 'success')],
    [c('payments') && btn(`💵 Naqd olish (qarzdorlar: ${debts.filter((d) => !d.pending).length})`, 'a:cash:a:0', 'success')],
    [c('expenses', 'reports') && btn('🧾 Chiqim', 'a:exp:list:0', 'primary'),
      c('collections') && btn('✉️ Xabar yuborish', 'a:bc', 'primary')],
    [c('reports') && btn('📊 Hisobot', 'a:rep', 'primary'),
      c('admins') && btn('👑 Adminlar', 'a:adm:list', 'primary')],
  ]));
}

module.exports = (bot, { fallback }) => {
  // Yashirin buyruq: admin bo'lmaganlarga oddiy foydalanuvchidek javob beriladi
  bot.command(cfg.ADMIN_COMMAND, async (ctx) => {
    if (!P.isAdmin(ctx.from.id)) {
      console.log(`[admin] ruxsatsiz /${cfg.ADMIN_COMMAND}: id=${ctx.from.id} @${ctx.from.username || '-'}`);
      return fallback(ctx);
    }
    return adminMenu(ctx);
  });

  bot.callbackQuery(/^a:/, async (ctx, next) => {
    if (P.isAdmin(ctx.from.id)) return next();
    await ctx.answerCallbackQuery({ text: "⛔ Ruxsat yo'q", show_alert: true }).catch(() => {});
    return undefined;
  });

  bot.callbackQuery('a:menu', adminMenu);
  bot.callbackQuery('a:cancel', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Bekor qilindi' }).catch(() => {});
    return adminMenu(ctx);
  });
  bot.callbackQuery('a:close', async (ctx) => {
    state.clear(ctx.from.id);
    await ctx.deleteMessage().catch(() => {});
  });

  require('./backup')(bot);
  require('./employees')(bot);
  require('./collections')(bot);
  require('./payments')(bot);
  require('./requests')(bot);
  require('./log')(bot);
  require('./settings')(bot);
  require('./expenses')(bot);
  require('./reports')(bot);
  require('./broadcast')(bot);
  require('./admins')(bot);
};

module.exports.adminMenu = adminMenu;
