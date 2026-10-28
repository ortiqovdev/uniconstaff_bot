const P = require('../../perms');
const { esc } = require('../../ui');
const { sendBackup, prepareRestore } = require('../../backup');

// Yashirin buyruqlar, faqat super admin uchun:
//   /backup  — bazaning hozirgi nusxasini yuborish
//   /restore — .db faylga javob (reply) qilib yozilsa, bazani shu fayldan tiklash
module.exports = (bot) => {
  bot.command('backup', async (ctx, next) => {
    if (!P.isSuper(ctx.from.id)) return next();
    return sendBackup(ctx.api, ctx.chat.id);
  });

  bot.command('restore', async (ctx, next) => {
    if (!P.isSuper(ctx.from.id)) return next();
    // Qayta ishga tushgach Telegram eski buyruqni qayta yubormasligi uchun
    if (Date.now() / 1000 - ctx.message.date > 120) return undefined;
    const doc = ctx.message.document || ctx.message.reply_to_message?.document;
    if (!doc) {
      return ctx.reply('♻️ Bazani tiklash uchun zaxira <b>.db</b> faylga javob (reply) qilib <code>/restore</code> yozing.', { parse_mode: 'HTML' });
    }
    let info;
    try {
      info = await prepareRestore(ctx.api, doc.file_id);
    } catch (e) {
      return ctx.reply(`❌ Tiklab bo'lmadi: ${esc(e.message)}`, { parse_mode: 'HTML' });
    }
    await ctx.reply(`✅ <b>Fayl tekshirildi:</b> ${info.employees} hodim, ${info.collections} yig'im, ${info.payments} to'lov, ${info.expenses} chiqim.\n\n`
      + '♻️ Bot qayta ishga tushmoqda, 1 daqiqadan keyin /admin ni bosing.', { parse_mode: 'HTML' });
    console.log(`♻️ /restore: ${JSON.stringify(info)} — qayta ishga tushirilmoqda`);
    // Ishlovchi tugagach to'xtatamiz: bot.stop() oxirgi update'ni tasdiqlaydi, so'ng hosting jarayonni qayta ishga tushiradi
    setTimeout(() => bot.stop().finally(() => process.exit(0)), 500);
    return undefined;
  });
};
