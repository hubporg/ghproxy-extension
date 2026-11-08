// ==UserScript==
// @name         GitHub Accelerator
// @namespace    https://www.hubp.org/projects/extension
// @version      0.4.0
// @description  智能 GitHub 下载加速：与扩展同源的节点测速、页面级拦截与官网联动
// @author       hubp.org
// @homepageURL  https://github.com/hubporg/ghproxy-extension
// @supportURL   https://github.com/hubporg/ghproxy-extension/issues
// @updateURL    https://hubp.tbedu.top/userscript/github-accelerator.user.js
// @downloadURL  https://hubp.tbedu.top/userscript/github-accelerator.user.js
// @match        https://github.com/*
// @match        https://codeload.github.com/*
// @match        https://raw.githubusercontent.com/*
// @match        https://gist.githubusercontent.com/*
// @match        https://www.hubp.org/*
// @match        https://hubp.org/*
// @connect      hubp.tbedu.top
// @connect      gh.dpik.top
// @connect      www.visa.cn
// @connect      www.cloudflare.com
// @connect      api.ipapi.is
// @connect      api.ip.sb
// @connect      raw.githubusercontent.com
// @connect      addon-analytics.hubp.org
// @connect      addon-analytics-hubp.tbedu.top
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        unsafeWindow
// @sandbox      raw
// @run-at       document-start
// @noframes
// ==/UserScript==

// 与扩展（manifest 版）对齐的能力：
//   - 同一节点源 hubp.tbedu.top/nodes.json，同一套链接识别规则
//   - 点击下载链接时注入与 intercept 页一致的拦截 UI（含节点选择、倒计时、始终加速）
//   - 常驻浮标 + popup 风格面板（节点测速、自定义节点、位置、缓存、公告）
//   - hubp.org 官网桥接：只读广播本地节点测速与计数，协议与扩展 content script 一致
// 差异：不安装扩展的右键菜单。
// 对齐：节点测速做图标 SHA-256 校验（不匹配的节点直接排除）；匿名统计上报（jumps/installs，
// 受隐私同意控制，与扩展 stats.js 同一接口与 payload）；首次运行先确认隐私政策再启用拦截。
//
// 注入方式：@sandbox raw 让脚本运行在页面上下文，配合 unsafeWindow 把 a.click() 的原型 hook
// 装到页面世界（等价扩展的 MAIN world main-hooks）。不支持 @sandbox 的管理器（如 Violentmonkey）
// 会退化为捕获阶段 click 拦截，用户手动点击仍会正常进入拦截流程。
//
// 命名全部带 ghx9f3a 前缀，避免与 GitHub 页面自身的 DOM/全局变量冲突。
(function () {
  'use strict';

  var NS = 'ghx9f3a';
  var VERSION = '0.4.0';
  var CHANGELOG = [
    { version: '0.4.0', items: ['重新设计面板与拦截层布局', '测速并发提升到 32，节点列表实时增量更新', '面板内嵌本机 / 全网统计、更新日志与隐私说明'] },
    { version: '0.3.1', items: ['匿名统计上报（source=userscript）', '节点测速增加 SHA-256 校验', '首次运行隐私确认'] },
    { version: '0.3.0', items: ['注入式拦截层与浮标面板', '官网桥接、自定义节点、公告'] },
    { version: '0.2.0', items: ['首个可用版本'] }
  ];
  var API_URL = 'https://hubp.tbedu.top/nodes.json';
  var UPDATE_URL = 'https://hubp.tbedu.top/userscript/github-accelerator.user.js';
  var UPDATE_FALLBACK_URL = 'https://raw.githubusercontent.com/hubporg/ghproxy-extension/main/userscript/github-accelerator.user.js';
  var PRIVACY_URL = 'https://www.hubp.org/projects/extension/privacy';
  var SPEED_TEST_URL = 'https://raw.githubusercontent.com/hubporg/ghproxy-extension/refs/heads/main/src/icons/icon128.png';
  var ICON_HASH_URL = 'https://hubp.tbedu.top/icons/icon128.png';
  var STATS_URL = 'https://addon-analytics.hubp.org/stats/collect';
  var STATS_FALLBACK_URL = 'https://addon-analytics-hubp.tbedu.top/stats/collect';
  var CACHE_TTL = 2 * 60 * 60 * 1000;
  var LOCATION_TTL = 10 * 60 * 1000;
  var HASH_TTL = 24 * 60 * 60 * 1000;
  var REQUEST_TIMEOUT = 8000;
  var SPEED_CONCURRENCY = 32;
  var COUNTDOWN_SECONDS = 10;
  var BATCH_THRESHOLD = 5;
  var REPORT_INTERVAL = 5 * 60 * 1000;

  var KEYS = {
    cache: NS + '_node_cache',
    selected: NS + '_selected_node',
    always: NS + '_always_accelerate',
    custom: NS + '_custom_nodes',
    jumps: NS + '_jump_count',
    installs: NS + '_install_count',
    location: NS + '_location_cache',
    privacy: NS + '_privacy_accepted',
    pending: NS + '_pending_report',
    iconHash: NS + '_icon_hash'
  };

  var CF_TRACE_ENDPOINTS = [
    'https://gh.dpik.top/cdn-cgi/trace',
    'https://www.visa.cn/cdn-cgi/trace',
    'https://www.cloudflare.com/cdn-cgi/trace'
  ];

  var FALLBACK_NODES = ['https://gh.dpik.top', 'https://github.tbap.top'];

  var COUNTRY_NAMES = {
    CN: '中国大陆', HK: '中国香港', TW: '中国台湾', US: '美国',
    JP: '日本', KR: '韩国', SG: '新加坡', DE: '德国', GB: '英国', FR: '法国'
  };

  // 与扩展 src/shared/link-patterns.js 保持一致（改规则时两边一起改）
  var PATTERNS = [
    '*://github.com/*/releases/download/*',
    '*://github.com/*/releases/latest/download/*',
    '*://github.com/*/archive/*',
    '*://github.com/*/raw/*',
    '*://codeload.github.com/*',
    '*://raw.githubusercontent.com/*',
    '*://gist.githubusercontent.com/*/raw/*'
  ];

  var PATTERN_RE = PATTERNS.map(function (p) {
    return new RegExp('^' + p.replace(/^\*:\/\//, 'https?:\\/\\/').replace(/\*/g, '.*') + '$');
  });

  var state = {
    nodes: [],
    best: null,
    selected: '',
    custom: [],
    loading: false,
    location: null,
    locationAt: 0,
    pending: null,
    overlayOpen: false,
    panelOpen: false,
    countdownTimer: null,
    countdownLeft: COUNTDOWN_SECONDS,
    skip: null,
    announcement: null,
    coreStarted: false,
    statsTimer: null,
    initialized: false
  };

  // ==================== 存储与请求 ====================

  function hasGM() {
    return typeof GM_getValue === 'function' && typeof GM_setValue === 'function';
  }

  // 调试日志开关：默认关闭，避免刷屏；菜单「🐛 调试日志」切换
  function debugEnabled() {
    return gmGet(NS + '_debug', false) === true;
  }

  function log() {
    if (!debugEnabled()) return;
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift('[' + NS + ']');
      console.log.apply(console, args);
    } catch (e) { /* noop */ }
  }

  function gmGet(key, fallback) {
    try {
      if (hasGM()) {
        var value = GM_getValue(key, fallback);
        return value === undefined ? fallback : value;
      }
      var raw = window.localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function gmSet(key, value) {
    try {
      if (hasGM()) {
        GM_setValue(key, value);
        return;
      }
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* noop */ }
  }

  function gmRequest(options) {
    return new Promise(function (resolve, reject) {
      if (typeof GM_xmlhttpRequest === 'function') {
        GM_xmlhttpRequest({
          method: options.method || 'GET',
          url: options.url,
          headers: options.headers || {},
          data: options.data,
          timeout: options.timeout || REQUEST_TIMEOUT,
          responseType: options.responseType || 'text',
          anonymous: true,
          onload: function (res) { resolve(res); },
          onerror: function () { reject(new Error('request error')); },
          ontimeout: function () { reject(new Error('timeout')); }
        });
        return;
      }

      var controller = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = controller ? setTimeout(function () { controller.abort(); }, options.timeout || REQUEST_TIMEOUT) : null;
      fetch(options.url, {
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.data,
        cache: 'no-store',
        signal: controller ? controller.signal : undefined
      })
        .then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          var type = res.headers.get('content-type') || '';
          if (options.responseType === 'arraybuffer') {
            return res.arrayBuffer().then(function (buffer) {
              return { buffer: buffer, text: '', type: type };
            });
          }
          return res.text().then(function (text) {
            return { buffer: undefined, text: text, type: type };
          });
        })
        .then(function (data) {
          resolve({
            status: 200,
            response: data.buffer,
            responseText: data.text,
            responseHeaders: 'content-type: ' + data.type
          });
        })
        .catch(reject)
        .finally(function () {
          if (timer) clearTimeout(timer);
        });
    });
  }

  function fetchJson(url) {
    return gmRequest({ url: url, timeout: REQUEST_TIMEOUT }).then(function (res) {
      if (res.status >= 400) throw new Error('HTTP ' + res.status);
      return JSON.parse(res.responseText);
    });
  }

  // ==================== 纯函数 ====================

  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return String(url);
    }
  }

  function isGitHubHostname(hostname) {
    if (!hostname) return false;
    var h = String(hostname).toLowerCase();
    return h === 'github.com' ||
      h === 'codeload.github.com' ||
      h === 'raw.githubusercontent.com' ||
      h === 'gist.githubusercontent.com' ||
      h.slice(-11) === '.github.com';
  }

  function isDownloadUrl(url) {
    if (!url || typeof url !== 'string') return false;
    var u;
    try {
      u = new URL(url);
    } catch (e) {
      try {
        u = new URL(url, 'https://github.com/');
      } catch (e2) {
        return false;
      }
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (!isGitHubHostname(u.hostname)) return false;
    var canonical = u.href.replace(/#.*$/, '');
    for (var i = 0; i < PATTERN_RE.length; i++) {
      if (PATTERN_RE[i].test(canonical)) return true;
    }
    return false;
  }

  // 与扩展 background/intercept 的 transformUrl 一致
  function transformUrl(originalUrl) {
    try {
      var url = new URL(originalUrl);
      var hostname = url.hostname;
      var pathname = url.pathname;

      if (hostname === 'codeload.github.com') {
        var match = pathname.match(/^\/([^\/]+)\/([^\/]+)\/(zip|tar\.gz)\/(.+)$/);
        if (match) {
          var user = match[1];
          var repo = match[2];
          var format = match[3];
          var ref = match[4];
          var extension = format === 'zip' ? '.zip' : '.tar.gz';
          return 'https://github.com/' + user + '/' + repo + '/archive/' + ref + extension;
        }
        return null;
      }

      if (hostname === 'github.com' && pathname.indexOf('/blob/') !== -1) {
        return 'https://github.com' + pathname.replace('/blob/', '/raw/');
      }

      if (hostname === 'raw.githubusercontent.com') return originalUrl;

      if (hostname === 'github.com') {
        if (pathname.indexOf('/releases/download/') !== -1 ||
          pathname.indexOf('/releases/latest/download/') !== -1 ||
          pathname.indexOf('/archive/') !== -1 ||
          pathname.indexOf('/raw/') !== -1) {
          return originalUrl;
        }
      }

      if (hostname === 'gist.githubusercontent.com') return originalUrl;

      return null;
    } catch (e) {
      return null;
    }
  }

  function accelerate(node, url) {
    if (!node) return url;
    return String(node).replace(/\/+$/, '') + '/' + url;
  }

  function buildAccelerated(nodeUrl, originalUrl) {
    if (!nodeUrl) return '';
    var transformed = transformUrl(originalUrl);
    return accelerate(nodeUrl, transformed || originalUrl);
  }

  function normalizeNodes(payload) {
    var list = payload && Array.isArray(payload.data) ? payload.data : (Array.isArray(payload) ? payload : []);
    var out = [];
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      if (typeof list[i] !== 'string') continue;
      var url = /^https?:\/\//i.test(list[i]) ? list[i] : 'https://' + list[i];
      var host;
      try {
        host = new URL(url).hostname.toLowerCase();
      } catch (e) {
        continue;
      }
      if (!host || seen[host]) continue;
      seen[host] = true;
      out.push(url.replace(/\/+$/, ''));
    }
    return out;
  }

  function sortNodes(nodes) {
    return nodes.slice().sort(function (a, b) {
      var la = a.latency > 0 ? a.latency : Infinity;
      var lb = b.latency > 0 ? b.latency : Infinity;
      return la - lb;
    });
  }

  function pickNode(nodes, selected) {
    if (!Array.isArray(nodes) || nodes.length === 0) return null;
    if (selected) {
      var target = String(selected).replace(/\/+$/, '');
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].url === target || nodes[i].url === selected) return nodes[i];
      }
    }
    var best = null;
    for (var j = 0; j < nodes.length; j++) {
      if (!(nodes[j].latency > 0)) continue;
      if (!best || nodes[j].latency < best.latency) best = nodes[j];
    }
    return best || nodes[0] || null;
  }

  function allNodes() {
    var custom = state.custom.map(function (node) {
      return { url: node.url, latency: typeof node.latency === 'number' ? node.latency : -1, isCustom: true };
    });
    var api = state.nodes.map(function (node) {
      return { url: node.url, latency: node.latency, isCustom: false };
    });
    return sortNodes(custom.concat(api));
  }

  function latencyBadgeClass(latency) {
    if (latency > 0 && latency < 200) return 'good';
    if (latency > 0 && latency < 500) return 'default';
    return '';
  }

  function formatRemaining(testedAt) {
    if (!testedAt) return '-';
    var remaining = Math.max(0, CACHE_TTL - (Date.now() - testedAt));
    var minutes = Math.floor(remaining / 60000);
    if (minutes >= 60) return Math.floor(minutes / 60) + ' 小时 ' + (minutes % 60) + ' 分钟';
    return minutes + ' 分钟';
  }

  // ==================== 节点缓存与测速 ====================

  function readCache() {
    var cache = gmGet(KEYS.cache, null);
    if (!cache || !Array.isArray(cache.nodes) || !cache.nodes.length) return null;
    if (!cache.testedAt || Date.now() - cache.testedAt > CACHE_TTL) return null;
    return cache;
  }

  function sha256Hex(buffer) {
    try {
      if (!(window.crypto && window.crypto.subtle) || !buffer) return Promise.resolve(null);
      return window.crypto.subtle.digest('SHA-256', buffer).then(function (digest) {
        var bytes = new Uint8Array(digest);
        var out = '';
        for (var i = 0; i < bytes.length; i++) {
          out += bytes[i].toString(16).padStart(2, '0');
        }
        return out;
      }).catch(function () {
        return null;
      });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  // 与扩展 INTEGRITY_TEST 一致：以云端 icon 的 SHA-256 作为期望值
  function getExpectedHash() {
    var cached = gmGet(KEYS.iconHash, null);
    if (cached && cached.hash && cached.at && Date.now() - cached.at < HASH_TTL) {
      return Promise.resolve(cached.hash);
    }
    return gmRequest({
      url: ICON_HASH_URL + '?t=' + Date.now(),
      timeout: 6000,
      responseType: 'arraybuffer'
    }).then(function (res) {
      if (res.status >= 400 || !res.response) throw new Error('HTTP ' + res.status);
      return sha256Hex(res.response);
    }).then(function (hash) {
      if (hash) gmSet(KEYS.iconHash, { hash: hash, at: Date.now() });
      return hash || null;
    }).catch(function () {
      return null;
    });
  }

  function testNode(nodeUrl, expectedHash) {
    var start = Date.now();
    return gmRequest({
      url: nodeUrl.replace(/\/+$/, '') + '/' + SPEED_TEST_URL,
      timeout: REQUEST_TIMEOUT,
      responseType: 'arraybuffer'
    }).then(function (res) {
      if (res.status && (res.status < 200 || res.status >= 400)) {
        return { latency: -1, verified: false };
      }
      var headers = String(res.responseHeaders || '').toLowerCase();
      if (headers.indexOf('content-type:') !== -1 && headers.indexOf('image/') === -1) {
        return { latency: -1, verified: false };
      }
      var latency = Date.now() - start;
      if (latency <= 0) latency = 1;
      return sha256Hex(res.response).then(function (hash) {
        // 与扩展一致：哈希不匹配（被篡改/错误页）直接判定失败，不能进入节点列表
        var verified = !!(expectedHash && hash && hash === expectedHash);
        return { latency: verified ? latency : -1, verified: verified };
      });
    }).catch(function () {
      return { latency: -1, verified: false };
    });
  }

  function mapPool(items, limit, worker) {
    var results = new Array(items.length);
    var cursor = 0;
    var runners = [];
    var size = Math.max(1, Math.min(limit, items.length));

    function run() {
      return Promise.resolve().then(function next() {
        if (cursor >= items.length) return undefined;
        var index = cursor++;
        return Promise.resolve(worker(items[index], index)).then(function (value) {
          results[index] = value;
          return next();
        });
      });
    }

    for (var i = 0; i < size; i++) runners.push(run());
    return Promise.all(runners).then(function () { return results; });
  }

  function refreshNodes(force) {
    if (state.loading) return Promise.resolve(state.best);

    var cached = force ? null : readCache();
    if (cached) {
      state.nodes = sortNodes(cached.nodes);
      state.selected = gmGet(KEYS.selected, '') || '';
      state.best = pickNode(state.nodes, state.selected);
      log('nodes from cache:', state.nodes.length, 'best =', state.best && state.best.url);
      updateFab();
      renderPanelNodes();
      return Promise.resolve(state.best);
    }

    state.loading = true;
    updateFab();

    return getExpectedHash()
      .then(function (expectedHash) {
        return fetchJson(API_URL + '?t=' + Date.now()).then(function (payload) {
          var urls = normalizeNodes(payload);
          if (!urls.length) throw new Error('节点列表为空');
          log('nodes fetched:', urls.length, 'expected hash =', expectedHash ? expectedHash.slice(0, 12) + '…' : 'none');
          state.speedProgress = { done: 0, total: urls.length };
          // 清空旧列表，测速过程中逐条填充，用户能实时看到可用节点和当前最快节点
          state.nodes = [];
          state.best = null;
          var live = [];
          var lastRender = 0;
          updateFab();
          renderPanelNodes();
          renderOverlayNodes();
          return mapPool(urls, SPEED_CONCURRENCY, function (url) {
            return testNode(url, expectedHash).then(function (result) {
              state.speedProgress.done++;
              if (result.verified) {
                live.push({ url: url, latency: result.latency, verified: true });
              }
              var now = Date.now();
              var finished = state.speedProgress.done === state.speedProgress.total;
              // 200ms 节流，避免 81 次连着重排
              if (now - lastRender >= 200 || finished) {
                lastRender = now;
                state.nodes = sortNodes(live.slice());
                if (!state.selected) state.best = pickNode(state.nodes, '');
                updateFab();
                renderPanelNodes();
                renderOverlayNodes();
                if (state.overlayOpen && state.pending) renderOverlayLinks();
              }
              if (result.verified) {
                log('node ok  ', hostOf(url), result.latency + 'ms');
              } else {
                log('node fail', hostOf(url), expectedHash ? 'hash/type mismatch' : 'no expected hash');
              }
              return { url: url, latency: result.latency, verified: result.verified };
            });
          });
        });
      })
      .then(function (tested) {
        var valid = tested.filter(function (node) { return node.verified; });
        log('nodes verified:', valid.length + '/' + tested.length);
        if (!valid.length) throw new Error('没有通过完整性校验的节点');
        gmSet(KEYS.cache, { nodes: valid, testedAt: Date.now() });
        state.nodes = sortNodes(valid);
        state.selected = gmGet(KEYS.selected, '') || '';
        state.best = pickNode(state.nodes, state.selected);
      })
      .catch(function (error) {
        console.warn('[' + NS + '] 节点加载失败:', error && error.message ? error.message : error);
        log('nodes load failed, fallback:', error && error.message);
        if (!state.nodes.length) {
          state.nodes = FALLBACK_NODES.map(function (url) {
            return { url: url, latency: -1 };
          });
          state.best = { url: state.nodes[0].url, latency: -1 };
        }
      })
      .finally(function () {
        state.loading = false;
        state.speedProgress = null;
        updateFab();
        renderPanelNodes();
        renderOverlayNodes();
        bridgePush();
      });
  }

  // ==================== 自定义节点 ====================

  function loadCustomNodes() {
    var list = gmGet(KEYS.custom, []);
    state.custom = Array.isArray(list) ? list.filter(function (n) {
      return n && typeof n.url === 'string' && /^https?:\/\//i.test(n.url);
    }) : [];
    return state.custom;
  }

  function saveCustomNodes(nodes) {
    state.custom = nodes;
    gmSet(KEYS.custom, nodes);
    renderCustomNodes();
    renderPanelNodes();
    renderOverlayNodes();
  }

  function addCustomNode(url) {
    url = String(url || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) return Promise.resolve(null);
    if (state.custom.some(function (n) { return n.url === url; })) return Promise.resolve(null);
    var node = { url: url, latency: -1, addedAt: Date.now() };
    var nodes = state.custom.concat([node]);
    saveCustomNodes(nodes);
    return getExpectedHash().then(function (hash) {
      return testNode(url, hash);
    }).then(function (result) {
      var latest = gmGet(KEYS.custom, []);
      for (var i = 0; i < latest.length; i++) {
        if (latest[i].url === url) {
          latest[i].latency = result.latency;
          latest[i].verified = result.verified;
        }
      }
      saveCustomNodes(latest);
      return node;
    });
  }

  // ==================== 位置检测 ====================

  function parseCfTrace(text) {
    if (!text) return null;
    var fields = {};
    var lines = String(text).split('\n');
    for (var i = 0; i < lines.length; i++) {
      var eq = lines[i].indexOf('=');
      if (eq > 0) fields[lines[i].slice(0, eq).trim()] = lines[i].slice(eq + 1).trim();
    }
    var country = (fields.loc || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) return null;
    return {
      ip: fields.ip || 'unknown',
      country: country,
      isChinaMainland: country === 'CN',
      needProxy: country === 'CN'
    };
  }

  function parseGeoLocation(data) {
    if (!data || typeof data !== 'object') return null;
    var country = data.country_code || data.countryCode || (data.location && data.location.country_code) || '';
    if (typeof data.country === 'object' && data.country) {
      country = data.country.iso_code || country;
    } else if (typeof data.country === 'string' && data.country) {
      country = data.country;
    }
    if (country === '中国' || country === '中国大陆' || country === 'China') country = 'CN';
    var code = String(country).toUpperCase();
    if (!code || code === 'UNKNOWN') return null;
    return {
      ip: data.ip || data.query || data.ip_address || 'unknown',
      country: code,
      isChinaMainland: code === 'CN',
      needProxy: code === 'CN'
    };
  }

  function detectLocation(force) {
    if (!force && state.location && Date.now() - state.locationAt < LOCATION_TTL) {
      return Promise.resolve(state.location);
    }

    var chain = Promise.reject(new Error('skip'));
    CF_TRACE_ENDPOINTS.forEach(function (endpoint) {
      chain = chain.catch(function () {
        return gmRequest({ url: endpoint, timeout: 4000 }).then(function (res) {
          if (res.status >= 400) throw new Error('HTTP ' + res.status);
          var parsed = parseCfTrace(res.responseText);
          if (!parsed) throw new Error('trace 格式异常');
          return parsed;
        });
      });
    });

    return chain
      .catch(function () {
        return gmRequest({ url: 'https://api.ipapi.is/', timeout: 5000 }).then(function (res) {
          return parseGeoLocation(JSON.parse(res.responseText));
        });
      })
      .catch(function () {
        return gmRequest({ url: 'https://api.ip.sb/geoip', timeout: 5000 }).then(function (res) {
          return parseGeoLocation(JSON.parse(res.responseText));
        });
      })
      .catch(function () {
        return { ip: 'unknown', country: 'unknown', isChinaMainland: false, needProxy: true };
      })
      .then(function (location) {
        if (!location) return null;
        state.location = location;
        state.locationAt = Date.now();
        log('location:', location.country, location.ip, 'needProxy =', location.needProxy);
        return location;
      });
  }

  function countryName(code) {
    return COUNTRY_NAMES[code] || code;
  }

  // ==================== 计数 ====================

  function bumpCount(key) {
    var current = Number(gmGet(key, 0)) || 0;
    var next = current + 1;
    gmSet(key, next);
    return next;
  }

  function isPrivacyAccepted() {
    return gmGet(KEYS.privacy, false) === true;
  }

  function detectBrowser() {
    var ua = (window.navigator && window.navigator.userAgent ? window.navigator.userAgent : '').toLowerCase();
    return ua.indexOf('firefox') !== -1 ? 'firefox' : 'chromium';
  }

  function enqueueReport(action) {
    if (!isPrivacyAccepted()) return;
    var pending = gmGet(KEYS.pending, { jump: 0, install: 0 }) || {};
    pending[action] = (Number(pending[action]) || 0) + 1;
    gmSet(KEYS.pending, pending);
    if ((Number(pending.jump) || 0) + (Number(pending.install) || 0) >= BATCH_THRESHOLD) {
      flushStats();
    }
  }

  function postStats(url, body) {
    return gmRequest({
      method: 'POST',
      url: url,
      headers: { 'Content-Type': 'application/json' },
      data: body,
      timeout: 8000
    });
  }

  // 与扩展 stats.js 同一接口与 payload，受隐私同意控制
  function flushStats() {
    if (!isPrivacyAccepted()) return Promise.resolve();
    var pending = gmGet(KEYS.pending, null);
    if (!pending || (!pending.jump && !pending.install)) return Promise.resolve();

    var payload = {
      jumps: Number(pending.jump) || 0,
      installs: Number(pending.install) || 0,
      browser: detectBrowser(),
      version: VERSION,
      source: 'userscript',
      timestamp: Date.now()
    };
    var body = JSON.stringify(payload);
    log('stats flush:', payload);

    return postStats(STATS_URL, body)
      .catch(function () {
        return postStats(STATS_FALLBACK_URL, body);
      })
      .then(function (res) {
        if (res && res.status >= 400) throw new Error('HTTP ' + res.status);
        gmSet(KEYS.pending, { jump: 0, install: 0 });
        log('stats reported:', payload.jumps, 'jumps,', payload.installs, 'installs');
      })
      .catch(function (error) {
        console.warn('[' + NS + '] 统计上报失败，保留待下次重试:', error && error.message ? error.message : error);
        log('stats failed:', error && error.message);
      });
  }

  function startStatsScheduler() {
    if (state.statsTimer) return;
    state.statsTimer = setInterval(function () {
      flushStats();
    }, REPORT_INTERVAL);
  }

  function logJump() {
    if (!isPrivacyAccepted()) return;
    bumpCount(KEYS.jumps);
    enqueueReport('jump');
    bridgePush();
  }

  function ensureInstalled() {
    if (gmGet(KEYS.installs, null) === null) {
      gmSet(KEYS.installs, 1);
      enqueueReport('install');
    }
  }

  function setAlways(value) {
    gmSet(KEYS.always, value === true);
    var checkbox = document.querySelector('#' + NS + '-panel [data-' + NS + '-action="always"]');
    if (checkbox) checkbox.checked = value === true;
  }

  function isAlways() {
    return gmGet(KEYS.always, false) === true;
  }

  // ==================== 样式（全部限定在 ghx9f3a 命名空间内） ====================

  function addStyle(css) {
    if (typeof GM_addStyle === 'function') {
      GM_addStyle(css);
      return;
    }
    var style = document.createElement('style');
    style.id = NS + '-style';
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  var STYLE = [
    '#ghx9f3a-root{position:fixed;right:18px;bottom:18px;z-index:2147483000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:13px;line-height:1.55;color:#1f2937}',
    '#ghx9f3a-root *{box-sizing:border-box;margin:0;padding:0}',
    '.ghx9f3a-fab{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border:none;border-radius:999px;background:#155DFC;color:#fff;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 6px 20px rgba(21,93,252,.35);transition:transform .15s,background .15s}',
    '.ghx9f3a-fab:hover{background:#0d4bb5;transform:translateY(-1px)}',
    '.ghx9f3a-fab.is-loading,.ghx9f3a-fab.is-idle{background:#6b7280;box-shadow:none;cursor:default}',
    '.ghx9f3a-panel{position:fixed;right:18px;bottom:78px;width:440px;max-width:calc(100vw - 36px);max-height:82vh;display:flex;flex-direction:column;background:#fff;border:1px solid #e6e8eb;border-radius:16px;box-shadow:0 24px 60px rgba(17,24,39,.18);overflow:hidden}',
    '.ghx9f3a-panel[hidden]{display:none}',
    '.ghx9f3a-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border-bottom:1px solid #f0f1f3}',
    '.ghx9f3a-brand{display:flex;align-items:center;gap:10px;min-width:0}',
    '.ghx9f3a-brand-icon{width:34px;height:34px;border-radius:10px;background:#155DFC;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:17px;flex:0 0 auto}',
    '.ghx9f3a-brand-title{font-size:14px;font-weight:700;color:#111827}',
    '.ghx9f3a-brand-sub{font-size:11px;color:#8a94a6}',
    '.ghx9f3a-close{border:none;background:transparent;color:#9aa3af;font-size:20px;line-height:1;cursor:pointer;padding:2px 4px;border-radius:6px}',
    '.ghx9f3a-close:hover{color:#374151;background:#f3f4f6}',
    '.ghx9f3a-panel-body{padding:16px 18px;overflow:auto;display:flex;flex-direction:column;gap:14px}',
    '.ghx9f3a-card{background:#f8f9fb;border:1px solid #eef0f3;border-radius:12px;padding:14px}',
    '.ghx9f3a-card-title{font-size:13px;font-weight:600;color:#111827}',
    '.ghx9f3a-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}',
    '.ghx9f3a-select{width:100%;padding:10px 12px;border:1px solid #dfe3e8;border-radius:9px;background:#fff;font-size:13px;color:#111827;outline:none;cursor:pointer}',
    '.ghx9f3a-select:focus{border-color:#155DFC;box-shadow:0 0 0 3px rgba(21,93,252,.12)}',
    '.ghx9f3a-badge{background:#ffebee;color:#c62828;padding:4px 9px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap;flex:0 0 auto}',
    '.ghx9f3a-badge.good{background:#e8f5e9;color:#2e7d32}',
    '.ghx9f3a-badge.default{background:#fff3e0;color:#ef6c00}',
    '.ghx9f3a-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}',
    '.ghx9f3a-btn{border:none;border-radius:9px;padding:9px 10px;font-size:12px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;white-space:nowrap;transition:background .15s;text-decoration:none}',
    '.ghx9f3a-btn.primary{background:#155DFC;color:#fff}',
    '.ghx9f3a-btn.primary:hover{background:#0d4bb5}',
    '.ghx9f3a-btn.ghost{background:#fff;color:#374151;border:1px solid #dfe3e8}',
    '.ghx9f3a-btn.ghost:hover{background:#f3f4f6}',
    '.ghx9f3a-input{width:100%;padding:9px 11px;border:1px solid #dfe3e8;border-radius:9px;font-size:12px;outline:none;background:#fff}',
    '.ghx9f3a-input:focus{border-color:#155DFC;box-shadow:0 0 0 3px rgba(21,93,252,.12)}',
    '.ghx9f3a-custom-input{display:flex;gap:8px;margin-top:10px}',
    '.ghx9f3a-custom-input .ghx9f3a-input{flex:1}',
    '.ghx9f3a-custom-item{display:flex;align-items:center;gap:8px;padding:8px;background:#fff;border:1px solid #eef0f3;border-radius:8px;margin-top:8px}',
    '.ghx9f3a-custom-host{flex:1;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ghx9f3a-custom-latency{font-size:11px;color:#8a94a6}',
    '.ghx9f3a-icon-btn{border:none;background:transparent;cursor:pointer;font-size:13px;padding:2px 4px;border-radius:6px}',
    '.ghx9f3a-icon-btn:hover{background:#f3f4f6}',
    '.ghx9f3a-info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}',
    '.ghx9f3a-info-item{min-width:0}',
    '.ghx9f3a-info-item small{display:block;font-size:11px;color:#8a94a6;margin-bottom:2px}',
    '.ghx9f3a-info-item span{display:block;font-size:12px;font-weight:600;color:#111827;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.ghx9f3a-switch{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#f8f9fb;border:1px solid #eef0f3;border-radius:12px;cursor:pointer;font-size:13px}',
    '.ghx9f3a-switch input{width:16px;height:16px;flex:0 0 auto;cursor:pointer}',
    '.ghx9f3a-switch small{display:block;font-size:11px;color:#8a94a6;font-weight:400}',
    '.ghx9f3a-panel-foot{padding:12px 18px;border-top:1px solid #f0f1f3;text-align:center;font-size:11px;color:#9aa3af}',
    '.ghx9f3a-panel-foot a{color:#0d4bb5;text-decoration:none}',
    '.ghx9f3a-tabs{display:flex;gap:4px;padding:8px 18px 0;border-bottom:1px solid #f0f1f3;background:#fff}',
    '.ghx9f3a-tab{border:none;background:transparent;padding:9px 12px;font-size:12px;font-weight:600;color:#8a94a6;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}',
    '.ghx9f3a-tab:hover{color:#374151}',
    '.ghx9f3a-tab.active{color:#155DFC;border-bottom-color:#155DFC}',
    '.ghx9f3a-changelog-item{margin-top:12px}',
    '.ghx9f3a-changelog-item:first-child{margin-top:0}',
    '.ghx9f3a-changelog-version{font-size:12px;font-weight:700;color:#111827}',
    '.ghx9f3a-changelog-list{margin:5px 0 0 16px;font-size:12px;color:#4b5563;line-height:1.65}',
    '.ghx9f3a-overlay{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;padding:24px}',
    '.ghx9f3a-overlay[hidden]{display:none}',
    '.ghx9f3a-mask{position:absolute;inset:0;background:rgba(15,23,42,.5);backdrop-filter:blur(3px)}',
    '.ghx9f3a-sheet{position:relative;width:100%;max-width:min(760px,calc(100vw - 48px));max-height:88vh;overflow:auto;background:#fff;border-radius:18px;box-shadow:0 32px 80px rgba(15,23,42,.35);display:flex;flex-direction:column}',
    '.ghx9f3a-sheet-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:22px 26px;border-bottom:1px solid #f0f1f3}',
    '.ghx9f3a-sheet-title{font-size:19px;font-weight:700;color:#111827}',
    '.ghx9f3a-sheet-sub{font-size:12px;color:#8a94a6;margin-top:3px}',
    '.ghx9f3a-location-status{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}',
    '.ghx9f3a-location-status.global{background:#fff8e1;color:#9a6700;border:1px solid #f59e0b}',
    '.ghx9f3a-location-status.cn{background:#e8f5e9;color:#1a7f37;border:1px solid #2da44e}',
    '.ghx9f3a-spinner{width:13px;height:13px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:ghx9f3a-spin .8s linear infinite;flex:0 0 auto}',
    '@keyframes ghx9f3a-spin{to{transform:rotate(360deg)}}',
    '.ghx9f3a-sheet-body{display:grid;grid-template-columns:1.5fr 1fr;gap:22px;padding:22px 26px}',
    '.ghx9f3a-sheet-main{display:flex;flex-direction:column;gap:14px;min-width:0}',
    '.ghx9f3a-sheet-side{display:flex;flex-direction:column;gap:14px;min-width:0;border-left:1px solid #f0f1f3;padding-left:22px}',
    '.ghx9f3a-link-card{background:#f8f9fb;border:1px solid #eef0f3;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:8px}',
    '.ghx9f3a-link-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:#8a94a6}',
    '.ghx9f3a-copy{border:1px solid #dfe3e8;background:#fff;color:#374151;padding:4px 10px;border-radius:7px;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap}',
    '.ghx9f3a-copy:hover{background:#f3f4f6}',
    '.ghx9f3a-copy.copied{background:#2da44e;color:#fff;border-color:#2da44e}',
    '.ghx9f3a-copy.primary-text{background:#155DFC;color:#fff;border-color:#155DFC}',
    '.ghx9f3a-copy.primary-text:hover{background:#0d4bb5}',
    '.ghx9f3a-url{font:12px/1.55 Consolas,Monaco,monospace;color:#374151;word-break:break-all}',
    '.ghx9f3a-actions{display:grid;grid-template-columns:1.4fr 1fr auto;gap:10px}',
    '.ghx9f3a-actions .ghx9f3a-btn{padding:12px 16px;font-size:13px}',
    '.ghx9f3a-countdown{text-align:center;font-size:12px;color:#9a6700;padding:10px 12px;background:#fff8e1;border:1px solid #f59e0b;border-radius:9px}',
    '.ghx9f3a-countdown[hidden]{display:none}',
    '.ghx9f3a-countdown strong{color:#155DFC}',
    '.ghx9f3a-side-block{background:#f8f9fb;border:1px solid #eef0f3;border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:10px}',
    '.ghx9f3a-side-label{font-size:12px;color:#8a94a6}',
    '.ghx9f3a-side-row{display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.ghx9f3a-side-note{font-size:11px;color:#9aa3af;line-height:1.6}',
    '.ghx9f3a-sheet-foot{padding:14px 26px;border-top:1px solid #f0f1f3;text-align:center;font-size:11px;color:#9aa3af}',
    '.ghx9f3a-sheet-foot a{color:#0d4bb5;text-decoration:none}',
    '.ghx9f3a-ann{box-sizing:border-box;padding:12px 14px;border:1px solid #dbe4f0;border-left:4px solid #155DFC;border-radius:10px;background:#f5f8ff}',
    '.ghx9f3a-ann[hidden]{display:none}',
    '.ghx9f3a-ann.warning{border-color:#ffe0b2;border-left-color:#ef6c00;background:#fff8e1}',
    '.ghx9f3a-ann.critical{border-color:#ffcdd2;border-left-color:#c62828;background:#ffebee}',
    '.ghx9f3a-ann-head{display:flex;align-items:flex-start;gap:8px}',
    '.ghx9f3a-ann-icon{flex:0 0 auto;width:15px;height:15px;margin-top:1px;color:#155DFC}',
    '.ghx9f3a-ann.warning .ghx9f3a-ann-icon{color:#ef6c00}',
    '.ghx9f3a-ann.critical .ghx9f3a-ann-icon{color:#c62828}',
    '.ghx9f3a-ann-icon svg,.ghx9f3a-ann-link svg{width:100%;height:100%;display:block}',
    '.ghx9f3a-ann-title{flex:1;min-width:0;font-size:13px;font-weight:600;line-height:1.45;color:#1f2937;word-break:break-word}',
    '.ghx9f3a-ann-close{flex:0 0 auto;width:18px;height:18px;border:none;background:transparent;color:#8a94a6;cursor:pointer;padding:0;line-height:1}',
    '.ghx9f3a-ann-close[hidden]{display:none}',
    '.ghx9f3a-ann-content{margin-top:5px;font-size:12px;line-height:1.6;color:#4b5563;white-space:pre-wrap;word-break:break-word}',
    '.ghx9f3a-ann-content[hidden]{display:none}',
    '.ghx9f3a-ann-link{display:inline-flex;align-items:center;gap:4px;margin-top:6px;font-size:12px;font-weight:500;color:#0d4bb5;text-decoration:none}',
    '.ghx9f3a-ann-link[hidden]{display:none}',
    '.ghx9f3a-ann-link svg{width:12px;height:12px;flex:0 0 auto}',
    '#ghx9f3a-ann-panel,#ghx9f3a-ann-overlay{display:flow-root}',
    '.ghx9f3a-privacy-note{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border-left:4px solid #c62828;background:#ffebee;border-radius:8px;font-size:12px;color:#7f1d1d}',
    '.ghx9f3a-privacy-note[hidden]{display:none}',
    '.ghx9f3a-link-btn{border:none;background:transparent;color:#0d4bb5;font-size:12px;font-weight:600;cursor:pointer;text-decoration:underline;padding:0}',
    '@media (prefers-color-scheme: dark){.ghx9f3a-panel,.ghx9f3a-sheet{background:#1f2328;border-color:#30363d}.ghx9f3a-panel-head,.ghx9f3a-sheet-head,.ghx9f3a-sheet-foot,.ghx9f3a-panel-foot{border-color:#30363d}.ghx9f3a-brand-title,.ghx9f3a-sheet-title,.ghx9f3a-card-title,.ghx9f3a-info-item span{color:#e6edf3}.ghx9f3a-card,.ghx9f3a-link-card,.ghx9f3a-side-block,.ghx9f3a-switch{background:#161b22;border-color:#30363d}.ghx9f3a-select,.ghx9f3a-input,.ghx9f3a-btn.ghost,.ghx9f3a-copy,.ghx9f3a-custom-item{background:#0d1117;border-color:#30363d;color:#e6edf3}.ghx9f3a-url{color:#c9d1d9}.ghx9f3a-ann{background:#161b22;border-color:#30363d}.ghx9f3a-ann-title{color:#e6edf3}.ghx9f3a-ann-content{color:#c9d1d9}}',
    '@media (prefers-color-scheme: dark){.ghx9f3a-tabs{background:#1f2328;border-color:#30363d}.ghx9f3a-changelog-version{color:#e6edf3}.ghx9f3a-changelog-list{color:#c9d1d9}}',
    '@media (max-width:720px){.ghx9f3a-sheet-body{grid-template-columns:1fr}.ghx9f3a-sheet-side{border-left:none;padding-left:0;border-top:1px solid #f0f1f3;padding-top:18px}.ghx9f3a-actions{grid-template-columns:1fr 1fr}}'
  ].join('\n');

  // ==================== 公告 ====================

  var ANNOUNCEMENT_URL = 'https://hubp.tbedu.top/announcements.json';
  var ANNOUNCEMENT_KEY = NS + '_announcement_dismissed';
  var ANNOUNCEMENT_LEVELS = ['info', 'warning', 'critical'];
  var ANNOUNCEMENT_ICONS = {
    info: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m8-6.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13M6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75M8 6a1 1 0 1 1 0-2a1 1 0 0 1 0 2"/></svg>',
    warning: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0M9 11a1 1 0 1 1-2 0a1 1 0 0 1 2 0"/></svg>',
    close: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326a.75.75 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275a.75.75 0 0 1-.734-.215L8 9.06l-3.22 3.22a.75.75 0 0 1-1.042-.018a.75.75 0 0 1-.018-1.042L6.94 8L3.72 4.78a.75.75 0 0 1 0-1.06"/></svg>',
    external: '<svg viewBox="0 0 16 16"><path fill="currentColor" d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2m6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03L9.28 7.78a.75.75 0 0 1-1.042-.018a.75.75 0 0 1-.018-1.042l3.75-3.75l-1.543-1.543A.25.25 0 0 1 10.604 1"/></svg>'
  };

  function announcementTime(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
    }
    var parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeAnnouncement(raw, now) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    var id = raw.id === null || raw.id === undefined ? '' : String(raw.id).trim();
    var title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!id || !title) return null;

    var target = (typeof raw.target === 'string' ? raw.target.trim().toLowerCase() : '') || 'both';
    if (target !== 'extension' && target !== 'both') return null;

    var startAt = announcementTime(raw.startAt);
    var endAt = announcementTime(raw.endAt);
    if (startAt !== null && now < startAt) return null;
    if (endAt !== null && now >= endAt) return null;

    var level = ANNOUNCEMENT_LEVELS.indexOf(String(raw.level || '').toLowerCase()) >= 0
      ? String(raw.level).toLowerCase()
      : 'info';

    var link = typeof raw.link === 'string' ? raw.link.trim() : '';
    if (link && !/^https?:\/\//i.test(link)) link = '';

    return {
      id: id,
      level: level,
      title: title,
      content: typeof raw.content === 'string' ? raw.content.trim() : '',
      link: link,
      linkText: typeof raw.linkText === 'string' && raw.linkText.trim() ? raw.linkText.trim() : '查看详情',
      dismissible: raw.dismissible !== false
    };
  }

  function pickAnnouncement(items, now) {
    if (!Array.isArray(items)) return null;
    var current = typeof now === 'number' ? now : Date.now();
    for (var i = 0; i < items.length; i++) {
      var item = normalizeAnnouncement(items[i], current);
      if (item) return item;
    }
    return null;
  }

  function announcementHtml(item) {
    return [
      '<div class="ghx9f3a-ann ' + item.level + '" data-' + NS + '-ann-id="' + esc(item.id) + '">',
      '  <div class="ghx9f3a-ann-head">',
      '    <span class="ghx9f3a-ann-icon">' + (item.level === 'info' ? ANNOUNCEMENT_ICONS.info : ANNOUNCEMENT_ICONS.warning) + '</span>',
      '    <span class="ghx9f3a-ann-title">' + esc(item.title) + '</span>',
      item.dismissible ? '    <button type="button" class="ghx9f3a-ann-close" data-' + NS + '-action="dismiss-ann">' + ANNOUNCEMENT_ICONS.close + '</button>' : '',
      '  </div>',
      item.content ? '  <div class="ghx9f3a-ann-content">' + esc(item.content) + '</div>' : '',
      item.link ? '  <a class="ghx9f3a-ann-link" href="' + esc(item.link) + '" target="_blank" rel="noopener noreferrer"><span class="ghx9f3a-ann-link-text">' + esc(item.linkText) + '</span>' + ANNOUNCEMENT_ICONS.external + '</a>' : '',
      '</div>'
    ].join('');
  }

  function renderAnnouncement(host, item) {
    if (!host) return;
    host.innerHTML = item ? announcementHtml(item) : '';
    host.classList.toggle('ghx9f3a-has-ann', !!item);
  }

  function loadAnnouncement() {
    var dismissed = gmGet(ANNOUNCEMENT_KEY, []);
    if (!Array.isArray(dismissed)) dismissed = [];

    return gmRequest({ url: ANNOUNCEMENT_URL + '?t=' + Date.now(), timeout: 6000 })
      .then(function (res) {
        if (res.status >= 400) throw new Error('HTTP ' + res.status);
        var data = JSON.parse(res.responseText);
        if (!data || !Array.isArray(data.items)) throw new Error('公告数据格式异常');
        var item = pickAnnouncement(data.items, Date.now());
        if (!item || dismissed.indexOf(item.id) !== -1) return null;
        state.announcement = item;
        log('announcement:', item.id, item.level);
        renderAnnouncement(document.getElementById(NS + '-ann-panel'), item);
        renderAnnouncement(document.getElementById(NS + '-ann-overlay'), item);
        return item;
      })
      .catch(function (error) {
        console.warn('[' + NS + '] 公告加载失败，已忽略:', error && error.message ? error.message : error);
        log('announcement skipped:', error && error.message);
        return null;
      });
  }

  function dismissAnnouncement() {
    if (!state.announcement) return;
    var dismissed = gmGet(ANNOUNCEMENT_KEY, []);
    if (!Array.isArray(dismissed)) dismissed = [];
    if (dismissed.indexOf(state.announcement.id) === -1) {
      dismissed.push(state.announcement.id);
      gmSet(ANNOUNCEMENT_KEY, dismissed.slice(-50));
    }
    renderAnnouncement(document.getElementById(NS + '-ann-panel'), null);
    renderAnnouncement(document.getElementById(NS + '-ann-overlay'), null);
    state.announcement = null;
  }

  // ==================== DOM 工具 ====================

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function qs(selector) {
    return document.querySelector('#' + NS + '-root ' + selector);
  }

  function qsa(selector) {
    return Array.prototype.slice.call(document.querySelectorAll('#' + NS + '-root ' + selector));
  }

  // ==================== UI 构建 ====================

  function ensureUI() {
    if (document.getElementById(NS + '-root') || !document.body) return false;

    addStyle(STYLE);

    var root = document.createElement('div');
    root.id = NS + '-root';
    root.innerHTML = [
      '<button type="button" class="ghx9f3a-fab" data-' + NS + '-action="toggle-panel" title="GitHub Accelerator">',
      '  <span>⚡</span><span class="ghx9f3a-fab-text">初始化</span>',
      '</button>',
            '<div id="' + NS + '-panel" class="ghx9f3a-panel" hidden>',
      '  <div class="ghx9f3a-panel-head">',
      '    <div class="ghx9f3a-brand">',
      '      <span class="ghx9f3a-brand-icon">⚡</span>',
      '      <div><div class="ghx9f3a-brand-title">GitHub Accelerator</div><div class="ghx9f3a-brand-sub">节点加速 · 脚本版 v' + VERSION + '</div></div>',
      '    </div>',
      '    <button type="button" class="ghx9f3a-close" data-' + NS + '-action="close-panel" aria-label="关闭">×</button>',
      '  </div>',
      '  <div class="ghx9f3a-tabs">',
      '    <button type="button" class="ghx9f3a-tab active" data-' + NS + '-action="tab-node">节点</button>',
      '    <button type="button" class="ghx9f3a-tab" data-' + NS + '-action="tab-stats">统计</button>',
      '    <button type="button" class="ghx9f3a-tab" data-' + NS + '-action="tab-about">关于</button>',
      '  </div>',
      '  <div class="ghx9f3a-panel-body">',
      '    <div id="' + NS + '-view-node">',
      '      <div id="' + NS + '-privacy-note" class="ghx9f3a-privacy-note" hidden>隐私政策未同意，拦截与测速已禁用 <button type="button" class="ghx9f3a-link-btn" data-' + NS + '-action="open-privacy-gate">重新开启</button></div>',
      '      <div id="' + NS + '-ann-panel"></div>',
      '      <div class="ghx9f3a-card">',
      '        <div class="ghx9f3a-card-head"><span class="ghx9f3a-card-title">当前节点</span><span id="' + NS + '-latency-badge" class="ghx9f3a-badge default">-</span></div>',
      '        <select id="' + NS + '-node-select" class="ghx9f3a-select" data-' + NS + '-action="select-node-panel"><option value="">加载中...</option></select>',
      '        <div class="ghx9f3a-row">',
      '          <button type="button" class="ghx9f3a-btn primary" data-' + NS + '-action="speedtest">节点测速</button>',
      '          <button type="button" class="ghx9f3a-btn ghost" data-' + NS + '-action="copy-node">复制地址</button>',
      '          <button type="button" class="ghx9f3a-btn ghost" data-' + NS + '-action="refresh-location">重测 IP</button>',
      '        </div>',
      '      </div>',
      '      <details class="ghx9f3a-card">',
      '        <summary class="ghx9f3a-card-title" style="cursor:pointer">自定义节点</summary>',
      '        <div class="ghx9f3a-custom-input">',
      '          <input id="' + NS + '-custom-url" class="ghx9f3a-input" type="text" placeholder="https://gh.example.com">',
      '          <button type="button" class="ghx9f3a-btn primary" data-' + NS + '-action="add-custom">添加</button>',
      '        </div>',
      '        <div id="' + NS + '-custom-list"></div>',
      '      </details>',
      '      <div class="ghx9f3a-card">',
      '        <div class="ghx9f3a-info-grid">',
      '          <div class="ghx9f3a-info-item"><small>地理位置</small><span id="' + NS + '-location">检测中...</span></div>',
      '          <div class="ghx9f3a-info-item"><small>响应延迟</small><span id="' + NS + '-node-latency">-</span></div>',
      '          <div class="ghx9f3a-info-item"><small>当前节点</small><span id="' + NS + '-node-url">-</span></div>',
      '          <div class="ghx9f3a-info-item"><small>缓存剩余</small><span id="' + NS + '-cache-ttl">-</span></div>',
      '          <div class="ghx9f3a-info-item"><small>状态</small><span id="' + NS + '-status">初始化中</span></div>',
      '        </div>',
      '      </div>',
      '      <label class="ghx9f3a-switch"><input type="checkbox" data-' + NS + '-action="always"> <span><strong>始终使用加速链接</strong><small>访问下载链接时自动跳转，不再询问</small></span></label>',
      '    </div>',
      '    <div id="' + NS + '-view-stats" hidden>',
      '      <div class="ghx9f3a-card">',
      '        <div class="ghx9f3a-card-title">本机</div>',
      '        <div class="ghx9f3a-info-grid" style="margin-top:10px">',
      '          <div class="ghx9f3a-info-item"><small>加速跳转</small><span id="' + NS + '-stat-jumps">0</span></div>',
      '          <div class="ghx9f3a-info-item"><small>安装/更新</small><span id="' + NS + '-stat-installs">0</span></div>',
      '          <div class="ghx9f3a-info-item"><small>缓存时间</small><span id="' + NS + '-stat-tested">-</span></div>',
      '          <div class="ghx9f3a-info-item"><small>自定义节点</small><span id="' + NS + '-stat-custom">0</span></div>',
      '        </div>',
      '      </div>',
      '      <div class="ghx9f3a-card">',
      '        <div class="ghx9f3a-card-head"><span class="ghx9f3a-card-title">全网</span><button type="button" class="ghx9f3a-btn ghost" data-' + NS + '-action="refresh-stats">刷新</button></div>',
      '        <div class="ghx9f3a-info-grid">',
      '          <div class="ghx9f3a-info-item"><small>累计加速</small><span id="' + NS + '-cloud-jumps">—</span></div>',
      '          <div class="ghx9f3a-info-item"><small>累计安装</small><span id="' + NS + '-cloud-installs">—</span></div>',
      '          <div class="ghx9f3a-info-item"><small>扩展贡献</small><span id="' + NS + '-cloud-ext">—</span></div>',
      '          <div class="ghx9f3a-info-item"><small>脚本贡献</small><span id="' + NS + '-cloud-us">—</span></div>',
      '        </div>',
      '        <div class="ghx9f3a-side-note" id="' + NS + '-cloud-updated" style="margin-top:10px">来自 addon-analytics.hubp.org</div>',
      '      </div>',
      '    </div>',
      '    <div id="' + NS + '-view-about" hidden>',
      '      <div class="ghx9f3a-card">',
      '        <div class="ghx9f3a-card-head"><span class="ghx9f3a-card-title">版本</span><button type="button" class="ghx9f3a-btn ghost" data-' + NS + '-action="check-update">检测更新</button></div>',
      '        <div class="ghx9f3a-side-note" id="' + NS + '-update-status">脚本 v' + VERSION + ' · 从更新页安装后脚本管理器会自动检查更新</div>',
      '        <a class="ghx9f3a-btn primary" id="' + NS + '-update-link" href="' + UPDATE_URL + '" target="_blank" rel="noopener noreferrer" hidden style="margin-top:10px">打开更新页</a>',
      '      </div>',
      '      <div class="ghx9f3a-card">',
      '        <div class="ghx9f3a-card-title">更新日志</div>',
      '        <div id="' + NS + '-changelog" class="ghx9f3a-changelog"></div>',
      '      </div>',
      '      <div class="ghx9f3a-card">',
      '        <div class="ghx9f3a-card-title">隐私</div>',
      '        <div class="ghx9f3a-side-note" style="margin-top:6px">只请求节点列表、测速图片、官网公告、加速链接与匿名计数；不收集浏览历史、不读取页面内容。</div>',
      '        <div class="ghx9f3a-row" style="grid-template-columns:1fr 1fr;margin-top:10px">',
      '          <a class="ghx9f3a-btn ghost" href="' + PRIVACY_URL + '" target="_blank" rel="noopener noreferrer">完整政策</a>',
      '          <a class="ghx9f3a-btn ghost" href="https://www.hubp.org/projects/extension" target="_blank" rel="noopener noreferrer">项目主页</a>',
      '        </div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div class="ghx9f3a-panel-foot">Powered By <a href="https://www.hubp.org" target="_blank" rel="noopener noreferrer">hubp.org</a> · <a href="#" data-' + NS + '-action="tab-stats">统计</a> · <a href="#" data-' + NS + '-action="tab-about">关于</a></div>',
      '</div>',
'<div id="' + NS + '-overlay" class="ghx9f3a-overlay" hidden>',
      '  <div class="ghx9f3a-mask" data-' + NS + '-action="close-overlay"></div>',
      '  <div class="ghx9f3a-sheet" role="dialog" aria-modal="true">',
      '    <div class="ghx9f3a-sheet-head">',
      '      <div><div class="ghx9f3a-sheet-title">下载加速</div><div class="ghx9f3a-sheet-sub">智能 GitHub 下载加速器</div></div>',
      '      <div style="display:flex;align-items:center;gap:10px">',
      '        <div id="' + NS + '-location-status" class="ghx9f3a-location-status global"><span class="ghx9f3a-spinner"></span><span id="' + NS + '-location-text">检测中...</span></div>',
      '        <button type="button" class="ghx9f3a-close" data-' + NS + '-action="close-overlay" aria-label="关闭">×</button>',
      '      </div>',
      '    </div>',
      '    <div class="ghx9f3a-sheet-body">',
      '      <div class="ghx9f3a-sheet-main">',
      '        <div id="' + NS + '-ann-overlay"></div>',
      '        <div class="ghx9f3a-link-card">',
      '          <div class="ghx9f3a-link-head"><span>原始链接</span><button type="button" class="ghx9f3a-copy" data-' + NS + '-action="copy-original">复制</button></div>',
      '          <div class="ghx9f3a-url" id="' + NS + '-original-url"></div>',
      '        </div>',
      '        <div class="ghx9f3a-link-card">',
      '          <div class="ghx9f3a-link-head"><span>加速链接</span><button type="button" class="ghx9f3a-copy primary-text" data-' + NS + '-action="copy-accel">复制</button></div>',
      '          <div class="ghx9f3a-url" id="' + NS + '-accel-url"></div>',
      '        </div>',
      '        <div class="ghx9f3a-actions">',
      '          <button type="button" class="ghx9f3a-btn primary" data-' + NS + '-action="use-accel">⚡ 使用加速链接</button>',
      '          <button type="button" class="ghx9f3a-btn ghost" data-' + NS + '-action="use-direct">直接下载</button>',
      '          <button type="button" class="ghx9f3a-btn ghost" data-' + NS + '-action="close-overlay">返回</button>',
      '        </div>',
      '        <div id="' + NS + '-countdown" class="ghx9f3a-countdown" hidden>将在 <strong id="' + NS + '-timer">10</strong> 秒后自动使用加速链接...</div>',
      '      </div>',
      '      <aside class="ghx9f3a-sheet-side">',
      '        <div class="ghx9f3a-side-block">',
      '          <div class="ghx9f3a-side-label">加速节点</div>',
      '          <select id="' + NS + '-overlay-node-select" class="ghx9f3a-select" data-' + NS + '-action="select-node-overlay"><option value="">加载中...</option></select>',
      '          <div class="ghx9f3a-side-row"><span id="' + NS + '-overlay-latency" class="ghx9f3a-badge default">-</span><button type="button" class="ghx9f3a-btn ghost" data-' + NS + '-action="refresh-location">重测 IP</button></div>',
      '        </div>',
      '        <label class="ghx9f3a-switch"><input type="checkbox" data-' + NS + '-action="always-overlay"> <span><strong>始终使用加速链接</strong><small>之后不再显示此页面</small></span></label>',
      '        <div class="ghx9f3a-side-note">公益服务，请勿滥用。支持 Releases、Archive、Raw、Code Download 等下载场景。</div>',
      '      </aside>',
      '    </div>',
      '    <div class="ghx9f3a-sheet-foot">智能域名转换 + 节点加速 · Powered By <a href="https://www.hubp.org" target="_blank" rel="noopener noreferrer">hubp.org</a></div>',
      '  </div>',
      '</div>',
      '<div id="' + NS + '-privacy" class="ghx9f3a-overlay" hidden>',
      '  <div class="ghx9f3a-mask"></div>',
      '  <div class="ghx9f3a-sheet" style="max-width:520px">',
      '    <div class="ghx9f3a-sheet-head"><div><div class="ghx9f3a-sheet-title">隐私说明</div><div class="ghx9f3a-sheet-sub">首次使用请确认数据范围</div></div></div>',
      '    <div style="padding:22px 26px">',
      '      <div style="font-size:13px;line-height:1.7;color:#4b5563">本脚本只会请求：节点列表、节点测速图片、官网公告、匿名使用计数（加速次数 / 安装次数）。不收集浏览历史、不读取页面内容、不发送可识别身份的信息。统计可在脚本菜单里随时关闭。</div>',
      '      <div class="ghx9f3a-actions" style="grid-template-columns:1fr 1fr;margin-top:18px">',
      '        <button type="button" class="ghx9f3a-btn primary" data-' + NS + '-action="accept-privacy">同意并启用</button>',
      '        <button type="button" class="ghx9f3a-btn ghost" data-' + NS + '-action="reject-privacy">拒绝</button>',
      '      </div>',
      '      <div style="margin-top:10px;font-size:11px;color:#9aa3af">拒绝后拦截与测速不会启用，可随时在脚本菜单重新开启。</div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('\n');

    document.body.appendChild(root);
    root.addEventListener('click', onRootClick);
    root.addEventListener('change', onRootChange);
    document.addEventListener('keydown', onKeydown);

    renderPanelNodes();
    renderCustomNodes();
    renderLocation();
    updateFab();
    return true;
  }

  function showPrivacyGate() {
    ensureUI();
    var gate = document.getElementById(NS + '-privacy');
    if (gate) gate.hidden = false;
  }

  function hidePrivacyGate() {
    var gate = document.getElementById(NS + '-privacy');
    if (gate) gate.hidden = true;
  }

  function showPrivacyNote(shown) {
    var note = document.getElementById(NS + '-privacy-note');
    if (note) note.hidden = !shown;
  }

  function updateFab() {
    var fab = qs('.ghx9f3a-fab');
    if (!fab) return;
    var text = fab.querySelector('.ghx9f3a-fab-text');
    if (!text) return;
    fab.classList.remove('is-loading', 'is-idle');
    if (state.loading) {
      var progress = state.speedProgress;
      var fastest = state.best && state.best.latency > 0 ? ' · ' + state.best.latency + 'ms' : '';
      text.textContent = progress
        ? '测速 ' + progress.done + '/' + progress.total + fastest
        : '测速中…';
      fab.classList.add('is-loading');
    } else if (state.best && state.best.latency > 0) {
      text.textContent = state.best.latency + 'ms';
    } else if (state.best) {
      text.textContent = hostOf(state.best.url);
      fab.classList.add('is-idle');
    } else {
      text.textContent = '未就绪';
      fab.classList.add('is-idle');
    }
  }

  function nodeEmoji(node, index, total) {
    if (node.isCustom) return '⭐';
    if (!(node.latency > 0)) return '⚪';
    if (node.latency < 300) return '🟢';
    if (node.latency < 800) return '🟠';
    return '🔴';
  }

  function fillNodeSelect(select, currentUrl) {
    if (!select) return;
    var nodes = allNodes();
    if (!nodes.length) {
      select.innerHTML = '<option value="">加载中...</option>';
      return;
    }
    var html = nodes.map(function (node, index) {
      var latency = node.latency > 0 ? node.latency + 'ms' : '未测速';
      var selected = node.url === currentUrl ? ' selected' : '';
      return '<option value="' + esc(node.url) + '"' + selected + '>' +
        nodeEmoji(node, index, nodes.length) + ' ' + esc(hostOf(node.url)) + ' (' + latency + ')</option>';
    }).join('');
    select.innerHTML = html;
    if (currentUrl) select.value = currentUrl;
  }

  function updateBadge(badge, latency) {
    if (!badge) return;
    badge.textContent = latency > 0 ? latency + 'ms' : '-';
    badge.className = 'ghx9f3a-badge ' + latencyBadgeClass(latency);
  }

  function renderPanelNodes() {
    var select = document.getElementById(NS + '-node-select');
    var badge = document.getElementById(NS + '-latency-badge');
    if (!select) return;
    var currentUrl = state.best ? state.best.url : '';
    fillNodeSelect(select, currentUrl);
    updateBadge(badge, state.best ? state.best.latency : -1);

    var nodeUrlEl = document.getElementById(NS + '-node-url');
    var nodeLatencyEl = document.getElementById(NS + '-node-latency');
    var cacheTtlEl = document.getElementById(NS + '-cache-ttl');
    var statusEl = document.getElementById(NS + '-status');
    var cache = gmGet(KEYS.cache, null);

    if (nodeUrlEl) {
      nodeUrlEl.textContent = currentUrl || '-';
      nodeUrlEl.title = currentUrl || '';
    }
    if (nodeLatencyEl) nodeLatencyEl.textContent = state.best && state.best.latency > 0 ? state.best.latency + 'ms' : '默认节点';
    if (cacheTtlEl) cacheTtlEl.textContent = cache && cache.testedAt ? formatRemaining(cache.testedAt) : '-';
    if (statusEl) {
      statusEl.textContent = state.loading ? '测速中' : (state.best ? '运行中' : '初始化中');
      statusEl.style.color = state.best ? '#2e7d32' : '#666';
    }

    var alwaysBox = qs('[data-' + NS + '-action="always"]');
    if (alwaysBox) alwaysBox.checked = isAlways();
  }

  function renderOverlayNodes() {
    var select = document.getElementById(NS + '-overlay-node-select');
    var badge = document.getElementById(NS + '-overlay-latency');
    if (!select) return;
    var currentUrl = state.best ? state.best.url : '';
    fillNodeSelect(select, currentUrl);
    updateBadge(badge, state.best ? state.best.latency : -1);
  }

  function renderOverlayLinks() {
    if (!state.pending) return;
    var originalEl = document.getElementById(NS + '-original-url');
    var accelEl = document.getElementById(NS + '-accel-url');
    var accelUrl = buildAccelerated(state.best ? state.best.url : '', state.pending.url);
    if (originalEl) originalEl.textContent = state.pending.url;
    if (accelEl) accelEl.textContent = accelUrl || '生成中...';
    return accelUrl;
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('zh-CN');
  }

  function switchTab(name) {
    ['node', 'stats', 'about'].forEach(function (tab) {
      var view = document.getElementById(NS + '-view-' + tab);
      if (view) view.hidden = tab !== name;
      var btn = qs('[data-' + NS + '-action="tab-' + tab + '"]');
      if (btn) btn.classList.toggle('active', tab === name);
    });
    if (name === 'stats') {
      renderLocalStats();
      loadCloudStats();
    }
    if (name === 'about') renderChangelog();
  }

  function renderLocalStats() {
    var cache = gmGet(KEYS.cache, null);
    setText(NS + '-stat-jumps', formatNumber(gmGet(KEYS.jumps, 0)));
    setText(NS + '-stat-installs', formatNumber(gmGet(KEYS.installs, 0)));
    setText(NS + '-stat-tested', cache && cache.testedAt ? formatRemaining(cache.testedAt) : '-');
    setText(NS + '-stat-custom', String(state.custom.length));
  }

  function renderChangelog() {
    var host = document.getElementById(NS + '-changelog');
    if (!host) return;
    host.innerHTML = CHANGELOG.map(function (entry) {
      var items = entry.items.map(function (item) {
        return '<li>' + esc(item) + '</li>';
      }).join('');
      return '<div class="ghx9f3a-changelog-item"><div class="ghx9f3a-changelog-version">v' + esc(entry.version) +
        (entry.version === VERSION ? ' · 当前版本' : '') +
        '</div><ul class="ghx9f3a-changelog-list">' + items + '</ul></div>';
    }).join('');
  }

  function loadCloudStats() {
    setText(NS + '-cloud-updated', '加载中…');
    function get(url) {
      return gmRequest({ url: url, timeout: 6000 }).then(function (res) {
        if (res.status >= 400) throw new Error('HTTP ' + res.status);
        return JSON.parse(res.responseText);
      });
    }
    return get('https://addon-analytics.hubp.org/stats/summary')
      .catch(function () {
        return get('https://addon-analytics-hubp.tbedu.top/stats/summary');
      })
      .then(function (data) {
        setText(NS + '-cloud-jumps', formatNumber(data.total_jumps));
        setText(NS + '-cloud-installs', formatNumber(data.total_installs));
        var jumps = data.jumps_by_source || {};
        setText(NS + '-cloud-ext', formatNumber(jumps.extension));
        setText(NS + '-cloud-us', formatNumber(jumps.userscript));
        setText(NS + '-cloud-updated', data.last_updated
          ? '更新于 ' + new Date(data.last_updated).toLocaleString('zh-CN')
          : '来自 addon-analytics.hubp.org');
      })
      .catch(function () {
        setText(NS + '-cloud-updated', '云端统计加载失败，稍后重试');
      });
  }

  function compareVersion(a, b) {
    var pa = String(a || '0').split('.').map(Number);
    var pb = String(b || '0').split('.').map(Number);
    var len = Math.max(pa.length, pb.length);
    for (var i = 0; i < len; i++) {
      var x = pa[i] || 0;
      var y = pb[i] || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }

  // 自动更新由脚本管理器的 @updateURL 负责；这里做手动检测 + 更新入口
  function checkUpdate() {
    var statusEl = document.getElementById(NS + '-update-status');
    var linkEl = document.getElementById(NS + '-update-link');
    var btn = qs('[data-' + NS + '-action="check-update"]');
    if (statusEl) statusEl.textContent = '检测中…';
    if (linkEl) linkEl.hidden = true;
    if (btn) btn.disabled = true;

    function fetchScript(url) {
      return gmRequest({ url: url + '?t=' + Date.now(), timeout: 10000 }).then(function (res) {
        if (res.status >= 400) throw new Error('HTTP ' + res.status);
        var match = String(res.responseText).match(/@version\s+([\d.]+)/);
        if (!match) throw new Error('无法解析版本号');
        return { version: match[1], url: url };
      });
    }

    return fetchScript(UPDATE_URL)
      .catch(function () {
        return fetchScript(UPDATE_FALLBACK_URL);
      })
      .then(function (remote) {
        if (compareVersion(remote.version, VERSION) > 0) {
          if (statusEl) statusEl.textContent = '发现新版本 v' + remote.version + '（当前 v' + VERSION + '）';
          if (linkEl) {
            linkEl.href = remote.url;
            linkEl.hidden = false;
          }
        } else {
          if (statusEl) statusEl.textContent = '已是最新版本（v' + VERSION + '）';
        }
      })
      .catch(function (error) {
        if (statusEl) statusEl.textContent = '检测失败：' + (error && error.message ? error.message : '网络错误');
      })
      .finally(function () {
        if (btn) btn.disabled = false;
      });
  }

  function renderCustomNodes() {
    var list = document.getElementById(NS + '-custom-list');
    if (!list) return;
    if (!state.custom.length) {
      list.innerHTML = '<div style="font-size:12px;color:#999;text-align:center;padding:8px">暂无自定义节点</div>';
      return;
    }
    list.innerHTML = state.custom.map(function (node) {
      var latency = node.latency > 0 ? node.latency + 'ms' : '未测速';
      return '<div class="ghx9f3a-custom-item">' +
        '<span class="ghx9f3a-custom-host" title="' + esc(node.url) + '">⭐ ' + esc(hostOf(node.url)) + '</span>' +
        '<span class="ghx9f3a-custom-latency">' + latency + '</span>' +
        '<button type="button" class="ghx9f3a-icon-btn" data-' + NS + '-action="edit-custom" data-' + NS + '-url="' + esc(node.url) + '">✏️</button>' +
        '<button type="button" class="ghx9f3a-icon-btn danger" data-' + NS + '-action="remove-custom" data-' + NS + '-url="' + esc(node.url) + '">🗑️</button>' +
        '</div>';
    }).join('');
  }

  function renderLocation() {
    var locationEl = document.getElementById(NS + '-location');
    var statusText = document.getElementById(NS + '-location-text');
    var statusBox = document.getElementById(NS + '-location-status');
    var location = state.location;

    if (!location) {
      if (statusText) statusText.textContent = '检测代理状态中...';
      return;
    }

    var name = countryName(location.country);
    if (location.isChinaMainland) {
      if (locationEl) locationEl.innerHTML = name + ' <span style="color:#c62828;font-size:11px;font-weight:600">[GFW限制]</span>';
      if (statusBox) statusBox.className = 'ghx9f3a-location-status global';
      if (statusText) statusText.textContent = name + ' · 未开启代理 · 将自动加速';
    } else if (location.country && location.country !== 'unknown') {
      if (locationEl) locationEl.innerHTML = name + ' <span style="color:#2e7d32;font-size:11px;font-weight:600">[可直连]</span>';
      if (statusBox) statusBox.className = 'ghx9f3a-location-status cn';
      if (statusText) statusText.textContent = name + ' · 已开启代理 · 请手动选择';
    } else {
      if (locationEl) locationEl.textContent = '检测失败';
      if (statusText) statusText.textContent = '检测失败';
    }
  }

  // ==================== 覆盖层 ====================

  function openOverlay(url) {
    log('intercept:', url);
    state.pending = { url: url };
    state.overlayOpen = true;
    ensureUI();
    var overlay = document.getElementById(NS + '-overlay');
    if (!overlay) return;
    overlay.hidden = false;
    stopCountdown();

    var alwaysBox = qs('[data-' + NS + '-action="always-overlay"]');
    if (alwaysBox) alwaysBox.checked = isAlways();

    renderOverlayNodes();
    renderOverlayLinks();
    updateOverlayLocation();
  }

  function updateOverlayLocation() {
    detectLocation().then(function (location) {
      renderLocation();
      var overlay = document.getElementById(NS + '-overlay');
      if (!overlay || overlay.hidden) return;
      // 与扩展一致：已开代理（非大陆）不倒计时；未开代理且开启始终加速才倒计时
      if (location && location.isChinaMainland === true && isAlways()) {
        startCountdown();
      } else {
        stopCountdown();
      }
    });
  }

  function closeOverlay() {
    stopCountdown();
    state.pending = null;
    state.overlayOpen = false;
    var overlay = document.getElementById(NS + '-overlay');
    if (overlay) overlay.hidden = true;
  }

  function startCountdown() {
    stopCountdown();
    var countdownEl = document.getElementById(NS + '-countdown');
    var timerEl = document.getElementById(NS + '-timer');
    if (!countdownEl || !timerEl) return;

    state.countdownLeft = COUNTDOWN_SECONDS;
    timerEl.textContent = state.countdownLeft;
    countdownEl.hidden = false;

    state.countdownTimer = setInterval(function () {
      state.countdownLeft--;
      if (timerEl) timerEl.textContent = state.countdownLeft;
      if (state.countdownLeft <= 0) {
        stopCountdown();
        useAccelerated();
      }
    }, 1000);
  }

  function stopCountdown() {
    if (state.countdownTimer) {
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
    }
    var countdownEl = document.getElementById(NS + '-countdown');
    if (countdownEl) countdownEl.hidden = true;
  }

  function useAccelerated() {
    if (!state.pending) return;
    var accelUrl = buildAccelerated(state.best ? state.best.url : '', state.pending.url);
    if (!accelUrl) return;
    log('accelerate:', accelUrl);
    logJump();
    closeOverlay();
    window.location.href = accelUrl;
  }

  function useDirect() {
    if (!state.pending) return;
    var url = state.pending.url;
    log('direct:', url);
    state.skip = { url: url, until: Date.now() + 10000 };
    closeOverlay();
    window.location.href = url;
  }

  // ==================== 交互 ====================

  function onKeydown(event) {
    if (event.key === 'Escape' && state.overlayOpen) closeOverlay();
  }

  function onRootClick(event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    var el = target.closest('[data-' + NS + '-action]');
    if (!el) return;
    // select 的 click 不能 preventDefault，否则下拉打不开；它走 change 分支
    if (el.tagName !== 'SELECT') event.preventDefault();
    var action = el.getAttribute('data-' + NS + '-action');

    if (action === 'accept-privacy') {
      gmSet(KEYS.privacy, true);
      hidePrivacyGate();
      showPrivacyNote(false);
      ensureInstalled();
      startCore();
      flushStats();
      return;
    }
    if (action === 'reject-privacy') {
      gmSet(KEYS.privacy, false);
      hidePrivacyGate();
      showPrivacyNote(true);
      return;
    }
    if (action === 'tab-node' || action === 'tab-stats' || action === 'tab-about') {
      switchTab(action.slice(4));
      return;
    }
    if (action === 'refresh-stats') {
      renderLocalStats();
      loadCloudStats();
      return;
    }
    if (action === 'check-update') {
      checkUpdate();
      return;
    }
    if (action === 'open-privacy-gate') {
      showPrivacyGate();
      return;
    }
    if (action === 'toggle-panel') {
      var panel = document.getElementById(NS + '-panel');
      if (!panel) return;
      state.panelOpen = panel.hidden;
      panel.hidden = !panel.hidden;
      if (state.panelOpen) {
        renderPanelNodes();
        renderLocation();
      }
      return;
    }
    if (action === 'close-panel') {
      var p = document.getElementById(NS + '-panel');
      if (p) p.hidden = true;
      state.panelOpen = false;
      return;
    }
    if (action === 'speedtest') {
      refreshNodes(true);
      return;
    }
    if (action === 'copy-node') {
      copyText(state.best ? state.best.url : '', el);
      return;
    }
    if (action === 'refresh-location') {
      detectLocation(true).then(function () {
        renderLocation();
        bridgePush();
      });
      return;
    }
    if (action === 'add-custom') {
      var input = document.getElementById(NS + '-custom-url');
      if (!input) return;
      var value = input.value.trim();
      if (!value) { alert('请输入节点URL'); return; }
      if (!/^https:\/\//i.test(value)) { alert('节点URL必须以 https:// 开头'); return; }
      addCustomNode(value).then(function () {
        input.value = '';
        renderPanelNodes();
      });
      return;
    }
    if (action === 'edit-custom') {
      var oldUrl = el.getAttribute('data-' + NS + '-url');
      var newUrl = prompt('编辑节点URL:', oldUrl);
      if (!newUrl || newUrl === oldUrl || !/^https:\/\//i.test(newUrl)) return;
      var nodes = state.custom.map(function (node) {
        return node.url === oldUrl ? { url: newUrl.replace(/\/+$/, ''), latency: -1, addedAt: node.addedAt } : node;
      });
      saveCustomNodes(nodes);
      return;
    }
    if (action === 'remove-custom') {
      var removeUrl = el.getAttribute('data-' + NS + '-url');
      if (!confirm('确定要删除此自定义节点吗？')) return;
      saveCustomNodes(state.custom.filter(function (node) { return node.url !== removeUrl; }));
      return;
    }
    if (action === 'copy-original') {
      copyText(state.pending ? state.pending.url : '', el);
      return;
    }
    if (action === 'copy-accel') {
      var accelText = document.getElementById(NS + '-accel-url');
      copyText(accelText ? accelText.textContent : '', el);
      return;
    }
    if (action === 'use-accel') {
      useAccelerated();
      return;
    }
    if (action === 'use-direct') {
      useDirect();
      return;
    }
    if (action === 'close-overlay') {
      closeOverlay();
      return;
    }
    if (action === 'dismiss-ann') {
      dismissAnnouncement();
      return;
    }
    if (action === 'open-privacy') {
      window.open(PRIVACY_URL, '_blank');
      return;
    }
    if (action === 'open-stats') {
      window.open('https://www.hubp.org/projects/extension', '_blank');
    }
  }

  function onRootChange(event) {
    var target = event.target;
    if (!target || typeof target.getAttribute !== 'function') return;
    var action = target.getAttribute('data-' + NS + '-action');

    if (action === 'select-node-panel' || action === 'select-node-overlay') {
      var url = target.value;
      if (!url) return;
      state.selected = url;
      gmSet(KEYS.selected, url);
      state.best = pickNode(allNodes(), url);
      renderPanelNodes();
      if (action === 'select-node-overlay') {
        renderOverlayNodes();
        renderOverlayLinks();
        if (state.countdownTimer) startCountdown();
      }
      bridgePush();
      return;
    }

    if (action === 'always') {
      setAlways(target.checked);
      return;
    }

    if (action === 'always-overlay') {
      var checked = target.checked;
      setAlways(checked);
      if (checked) {
        var selectedUrl = document.getElementById(NS + '-overlay-node-select');
        if (selectedUrl && selectedUrl.value) {
          state.selected = selectedUrl.value;
          gmSet(KEYS.selected, selectedUrl.value);
          state.best = pickNode(allNodes(), selectedUrl.value);
        }
        useAccelerated();
      } else {
        stopCountdown();
      }
    }
  }

  function copyText(text, button) {
    if (!text) return;
    var done = function () {
      if (!button) return;
      var original = button.textContent;
      button.classList.add('copied');
      button.textContent = '已复制';
      setTimeout(function () {
        button.classList.remove('copied');
        button.textContent = original;
      }, 1500);
    };

    var fallback = function () {
      var textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand('copy'); } catch (e) { /* noop */ }
      textarea.remove();
      done();
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () {
        fallback();
      });
    } else {
      fallback();
    }
  }

  // ==================== 首页桥接（hubp.org） ====================

  function isHubpHost() {
    var host = String((window.location && window.location.hostname) || '').toLowerCase();
    return host === 'hubp.org' || host === 'www.hubp.org';
  }

  function bridgePayload() {
    var cache = gmGet(KEYS.cache, null);
    var nodes = cache && Array.isArray(cache.nodes) ? cache.nodes : [];
    var selected = gmGet(KEYS.selected, '') || '';
    var best = pickNode(nodes, selected);
    return {
      version: VERSION,
      privacyAccepted: gmGet(KEYS.privacy, false) === true,
      nodes: nodes.map(function (node) {
        return { url: node.url, latency: Math.max(0, Math.round(node.latency || 0)) };
      }),
      nodesTestedAt: cache && typeof cache.testedAt === 'number' && cache.testedAt > 0 ? cache.testedAt : null,
      bestNode: best ? {
        url: best.url,
        latency: typeof best.latency === 'number' ? Math.round(best.latency) : -1,
        timestamp: cache && cache.testedAt ? cache.testedAt : 0
      } : null,
      counts: {
        jumps: Math.max(0, Math.floor(Number(gmGet(KEYS.jumps, 0)) || 0)),
        installs: Math.max(0, Math.floor(Number(gmGet(KEYS.installs, 0)) || 0))
      }
    };
  }

  function bridgePush() {
    if (!isHubpHost()) return;
    var payload = bridgePayload();
    log('bridge push:', payload.nodes.length, 'nodes, counts =', payload.counts);
    try {
      window.postMessage({ __ghAccelSite: true, type: 'state', payload: payload }, window.location.origin);
    } catch (e) { /* noop */ }
  }

  function bridgeBootstrap() {
    window.addEventListener('message', function (event) {
      if (event.source !== window) return;
      var data = event.data;
      if (!data || data.__ghAccelSite !== true || data.type !== 'request') return;
      bridgePush();
    });
    bridgePush();
    setTimeout(bridgePush, 700);
    setTimeout(bridgePush, 2000);
    document.addEventListener('DOMContentLoaded', bridgePush);
  }

  // ==================== 菜单 ====================

  function registerMenus() {
    if (typeof GM_registerMenuCommand !== 'function') return;

    GM_registerMenuCommand('⚡ 刷新节点测速', function () {
      refreshNodes(true);
    });

    GM_registerMenuCommand('🎯 选择节点', function () {
      var nodes = allNodes();
      if (!nodes.length) {
        alert('节点尚未加载完成，请稍后再试。');
        return;
      }
      var lines = nodes.map(function (node, index) {
        return (index + 1) + '. ' + hostOf(node.url) + ' ' + (node.latency > 0 ? node.latency + 'ms' : '未测速');
      }).join('\n');
      var input = prompt('输入节点序号（留空恢复自动选择）：\n' + lines);
      if (input === null) return;
      if (input.trim() === '') {
        state.selected = '';
        gmSet(KEYS.selected, '');
        state.best = pickNode(nodes, '');
      } else {
        var picked = nodes[parseInt(input, 10) - 1];
        if (!picked) {
          alert('序号无效。');
          return;
        }
        state.selected = picked.url;
        gmSet(KEYS.selected, picked.url);
        state.best = pickNode(nodes, picked.url);
      }
      renderPanelNodes();
      bridgePush();
    });

    GM_registerMenuCommand('🔁 切换始终加速', function () {
      var next = !isAlways();
      setAlways(next);
      alert('始终使用加速链接：' + (next ? '已开启' : '已关闭'));
      renderPanelNodes();
    });

    GM_registerMenuCommand('🗑️ 清除缓存并重新测速', function () {
      gmSet(KEYS.cache, null);
      refreshNodes(true);
    });

    GM_registerMenuCommand('🔐 隐私设置', function () {
      showPrivacyGate();
    });

    GM_registerMenuCommand('🐛 调试日志', function () {
      var next = !debugEnabled();
      gmSet(NS + '_debug', next);
      alert('调试日志：' + (next ? '已开启，按 F12 打开 Console 查看 [ghx9f3a] 输出' : '已关闭'));
    });

  }

  // ==================== 启动 ====================

  function isSkipped(url) {
    return !!(state.skip && state.skip.url === url && Date.now() < state.skip.until);
  }

  function handleDownload(href) {
    if (!isPrivacyAccepted()) return false;
    if (isSkipped(href)) return false;

    if (isAlways() && state.best) {
      logJump();
      window.location.href = buildAccelerated(state.best.url, href);
      return true;
    }

    openOverlay(href);
    return true;
  }

  function onDocumentClick(event) {
    if (event.defaultPrevented) return;
    // GitHub 是 SPA，极端情况下 body 可能被替换，确保 UI 还在
    if (!document.getElementById(NS + '-root')) ensureUI();

    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    var anchor = target.closest('a[href]');
    if (!anchor) return;

    var href = anchor.href;
    if (!isDownloadUrl(href)) return;
    if (!isPrivacyAccepted() || isSkipped(href)) return;

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();

    handleDownload(href);
  }

  function installInterceptor() {
    document.addEventListener('click', onDocumentClick, true);
  }

  // 页面级 hook：a.click() 不会被 document click 捕获，必须直接改页面原型
  // （与扩展 main-hooks.js 的 HTMLAnchorElement.prototype.click hook 等价）
  function getPageWindow() {
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow) return unsafeWindow;
    } catch (e) { /* noop */ }
    return window;
  }

  function installPageHooks(pageWindow) {
    if (!pageWindow || !pageWindow.HTMLAnchorElement) return;

    // 随机标记：页面无法预置，避免被绕过
    var installKey = '__ghx9f3a_' + Math.random().toString(36).slice(2, 10);
    try {
      if (pageWindow[installKey]) return;
      Object.defineProperty(pageWindow, installKey, {
        value: true,
        writable: false,
        enumerable: false,
        configurable: false
      });
    } catch (e) {
      try { pageWindow[installKey] = true; } catch (e2) { /* noop */ }
    }

    try {
      var proto = pageWindow.HTMLAnchorElement.prototype;
      var original = proto.click;
      if (typeof original !== 'function' || original.__ghx9f3aHooked) return;

      function hookedClick() {
        var el = this;
        var href = (typeof el.href === 'string' && el.href) ||
          (el.getAttribute && el.getAttribute('href')) || '';
        if (!href || !isPrivacyAccepted() || isSkipped(href) || !isDownloadUrl(href)) {
          return original.apply(this, arguments);
        }
        handleDownload(href);
      }
      hookedClick.__ghx9f3aHooked = true;
      proto.click = hookedClick;
    } catch (e) {
      console.warn('[' + NS + '] 页面 hook 安装失败，已降级为 click 拦截:', e);
    }
  }

  function startCore() {
    if (state.coreStarted) return;
    state.coreStarted = true;
    log('core started');

    loadCustomNodes();
    refreshNodes(false);
    detectLocation(false).then(function () {
      renderLocation();
      bridgePush();
    });
    loadAnnouncement();
    flushStats();
    startStatsScheduler();
  }

  function onDomReady() {
    ensureUI();

    var privacy = gmGet(KEYS.privacy, null);
    log('dom ready, privacy =', privacy);
    if (privacy === null) {
      // 首次运行：先确认隐私政策，与扩展打开 privacy.html 的行为一致
      showPrivacyGate();
      return;
    }
    if (privacy === true) {
      startCore();
      return;
    }
    showPrivacyNote(true);
  }

  function bootstrap() {
    if (isHubpHost()) {
      bridgeBootstrap();
      return;
    }

    // 拦截器与菜单先装上；是否真正拦截由隐私同意状态决定
    installInterceptor();
    installPageHooks(getPageWindow());
    registerMenus();

    if (document.body) {
      onDomReady();
    } else {
      document.addEventListener('DOMContentLoaded', onDomReady, { once: true });
    }
  }

  // 供本地测试与调试使用（唯一全局，避免污染 GitHub 页面）
  window.__ghx9f3a = Object.freeze({
    version: VERSION,
    PATTERNS: PATTERNS.slice(),
    isDownloadUrl: isDownloadUrl,
    transformUrl: transformUrl,
    buildAccelerated: buildAccelerated,
    normalizeNodes: normalizeNodes,
    pickNode: pickNode,
    pickAnnouncement: pickAnnouncement,
    parseCfTrace: parseCfTrace,
    bridgePayload: bridgePayload,
    sha256Hex: sha256Hex,
    getExpectedHash: getExpectedHash,
    flushStats: flushStats,
    compareVersion: compareVersion,
    checkUpdate: checkUpdate
  });

  try {
    console.info('[' + NS + '] v' + VERSION + ' loaded @ ' + ((window.location && window.location.hostname) || 'unknown'));
  } catch (e) { /* noop */ }

  try {
    bootstrap();
  } catch (error) {
    console.warn('[' + NS + '] 初始化失败:', error);
  }
})();
