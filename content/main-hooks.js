// GitHub Accelerator - 页面级下载点击拦截（MAIN world）
//
// 对抗 IDM 等下载器「抢在扩展之前抓走原始链接」的绕过：
//   1. 捕获阶段 click 拦截：用户在 GitHub 上下载按钮/链接的点击在
//      IDM 的监听器之前被拿到，preventDefault + stopImmediatePropagation，
//      由扩展决定「走加速拦截页」还是「原样放行」
//   2. HTMLAnchorElement.prototype.click hook：拦截 a.click() 程式化下载
//   3. 未启用（arm=false）或获准放行（replay）时一律原样放行
//
// MAIN world 无法访问 chrome.* API，通过 window.postMessage 与
// content/bridge.js（ISOLATED world）通信，由 bridge 转交 background 裁决。
// 防预置禁用：随机命名 + 不可枚举 + 不可配置，页面脚本无法提前探测/覆盖该标记
// 使居中 `window.__ghAccelHookInstalled = true` 之类的预置绕过失效。
(function () {
  'use strict';

  var INSTALL_KEY = '__ghxHook_' + Math.random().toString(36).slice(2, 10);
  try {
    if (window[INSTALL_KEY]) return; // 随机键每次注入各不相同，页面无法预置
  } catch (e) { /* accessor 抛错视为未安装 */ }

  try {
    Object.defineProperty(window, INSTALL_KEY, {
      value: true,
      writable: false,
      enumerable: false,  // 不出现在 for…in / Object.keys 中
      configurable: false // 页面无法 delete / 重新定义
    });
  } catch (e) {
    try { window[INSTALL_KEY] = true; } catch (e2) { /* noop */ }
  }

  var AUTO_REPLAY_DELAY = 1200; // 后台裁决超时后自动放行，避免页面被永久阻塞
  var REPLAY_WINDOW = 300;      // 放行一次性点击的时间窗口（毫秒）

  // 与 shared/link-patterns.js（background / bridge 单一来源）保持一致。
  // 注意：本脚本运行在 MAIN world，页面可篡改外部全局属性，因此必须内联自包含，
  // 不能引用 shared/link-patterns.js。修改时两边需同步。
  var URL_PATTERNS = [
    '*://github.com/*/releases/download/*',
    '*://github.com/*/archive/*',
    '*://github.com/*/raw/*',
    '*://github.com/*/blob/*',
    '*://codeload.github.com/*',
    '*://raw.githubusercontent.com/*',
    '*://gist.githubusercontent.com/*/raw/*'
  ];
  var PATTERNS = URL_PATTERNS.map(function (p) {
    // *:// 严格对应 https?://，锚定主机名（与 shared/link-patterns.js 一致）
    return new RegExp('^' + p.replace(/^\*:\/\//, 'https?:\\/\\/').replace(/\*/g, '.*') + '$');
  });

  var armed = false;  // background 通知可拦截后置为 true
  var pending = new Map(); // 规范化 URL -> 被拦截、等待裁决的元素（支持并发多次点击）
  var skipUntil = 0;  // 放行（replay）时间窗：窗口期内不拦截任何点击

  function canonUrl(href) {
    try {
      return new URL(href, window.location.href).href.replace(/#.*$/, '');
    } catch (e) {
      return href;
    }
  }

  function isSkipping() {
    return Date.now() < skipUntil;
  }

  function isGitHubDownloadUrl(href) {
    if (!href || typeof href !== 'string') return false;
    try {
      var u = new URL(href, window.location.href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      var canonical = u.href.replace(/#.*$/, '');
      for (var i = 0; i < PATTERNS.length; i++) {
        if (PATTERNS[i].test(canonical)) return true;
      }
    } catch (e) { /* noop */ }
    return false;
  }

  function toBridge(type, url) {
    try {
      window.postMessage({ __ghAccelBridge: true, type: type, url: url }, window.location.origin);
    } catch (e) { /* noop */ }
  }

  // 拦截：上报后台裁决；超时未裁决则自动放行（不会无限阻塞页面）
  function blockAndReport(el, href) {
    var key = canonUrl(href);
    pending.set(key, el);
    toBridge('intercept', key);
    setTimeout(function () {
      if (pending.get(key) !== el) return; // 已被后台裁决处理（放行或接管）
      pending.delete(key);
      console.log('[GH Accelerator] 后台裁决超时，自动放行:', key);
      skipUntil = Date.now() + REPLAY_WINDOW;
      try { el.click(); } catch (e) { /* noop */ }
    }, AUTO_REPLAY_DELAY);
  }

  // 放行指定 URL 的原生点击（bridge 转达后台 'replay' 裁决）
  function replay(url) {
    var el = pending.get(url);
    if (!el) return;
    pending.delete(url);
    if (!el.isConnected) return;
    skipUntil = Date.now() + REPLAY_WINDOW;
    try { el.click(); } catch (e) { /* noop */ }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var d = event.data;
    if (!d || d.__ghAccelBridge !== true) return;
    if (d.type === 'arm') {
      armed = !!d.value;
      if (!armed) pending.clear();
    } else if (d.type === 'replay') {
      replay(d.url);
    } else if (d.type === 'done') {
      // 后台已接管（打开拦截页/直接跳转），将该 URL 移出待放行队列
      pending.delete(d.url);
    }
  });

  // 1. 捕获阶段 click：先于页面脚本与 IDM 拿到点击
  document.addEventListener('click', function (e) {
    if (isSkipping()) return;
    var target = e.target;
    if (!target || !target.closest) return;
    var anchor = target.closest('a[href]');
    if (!anchor) return;
    var href = anchor.href;
    if (!armed || !isGitHubDownloadUrl(href)) return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    blockAndReport(anchor, href);
  }, true);

  // 2. 程式化 a.click()：拦截脚本触发的下载
  try {
    var _origAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (isSkipping()) return _origAnchorClick.call(this);
      var el = this;
      var href = (typeof el.href === 'string' && el.href) ||
        (el.getAttribute && el.getAttribute('href')) || '';
      if (armed && isGitHubDownloadUrl(href)) {
        blockAndReport(el, href);
        return; // 不执行原始 click，避免开始阶段就被 IDM 抓走
      }
      return _origAnchorClick.call(this);
    };
  } catch (e) { /* prototype hook 失败时静默降级 */ }
})();