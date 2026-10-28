const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');

fs.mkdirSync(path.dirname(cfg.DB_PATH), { recursive: true });

// /restore orqali yuklangan baza: eski baza nusxasi saqlanadi va yangisi o'rniga qo'yiladi
const RESTORE_PATH = `${cfg.DB_PATH}.restore`;
if (fs.existsSync(RESTORE_PATH)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (fs.existsSync(cfg.DB_PATH)) fs.copyFileSync(cfg.DB_PATH, `${cfg.DB_PATH}.before-restore-${stamp}`);
  for (const s of ['', '-wal', '-shm']) fs.rmSync(cfg.DB_PATH + s, { force: true });
  fs.renameSync(RESTORE_PATH, cfg.DB_PATH);
  console.log('♻️ Baza zaxira nusxadan tiklandi');
}

const db = new DatabaseSync(cfg.DB_PATH);

// Boshlang'ich (v0) sxema; keyingi o'zgarishlar migrate() da
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS employees (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name  TEXT NOT NULL,
  last_name   TEXT NOT NULL,
  phone       TEXT NOT NULL UNIQUE,
  position    TEXT,
  department  TEXT,
  birth_date  TEXT,
  note        TEXT,
  telegram_id INTEGER UNIQUE,
  tg_username TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  linked_at   TEXT
);

CREATE TABLE IF NOT EXISTS admins (
  telegram_id INTEGER PRIMARY KEY,
  name        TEXT,
  perms       TEXT NOT NULL DEFAULT '',
  added_by    INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS collections (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT,
  amount      INTEGER NOT NULL DEFAULT 0,
  deadline    TEXT,
  status      TEXT NOT NULL DEFAULT 'open',
  created_by  INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at   TEXT
);

CREATE TABLE IF NOT EXISTS collection_members (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, employee_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
  employee_id   INTEGER NOT NULL REFERENCES employees(id),
  amount        INTEGER NOT NULL,
  accepted_by   INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  amount        INTEGER NOT NULL,
  reason        TEXT NOT NULL,
  collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
  photo_file_id TEXT,
  created_by    INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reminder_log (
  day     TEXT NOT NULL,
  slot    TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (day, slot)
);
`);

const clean = (p) => p.map((v) => (v === undefined ? null : v));
const all = (sql, ...p) => db.prepare(sql).all(...clean(p));
const get = (sql, ...p) => db.prepare(sql).get(...clean(p));
const run = (sql, ...p) => db.prepare(sql).run(...clean(p));
const num = (sql, ...p) => Number(Object.values(get(sql, ...p) || { v: 0 })[0] || 0);

function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function migrate() {
  const version = Number(get('PRAGMA user_version').user_version);
  if (version < 1) {
    // v1: ism/familiyani hodim o'zi kiritadi (NULL bo'lishi mumkin), guruh (boshqarma/shahar),
    // to'lov usuli, Click cheklari, sozlamalar
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      tx(() => db.exec(`
        CREATE TABLE employees_new (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          first_name    TEXT,
          last_name     TEXT,
          phone         TEXT NOT NULL UNIQUE,
          grp           TEXT NOT NULL DEFAULT 'boshqarma',
          position      TEXT,
          department    TEXT,
          birth_date    TEXT,
          note          TEXT,
          telegram_id   INTEGER UNIQUE,
          tg_username   TEXT,
          is_active     INTEGER NOT NULL DEFAULT 1,
          created_by    INTEGER,
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          linked_at     TEXT,
          registered_at TEXT
        );
        INSERT INTO employees_new (id, first_name, last_name, phone, position, department, birth_date, note,
                                   telegram_id, tg_username, is_active, created_by, created_at, linked_at, registered_at)
          SELECT id, first_name, last_name, phone, position, department, birth_date, note,
                 telegram_id, tg_username, is_active, created_by, created_at, linked_at, created_at
          FROM employees;
        DROP TABLE employees;
        ALTER TABLE employees_new RENAME TO employees;

        ALTER TABLE payments ADD COLUMN method TEXT NOT NULL DEFAULT 'naqd';

        CREATE TABLE payment_requests (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
          employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
          amount        INTEGER NOT NULL,
          file_id       TEXT NOT NULL,
          file_kind     TEXT NOT NULL DEFAULT 'photo',
          status        TEXT NOT NULL DEFAULT 'pending',
          reason        TEXT,
          payment_id    INTEGER,
          reviewed_by   INTEGER,
          reviewed_at   TEXT,
          created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE request_msgs (
          request_id INTEGER NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
          chat_id    INTEGER NOT NULL,
          message_id INTEGER NOT NULL
        );
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);

        PRAGMA user_version = 1;
      `));
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
  if (version < 2) {
    // v2: hodim naqd to'lovni ham so'rov sifatida yuboradi (chek rasmisiz), admin tasdiqlaydi
    tx(() => db.exec(`
      ALTER TABLE payment_requests ADD COLUMN method TEXT NOT NULL DEFAULT 'click';
      PRAGMA user_version = 2;
    `));
  }
  if (version < 3) {
    // v3: yig'im qaysi bo'lim uchun (NULL — hamma)
    tx(() => db.exec(`
      ALTER TABLE collections ADD COLUMN grp TEXT;
      PRAGMA user_version = 3;
    `));
  }
}
migrate();

/** Yig'im to'langanmi: summa belgilangan bo'lsa — to'liq, ixtiyoriy bo'lsa — biror summa */
const isPaid = (amount, paid) => (amount > 0 ? paid >= amount : paid > 0);

const PAID_SQL = (col, emp) =>
  `COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.collection_id = ${col} AND p.employee_id = ${emp}), 0)`;
const PENDING_SQL = (col, emp) =>
  `EXISTS (SELECT 1 FROM payment_requests r WHERE r.collection_id = ${col} AND r.employee_id = ${emp} AND r.status = 'pending')`;

const NAME_ORDER = 'e.last_name IS NULL, e.last_name COLLATE NOCASE, e.first_name COLLATE NOCASE, e.id';
const EMP_FIELDS = ['first_name', 'last_name', 'phone', 'grp', 'position', 'birth_date', 'note'];

// ───────── Hodimlar ─────────
const empById = (id) => get('SELECT * FROM employees WHERE id = ?', id);
const empByTg = (tg) => get('SELECT * FROM employees WHERE telegram_id = ?', tg);
const empByPhone = (phone) => get('SELECT * FROM employees WHERE phone = ?', phone);

/** grp: 'boshqarma' | 'shahar' | null (hammasi) */
const empList = (grp = null) => all(
  `SELECT e.* FROM employees e WHERE (? IS NULL OR e.grp = ?) ORDER BY e.is_active DESC, ${NAME_ORDER}`, grp, grp,
);
const empActive = (grp = null) => all(
  `SELECT e.* FROM employees e WHERE e.is_active = 1 AND (? IS NULL OR e.grp = ?) ORDER BY ${NAME_ORDER}`, grp, grp,
);

function empSearch(q) {
  const like = `%${q.trim()}%`;
  const digits = q.replace(/\D/g, '');
  return all(
    `SELECT e.* FROM employees e
     WHERE e.last_name || ' ' || e.first_name LIKE ? OR e.first_name || ' ' || e.last_name LIKE ? OR e.position LIKE ?
        ${digits.length >= 3 ? 'OR e.phone LIKE ?' : ''}
     ORDER BY e.is_active DESC, ${NAME_ORDER} LIMIT 30`,
    like, like, like, ...(digits.length >= 3 ? [`%${digits}%`] : []),
  );
}

function empCreate(phone, grp, by) {
  return Number(run('INSERT INTO employees (phone, grp, created_by) VALUES (?, ?, ?)', phone, grp, by).lastInsertRowid);
}

function empUpdate(id, field, value) {
  if (!EMP_FIELDS.includes(field)) throw new Error(`Bad field ${field}`);
  run(`UPDATE employees SET ${field} = ? WHERE id = ?`, value, id);
}

/** Hodim o'z ma'lumotlarini to'ldirganda */
function empRegister(id, v) {
  run("UPDATE employees SET last_name = ?, first_name = ?, position = ?, registered_at = datetime('now') WHERE id = ?",
    v.last_name, v.first_name, v.position, id);
}

function empLink(id, tg, username) {
  tx(() => {
    run('UPDATE employees SET telegram_id = NULL WHERE telegram_id = ? AND id <> ?', tg, id);
    run("UPDATE employees SET telegram_id = ?, tg_username = ?, linked_at = datetime('now') WHERE id = ?", tg, username, id);
  });
}
const empUnlink = (id) => run('UPDATE employees SET telegram_id = NULL, tg_username = NULL, linked_at = NULL WHERE id = ?', id);
const empSetActive = (id, v) => run('UPDATE employees SET is_active = ? WHERE id = ?', v ? 1 : 0, id);
const empPaymentsCount = (id) => num('SELECT COUNT(*) FROM payments WHERE employee_id = ?', id);
const empDelete = (id) => run('DELETE FROM employees WHERE id = ?', id);
const empPaidTotal = (id) => num('SELECT COALESCE(SUM(amount), 0) FROM payments WHERE employee_id = ?', id);

function empCounts() {
  const r = get(`SELECT
      COALESCE(SUM(is_active = 1), 0) AS active,
      COALESCE(SUM(is_active = 1 AND telegram_id IS NOT NULL), 0) AS linked,
      COALESCE(SUM(is_active = 1 AND registered_at IS NOT NULL), 0) AS registered,
      COALESCE(SUM(is_active = 0), 0) AS inactive,
      COALESCE(SUM(is_active = 1 AND grp = 'boshqarma'), 0) AS boshqarma,
      COALESCE(SUM(is_active = 1 AND grp = 'shahar'), 0) AS shahar
    FROM employees`);
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
}

/** Hodim a'zo bo'lgan yig'imlar: to'lagan summasi va tekshiruvdagi chek bormi */
const empCollections = (eid, limit = 100) => all(
  `SELECT c.*, ${PAID_SQL('c.id', 'm.employee_id')} AS paid, ${PENDING_SQL('c.id', 'm.employee_id')} AS pending
   FROM collections c JOIN collection_members m ON m.collection_id = c.id
   WHERE m.employee_id = ?
   ORDER BY (c.status = 'open') DESC, c.id DESC LIMIT ?`,
  eid, limit,
);
const empUnpaid = (eid) => empCollections(eid).filter((c) => c.status === 'open' && !isPaid(c.amount, c.paid));

// ───────── Yig'imlar ─────────
const colById = (id) => get('SELECT * FROM collections WHERE id = ?', id);
const colList = () => all("SELECT * FROM collections ORDER BY (status = 'open') DESC, id DESC");
const colOpen = () => all("SELECT * FROM collections WHERE status = 'open' ORDER BY id DESC");

/** v.grp: 'boshqarma' | 'shahar' | null (hamma faol hodimlar) */
function colCreate(v, by) {
  return tx(() => {
    const r = run(
      'INSERT INTO collections (title, description, amount, deadline, grp, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      v.title, v.description, v.amount || 0, v.deadline, v.grp || null, by,
    );
    const id = Number(r.lastInsertRowid);
    run('INSERT INTO collection_members (collection_id, employee_id) SELECT ?, id FROM employees WHERE is_active = 1 AND (? IS NULL OR grp = ?)',
      id, v.grp || null, v.grp || null);
    return id;
  });
}

function colSetStatus(id, status) {
  run(`UPDATE collections SET status = ?, closed_at = ${status === 'closed' ? "datetime('now')" : 'NULL'} WHERE id = ?`, status, id);
}

const colAddMember = (cid, eid) => run('INSERT OR IGNORE INTO collection_members (collection_id, employee_id) VALUES (?, ?)', cid, eid);
/** Hodimni yig'imdan chiqarish: u endi bu yig'im bo'yicha qarzdor hisoblanmaydi */
const colRemoveMember = (cid, eid) => run('DELETE FROM collection_members WHERE collection_id = ? AND employee_id = ?', cid, eid);

const colMembers = (cid) => all(
  `SELECT e.*, ${PAID_SQL('m.collection_id', 'e.id')} AS paid, ${PENDING_SQL('m.collection_id', 'e.id')} AS pending
   FROM collection_members m JOIN employees e ON e.id = m.employee_id
   WHERE m.collection_id = ? AND e.is_active = 1
   ORDER BY ${NAME_ORDER}`,
  cid,
);

function colStats(cid) {
  const col = colById(cid);
  if (!col) return null;
  const members = colMembers(cid);
  const paid = members.filter((m) => isPaid(col.amount, m.paid));
  const unpaid = members.filter((m) => !isPaid(col.amount, m.paid));
  const pending = unpaid.filter((m) => m.pending);
  const collected = num('SELECT COALESCE(SUM(amount), 0) FROM payments WHERE collection_id = ?', cid);
  const spent = num('SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE collection_id = ?', cid);
  const due = col.amount > 0 ? unpaid.reduce((s, m) => s + (col.amount - m.paid), 0) : 0;
  return { col, members, paid, unpaid, pending, collected, spent, due };
}

/** Ochiq yig'imlar bo'yicha barcha qarzdorliklar (hodim × yig'im) */
function debts() {
  return all(
    `SELECT c.id AS cid, c.title, c.amount, c.deadline,
            e.id AS eid, e.first_name, e.last_name, e.phone, e.grp, e.telegram_id,
            ${PAID_SQL('c.id', 'e.id')} AS paid, ${PENDING_SQL('c.id', 'e.id')} AS pending
     FROM collections c
     JOIN collection_members m ON m.collection_id = c.id
     JOIN employees e ON e.id = m.employee_id
     WHERE c.status = 'open' AND e.is_active = 1
     ORDER BY ${NAME_ORDER}, c.id`,
  ).filter((d) => !isPaid(d.amount, d.paid));
}

// ───────── To'lovlar ─────────
function payCreate({ cid, eid, amount, by, method = 'naqd' }) {
  const r = run('INSERT INTO payments (collection_id, employee_id, amount, accepted_by, method) VALUES (?, ?, ?, ?, ?)',
    cid || null, eid, amount, by, method);
  return Number(r.lastInsertRowid);
}
const PAY_SELECT = `SELECT p.*, c.title AS col_title, e.first_name, e.last_name, e.phone, e.grp, e.telegram_id
  FROM payments p JOIN employees e ON e.id = p.employee_id LEFT JOIN collections c ON c.id = p.collection_id`;
const payById = (id) => get(`${PAY_SELECT} WHERE p.id = ?`, id);
const paysByEmp = (eid, limit = 20) => all(`${PAY_SELECT} WHERE p.employee_id = ? ORDER BY p.id DESC LIMIT ?`, eid, limit);
const paysAll = () => all(`${PAY_SELECT} ORDER BY p.id DESC`);
const payDelete = (id) => run('DELETE FROM payments WHERE id = ?', id);
/** Hodimning shu yig'im bo'yicha barcha to'lovlarini bekor qilish; o'chirilgan summa qaytadi */
function payDeleteFor(cid, eid) {
  const sum = num('SELECT COALESCE(SUM(amount), 0) FROM payments WHERE collection_id = ? AND employee_id = ?', cid, eid);
  run('DELETE FROM payments WHERE collection_id = ? AND employee_id = ?', cid, eid);
  return sum;
}

// ───────── To'lov so'rovlari (hodim yuboradi, admin tasdiqlaydi) ─────────
/** method: 'naqd' (fayl yo'q) | 'click' (karta, chek rasmi bilan) */
function reqCreate({ cid, eid, amount, method, fileId = '', kind = 'none' }) {
  return Number(run('INSERT INTO payment_requests (collection_id, employee_id, amount, method, file_id, file_kind) VALUES (?, ?, ?, ?, ?, ?)',
    cid, eid, amount, method, fileId, kind).lastInsertRowid);
}
const REQ_SELECT = `SELECT r.*, c.title AS col_title, c.amount AS col_amount, e.first_name, e.last_name, e.phone, e.grp, e.telegram_id
  FROM payment_requests r JOIN employees e ON e.id = r.employee_id LEFT JOIN collections c ON c.id = r.collection_id`;
const reqById = (id) => get(`${REQ_SELECT} WHERE r.id = ?`, id);
const reqPending = () => all(`${REQ_SELECT} WHERE r.status = 'pending' ORDER BY r.id`);
const reqPendingFor = (cid, eid) => get(`${REQ_SELECT} WHERE r.status = 'pending' AND r.collection_id = ? AND r.employee_id = ?`, cid, eid);
const reqPendingCount = () => num("SELECT COUNT(*) FROM payment_requests WHERE status = 'pending'");
function reqReview(id, { status, by, paymentId = null, reason = null }) {
  // Faqat hali ko'rib chiqilmagan chek yangilanadi (ikki admin bir vaqtda bossa ham bitta to'lov)
  return run(`UPDATE payment_requests SET status = ?, reviewed_by = ?, payment_id = ?, reason = ?, reviewed_at = datetime('now')
              WHERE id = ? AND status = 'pending'`, status, by, paymentId, reason, id).changes > 0;
}
const reqMsgAdd = (id, chatId, msgId) => run('INSERT INTO request_msgs (request_id, chat_id, message_id) VALUES (?, ?, ?)', id, chatId, msgId);
const reqMsgs = (id) => all('SELECT * FROM request_msgs WHERE request_id = ?', id);

// ───────── Chiqimlar ─────────
function expCreate(v, by) {
  const r = run('INSERT INTO expenses (amount, reason, collection_id, photo_file_id, created_by) VALUES (?, ?, ?, ?, ?)',
    v.amount, v.reason, v.cid || null, v.photo, by);
  return Number(r.lastInsertRowid);
}
const EXP_SELECT = 'SELECT x.*, c.title AS col_title FROM expenses x LEFT JOIN collections c ON c.id = x.collection_id';
const expById = (id) => get(`${EXP_SELECT} WHERE x.id = ?`, id);
const expList = () => all(`${EXP_SELECT} ORDER BY x.created_at DESC, x.id DESC`);
const expDelete = (id) => run('DELETE FROM expenses WHERE id = ?', id);

// ───────── Kassa logi (kirim + chiqim, vaqt bo'yicha) ─────────
/** kind: 'in' | 'out' | null; eid berilsa — faqat shu hodimning to'lovlari (chiqimlar hammaga ko'rinadi) */
function logEntries({ kind = null, eid = null } = {}) {
  const ins = `SELECT 'in' AS kind, p.id, p.amount, p.created_at, p.method, p.accepted_by AS actor, c.title AS col_title,
                      e.first_name, e.last_name, e.phone, e.grp, NULL AS reason
               FROM payments p JOIN employees e ON e.id = p.employee_id LEFT JOIN collections c ON c.id = p.collection_id
               ${eid ? 'WHERE p.employee_id = ?' : ''}`;
  const outs = `SELECT 'out' AS kind, x.id, x.amount, x.created_at, NULL AS method, x.created_by AS actor, c.title AS col_title,
                       NULL AS first_name, NULL AS last_name, NULL AS phone, NULL AS grp, x.reason
                FROM expenses x LEFT JOIN collections c ON c.id = x.collection_id`;
  const parts = [kind !== 'out' && ins, kind !== 'in' && outs].filter(Boolean);
  const params = kind !== 'out' && eid ? [eid] : [];
  return all(`SELECT * FROM (${parts.join(' UNION ALL ')}) ORDER BY created_at DESC, id DESC`, ...params);
}

// ───────── Kassa ─────────
function totals() {
  const inc = num('SELECT COALESCE(SUM(amount), 0) FROM payments');
  const out = num('SELECT COALESCE(SUM(amount), 0) FROM expenses');
  return { inc, out, bal: inc - out };
}
function monthTotals(ym) {
  const mod = `${cfg.TZ_OFFSET_MIN >= 0 ? '+' : ''}${cfg.TZ_OFFSET_MIN} minutes`;
  const inc = num("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE strftime('%Y-%m', created_at, ?) = ?", mod, ym);
  const out = num("SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE strftime('%Y-%m', created_at, ?) = ?", mod, ym);
  return { inc, out };
}

// ───────── Adminlar ─────────
const adminGet = (id) => get('SELECT * FROM admins WHERE telegram_id = ?', id);
const adminList = () => all('SELECT * FROM admins ORDER BY created_at');
const adminAdd = (id, name, by) => run('INSERT OR IGNORE INTO admins (telegram_id, name, added_by) VALUES (?, ?, ?)', id, name, by);
const adminSetPerms = (id, perms) => run('UPDATE admins SET perms = ? WHERE telegram_id = ?', [...perms].join(','), id);
const adminDelete = (id) => run('DELETE FROM admins WHERE telegram_id = ?', id);

// ───────── Sozlamalar ─────────
const settingGet = (key) => get('SELECT value FROM settings WHERE key = ?', key)?.value ?? null;
const settingSet = (key, value) => run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);

// ───────── Zaxira nusxa ─────────
/** Bazaning izchil nusxasini faylga yozish (WAL bilan birga) */
const snapshot = (file) => db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);

// ───────── Eslatmalar ─────────
const remWasSent = (day, slot) => !!get('SELECT 1 FROM reminder_log WHERE day = ? AND slot = ?', day, slot);
const remMark = (day, slot) => run('INSERT OR IGNORE INTO reminder_log (day, slot) VALUES (?, ?)', day, slot);

module.exports = {
  isPaid,
  empById, empByTg, empByPhone, empList, empActive, empSearch, empCreate, empUpdate, empRegister, empLink, empUnlink,
  empSetActive, empPaymentsCount, empDelete, empPaidTotal, empCounts, empCollections, empUnpaid,
  colById, colList, colOpen, colCreate, colSetStatus, colAddMember, colRemoveMember, colMembers, colStats, debts,
  payCreate, payById, paysByEmp, paysAll, payDelete, payDeleteFor,
  reqCreate, reqById, reqPending, reqPendingFor, reqPendingCount, reqReview, reqMsgAdd, reqMsgs,
  expCreate, expById, expList, expDelete,
  logEntries, totals, monthTotals,
  adminGet, adminList, adminAdd, adminSetPerms, adminDelete,
  settingGet, settingSet,
  snapshot, RESTORE_PATH,
  remWasSent, remMark,
};
