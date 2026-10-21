/**
 * 博冠包装 —— 零依赖 Node 服务
 * HTTP 路由 + 静态文件 + 鉴权中间件 + 限流，全部基于 node: 内置模块。
 *
 * 启动：node server/index.js
 * 环境变量：
 *   PORT             监听端口（默认 3000）
 *   ADMIN_PASSWORD   后台密码（首次启动时写入，之后以数据库为准）
 *   ALLOWED_ORIGIN   允许跨域的主站来源（默认 *，仅作用于公开接口）
 *   DATA_DIR         数据库目录（默认 ./data）
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, sep, extname, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  openDb, getSetting, setSetting, INQUIRY_STATUS,
  createInquiry, listInquiries, updateInquiryStatus, deleteInquiry,
  listProducts, createProduct, updateProduct, deleteProduct,
  stats, revokeToken, isRevoked,
} from './db.js';
import { hashPassword, verifyPassword, createTokenizer } from './auth.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

/* ---------------- 静态文件白名单 ---------------- */
// 只服务站点自身需要的文件，其余（package.json / server / tests / data）一律 404。
const PUBLIC_FILES = new Set([
  '/index.html', '/admin.html', '/styles.css', '/main.js', '/admin.css', '/admin.js',
  '/favicon.ico', '/robots.txt', '/site.webmanifest', '/.nojekyll',
]);
const ASSET_RE = /^\/assets\/[\w.-]+\.(webp|png|jpe?g|gif|ico|svg)$/i;

function isPublicPath(pathname) {
  return PUBLIC_FILES.has(pathname) || ASSET_RE.test(pathname);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/* ---------------- 小工具 ---------------- */
function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

function readBody(req, limit = 32 * 1024) {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolvePromise({});
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return reject(Object.assign(new Error('body must be a JSON object'), { status: 400 }));
        }
        resolvePromise(parsed);
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function createRateLimiter({ windowMs = 60_000, max = 10 } = {}) {
  const hits = new Map();
  function allow(key) {
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || now > rec.reset) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return true;
    }
    rec.count += 1;
    if (hits.size > 5000) hits.clear(); // 防内存膨胀
    return rec.count <= max;
  }
  return { allow };
}

const str = (v, max = 200) => (v === undefined || v === null ? '' : String(v).trim().slice(0, max));
const clientIp = (req) =>
  (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';

/* ---------------- 应用工厂 ---------------- */
export async function createApp(options = {}) {
  const {
    dataDir = process.env.DATA_DIR || resolve(ROOT, 'data'),
    adminPassword,
    rateLimit = true,
    sessionTtl = 12 * 3600,
  } = options;

  const db = openDb(dataDir);

  // 会话密钥：持久化到文件，重启后已有 token 仍有效
  mkdirSync(dataDir, { recursive: true });
  const secretFile = resolve(dataDir, '.session-secret');
  let secret;
  if (existsSync(secretFile)) {
    secret = readFileSync(secretFile, 'utf8').trim();
  } else {
    secret = randomBytes(32).toString('hex');
    writeFileSync(secretFile, secret, { mode: 0o600 });
  }
  const tokenizer = createTokenizer(secret);

  // 密码优先级：显式参数 / 环境变量（每次都覆盖，作为重置手段）> 数据库已有 > 随机生成
  // 注意：这里只决定"待写入什么密码"，真正的落盘推迟到端口监听成功之后，
  // 避免端口被占用导致启动失败、却已经悄悄改了密码。
  let generatedPassword = null;
  let passwordSource = 'existing';
  let pendingPassword = null;
  const explicitPassword = adminPassword || process.env.ADMIN_PASSWORD;
  if (explicitPassword) {
    pendingPassword = explicitPassword;
    passwordSource = 'explicit';
  } else if (!getSetting(db, 'admin_password')) {
    generatedPassword = randomBytes(9).toString('base64url');
    pendingPassword = generatedPassword;
    passwordSource = 'generated';
  }

  const submitLimiter = createRateLimiter({ windowMs: 60_000, max: 10 });
  const loginLimiter = createRateLimiter({ windowMs: 5 * 60_000, max: 5 });
  const allowOrigin = process.env.ALLOWED_ORIGIN || '*';

  function authOf(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = tokenizer.verify(token);
    if (!payload) return null;
    if (payload.jti && isRevoked(db, payload.jti)) return null;
    return { payload, token };
  }

  /* ---------- 路由表 ---------- */
  async function handleApi(req, res, url) {
    const { pathname } = url;
    const method = req.method;
    const parts = pathname.split('/').filter(Boolean); // ['api', 'inquiries', '12']
    const route = parts[1] || '';
    const id = parts[2] ? Number.parseInt(parts[2], 10) : null;
    const isPublic = route === 'health' || (route === 'inquiries' && method === 'POST') ||
      (route === 'auth' && parts[2] === 'login') || (route === 'products' && method === 'GET');

    if (isPublic) {
      res.setHeader('Access-Control-Allow-Origin', allowOrigin);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Max-Age': '86400' });
      return res.end();
    }

    // ---- 公开 ----
    if (route === 'health' && method === 'GET') {
      return sendJson(res, 200, { ok: true, time: new Date().toISOString() });
    }

    if (route === 'inquiries' && method === 'POST') {
      const ip = clientIp(req);
      if (rateLimit && !submitLimiter.allow(ip)) {
        return sendJson(res, 429, { error: '提交过于频繁，请稍后再试' });
      }
      const body = await readBody(req);
      // 超长输入直接拒绝，不静默截断——否则用户以为提交了完整内容
      if (String(body.contact ?? '').trim().length > 120) {
        return sendJson(res, 400, { error: '联系方式过长（最多 120 字）' });
      }
      if (String(body.need ?? '').length > 1000) {
        return sendJson(res, 400, { error: '需求描述过长（最多 1000 字）' });
      }
      const contact = str(body.contact, 120);
      const need = str(body.need, 1000);
      if (!contact) return sendJson(res, 400, { error: '请填写联系方式（电话或邮箱）' });
      if (contact.length < 3) return sendJson(res, 400, { error: '联系方式格式不正确' });
      if (!/^[\w.@+\-\s()（）]{3,120}$/.test(contact)) {
        return sendJson(res, 400, { error: '联系方式格式不正确' });
      }
      const row = createInquiry(db, {
        contact, need,
        source: str(body.source, 40) || 'web',
        ua: str(req.headers['user-agent'], 300),
        ip: str(ip, 60),
      });
      return sendJson(res, 201, { id: row.id, status: row.status, createdAt: row.created_at });
    }

    if (route === 'auth' && parts[2] === 'login' && method === 'POST') {
      const ip = clientIp(req);
      if (rateLimit && !loginLimiter.allow(ip)) {
        return sendJson(res, 429, { error: '尝试次数过多，请 5 分钟后再试' });
      }
      const body = await readBody(req);
      const password = String(body.password || '');
      const stored = getSetting(db, 'admin_password');
      if (!password || !verifyPassword(password, stored)) {
        return sendJson(res, 401, { error: '密码错误' });
      }
      const token = tokenizer.sign({ role: 'admin' }, sessionTtl);
      return sendJson(res, 200, { token, expiresIn: sessionTtl });
    }

    // ---- 以下需要鉴权 ----
    // 先确认路径属于已知受保护资源：不存在的接口直接 404，
    // 不要先吐 401（否则会让人误以为"这个接口存在只是没登录"）。
    if (!new Set(['inquiries', 'products', 'stats', 'auth']).has(route)) {
      return sendJson(res, 404, { error: '接口不存在' });
    }
    const auth = authOf(req);
    if (!auth) return sendJson(res, 401, { error: '未登录或登录已过期' });

    if (route === 'auth' && parts[2] === 'logout' && method === 'POST') {
      const { payload } = auth;
      if (payload.jti) revokeToken(db, payload.jti, payload.exp);
      return sendJson(res, 200, { ok: true });
    }

    if (route === 'inquiries' && method === 'GET') {
      const status = url.searchParams.get('status') || '';
      const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);
      const offset = Math.max(Number.parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);
      return sendJson(res, 200, listInquiries(db, { status, limit, offset }));
    }

    if (route === 'inquiries' && method === 'PATCH' && id) {
      const body = await readBody(req);
      const status = str(body.status, 20);
      if (!INQUIRY_STATUS.includes(status)) {
        return sendJson(res, 400, { error: `状态必须是 ${INQUIRY_STATUS.join(' / ')}` });
      }
      if (!updateInquiryStatus(db, id, status)) return sendJson(res, 404, { error: '记录不存在' });
      return sendJson(res, 200, { id, status });
    }

    if (route === 'inquiries' && method === 'DELETE' && id) {
      if (!deleteInquiry(db, id)) return sendJson(res, 404, { error: '记录不存在' });
      res.writeHead(204);
      return res.end();
    }

    if (route === 'products' && method === 'GET') {
      return sendJson(res, 200, { items: listProducts(db, { includeInactive: true }) });
    }

    if (route === 'products' && method === 'POST') {
      const body = await readBody(req);
      const name = str(body.name, 120);
      if (!name) return sendJson(res, 400, { error: '产品名称不能为空' });
      const row = createProduct(db, { ...body, name });
      return sendJson(res, 201, row);
    }

    if (route === 'products' && method === 'PATCH' && id) {
      const body = await readBody(req);
      if (body.name !== undefined && !str(body.name, 120)) {
        return sendJson(res, 400, { error: '产品名称不能为空' });
      }
      if (!updateProduct(db, id, body)) return sendJson(res, 404, { error: '产品不存在或没有可更新字段' });
      return sendJson(res, 200, listProducts(db, { includeInactive: true }).find((p) => p.id === id));
    }

    if (route === 'products' && method === 'DELETE' && id) {
      if (!deleteProduct(db, id)) return sendJson(res, 404, { error: '产品不存在' });
      res.writeHead(204);
      return res.end();
    }

    if (route === 'stats' && method === 'GET') {
      return sendJson(res, 200, stats(db));
    }

    return sendJson(res, 404, { error: '接口不存在' });
  }

  /* ---------- 静态文件 ---------- */
  async function handleStatic(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return sendJson(res, 400, { error: 'Bad Request' });
    }
    if (pathname === '/') pathname = '/index.html';
    if (pathname.includes('\0') || pathname.includes('..') || !isPublicPath(pathname)) {
      return sendJson(res, 404, { error: 'Not Found' });
    }
    const filePath = resolve(ROOT, '.' + pathname);
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
      return sendJson(res, 403, { error: 'Forbidden' });
    }
    try {
      const info = await stat(filePath);
      if (!info.isFile()) return sendJson(res, 404, { error: 'Not Found' });
      const data = await readFile(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': data.length,
        'Cache-Control': extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(req.method === 'HEAD' ? undefined : data);
    } catch {
      return sendJson(res, 404, { error: 'Not Found' });
    }
  }

  /* ---------- 请求入口 ---------- */
  const server = http.createServer(async (req, res) => {
    let url;
    try {
      url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    } catch {
      return sendJson(res, 400, { error: 'Bad Request' });
    }
    try {
      if (url.pathname.startsWith('/api/')) {
        return await handleApi(req, res, url);
      }
      return await handleStatic(req, res, url);
    } catch (err) {
      const status = err && err.status ? err.status : 500;
      if (status >= 500) console.error('[server]', err);
      if (!res.headersSent) {
        sendJson(res, status, { error: status === 500 ? '服务器内部错误' : err.message });
      } else {
        res.end();
      }
    }
  });

  // 端口真正监听成功后才落盘密码。若 listen 抛 EADDRINUSE，
  // 'listening' 不会触发，数据库保持原样——不会出现"启动失败但密码已被改"。
  server.once('listening', () => {
    if (pendingPassword) {
      setSetting(db, 'admin_password', hashPassword(pendingPassword));
      pendingPassword = null;
    }
  });

  return { server, db, tokenizer, generatedPassword, passwordSource };
}

/* ---------------- 直接运行 ---------------- */
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const port = Number.parseInt(process.env.PORT || '3000', 10);
  const { server, generatedPassword, passwordSource } = await createApp();
  server.listen(port, () => {
    console.log(`\n  博冠包装服务已启动`);
    console.log(`  官网      http://localhost:${port}/`);
    console.log(`  后台      http://localhost:${port}/admin.html`);
    if (generatedPassword) {
      console.log(`\n  已生成后台初始密码：${generatedPassword}`);
      console.log(`  仅显示这一次，请立即保存。忘了可用 ADMIN_PASSWORD=新密码 npm start 重置。\n`);
    } else if (passwordSource === 'explicit') {
      console.log(`  后台密码：已按 ADMIN_PASSWORD 设为你这次传入的值\n`);
    } else {
      console.log(`  后台密码：沿用数据库中已有的密码`);
      console.log(`  忘了密码就执行：ADMIN_PASSWORD=新密码 npm start\n`);
    }
  });
}
