const ExcelJS = require('exceljs');
const db = require('./db');
const P = require('./perms');
const { fmtDate, fmtPhone, fullName, GROUPS, PAY_METHODS } = require('./ui');

const MONEY_FMT = '#,##0';
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const COLORS = {
  head: 'FF2E5BFF', section: 'FF1F2A44', paid: 'FFC6EFCE', unpaid: 'FFFFC7CE', pending: 'FFFFEB9C', none: 'FFF2F2F2', total: 'FFDDE5FF',
};
const border = { top: { style: 'thin', color: { argb: 'FFBFBFBF' } }, left: { style: 'thin', color: { argb: 'FFBFBFBF' } }, bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } }, right: { style: 'thin', color: { argb: 'FFBFBFBF' } } };
const plain = (s) => String(s || '').replace(/<[^>]+>/g, '');
const splitDT = (sql) => {
  const [d, t] = fmtDate(sql).split(' ');
  return { date: d, time: t || '' };
};

function styleHeader(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.height = 30;
  row.eachCell((c) => {
    c.fill = fill(COLORS.head);
    c.border = border;
  });
}

function sectionTitle(ws, text, span) {
  const row = ws.addRow([text]);
  ws.mergeCells(row.number, 1, row.number, span);
  row.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
  row.getCell(1).fill = fill(COLORS.section);
  row.height = 24;
  return row;
}

function totalRow(ws, values) {
  const row = ws.addRow(values);
  row.font = { bold: true };
  row.eachCell((c) => {
    c.fill = fill(COLORS.total);
    c.border = border;
  });
  return row;
}

/** Boshqarma / Shahar varag'i: hodimlar × yig'imlar (to'lagan summa, rang bilan holat) */
function groupSheet(wb, grp) {
  const { label } = GROUPS[grp];
  const ws = wb.addWorksheet(label, { views: [{ state: 'frozen', xSplit: 3, ySplit: 1 }] });
  const emps = db.empList(grp);
  const cols = db.colList().reverse();
  const members = new Map(cols.map((c) => [c.id, new Map(db.colMembers(c.id).map((m) => [m.id, m]))]));

  const base = ['№', 'Familiya', 'Ism', 'Telefon', 'Lavozim', 'Holat'];
  const header = ws.addRow([...base, ...cols.map((c) => `${c.title}\n(${c.amount > 0 ? c.amount.toLocaleString('ru-RU') : 'ixtiyoriy'})`), "Jami to'lagan"]);
  styleHeader(header);
  [5, 18, 16, 18, 26, 16].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  cols.forEach((_, i) => { ws.getColumn(base.length + 1 + i).width = 16; });
  ws.getColumn(base.length + cols.length + 1).width = 16;

  const sums = cols.map(() => 0);
  emps.forEach((e, idx) => {
    const status = !e.is_active ? "To'xtatilgan" : !e.telegram_id ? 'Botga kirmagan' : !e.registered_at ? "To'ldirmagan" : 'Faol';
    const cells = cols.map((c, i) => {
      const m = members.get(c.id).get(e.id);
      if (!m) return null;
      sums[i] += m.paid;
      return m.paid;
    });
    const row = ws.addRow([idx + 1, e.last_name || '', e.first_name || '', fmtPhone(e.phone), e.position || '', status, ...cells, db.empPaidTotal(e.id)]);
    row.eachCell({ includeEmpty: true }, (cell) => { cell.border = border; });
    cols.forEach((c, i) => {
      const cell = row.getCell(base.length + 1 + i);
      const m = members.get(c.id).get(e.id);
      cell.numFmt = MONEY_FMT;
      if (!m) cell.fill = fill(COLORS.none);
      else if (db.isPaid(c.amount, m.paid)) cell.fill = fill(COLORS.paid);
      else if (m.pending) {
        cell.fill = fill(COLORS.pending);
        cell.note = 'Admin tasdiqlashi kutilmoqda';
      } else cell.fill = fill(COLORS.unpaid);
    });
    row.getCell(base.length + cols.length + 1).numFmt = MONEY_FMT;
  });

  const tr = totalRow(ws, ['', 'JAMI', '', '', '', `${emps.length} ta hodim`, ...sums, sums.reduce((a, b) => a + b, 0)]);
  for (let i = base.length + 1; i <= base.length + cols.length + 1; i++) tr.getCell(i).numFmt = MONEY_FMT;

  ws.addRow([]);
  const legend = ws.addRow(['', "🟩 To'lagan   🟥 To'lamagan   🟨 Admin tasdiqlashi kutilmoqda   ⬜ Ishtirokchi emas"]);
  legend.font = { italic: true, color: { argb: 'FF666666' } };
  return ws;
}

function monitoringSheet(wb) {
  const ws = wb.addWorksheet('Monitoring');
  [6, 14, 8, 26, 13, 18, 28, 14, 11, 22].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const t = db.totals();
  const pays = db.paysAll();
  const byMethod = (m) => pays.filter((p) => p.method === m).reduce((s, p) => s + p.amount, 0);
  const c = db.empCounts();
  const nowSql = new Date().toISOString().replace('T', ' ').slice(0, 19);

  sectionTitle(ws, `📊 Kassa monitoringi · ${fmtDate(nowSql)}`, 10);
  [
    ["Jami kirim", t.inc], ["  shundan naqd", byMethod('naqd')], ['  shundan karta orqali', byMethod('click')],
    ['Jami chiqim (harajatlar)', t.out], ["Kassa qoldig'i", t.bal],
    ['Boshqarma hodimlari', c.boshqarma], ['Shahar hodimlari', c.shahar], ["Ro'yxatdan o'tganlar", c.registered],
    ['Tasdiqlash kutilayotgan cheklar', db.reqPendingCount()],
  ].forEach(([k, v], i) => {
    const row = ws.addRow(['', k, '', '', v]);
    ws.mergeCells(row.number, 2, row.number, 4);
    row.getCell(5).numFmt = MONEY_FMT;
    row.getCell(5).font = { bold: true };
    if (i === 4) row.font = { bold: true };
  });

  ws.addRow([]);
  sectionTitle(ws, "📢 Yig'imlar holati", 10);
  styleHeader(ws.addRow(['№', 'Ochilgan', '', "Yig'im", 'Holat', 'Summa (har biri)', "Ishtirokchi / To'lagan", "Yig'ildi", 'Sarflandi', 'Qoldiq']));
  db.colList().forEach((col, i) => {
    const s = db.colStats(col.id);
    const row = ws.addRow([i + 1, splitDT(col.created_at).date, '', col.title, col.status === 'open' ? 'Ochiq' : 'Yopilgan',
      col.amount || 'ixtiyoriy', `${s.members.length} / ${s.paid.length}`, s.collected, s.spent, s.collected - s.spent]);
    [6, 8, 9, 10].forEach((k) => { row.getCell(k).numFmt = MONEY_FMT; });
    row.eachCell((cell) => { cell.border = border; });
  });

  ws.addRow([]);
  sectionTitle(ws, "🟢 To'lovlar logi (sana va vaqt bilan)", 10);
  styleHeader(ws.addRow(['№', 'Sana', 'Vaqt', 'Hodim', 'Guruh', 'Telefon', "Yig'im", 'Summa', 'Usul', 'Qabul qildi']));
  pays.forEach((p, i) => {
    const dt = splitDT(p.created_at);
    const row = ws.addRow([i + 1, dt.date, dt.time, fullName(p), GROUPS[p.grp]?.label || '', fmtPhone(p.phone),
      p.col_title || 'Umumiy kassa', p.amount, plain(PAY_METHODS[p.method]).replace(/^\S+\s/, ''), P.adminName(p.accepted_by)]);
    row.getCell(8).numFmt = MONEY_FMT;
    row.eachCell((cell) => { cell.border = border; });
  });
  const tr = totalRow(ws, ['', '', '', 'JAMI', '', '', '', pays.reduce((s, p) => s + p.amount, 0), '', '']);
  tr.getCell(8).numFmt = MONEY_FMT;
  return ws;
}

function expensesSheet(wb) {
  const ws = wb.addWorksheet('Harajatlar', { views: [{ state: 'frozen', ySplit: 1 }] });
  styleHeader(ws.addRow(['№', 'Sana', 'Vaqt', 'Summa', 'Sabab', "Yig'im", 'Chek', 'Kiritdi']));
  [6, 13, 8, 15, 44, 28, 7, 22].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const list = db.expList();
  list.forEach((x, i) => {
    const dt = splitDT(x.created_at);
    const row = ws.addRow([i + 1, dt.date, dt.time, x.amount, x.reason, x.col_title || 'Umumiy kassa', x.photo_file_id ? 'Bor' : "Yo'q", P.adminName(x.created_by)]);
    row.getCell(4).numFmt = MONEY_FMT;
    row.getCell(5).alignment = { wrapText: true, vertical: 'top' };
    row.eachCell((cell) => { cell.border = border; });
  });
  const tr = totalRow(ws, ['', 'JAMI', '', list.reduce((s, x) => s + x.amount, 0), `${list.length} ta harajat`, '', '', '']);
  tr.getCell(4).numFmt = MONEY_FMT;
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 8 } };
  return ws;
}

/** 4 varaqli hisobot: Boshqarma, Shahar, Monitoring, Harajatlar */
async function buildReport() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Unicon Staff Bot';
  wb.created = new Date();
  groupSheet(wb, 'boshqarma');
  groupSheet(wb, 'shahar');
  monitoringSheet(wb);
  expensesSheet(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { buildReport };
