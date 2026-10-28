const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { InputFile } = require('grammy');
const cfg = require('./config');
const db = require('./db');
const { money, localNow } = require('./ui');

const stamp = () => {
  const n = localNow();
  const p = (x) => String(x).padStart(2, '0');
  return `${n.getUTCFullYear()}-${p(n.getUTCMonth() + 1)}-${p(n.getUTCDate())}_${p(n.getUTCHours())}-${p(n.getUTCMinutes())}`;
};

/** Baza nusxasini Telegram orqali yuborish */
async function sendBackup(api, chatId, title = '💾 Zaxira nusxa') {
  const name = `unicon_${stamp()}.db`;
  const tmp = path.join(os.tmpdir(), name);
  fs.rmSync(tmp, { force: true });
  db.snapshot(tmp);
  try {
    const c = db.empCounts();
    await api.sendDocument(chatId, new InputFile(tmp, name), {
      parse_mode: 'HTML',
      caption: `${title}\n🕒 ${stamp().replace('_', ' ').replace(/-(\d\d)$/, ':$1')}\n`
        + `👥 Hodimlar: ${c.active} · 💰 Kassa: ${money(db.totals().bal)}\n\n`
        + '♻️ Tiklash kerak bo\'lsa: shu faylga <b>javob (reply)</b> qilib <code>/restore</code> yozing.',
    });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Yuklangan fayl haqiqiy bot bazasimi: SQLite sarlavhasi, butunlik va kerakli jadvallar */
function inspectDb(file) {
  const head = Buffer.alloc(16);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (head.toString('latin1') !== 'SQLite format 3\0') throw new Error('Bu SQLite baza fayli emas');
  const d = new DatabaseSync(file, { readOnly: true });
  try {
    if (d.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Fayl buzilgan');
    const tables = d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
    for (const t of ['employees', 'collections', 'payments', 'expenses']) {
      if (!tables.includes(t)) throw new Error(`Bu bot bazasi emas («${t}» jadvali yo'q)`);
    }
    const n = (t) => d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    return { employees: n('employees'), collections: n('collections'), payments: n('payments'), expenses: n('expenses') };
  } finally {
    d.close();
  }
}

/** Telegram'dagi faylni yuklab olish va keyingi ishga tushishda qo'llash uchun tayyorlash */
async function prepareRestore(api, fileId) {
  const f = await api.getFile(fileId);
  const res = await fetch(`https://api.telegram.org/file/bot${cfg.BOT_TOKEN}/${f.file_path}`);
  if (!res.ok) throw new Error(`Faylni yuklab bo'lmadi (${res.status})`);
  const tmp = `${db.RESTORE_PATH}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  try {
    const info = inspectDb(tmp);
    fs.renameSync(tmp, db.RESTORE_PATH);
    return info;
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

module.exports = { sendBackup, prepareRestore, inspectDb };
