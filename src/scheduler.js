const cfg = require('./config');
const db = require('./db');
const { localNow } = require('./ui');
const { sendReminders } = require('./notify');
const { sendBackup } = require('./backup');

// Bot o'chib qolgan bo'lsa, belgilangan vaqtdan keyin 60 daqiqa ichida yoqilganda vazifa baribir bajariladi
const CATCH_UP_MIN = 60;

const toMin = (s) => {
  const [h, m] = String(s).split(':').map(Number);
  return h * 60 + (m || 0);
};

function startScheduler(bot) {
  const tasks = [
    ...cfg.REMINDER_TIMES.map((s) => ({
      slot: s,
      min: toMin(s),
      run: async (day) => {
        const r = await sendReminders(bot.api);
        console.log(`[eslatma] ${day} ${s}: yuborildi ${r.sent}, xato ${r.failed}, botga kirmagan ${r.offline}`);
      },
    })),
    cfg.BACKUP_TIME && {
      slot: `backup ${cfg.BACKUP_TIME}`,
      min: toMin(cfg.BACKUP_TIME),
      run: async (day) => {
        for (const id of cfg.SUPER_ADMIN_IDS) await sendBackup(bot.api, id, '💾 Kunlik zaxira nusxa').catch((e) => console.error('[zaxira]', e.description || e.message));
        console.log(`[zaxira] ${day}: super adminlarga yuborildi`);
      },
    },
  ].filter((t) => t && Number.isFinite(t.min));

  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = localNow();
      const day = now.toISOString().slice(0, 10);
      const cur = now.getUTCHours() * 60 + now.getUTCMinutes();
      for (const t of tasks) {
        if (cur >= t.min && cur < t.min + CATCH_UP_MIN && !db.remWasSent(day, t.slot)) {
          db.remMark(day, t.slot);
          await t.run(day);
        }
      }
    } catch (e) {
      console.error('[rejalashtiruvchi] xato:', e);
    } finally {
      busy = false;
    }
  };

  setInterval(tick, 30_000);
  tick();
  console.log(`⏰ Eslatmalar: har kuni ${cfg.REMINDER_TIMES.join(' va ')}${cfg.BACKUP_TIME ? ` · 💾 zaxira: ${cfg.BACKUP_TIME}` : ''} (UTC${cfg.TZ_OFFSET_MIN >= 0 ? '+' : ''}${cfg.TZ_OFFSET_MIN / 60})`);
}

module.exports = { startScheduler };
