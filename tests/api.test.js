/**
 * API 集成测试 —— 跑真实 HTTP 服务 + 真实 SQLite 文件，不 mock 中间层。
 * 覆盖：公开提交、鉴权、越权拒绝、状态流转、产品 CRUD、输入校验、路径穿越防护。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';

const PASSWORD = 'testpass123';
let server, base, dataDir, token;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'bg-test-'));
  const app = await createApp({ dataDir, adminPassword: PASSWORD });
  server = app.server;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dataDir, { recursive: true, force: true });
});

async function api(path, { method = 'GET', body, auth = true, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  if (auth && token) h['Authorization'] = `Bearer ${token}`;
  const res = await fetch(base + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* 非 JSON 响应 */ }
  return { status: res.status, json, text, headers: res.headers };
}

/* ---------------- 健康检查 ---------------- */
test('GET /api/health 返回 ok', async () => {
  const r = await api('/api/health', { auth: false });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
});

/* ---------------- 公开询价提交 ---------------- */
test('POST /api/inquiries 无需登录即可提交', async () => {
  const r = await api('/api/inquiries', {
    method: 'POST', auth: false,
    body: { contact: '13800138000', need: '水果箱 5 层' },
  });
  assert.equal(r.status, 201);
  assert.ok(r.json.id > 0, '应返回新建 id');
  assert.equal(r.json.status, 'new');
});

test('POST /api/inquiries 联系方式为空时返回 400', async () => {
  const r = await api('/api/inquiries', { method: 'POST', auth: false, body: { contact: '   ' } });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /联系方式|contact/i);
});

test('POST /api/inquiries 拒绝超长输入', async () => {
  const r = await api('/api/inquiries', {
    method: 'POST', auth: false,
    body: { contact: 'a'.repeat(500) },
  });
  assert.equal(r.status, 400);
});

/* ---------------- 鉴权 ---------------- */
test('未登录读取询价列表返回 401', async () => {
  const r = await api('/api/inquiries', { auth: false });
  assert.equal(r.status, 401);
});

test('伪造 token 返回 401', async () => {
  const r = await api('/api/inquiries', { auth: false, headers: { Authorization: 'Bearer forged.token.value' } });
  assert.equal(r.status, 401);
});

test('错误密码登录返回 401', async () => {
  const r = await api('/api/auth/login', { method: 'POST', auth: false, body: { password: 'wrong' } });
  assert.equal(r.status, 401);
});

test('正确密码登录返回 token', async () => {
  const r = await api('/api/auth/login', { method: 'POST', auth: false, body: { password: PASSWORD } });
  assert.equal(r.status, 200);
  assert.ok(typeof r.json.token === 'string' && r.json.token.length > 20);
  token = r.json.token;
});

test('登录后可读取询价列表，且包含先前提交的记录', async () => {
  const r = await api('/api/inquiries');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.items));
  assert.ok(r.json.total >= 1);
  assert.ok(r.json.items.some((x) => x.contact === '13800138000'));
});

/* ---------------- 状态流转 ---------------- */
test('PATCH 状态可将询价标为已处理', async () => {
  const list = await api('/api/inquiries');
  const id = list.json.items[0].id;
  const r = await api(`/api/inquiries/${id}`, { method: 'PATCH', body: { status: 'replied' } });
  assert.equal(r.status, 200);
  const after = await api('/api/inquiries');
  assert.equal(after.json.items.find((x) => x.id === id).status, 'replied');
});

test('PATCH 非法状态返回 400', async () => {
  const list = await api('/api/inquiries');
  const r = await api(`/api/inquiries/${list.json.items[0].id}`, { method: 'PATCH', body: { status: 'bogus' } });
  assert.equal(r.status, 400);
});

test('DELETE 删除询价', async () => {
  const created = await api('/api/inquiries', { method: 'POST', auth: false, body: { contact: 'to-delete@x.com' } });
  const r = await api(`/api/inquiries/${created.json.id}`, { method: 'DELETE' });
  assert.equal(r.status, 204);
  const list = await api('/api/inquiries');
  assert.ok(!list.json.items.some((x) => x.id === created.json.id));
});

/* ---------------- 产品 CRUD ---------------- */
test('产品：创建 → 读取 → 更新 → 删除', async () => {
  const created = await api('/api/products', {
    method: 'POST',
    body: { name: '五层加重水果箱', category: '彩色瓦楞', spec: '600×400×300mm', moq: '500 只' },
  });
  assert.equal(created.status, 201);
  const id = created.json.id;

  const listed = await api('/api/products');
  assert.equal(listed.status, 200);
  assert.ok(listed.json.items.some((p) => p.id === id && p.name === '五层加重水果箱'));

  const patched = await api(`/api/products/${id}`, { method: 'PATCH', body: { moq: '300 只' } });
  assert.equal(patched.status, 200);
  const after = await api('/api/products');
  assert.equal(after.json.items.find((p) => p.id === id).moq, '300 只');

  const del = await api(`/api/products/${id}`, { method: 'DELETE' });
  assert.equal(del.status, 204);
  const final = await api('/api/products');
  assert.ok(!final.json.items.some((p) => p.id === id));
});

test('产品创建缺少名称返回 400', async () => {
  const r = await api('/api/products', { method: 'POST', body: { category: '礼盒' } });
  assert.equal(r.status, 400);
});

/* ---------------- 仪表盘统计 ---------------- */
test('GET /api/stats 返回计数', async () => {
  const r = await api('/api/stats');
  assert.equal(r.status, 200);
  assert.equal(typeof r.json.inquiriesTotal, 'number');
  assert.equal(typeof r.json.inquiriesNew, 'number');
  assert.equal(typeof r.json.productsTotal, 'number');
});

/* ---------------- 限流（回归：曾因 limiter 返回函数却按对象调用而 500） ---------------- */
test('同一 IP 连续提交超过阈值返回 429', async () => {
  const ip = { 'X-Forwarded-For': '10.9.9.9' }; // 独立 IP，避免影响其它用例
  let last;
  for (let i = 0; i < 12; i += 1) {
    last = await api('/api/inquiries', {
      method: 'POST', auth: false,
      body: { contact: `rate${i}@example.com` },
      headers: ip,
    });
  }
  assert.equal(last.status, 429);
  assert.match(last.json.error, /频繁/);
});

/* ---------------- 静态文件与安全 ---------------- */
test('GET / 返回官网首页', async () => {
  const r = await api('/', { auth: false });
  assert.equal(r.status, 200);
  assert.match(r.text, /博冠/);
});

test('GET /admin.html 返回后台页面', async () => {
  const r = await api('/admin.html', { auth: false });
  assert.equal(r.status, 200);
  assert.match(r.text, /<title>/i);
});

test('路径穿越无法读取项目外的文件', async () => {
  for (const p of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/package.json']) {
    const r = await api(p, { auth: false });
    assert.ok(r.status === 403 || r.status === 404, `${p} 应被拒绝，实际 ${r.status}`);
  }
});

test('未知 API 返回 404 JSON', async () => {
  const r = await api('/api/nope', { auth: false });
  assert.equal(r.status, 404);
  assert.ok(r.json && r.json.error);
});

/* ---------------- 登出后 token 失效 ---------------- */
test('登出后原 token 不可用', async () => {
  const saved = token;
  await api('/api/auth/logout', { method: 'POST' });
  const r = await api('/api/inquiries', { auth: false, headers: { Authorization: `Bearer ${saved}` } });
  assert.equal(r.status, 401);
  token = saved;
});
