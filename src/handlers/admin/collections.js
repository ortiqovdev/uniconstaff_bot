const db = require('../../db');
const P = require('../../perms');
const state = require('../../state');
const {
  LINE, esc, money, truncate, fullName, shortName, btn, kb, backBtn, cancelBtn, paginate, navRow, progress,
  fmtDate, parseDate, parseAmount, show, safeSend, GRP_CODES, grpFilterRow, grpLabel, GROUPS,
} = require('../../ui');

const audLabel = (grp) => (grp ? grpLabel(grp) : '👥 Hamma hodimlar');
const { payRow, sendReminders, sendToMany } = require('../../notify');
const { askAmount, acceptCash } = require('./payments');
const { showRequest } = require('./requests');

function colCardText(s) {
  const { col } = s;
  return `📢 <b>${esc(col.title)}</b>\n${col.status === 'open' ? '🟢 Ochiq' : `🔒 Yopilgan (${fmtDate(col.closed_at, false)})`}\n${LINE}\n`
    + `🎯 Kimlar uchun: <b>${audLabel(col.grp)}</b>\n`
    + `💵 Har bir hodimdan: <b>${col.amount > 0 ? money(col.amount) : 'Ixtiyoriy'}</b>\n`
    + `📅 Muddat: ${esc(col.deadline || '—')}\n`
    + `${col.description ? `📝 ${esc(col.description)}\n` : ''}`
    + `🗓 Ochilgan: ${fmtDate(col.created_at)}\n${LINE}\n`
    + `👥 Ishtirokchilar: <b>${s.members.length}</b>\n`
    + `✅ To'laganlar: <b>${s.paid.length}</b>\n`
    + `❌ To'lamaganlar: <b>${s.unpaid.length}</b>\n`
    + `${progress(s.paid.length, s.members.length)}\n${LINE}\n`
    + `📥 Yig'ildi: <b>${money(s.collected)}</b>${s.due ? ` (kutilmoqda: ${money(s.due)})` : ''}\n`
    + `📤 Sarflandi: <b>${money(s.spent)}</b>\n`
    + `💰 Qoldiq: <b>${money(s.collected - s.spent)}</b>`;
}

async function showCol(ctx, id, header = '') {
  const s = db.colStats(id);
  if (!s) return show(ctx, "❌ Yig'im topilmadi.", kb([[backBtn('a:col:list:0')]]));
  const me = ctx.from.id;
  const open = s.col.status === 'open';
  return show(ctx, `${header}${colCardText(s)}`, kb([
    [btn(`⚡ Hodimlar: ✅ ${s.paid.length} · ❌ ${s.unpaid.length - s.pending.length}${s.pending.length ? ` · ⏳ ${s.pending.length}` : ''}`, `a:col:g:${id}:a:0`, 'success')],
    [open && P.can(me, 'payments') && btn("💵 Boshqa summa bilan qabul qilish", `a:pay:c:${id}:0`, 'primary')],
    [open && P.can(me, 'collections') && s.unpaid.length && btn('🔔 Eslatma yuborish', `a:col:rem:${id}`, 'primary')],
    [P.can(me, 'collections') && (open
      ? btn("🔒 Yig'imni yopish", `a:col:cls:${id}`, 'danger')
      : btn('🔓 Qayta ochish', `a:col:opn:${id}`))],
    [backBtn('a:col:list:0', "⬅️ Yig'imlar")],
  ]));
}

function askStep(ctx, step, data) {
  state.set(ctx.from.id, step, data);
  const prompts = {
    col_title: ["✍️ Yig'im <b>nomini</b> kiriting:\n<i>Masalan: Alisherning tug'ilgan kuni 🎂</i>", null],
    col_amount: ["💵 Har bir hodimdan yig'iladigan <b>summani</b> kiriting:\n<i>Masalan: 50000 yoki 50k</i>", [btn('🤲 Ixtiyoriy summa', 'a:col:amt0', 'primary')]],
    col_deadline: ['📅 To\'lov <b>muddatini</b> kiriting:\n<i>Masalan: 30.10.2026</i>', [btn("⏭ Muddatsiz", 'a:col:skip')]],
    col_desc: ["📝 <b>Izoh</b> kiriting (nima uchun yig'ilmoqda):", [btn("⏭ O'tkazib yuborish", 'a:col:skip')]],
  };
  const [text, extra] = prompts[step];
  return show(ctx, `📢 <b>Yangi yig'im</b> · ${audLabel(data.grp)}\n\n${text}`, kb([extra, [cancelBtn()]]));
}

function confirmCreate(ctx, data) {
  state.set(ctx.from.id, 'col_confirm', data);
  const n = db.empActive(data.grp || null).length;
  return show(ctx, `📋 <b>Yangi yig'imni tekshiring:</b>\n${LINE}\n`
    + `🎯 Kimlar uchun: <b>${audLabel(data.grp)}</b>\n`
    + `📢 Nomi: <b>${esc(data.title)}</b>\n`
    + `💵 Summa: <b>${data.amount ? money(data.amount) : 'Ixtiyoriy'}</b>\n`
    + `📅 Muddat: ${esc(data.deadline || '—')}\n`
    + `📝 Izoh: ${esc(data.description || '—')}\n${LINE}\n`
    + `👥 <b>${n}</b> ta faol hodim ishtirokchi bo'ladi va faqat ularga xabar yuboriladi.`, kb([
    [btn("✅ Yaratish va e'lon qilish", 'a:col:save', 'success')],
    [cancelBtn()],
  ]));
}

const NEXT = { col_title: 'col_amount', col_amount: 'col_deadline', col_deadline: 'col_desc', col_desc: null };
const advance = (ctx, step, data) => (NEXT[step] ? askStep(ctx, NEXT[step], data) : confirmCreate(ctx, data));

const memberState = (col, m) => (db.isPaid(col.amount, m.paid) ? 'paid' : m.pending ? 'pending' : 'unpaid');
const STATE_ICON = { paid: '✅', pending: '⏳', unpaid: '❌' };
const STATE_STYLE = { paid: 'success', pending: 'primary', unpaid: 'danger' };

/**
 * Tezkor belgilash: hodimlar 2 ustunli tugmalar ko'rinishida.
 * ❌ (qizil) bosilsa — naqd to'lov yoziladi va tugma ✅ (yashil) bo'ladi; ✅ bosilsa — bekor qilish so'raladi.
 * exclude rejimida ❌ bosilsa — hodim yig'imdan chiqariladi (qarzdor hisoblanmaydi, eslatma bormaydi).
 */
function memberGrid(ctx, id, f, page, header = '', exclude = false) {
  const s = db.colStats(id);
  if (!s) return ctx.answerCallbackQuery('Topilmadi');
  const { col } = s;
  const grp = GRP_CODES[f];
  const list = s.members.filter((m) => !grp || m.grp === grp);
  const pg = paginate(list, page, 20);
  const me = ctx.from.id;
  const canPay = col.status === 'open' && P.can(me, 'payments');
  const canExclude = P.can(me, 'payments', 'collections');
  const x = exclude ? 'x' : '';
  const cnt = (st) => list.filter((m) => memberState(col, m) === st).length;

  let text = `${header}⚡ <b>${esc(col.title)}</b>\n💵 ${col.amount > 0 ? money(col.amount) : 'Ixtiyoriy summa'} · ${audLabel(col.grp)}${col.status === 'open' ? '' : ' · 🔒 Yopilgan'}\n${LINE}\n`
    + `✅ To'lagan: <b>${cnt('paid')}</b> · ❌ To'lamagan: <b>${cnt('unpaid')}</b> · ⏳ Tasdiqlash kutilmoqda: <b>${cnt('pending')}</b>\n`
    + `${progress(cnt('paid'), list.length)}\n`;
  if (exclude) {
    text += "\n🚫 <b>Chiqarish rejimi:</b> ❌ hodimni bossangiz, u bu yig'imdan chiqariladi — qarzdor hisoblanmaydi va unga eslatma bormaydi.";
  } else if (canPay) {
    text += `\n👆 <b>❌ qizil</b> tugmani bossangiz — naqd to'lov ${col.amount > 0 ? `(${money(col.amount)}) ` : ''}qabul qilinadi va <b>✅ yashil</b> bo'ladi.\n`
      + "✅ bosilsa — bekor qilish, ⏳ bosilsa — hodim yuborgan so'rovni ko'rish va tasdiqlash.";
  }

  const cells = pg.items.map((m) => {
    const st = memberState(col, m);
    return btn(`${STATE_ICON[st]} ${truncate(shortName(m), 18)}`, `a:col:${exclude ? 'tx' : 'tg'}:${id}:${m.id}:${f}:${pg.page}`, STATE_STYLE[st]);
  });
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) rows.push(cells.slice(i, i + 2));

  return show(ctx, text, kb([
    grpFilterRow(`a:col:g:${id}`, f, `${x}:0`),
    ...rows,
    navRow(`a:col:g:${id}:${f}${x}`, pg.page, pg.pages),
    [canExclude && (exclude
      ? btn('✅ Belgilash rejimiga qaytish', `a:col:g:${id}:${f}:${pg.page}`, 'success')
      : btn("🚫 Yig'imdan chiqarish rejimi", `a:col:g:${id}:${f}x:${pg.page}`))],
    [btn('🔄 Yangilash', `a:col:g:${id}:${f}${x}:${pg.page}`), backBtn(`a:col:v:${id}`, "⬅️ Yig'imga")],
  ]));
}

async function excludeMember(ctx, cid, eid) {
  const col = db.colById(cid);
  const e = db.empById(eid);
  const sum = db.payDeleteFor(cid, eid);
  db.colRemoveMember(cid, eid);
  if (sum && e?.telegram_id) {
    await safeSend(ctx.api, e.telegram_id, `ℹ️ <b>To'lov yozuvi bekor qilindi</b>\n\n📢 ${esc(col.title)}\n💵 ${money(sum)}\n\nSavollar bo'lsa, admin bilan bog'laning.`);
  }
  return { e, sum };
}

module.exports = (bot) => {
  const view = P.guard('collections', 'payments', 'reports');
  const edit = P.guard('collections');

  bot.callbackQuery(/^a:col:list:(\d+)$/, view, (ctx) => {
    const list = db.colList();
    const pg = paginate(list, ctx.match[1], 8);
    const rows = pg.items.map((c) => {
      const s = db.colStats(c.id);
      return [btn(`${c.status === 'open' ? '🟢' : '🔒'} ${GROUPS[c.grp]?.icon || '👥'} ${truncate(c.title, 26)} · ${s.paid.length}/${s.members.length}`, `a:col:v:${c.id}`, c.status === 'open' ? 'primary' : undefined)];
    });
    const me = ctx.from.id;
    const pending = db.reqPendingCount();
    return show(ctx, `💰 <b>Pul yig'ish</b>\n${LINE}\n💵 Kassa qoldig'i: <b>${money(db.totals().bal)}</b>\n`
      + `${pending ? `⏳ Tasdiqlash kutayotgan to'lovlar: <b>${pending}</b> ta\n` : ''}`
      + `\n🟢 Ochiq · 🔒 Yopilgan · 👥 Hamma · 🏢 Boshqarma · 🏙 Shahar · (to'lagan/jami)\n${list.length ? "👇 Yig'imni tanlang — ichida hodim ustiga bosib to'lovni belgilaysiz:" : "Hozircha yig'imlar yo'q."}`, kb([
      [P.can(me, 'collections') && btn("➕ Yangi yig'im boshlash", 'a:col:add', 'success')],
      [P.can(me, 'payments') && pending && btn(`⏳ To'lovlarni tasdiqlash (${pending})`, 'a:rq:list', 'danger')],
      ...rows,
      navRow('a:col:list', pg.page, pg.pages),
      [P.can(me, 'payments') && btn("💵 Boshqa summa / yig'imsiz to'lov", 'a:pay:start'),
        P.can(me, 'admins', 'collections') && btn('⚙️ Karta rekvizitlari', 'a:set')],
      [backBtn('a:menu', '🏠 Admin panel')],
    ]));
  });

  bot.callbackQuery(/^a:col:v:(\d+)$/, view, (ctx) => showCol(ctx, Number(ctx.match[1])));
  bot.callbackQuery(/^a:col:g:(\d+):([abs])(x?):(\d+)$/, view, (ctx) => memberGrid(ctx, Number(ctx.match[1]), ctx.match[2], ctx.match[4], '', ctx.match[3] === 'x'));

  // Chiqarish rejimida tugma bosildi
  bot.callbackQuery(/^a:col:tx:(\d+):(\d+):([abs]):(\d+)$/, P.guard('payments', 'collections'), async (ctx) => {
    const [cid, eid, f, page] = [Number(ctx.match[1]), Number(ctx.match[2]), ctx.match[3], Number(ctx.match[4])];
    const col = db.colById(cid);
    const m = db.colMembers(cid).find((x) => x.id === eid);
    if (!col || !m) return memberGrid(ctx, cid, f, page, '', true);
    const st = memberState(col, m);
    if (st !== 'unpaid') {
      return ctx.answerCallbackQuery({
        text: st === 'paid' ? "Bu hodim to'lagan. Chiqarish uchun belgilash rejimida ✅ ni bosing." : "Bu hodimning so'rovi tasdiqlash kutmoqda — avval uni ko'rib chiqing.",
        show_alert: true,
      });
    }
    db.colRemoveMember(cid, eid);
    await ctx.answerCallbackQuery(`🚫 ${fullName(m)} yig'imdan chiqarildi`);
    return memberGrid(ctx, cid, f, page, '', true);
  });

  // Tezkor belgilash tugmasi bosildi
  bot.callbackQuery(/^a:col:tg:(\d+):(\d+):([abs]):(\d+)$/, P.guard('payments'), async (ctx) => {
    const [cid, eid, f, page] = [Number(ctx.match[1]), Number(ctx.match[2]), ctx.match[3], Number(ctx.match[4])];
    const col = db.colById(cid);
    const m = db.colMembers(cid).find((x) => x.id === eid);
    if (!col || !m) return ctx.answerCallbackQuery('Topilmadi');
    if (col.status !== 'open') return ctx.answerCallbackQuery({ text: "🔒 Yig'im yopilgan", show_alert: true });
    const st = memberState(col, m);

    if (st === 'pending') {
      const r = db.reqPendingFor(cid, eid);
      return r ? showRequest(ctx, r.id) : memberGrid(ctx, cid, f, page);
    }
    if (st === 'paid') {
      return show(ctx, `↩️ <b>${esc(fullName(m))}</b> ning to'lovini bekor qilasizmi?\n\n📢 ${esc(col.title)}\n💵 To'lagan: <b>${money(m.paid)}</b>\n\n`
        + "• <b>Bekor qilish</b> — hodim qarzdor bo'lib qoladi va unga eslatma boradi.\n"
        + "• <b>Yig'imdan chiqarish</b> — to'lov bekor qilinadi, lekin hodim qarzdor hisoblanmaydi.", kb([
        [btn("↩️ Bekor qilish (qarzdor bo'ladi)", `a:col:un:${cid}:${eid}:${f}:${page}`, 'danger')],
        [btn("🚫 Bekor qilish va yig'imdan chiqarish", `a:col:unx:${cid}:${eid}:${f}:${page}`, 'danger')],
        [btn("❌ Yo'q, qaytish", `a:col:g:${cid}:${f}:${page}`, 'primary')],
      ]));
    }
    if (col.amount <= 0) return askAmount(ctx, cid, eid); // ixtiyoriy yig'im — summa so'raladi

    const amount = col.amount - m.paid;
    const { notified } = await acceptCash(ctx.api, { cid, eid, amount, by: ctx.from.id });
    await ctx.answerCallbackQuery(`✅ ${fullName(m)} — ${money(amount)} qabul qilindi${notified ? '' : ' (botda emas)'}`);
    return memberGrid(ctx, cid, f, page);
  });

  bot.callbackQuery(/^a:col:un:(\d+):(\d+):([abs]):(\d+)$/, P.guard('payments'), async (ctx) => {
    const [cid, eid, f, page] = [Number(ctx.match[1]), Number(ctx.match[2]), ctx.match[3], Number(ctx.match[4])];
    const col = db.colById(cid);
    const e = db.empById(eid);
    const sum = db.payDeleteFor(cid, eid);
    if (sum && e?.telegram_id) {
      await safeSend(ctx.api, e.telegram_id, `ℹ️ <b>To'lov yozuvi bekor qilindi</b>\n\n📢 ${esc(col.title)}\n💵 ${money(sum)}\n\nSavollar bo'lsa, admin bilan bog'laning.`);
    }
    return memberGrid(ctx, cid, f, page, `↩️ ${esc(fullName(e))} — ${money(sum)} bekor qilindi.\n\n`);
  });
  bot.callbackQuery(/^a:col:unx:(\d+):(\d+):([abs]):(\d+)$/, P.guard('payments'), async (ctx) => {
    const [cid, eid, f, page] = [Number(ctx.match[1]), Number(ctx.match[2]), ctx.match[3], Number(ctx.match[4])];
    const { e, sum } = await excludeMember(ctx, cid, eid);
    return memberGrid(ctx, cid, f, page, `🚫 ${esc(fullName(e))} — ${money(sum)} bekor qilindi va yig'imdan chiqarildi.\n\n`);
  });

  // ───── Yaratish: avval bo'lim tanlanadi ─────
  bot.callbackQuery('a:col:add', edit, (ctx) => {
    state.clear(ctx.from.id);
    const c = db.empCounts();
    return show(ctx, "📢 <b>Yangi yig'im</b>\n\nPul kimlardan yig'iladi? Xabar faqat shu bo'lim hodimlariga boradi:", kb([
      [btn(`👥 Hammasi (${c.active})`, 'a:col:aud:a', 'primary')],
      [btn(`🏢 Boshqarma (${c.boshqarma})`, 'a:col:aud:b', 'primary'), btn(`🏙 Shahar (${c.shahar})`, 'a:col:aud:s', 'primary')],
      [cancelBtn()],
    ]));
  });
  bot.callbackQuery(/^a:col:aud:([abs])$/, edit, (ctx) => askStep(ctx, 'col_title', { grp: GRP_CODES[ctx.match[1]] }));

  state.defineStep('col_title', { perms: ['collections'] }, (ctx, data) => {
    const t = ctx.message.text.trim();
    if (!t || t.length > 100) return show(ctx, '⚠️ Nomi 1–100 belgi bo\'lsin. Qaytadan kiriting:', kb([[cancelBtn()]]));
    data.title = t;
    return advance(ctx, 'col_title', data);
  });
  state.defineStep('col_amount', { perms: ['collections'] }, (ctx, data) => {
    const v = parseAmount(ctx.message.text);
    if (!v) return show(ctx, "⚠️ Summa noto'g'ri. Masalan: <b>50000</b> yoki <b>50k</b>", kb([[btn('🤲 Ixtiyoriy summa', 'a:col:amt0', 'primary')], [cancelBtn()]]));
    data.amount = v;
    return advance(ctx, 'col_amount', data);
  });
  state.defineStep('col_deadline', { perms: ['collections'] }, (ctx, data) => {
    const d = parseDate(ctx.message.text);
    if (!d) return show(ctx, "⚠️ Sana noto'g'ri. Format: <b>30.10.2026</b>", kb([[btn('⏭ Muddatsiz', 'a:col:skip')], [cancelBtn()]]));
    data.deadline = d;
    return advance(ctx, 'col_deadline', data);
  });
  state.defineStep('col_desc', { perms: ['collections'] }, (ctx, data) => {
    data.description = ctx.message.text.trim().slice(0, 500);
    return advance(ctx, 'col_desc', data);
  });
  bot.callbackQuery('a:col:amt0', edit, (ctx) => {
    const st = state.get(ctx.from.id);
    if (st?.step !== 'col_amount') return ctx.answerCallbackQuery('Sessiya tugagan');
    st.data.amount = 0;
    return advance(ctx, 'col_amount', st.data);
  });
  bot.callbackQuery('a:col:skip', edit, (ctx) => {
    const st = state.get(ctx.from.id);
    if (!st || !['col_deadline', 'col_desc'].includes(st.step)) return ctx.answerCallbackQuery('Sessiya tugagan');
    return advance(ctx, st.step, st.data);
  });

  bot.callbackQuery('a:col:save', edit, async (ctx) => {
    const st = state.get(ctx.from.id);
    if (st?.step !== 'col_confirm') return ctx.answerCallbackQuery({ text: '⌛ Sessiya tugagan, qaytadan boshlang', show_alert: true });
    state.clear(ctx.from.id);
    const d = st.data;
    const id = db.colCreate(d, ctx.from.id);
    await show(ctx, '⏳ Yig\'im yaratildi, hodimlarga xabar yuborilmoqda...', undefined);

    const ids = db.colMembers(id).filter((m) => m.telegram_id).map((m) => m.telegram_id);
    const text = `📢 <b>Yangi pul yig'ish!</b>\n${LINE}\n`
      + `📌 <b>${esc(d.title)}</b>\n`
      + `💵 Summa: <b>${d.amount ? money(d.amount) : 'Ixtiyoriy'}</b>\n`
      + `${d.deadline ? `📅 Muddat: <b>${esc(d.deadline)}</b>\n` : ''}`
      + `${d.description ? `📝 ${esc(d.description)}\n` : ''}${LINE}\n`
      + "👇 To'lov usulini tanlang:";
    const r = await sendToMany(ctx.api, ids, text, { reply_markup: kb([payRow(id)]) });
    return showCol(ctx, id, `✅ <b>Yig'im yaratildi!</b>\n📨 Xabar yuborildi: ${r.sent} ta${r.failed ? ` · ❗ ${r.failed} ta yetib bormadi` : ''}\n\n`);
  });

  // ───── Eslatma / yopish ─────
  bot.callbackQuery(/^a:col:rem:(\d+)$/, edit, async (ctx) => {
    await ctx.answerCallbackQuery('⏳ Yuborilmoqda...').catch(() => {});
    const r = await sendReminders(ctx.api, Number(ctx.match[1]));
    return showCol(ctx, Number(ctx.match[1]), `🔔 <b>Eslatma yuborildi:</b> ${r.sent} ta`
      + `${r.offline ? ` · ⚪ ${r.offline} ta botga kirmagan` : ''}${r.failed ? ` · ❗ ${r.failed} ta yetib bormadi` : ''}\n\n`);
  });
  bot.callbackQuery(/^a:col:cls:(\d+)$/, edit, (ctx) => {
    const id = Number(ctx.match[1]);
    const s = db.colStats(id);
    return show(ctx, `🔒 <b>${esc(s.col.title)}</b> yig'imini yopasizmi?\n\n`
      + `${s.unpaid.length ? `⚠️ ${s.unpaid.length} ta hodim hali to'lamagan. ` : ''}Yopilgach eslatmalar to'xtaydi.`, kb([
      [btn('✅ Ha, yopish', `a:col:clsok:${id}`, 'danger'), backBtn(`a:col:v:${id}`, "❌ Yo'q")],
    ]));
  });
  bot.callbackQuery(/^a:col:clsok:(\d+)$/, edit, (ctx) => {
    db.colSetStatus(Number(ctx.match[1]), 'closed');
    return showCol(ctx, Number(ctx.match[1]), "🔒 <b>Yig'im yopildi.</b>\n\n");
  });
  bot.callbackQuery(/^a:col:opn:(\d+)$/, edit, (ctx) => {
    db.colSetStatus(Number(ctx.match[1]), 'open');
    return showCol(ctx, Number(ctx.match[1]), "🔓 <b>Yig'im qayta ochildi.</b>\n\n");
  });
};

module.exports.showCol = showCol;
