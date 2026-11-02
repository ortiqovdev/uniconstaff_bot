const fs = require('node:fs');
const path = require('node:path');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  SUPER_ADMIN_IDS: list(process.env.SUPER_ADMIN_IDS).map(Number).filter(Boolean),
  ADMIN_COMMAND: (process.env.ADMIN_COMMAND || 'admin').replace(/^\//, ''),
  REMINDER_TIMES: list(process.env.REMINDER_TIMES || '10:00,18:00'),
  // Kunlik zaxira nusxa super adminlarga (bo'sh qoldirilsa — o'chiriladi)
  BACKUP_TIME: process.env.BACKUP_TIME === undefined ? '23:00' : process.env.BACKUP_TIME.trim(),
  TZ_OFFSET_MIN: Number(process.env.TZ_OFFSET_MIN || 300),
  COMPANY: process.env.COMPANY_NAME || 'Unicon Soft',
  PAY_INFO_DEFAULT: "Karta: 9860 3501 4183 1536\\nEgasi: Ortiqov Akmal",
  DB_PATH: path.resolve(__dirname, '..', process.env.DB_PATH || 'data/unicon.db'),
};
