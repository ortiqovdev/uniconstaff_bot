const { InputFile } = require('grammy');
const db = require('../../db');
const P = require('../../perms');
const {
  LINE, MONTHS, esc, money, truncate, fullName, btn, kb, backBtn, localNow, show,
} = require('../../ui');
const { buildReport } = require('../../export');

module.exports = (bot) => {
  const view = P.guard('reports');

  bot.callbackQuery('a:rep', view, (ctx) => {
    const t = db.totals();
    const now = localNow();
    const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const m = db.monthTotals(ym);
    const c = db.empCounts();
    const debts = db.debts();
    const debtSum = debts.reduce((s, d) => s + (d.amount > 0 ? d.amount - d.paid : 0), 0);
    const open = db.colOpen().map((col) => {
      const s = db.colStats(col.id);
      return `▫️ ${esc(truncate(col.title, 30))} — ${s.paid.length}/${s.members.length} ✅ · ${money(s.collected)}`;
    });

    const text = `📊 <b>Umumiy hisobot</b>\n${LINE}\n`
      + `💰 <b>Kassa</b>\n📥 Kirim: <b>${money(t.inc)}</b>\n📤 Chiqim: <b>${money(t.out)}</b>\n💵 Qoldiq: <b>${money(t.bal)}</b>\n\n`
      + `📅 <b>${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}</b>\n📥 Kirim: ${money(m.inc)}\n📤 Chiqim: ${money(m.out)}\n\n`
      + `👥 <b>Hodimlar</b>\n🟢 Faol: ${c.active} · 🤖 Botda: ${c.linked} · ⏸ To'xtatilgan: ${c.inactive}\n\n`
      + `📢 <b>Ochiq yig'imlar</b>\n${open.length ? open.join('\n') : "Yo'q"}\n${LINE}\n`
      + `⏳ Qarzdorlik: <b>${debts.length}</b> ta${debtSum ? ` (${money(debtSum)})` : ''}`;

    return show(ctx, text, kb([
      [btn('📥 Excel yuklab olish', 'a:rep:xls', 'success')],
      [btn('📜 Kassa logi', 'a:log:a:0', 'primary'), btn('⏳ Qarzdorlar', 'a:rep:debt', 'danger')],
      [btn('🔄 Yangilash', 'a:rep'), backBtn('a:menu', '🏠 Admin panel')],
    ]));
  });

  bot.callbackQuery('a:rep:debt', view, (ctx) => {
    const byEmp = new Map();
    for (const d of db.debts()) {
      if (!byEmp.has(d.eid)) byEmp.set(d.eid, { name: fullName(d), bot: !!d.telegram_id, items: [] });
      byEmp.get(d.eid).items.push(d);
    }
    let text = `⏳ <b>Qarzdorlar</b> (${byEmp.size} ta hodim)\n${LINE}\n`;
    if (!byEmp.size) text += "🎉 Qarzdorlar yo'q!";
    for (const e of byEmp.values()) {
      const sum = e.items.reduce((s, d) => s + (d.amount > 0 ? d.amount - d.paid : 0), 0);
      const line = `${e.bot ? '🔴' : '⚪'} <b>${esc(e.name)}</b>${sum ? ` — ${money(sum)}` : ''}\n      └ ${e.items.map((d) => `${d.pending ? '⏳ ' : ''}${esc(truncate(d.title, 25))}`).join(', ')}\n`;
      if (text.length + line.length > 3800) {
        text += '\n… to\'liq ro\'yxat Excel faylida';
        break;
      }
      text += line;
    }
    if (byEmp.size) text += '\n⚪ — botga kirmagan · ⏳ — admin tasdiqlashi kutilmoqda';
    return show(ctx, text, kb([[btn('📥 Excel', 'a:rep:xls', 'success'), backBtn('a:rep')]]));
  });

  bot.callbackQuery('a:rep:xls', view, async (ctx) => {
    await ctx.answerCallbackQuery('⏳ Fayl tayyorlanmoqda...').catch(() => {});
    const buf = await buildReport();
    const n = localNow();
    const stamp = `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-${String(n.getUTCDate()).padStart(2, '0')}`;
    await ctx.replyWithDocument(new InputFile(buf, `unicon_kassa_${stamp}.xlsx`), {
      caption: `📊 <b>Kassa hisoboti</b> · ${stamp}\n\n📄 Varaqlar: 🏢 Boshqarma · 🏙 Shahar · 📊 Monitoring · 🧾 Harajatlar`,
      parse_mode: 'HTML',
    });
  });
};
