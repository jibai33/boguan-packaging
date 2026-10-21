/* 博冠包装 BOGUAN — 交互层
   纯原生 JS，无依赖。职责：滚动揭示、导航状态、移动菜单、数字计数、
   hero 视差、询价校验、搜索。所有动效尊重 prefers-reduced-motion。 */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var supportsIO = 'IntersectionObserver' in window;

  /* ---------------- 1. 滚动揭示 ---------------- */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  // 同组元素错峰入场
  ['.promos', '.stats', '.steps', '.certs'].forEach(function (sel) {
    var group = document.querySelector(sel);
    if (!group) return;
    Array.prototype.forEach.call(group.children, function (child, i) {
      if (child.classList.contains('reveal')) {
        child.style.setProperty('--d', (i * 90) + 'ms');
      }
    });
  });

  if (supportsIO && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add('is-in'); });
  }

  // hero 首屏：不依赖 observer，进场即播，带轻错峰
  window.requestAnimationFrame(function () {
    document.querySelectorAll('.hero .reveal').forEach(function (el, i) {
      window.setTimeout(function () { el.classList.add('is-in'); }, 90 + i * 110);
    });
  });

  /* ---------------- 2. 导航滚动态 ---------------- */
  var nav = document.getElementById('nav');
  var lastY = -1;
  function onScroll() {
    var y = window.scrollY || window.pageYOffset;
    if (y === lastY) return;
    lastY = y;
    if (nav) nav.classList.toggle('is-scrolled', y > 8);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------------- 3. 移动端抽屉 ---------------- */
  var burger = document.getElementById('burger');
  var drawer = document.getElementById('drawer');

  function setDrawer(open) {
    if (!burger || !drawer) return;
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
    drawer.hidden = !open;
    document.body.style.overflow = open ? 'hidden' : '';
  }

  if (burger && drawer) {
    burger.addEventListener('click', function () {
      setDrawer(drawer.hidden);
    });
    drawer.addEventListener('click', function (e) {
      if (e.target.closest('a')) setDrawer(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !drawer.hidden) {
        setDrawer(false);
        burger.focus();
      }
    });
    // 视口变宽时自动收起，避免残留隐藏状态
    window.addEventListener('resize', function () {
      if (window.innerWidth > 734 && !drawer.hidden) setDrawer(false);
    });
  }

  /* ---------------- 4. 数字计数 ---------------- */
  function animateCount(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    var decimals = parseInt(el.getAttribute('data-decimals') || '0', 10);
    if (isNaN(target)) return;
    // 年份这类本身是标识符的数字不做计数动画（数到一半是噪音，不是信息）
    if (el.hasAttribute('data-static') || reduceMotion) {
      el.textContent = target.toFixed(decimals);
      return;
    }

    var dur = 1500;
    var start = null;
    function frame(t) {
      if (start === null) start = t;
      var p = Math.min(1, (t - start) / dur);
      var eased = 1 - Math.pow(1 - p, 4);          // easeOutQuart
      el.textContent = (target * eased).toFixed(decimals);
      if (p < 1) window.requestAnimationFrame(frame);
      else el.textContent = target.toFixed(decimals);
    }
    window.requestAnimationFrame(frame);
  }

  var counters = Array.prototype.slice.call(document.querySelectorAll('[data-count]'));
  if (counters.length) {
    if (supportsIO && !reduceMotion) {
      var cio = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            animateCount(entry.target);
            cio.unobserve(entry.target);
          }
        });
      }, { threshold: 0.6 });
      counters.forEach(function (el) { cio.observe(el); });
    } else {
      counters.forEach(function (el) {
        var d = parseInt(el.getAttribute('data-decimals') || '0', 10);
        el.textContent = parseFloat(el.getAttribute('data-count')).toFixed(d);
      });
    }
  }

  /* ---------------- 5. hero 指针视差 ---------------- */
  var hero = document.querySelector('.hero');
  var heroFloat = document.getElementById('heroFloat');
  if (hero && heroFloat && !reduceMotion && window.matchMedia('(hover: hover)').matches) {
    var raf = null, tx = 0, ty = 0;
    hero.addEventListener('mousemove', function (e) {
      var r = hero.getBoundingClientRect();
      tx = ((e.clientX - r.left) / r.width - 0.5) * 18;
      ty = ((e.clientY - r.top) / r.height - 0.5) * 12;
      if (raf) return;
      raf = window.requestAnimationFrame(function () {
        heroFloat.style.setProperty('--px', tx.toFixed(1) + 'px');
        heroFloat.style.setProperty('--py', ty.toFixed(1) + 'px');
        raf = null;
      });
    });
    hero.addEventListener('mouseleave', function () {
      heroFloat.style.setProperty('--px', '0px');
      heroFloat.style.setProperty('--py', '0px');
    });
  }

  /* ---------------- 6. 询价表单 ---------------- */
  var form = document.getElementById('quoteForm');
  var hint = document.getElementById('quoteHint');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var contact = form.querySelector('#qContact');
      var value = (contact.value || '').trim();
      var okEmail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
      var okPhone = /^[\d\s\-+()]{7,20}$/.test(value);

      if (!value || (!okEmail && !okPhone)) {
        contact.setAttribute('aria-invalid', 'true');
        if (hint) hint.textContent = '请填写有效的电话或邮箱，我们才能把样品寄给你。';
        contact.focus();
        return;
      }
      contact.removeAttribute('aria-invalid');
      if (hint) hint.textContent = '已收到。48 小时内会有工程师与你联系，并寄出实物样品。';
      form.reset();
    });
    var contactInput = form.querySelector('#qContact');
    if (contactInput) {
      contactInput.addEventListener('input', function () {
        contactInput.removeAttribute('aria-invalid');
        if (hint) hint.textContent = '';
      });
    }
  }

  /* ---------------- 7. 搜索 ---------------- */
  var searchBtn = document.getElementById('searchBtn');
  if (searchBtn) {
    searchBtn.addEventListener('click', function () {
      openSearch();
    });
  }

  function openSearch() {
    if (document.getElementById('searchLayer')) return;
    var layer = document.createElement('div');
    layer.id = 'searchLayer';
    layer.style.cssText =
      'position:fixed;inset:0;z-index:150;background:rgba(251,250,247,.94);' +
      '-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px);' +
      'display:flex;align-items:flex-start;justify-content:center;padding:14vh 24px;' +
      'animation:drawerIn .35s cubic-bezier(.28,.11,.32,1) both;';
    layer.innerHTML =
      '<div style="width:min(680px,100%)">' +
        '<label class="sr-only" for="searchInput">搜索产品与方案</label>' +
        '<input id="searchInput" type="search" placeholder="搜索：瓦楞 / 礼盒 / 打样 …" ' +
          'style="width:100%;height:56px;padding:0 22px;font-size:20px;border-radius:16px;' +
          'border:1px solid #e6e0d5;background:#fff;color:#1d1d1f;outline:none">' +
        '<p style="margin-top:14px;font-size:12px;letter-spacing:.1em;color:#8e8e93;' +
          'text-transform:uppercase">按 Esc 关闭 · 演示站点，搜索未接入后端</p>' +
      '</div>';

    document.body.appendChild(layer);
    document.body.style.overflow = 'hidden';
    var input = layer.querySelector('#searchInput');
    input.focus();

    function close() {
      layer.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', onKey);
      if (searchBtn) searchBtn.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
    }
    layer.addEventListener('click', function (e) {
      if (e.target === layer) close();
    });
    document.addEventListener('keydown', onKey);
  }

  /* ---------------- 8. 锚点跳转补偿固定导航 ---------------- */
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var id = a.getAttribute('href');
    if (!id || id === '#' || id.length < 2) return;
    var target = document.querySelector(id);
    if (!target) return;
    e.preventDefault();
    var top = target.getBoundingClientRect().top + window.scrollY - (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--nav-h'), 10) || 48);
    window.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'auto' : 'smooth' });
    history.replaceState(null, '', id);
  });
})();
