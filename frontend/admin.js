/* ==========================================================================
   博冠包装 · 后台交互
   纯原生 JS，无框架。所有用户输入一律通过 textContent / DOM API 渲染，
   不用 innerHTML 拼接——询价内容来自外部提交，必须当成不可信数据。
   ========================================================================== */
(function () {
  'use strict';

  const TOKEN_KEY = 'bg_admin_token';
  const STATUS_LABEL = { new: '待处理', read: '已查看', replied: '已回复', archived: '已归档' };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  let token = sessionStorage.getItem(TOKEN_KEY) || '';
  let currentView = 'overview';
  let products = [];

  /* ---------------- API ---------------- */
  async function api(path, { method = 'GET', body, auth = true } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401 && auth) {
      signOut(true);
      throw new Error('登录已过期，请重新登录');
    }
    if (res.status === 204) return null;

    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) throw new Error((data && data.error) || `请求失败（${res.status}）`);
    return data;
  }

  /* ---------------- 提示 ---------------- */
  let toastTimer = null;
  function toast(message, isError) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.toggle('is-error', !!isError);
    node.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('is-on'), 2400);
  }

  /* ---------------- 登录态 ---------------- */
  function showApp() {
    $('#loginView').hidden = true;
    $('#loginView').style.display = 'none';
    $('#appView').hidden = false;
    loadView(currentView);
  }

  function signOut(silent) {
    token = '';
    sessionStorage.removeItem(TOKEN_KEY);
    $('#appView').hidden = true;
    $('#loginView').style.display = '';
    $('#loginView').hidden = false;
    $('#password').value = '';
    if (!silent) toast('已退出登录');
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#loginBtn');
    const err = $('#loginError');
    const password = $('#password').value;
    if (!password) { err.textContent = '请输入密码'; return; }

    btn.disabled = true;
    btn.textContent = '登录中…';
    err.textContent = '';
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: { password }, auth: false });
      token = data.token;
      sessionStorage.setItem(TOKEN_KEY, token);
      showApp();
      toast('已登录');
    } catch (ex) {
      err.textContent = ex.message;
      $('#password').select();
    } finally {
      btn.disabled = false;
      btn.textContent = '登录';
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* 忽略：本地照常清掉 */ }
    signOut();
  });

  /* ---------------- 视图切换 ---------------- */
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentView = btn.dataset.view;
      document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('is-active', b === btn));
      document.querySelectorAll('.view').forEach((v) => { v.hidden = v.id !== `view-${currentView}`; });
      loadView(currentView);
    });
  });

  function loadView(view) {
    if (!token) return;
    if (view === 'overview') loadOverview();
    if (view === 'inquiries') loadInquiries();
    if (view === 'products') loadProducts();
  }

  /* ---------------- 概览 ---------------- */
  async function loadOverview() {
    const label = $('#todayLabel');
    label.textContent = new Date().toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    });
    try {
      const s = await api('/api/stats');
      const cards = [
        { num: s.inquiriesToday, label: '今日新增询价', accent: true },
        { num: s.inquiriesNew, label: '待处理' },
        { num: s.inquiriesTotal, label: '询价总数' },
        { num: s.productsTotal, label: '产品条目' },
      ];
      const box = $('#statCards');
      box.textContent = '';
      cards.forEach((c) => {
        const card = el('div', 'card' + (c.accent ? ' card--accent' : ''));
        card.append(el('span', 'card__num', String(c.num)), el('span', 'card__label', c.label));
        box.append(card);
      });
      updateBadge(s.inquiriesNew);
      await loadRecent();
    } catch (ex) {
      toast(ex.message, true);
    }
  }

  async function loadRecent() {
    const list = $('#recentList');
    try {
      const data = await api('/api/inquiries?limit=5');
      list.textContent = '';
      if (!data.items.length) {
        list.append(el('li', 'empty', '还没有询价记录'));
        return;
      }
      data.items.forEach((item) => {
        const li = el('li');
        li.append(
          el('time', null, shortTime(item.created_at)),
          el('span', 'need', item.need || '（未填写需求）'),
          statusBadge(item.status),
        );
        list.append(li);
      });
    } catch (ex) {
      list.textContent = '';
      list.append(el('li', 'empty', ex.message));
    }
  }

  function updateBadge(n) {
    const badge = $('#navBadge');
    badge.textContent = String(n);
    badge.hidden = !n;
  }

  /* ---------------- 询价 ---------------- */
  async function loadInquiries() {
    const body = $('#inquiryBody');
    const empty = $('#inquiryEmpty');
    const status = $('#statusFilter').value;
    try {
      const data = await api('/api/inquiries?limit=200' + (status ? `&status=${encodeURIComponent(status)}` : ''));
      body.textContent = '';
      $('#inquiryCount').textContent = `共 ${data.total} 条${status ? `（${STATUS_LABEL[status]}）` : ''}`;
      empty.hidden = data.items.length > 0;

      data.items.forEach((item) => {
        const tr = el('tr');
        tr.append(
          el('td', 'time', shortTime(item.created_at)),
          el('td', 'contact', item.contact),
          el('td', 'need-cell', item.need || '—'),
        );

        const statusCell = el('td');
        statusCell.append(statusBadge(item.status));
        tr.append(statusCell);

        const actions = el('td');
        const wrap = el('div', 'actions');

        if (item.status !== 'replied') {
          const mark = el('button', 'btn btn--sm', '标记已回复');
          mark.type = 'button';
          mark.addEventListener('click', () => setStatus(item.id, 'replied', mark));
          wrap.append(mark);
        }
        if (item.status === 'new') {
          const read = el('button', 'btn btn--sm', '已读');
          read.type = 'button';
          read.addEventListener('click', () => setStatus(item.id, 'read', read));
          wrap.append(read);
        }
        const del = el('button', 'btn btn--sm btn--danger', '删除');
        del.type = 'button';
        del.addEventListener('click', () => removeInquiry(item.id, item.contact, del));
        wrap.append(del);

        actions.append(wrap);
        tr.append(actions);
        body.append(tr);
      });
    } catch (ex) {
      toast(ex.message, true);
    }
  }

  async function setStatus(id, status, btn) {
    btn.disabled = true;
    try {
      await api(`/api/inquiries/${id}`, { method: 'PATCH', body: { status } });
      toast(`已标记为「${STATUS_LABEL[status]}」`);
      loadInquiries();
      refreshBadge();
    } catch (ex) {
      toast(ex.message, true);
      btn.disabled = false;
    }
  }

  async function removeInquiry(id, contact, btn) {
    if (!window.confirm(`删除来自「${contact}」的询价？此操作不可撤销。`)) return;
    btn.disabled = true;
    try {
      await api(`/api/inquiries/${id}`, { method: 'DELETE' });
      toast('已删除');
      loadInquiries();
      refreshBadge();
    } catch (ex) {
      toast(ex.message, true);
      btn.disabled = false;
    }
  }

  async function refreshBadge() {
    try {
      const s = await api('/api/stats');
      updateBadge(s.inquiriesNew);
    } catch { /* 角标不是关键路径，失败静默 */ }
  }

  $('#statusFilter').addEventListener('change', loadInquiries);
  $('#refreshInquiries').addEventListener('click', loadInquiries);
  $('#refreshStats').addEventListener('click', loadOverview);

  /* ---------------- 产品 ---------------- */
  async function loadProducts() {
    const body = $('#productBody');
    const empty = $('#productEmpty');
    try {
      const data = await api('/api/products');
      products = data.items;
      body.textContent = '';
      empty.hidden = products.length > 0;

      products.forEach((p) => {
        const tr = el('tr');
        tr.append(
          el('td', null, p.name),
          el('td', null, p.category || '—'),
          el('td', 'need-cell', p.spec || '—'),
          el('td', null, p.moq || '—'),
        );
        const activeCell = el('td');
        activeCell.append(el('span', `badge badge--${p.active ? 'on' : 'off'}`, p.active ? '可见' : '隐藏'));
        tr.append(activeCell);

        const actions = el('td');
        const wrap = el('div', 'actions');
        const editBtn = el('button', 'btn btn--sm', '编辑');
        editBtn.type = 'button';
        editBtn.addEventListener('click', () => openProductModal(p));
        const delBtn = el('button', 'btn btn--sm btn--danger', '删除');
        delBtn.type = 'button';
        delBtn.addEventListener('click', () => removeProduct(p, delBtn));
        wrap.append(editBtn, delBtn);
        actions.append(wrap);
        tr.append(actions);
        body.append(tr);
      });
    } catch (ex) {
      toast(ex.message, true);
    }
  }

  const modal = $('#productModal');

  function openProductModal(product) {
    $('#productModalTitle').textContent = product ? '编辑产品' : '新增产品';
    $('#productError').textContent = '';
    $('#pId').value = product ? product.id : '';
    $('#pName').value = product ? product.name : '';
    $('#pCategory').value = product ? product.category : '';
    $('#pSpec').value = product ? product.spec : '';
    $('#pMoq').value = product ? product.moq : '';
    $('#pPrice').value = product ? product.price : '';
    $('#pLead').value = product ? product.lead_time : '';
    $('#pNote').value = product ? product.note : '';
    $('#pActive').checked = product ? !!product.active : true;
    modal.showModal();
    $('#pName').focus();
  }

  $('#newProductBtn').addEventListener('click', () => openProductModal(null));

  $('#saveProductBtn').addEventListener('click', async () => {
    const err = $('#productError');
    const name = $('#pName').value.trim();
    if (!name) { err.textContent = '产品名称不能为空'; $('#pName').focus(); return; }

    const payload = {
      name,
      category: $('#pCategory').value.trim(),
      spec: $('#pSpec').value.trim(),
      moq: $('#pMoq').value.trim(),
      price: $('#pPrice').value.trim(),
      lead_time: $('#pLead').value.trim(),
      note: $('#pNote').value.trim(),
      active: $('#pActive').checked ? 1 : 0,
    };
    const id = $('#pId').value;
    const btn = $('#saveProductBtn');
    btn.disabled = true;
    try {
      if (id) {
        await api(`/api/products/${id}`, { method: 'PATCH', body: payload });
        toast('已保存');
      } else {
        await api('/api/products', { method: 'POST', body: payload });
        toast('已新增');
      }
      modal.close();
      loadProducts();
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });

  async function removeProduct(product, btn) {
    if (!window.confirm(`删除产品「${product.name}」？`)) return;
    btn.disabled = true;
    try {
      await api(`/api/products/${product.id}`, { method: 'DELETE' });
      toast('已删除');
      loadProducts();
    } catch (ex) {
      toast(ex.message, true);
      btn.disabled = false;
    }
  }

  /* ---------------- 小工具 ---------------- */
  function statusBadge(status) {
    const span = el('span', `badge badge--${status}`, STATUS_LABEL[status] || status);
    return span;
  }

  function shortTime(value) {
    if (!value) return '—';
    // 数据库存的是 'YYYY-MM-DD HH:MM:SS'
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!m) return value;
    const [, , mo, d, hh, mm] = m;
    return `${mo}-${d} ${hh}:${mm}`;
  }

  /* ---------------- 启动 ---------------- */
  if (token) showApp();
})();
