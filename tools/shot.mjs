#!/usr/bin/env node
/**
 * 用 Chrome DevTools Protocol 截图 —— 解决 `--screenshot` 模式的两个局限：
 *   1. 不能先滚动到页面中某个区块再截
 *   2. 不能等待 IntersectionObserver / rAF 跑完（导致 reveal 元素 opacity 仍为 0）
 *
 * 用法：
 *   node tools/shot.mjs [url] [outPath] [selector]
 *   node tools/shot.mjs http://127.0.0.1:3000/ /tmp/a.png "[data-factory]"
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const url = process.argv[2] || 'http://127.0.0.1:3000/';
const outPath = process.argv[3] || '/tmp/shot.png';
const selector = process.argv[4] || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, [
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--enable-unsafe-swiftshader',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,
  '--window-size=1440,1000',
  'about:blank',
], { stdio: 'ignore' });

function cleanup(code) {
  try { chrome.kill('SIGKILL'); } catch { /* ignore */ }
  process.exit(code);
}

async function wsUrl() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await sleep(200);
  }
  throw new Error('CDP 端口未就绪');
}

const target = await wsUrl();
const ws = new WebSocket(target);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let seq = 0;
const pending = new Map();
const consoleErrors = [];

ws.onmessage = (ev) => {
  let msg;
  try { msg = JSON.parse(ev.data); } catch { return; }
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    const d = msg.params.exceptionDetails;
    consoleErrors.push(d.exception?.description || d.text || 'exception');
  }
};

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++seq;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url });
  await sleep(1200); // 等首屏脚本执行

  if (selector) {
    await send('Runtime.evaluate', {
      expression: `
        (function () {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return 'not-found';
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          return 'scrolled';
        })()
      `,
      returnByValue: true,
    });
    await sleep(2500); // 等 IntersectionObserver + 3D 首帧
  }

  // 读取页面内部状态（徽章、canvas、renderer 信息）
  const probe = await send('Runtime.evaluate', {
    expression: `
      (function () {
        const badge = document.querySelector('[data-factory-diag]');
        const canvas = document.querySelector('[data-factory-canvas]');
        const fb = document.querySelector('[data-factory-fallback]');
        const gl = (function () {
          try {
            const c = document.createElement('canvas');
            const ctx = c.getContext('webgl2') || c.getContext('webgl');
            if (!ctx) return null;
            const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
            return dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'ctx-ok';
          } catch (e) { return 'err:' + e.message; }
        })();
        return JSON.stringify({
          badge: badge ? badge.textContent : null,
          fallback: fb ? !fb.hidden : null,
          title: (document.querySelector('[data-factory-title]') || {}).textContent || null,
          canvasCss: canvas ? canvas.getBoundingClientRect().width + 'x' + canvas.getBoundingClientRect().height : null,
          canvasBuf: canvas ? canvas.width + 'x' + canvas.height : null,
          glRenderer: gl,
          scrollY: window.scrollY,
        });
      })()
    `,
    returnByValue: true,
  });

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result && shot.result.data) {
    writeFileSync(outPath, Buffer.from(shot.result.data, 'base64'));
    console.log('STATE ' + probe.result.result.value);
    console.log('SAVED ' + outPath);
  } else {
    console.log('SCREENSHOT_FAILED');
  }
  if (consoleErrors.length) {
    console.log('CONSOLE_ERRORS ' + JSON.stringify(consoleErrors.slice(0, 5)));
  }
} catch (err) {
  console.error('ERR', err.message);
  cleanup(1);
}

ws.close();
cleanup(0);
