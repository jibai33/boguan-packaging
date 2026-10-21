/**
 * SQLite 数据层 —— 用 Node 内置 node:sqlite，无任何 npm 依赖。
 * 表结构在启动时幂等创建；所有查询走 prepare 占位符，不拼接 SQL。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS inquiries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  contact    TEXT NOT NULL,
  need       TEXT NOT NULL DEFAULT '',
  source     TEXT NOT NULL DEFAULT 'web',
  status     TEXT NOT NULL DEFAULT 'new',
  ua         TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_inq_status  ON inquiries(status);
CREATE INDEX IF NOT EXISTS idx_inq_created ON inquiries(created_at DESC);

CREATE TABLE IF NOT EXISTS products (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL DEFAULT '',
  spec       TEXT NOT NULL DEFAULT '',
  moq        TEXT NOT NULL DEFAULT '',
  price      TEXT NOT NULL DEFAULT '',
  lead_time  TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  sort       INTEGER NOT NULL DEFAULT 0,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti TEXT PRIMARY KEY,
  exp INTEGER NOT NULL
);
`;

export const INQUIRY_STATUS = ['new', 'read', 'replied', 'archived'];

export function openDb(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'app.db'));
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(SCHEMA);
  return db;
}

export function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
}

/* ---------------- 询价 ---------------- */
export function createInquiry(db, { contact, need = '', source = 'web', ua = '', ip = '' }) {
  const info = db.prepare(
    'INSERT INTO inquiries (contact, need, source, ua, ip) VALUES (?, ?, ?, ?, ?)'
  ).run(contact, need, source, ua, ip);
  return db.prepare('SELECT * FROM inquiries WHERE id = ?').get(Number(info.lastInsertRowid));
}

export function listInquiries(db, { status = '', limit = 50, offset = 0 } = {}) {
  const where = status && INQUIRY_STATUS.includes(status) ? 'WHERE status = ?' : '';
  const args = where ? [status] : [];
  const total = db.prepare(`SELECT COUNT(*) AS n FROM inquiries ${where}`).get(...args).n;
  const items = db.prepare(
    `SELECT * FROM inquiries ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...args, limit, offset);
  return { items, total };
}

export function updateInquiryStatus(db, id, status) {
  const info = db.prepare(
    "UPDATE inquiries SET status = ?, updated_at = datetime('now','localtime') WHERE id = ?"
  ).run(status, id);
  return info.changes > 0;
}

export function deleteInquiry(db, id) {
  return db.prepare('DELETE FROM inquiries WHERE id = ?').run(id).changes > 0;
}

/* ---------------- 产品 ---------------- */
const PRODUCT_FIELDS = ['name', 'category', 'spec', 'moq', 'price', 'lead_time', 'note', 'sort', 'active'];

export function listProducts(db, { includeInactive = false } = {}) {
  const where = includeInactive ? '' : 'WHERE active = 1';
  return db.prepare(`SELECT * FROM products ${where} ORDER BY sort ASC, id ASC`).all();
}

export function createProduct(db, data) {
  const values = PRODUCT_FIELDS.map((f) => normalizeProductField(f, data[f]));
  const info = db.prepare(
    `INSERT INTO products (${PRODUCT_FIELDS.join(', ')}) VALUES (${PRODUCT_FIELDS.map(() => '?').join(', ')})`
  ).run(...values);
  return db.prepare('SELECT * FROM products WHERE id = ?').get(Number(info.lastInsertRowid));
}

export function updateProduct(db, id, data) {
  const fields = PRODUCT_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(data, f));
  if (!fields.length) return false;
  const sets = fields.map((f) => `${f} = ?`).join(', ');
  const values = fields.map((f) => normalizeProductField(f, data[f]));
  const info = db.prepare(
    `UPDATE products SET ${sets}, updated_at = datetime('now','localtime') WHERE id = ?`
  ).run(...values, id);
  return info.changes > 0;
}

export function deleteProduct(db, id) {
  return db.prepare('DELETE FROM products WHERE id = ?').run(id).changes > 0;
}

function normalizeProductField(field, value) {
  if (field === 'sort') {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : 0;
  }
  if (field === 'active') {
    return value === 0 || value === '0' || value === false ? 0 : 1;
  }
  return value === undefined || value === null ? '' : String(value).slice(0, 500);
}

/* ---------------- 统计 ---------------- */
export function stats(db) {
  return {
    inquiriesTotal: db.prepare('SELECT COUNT(*) AS n FROM inquiries').get().n,
    inquiriesNew: db.prepare("SELECT COUNT(*) AS n FROM inquiries WHERE status = 'new'").get().n,
    inquiriesToday: db.prepare("SELECT COUNT(*) AS n FROM inquiries WHERE date(created_at) = date('now','localtime')").get().n,
    productsTotal: db.prepare('SELECT COUNT(*) AS n FROM products').get().n,
  };
}

/* ---------------- token 吊销 ---------------- */
export function revokeToken(db, jti, exp) {
  db.prepare('INSERT OR IGNORE INTO revoked_tokens (jti, exp) VALUES (?, ?)').run(jti, exp);
  db.prepare('DELETE FROM revoked_tokens WHERE exp < ?').run(Math.floor(Date.now() / 1000) - 60);
}

export function isRevoked(db, jti) {
  return !!db.prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?').get(jti);
}
