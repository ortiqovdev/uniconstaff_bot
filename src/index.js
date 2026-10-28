const cfg = require('./config');
const { createBot } = require('./bot');
const { startScheduler } = require('./scheduler');

if (!cfg.BOT_TOKEN) {
  console.error("❌ BOT_TOKEN .env faylida ko'rsatilmagan");
  process.exit(1);
}
if (!cfg.SUPER_ADMIN_IDS.length) {
  console.warn(`⚠️ SUPER_ADMIN_IDS bo'sh — hech kim /${cfg.ADMIN_COMMAND} ga kira olmaydi. ID ingizni .env ga yozing.`);
}

const bot = createBot(cfg.BOT_TOKEN);

async function main() {
  // Yashirin admin buyrug'i ro'yxatga kiritilmaydi
  await bot.api.setMyCommands([{ command: 'start', description: '🏠 Bosh menyu' }]);
  startScheduler(bot);
  await bot.start({
    allowed_updates: ['message', 'callback_query'],
    onStart: (me) => console.log(`✅ @${me.username} ishga tushdi`),
  });
}

process.once('SIGINT', () => bot.stop());
process.once('SIGTERM', () => bot.stop());

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
