// GitHub Accelerator - 共享公告模块
//
// popup、下载拦截页、统计页复用同一套公告逻辑：拉取 → 过滤 → 去重 → 渲染 → 关闭。
// 公告是增强功能：请求超时、失败、格式异常都静默降级，绝不影响页面其他功能。
//
// 用法（页面只需一个挂载点，脚本在 body 末尾引入）：
//   <div id="announcement-host"></div>
//   <script src="../shared/announcement.js"></script>
//   window.__GHXAnnouncement.init({ host: 'announcement-host' });
(function () {
  'use strict';

  var ANNOUNCEMENT_URL = 'https://hubp.tbedu.top/announcements.json';
  var REQUEST_TIMEOUT = 6000;
  var DISMISS_KEY = 'gh_accelerator_announcements_dismissed';
  var DISMISS_LIMIT = 50;
  var LEVELS = ['info', 'warning', 'critical'];
  var STYLE_ID = 'ghx-announcement-style';

  var ICONS = {
    info: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8m8-6.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13M6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75M8 6a1 1 0 1 1 0-2a1 1 0 0 1 0 2"/></svg>',
    warning: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0M9 11a1 1 0 1 1-2 0a1 1 0 0 1 2 0"/></svg>',
    close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326a.75.75 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275a.75.75 0 0 1-.734-.215L8 9.06l-3.22 3.22a.75.75 0 0 1-1.042-.018a.75.75 0 0 1-.018-1.042L6.94 8L3.72 4.78a.75.75 0 0 1 0-1.06"/></svg>',
    external: '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2m6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03L9.28 7.78a.75.75 0 0 1-1.042-.018a.75.75 0 0 1-.018-1.042l3.75-3.75l-1.543-1.543A.25.25 0 0 1 10.604 1"/></svg>'
  };

  var CSS = [
    '.ghx-announcement{box-sizing:border-box;padding:12px 14px;border:1px solid #dbe4f0;border-left:4px solid #155DFC;border-radius:8px;background:#f5f8ff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#4b5563;text-align:left}',
    '.ghx-announcement[hidden]{display:none}',
    '.ghx-announcement--warning{border-color:#ffe0b2;border-left-color:#ef6c00;background:#fff8e1}',
    '.ghx-announcement--critical{border-color:#ffcdd2;border-left-color:#c62828;background:#ffebee}',
    '.ghx-announcement-head{display:flex;align-items:flex-start;gap:8px}',
    '.ghx-announcement-icon{flex:0 0 auto;display:inline-flex;width:15px;height:15px;margin-top:1px;color:#155DFC}',
    '.ghx-announcement--warning .ghx-announcement-icon{color:#ef6c00}',
    '.ghx-announcement--critical .ghx-announcement-icon{color:#c62828}',
    '.ghx-announcement-icon svg{width:100%;height:100%;display:block}',
    '.ghx-announcement-title{flex:1;min-width:0;font-size:14px;font-weight:600;line-height:1.45;color:#1f2937;word-break:break-word}',
    '.ghx-announcement-close{flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;margin:0;border:none;border-radius:4px;background:transparent;color:#8a94a6;cursor:pointer;transition:background .15s,color .15s}',
    '.ghx-announcement-close:hover{color:#333;background:rgba(0,0,0,.06)}',
    '.ghx-announcement-close[hidden]{display:none}',
    '.ghx-announcement-close svg{width:12px;height:12px;display:block}',
    '.ghx-announcement-content{margin-top:6px;font-size:13px;line-height:1.6;color:#4b5563;white-space:pre-wrap;word-break:break-word}',
    '.ghx-announcement-content[hidden]{display:none}',
    '.ghx-announcement-link{display:inline-flex;align-items:center;gap:4px;margin-top:8px;font-size:13px;font-weight:500;color:#0d4bb5;text-decoration:none}',
    '.ghx-announcement-link:hover{text-decoration:underline}',
    '.ghx-announcement-link[hidden]{display:none}',
    '.ghx-announcement-link svg{width:12px;height:12px;display:block}'
  ].join('\n');

  function getApi() {
    return typeof browser !== 'undefined' ? browser : chrome;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }

  function parseTime(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
    }
    var parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function isActive(raw, now) {
    var startAt = parseTime(raw.startAt);
    var endAt = parseTime(raw.endAt);
    if (startAt !== null && now < startAt) return false;
    if (endAt !== null && now >= endAt) return false;
    return true;
  }

  // 归一化单条公告；数据不合法或不是面向扩展时返回 null
  function normalize(raw, now) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    var id = raw.id === null || raw.id === undefined ? '' : String(raw.id).trim();
    var title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!id || !title) return null;

    // target 缺省按 both；site 及其他取值一律跳过
    var target = (typeof raw.target === 'string' ? raw.target.trim().toLowerCase() : '') || 'both';
    if (target !== 'extension' && target !== 'both') return null;

    if (!isActive(raw, now)) return null;

    var level = LEVELS.indexOf(String(raw.level || '').toLowerCase()) >= 0
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

  // 只取第一条生效中的公告
  function pick(items, now) {
    if (!Array.isArray(items)) return null;
    var current = typeof now === 'number' ? now : Date.now();
    for (var i = 0; i < items.length; i++) {
      var item = normalize(items[i], current);
      if (item) return item;
    }
    return null;
  }

  function fetchItems() {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT) : null;
    var url = ANNOUNCEMENT_URL + '?t=' + Date.now();

    return fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (!response || !response.ok) {
        throw new Error('HTTP ' + (response ? response.status : 'unknown'));
      }
      return response.json();
    }).then(function (data) {
      if (!data || !Array.isArray(data.items)) throw new Error('公告数据格式异常');
      return data.items;
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  function getDismissed() {
    return Promise.resolve().then(function () {
      return getApi().storage.local.get([DISMISS_KEY]);
    }).then(function (result) {
      var list = result ? result[DISMISS_KEY] : null;
      return Array.isArray(list) ? list.map(String) : [];
    }).catch(function () {
      return [];
    });
  }

  function saveDismissed(ids) {
    return Promise.resolve().then(function () {
      var payload = {};
      payload[DISMISS_KEY] = ids.slice(-DISMISS_LIMIT);
      return getApi().storage.local.set(payload);
    }).catch(function (error) {
      console.warn('[公告] 关闭状态保存失败:', error);
    });
  }

  function dismiss(id) {
    return getDismissed().then(function (dismissed) {
      if (dismissed.indexOf(id) === -1) {
        dismissed.push(id);
        return saveDismissed(dismissed);
      }
    });
  }

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function build(host) {
    var root = el('div', 'ghx-announcement ghx-announcement--info');
    root.hidden = true;

    var head = el('div', 'ghx-announcement-head');
    var icon = el('span', 'ghx-announcement-icon');
    icon.setAttribute('aria-hidden', 'true');

    var title = el('span', 'ghx-announcement-title');

    var close = el('button', 'ghx-announcement-close');
    close.type = 'button';
    close.title = '关闭公告';
    close.setAttribute('aria-label', '关闭公告');
    close.innerHTML = ICONS.close;

    head.appendChild(icon);
    head.appendChild(title);
    head.appendChild(close);

    var content = el('div', 'ghx-announcement-content');
    content.hidden = true;

    var link = el('a', 'ghx-announcement-link');
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.hidden = true;
    var linkText = el('span');
    var linkIcon = el('span');
    linkIcon.innerHTML = ICONS.external;
    link.appendChild(linkText);
    link.appendChild(linkIcon);

    root.appendChild(head);
    root.appendChild(content);
    root.appendChild(link);
    host.appendChild(root);

    return {
      root: root,
      icon: icon,
      title: title,
      close: close,
      content: content,
      link: link,
      linkText: linkText
    };
  }

  function render(refs, item) {
    refs.root.className = 'ghx-announcement ghx-announcement--' + item.level;
    refs.icon.innerHTML = item.level === 'info' ? ICONS.info : ICONS.warning;
    refs.title.textContent = item.title;

    refs.content.textContent = item.content;
    refs.content.hidden = !item.content;

    if (item.link) {
      refs.link.href = item.link;
      refs.linkText.textContent = item.linkText;
      refs.link.hidden = false;
    } else {
      refs.link.removeAttribute('href');
      refs.link.hidden = true;
    }

    refs.close.hidden = !item.dismissible;
    refs.root.hidden = false;
  }

  function load(refs) {
    return fetchItems().then(function (items) {
      var item = pick(items, Date.now());
      if (!item) return null;

      return getDismissed().then(function (dismissed) {
        if (dismissed.indexOf(item.id) !== -1) return null;

        render(refs, item);

        refs.close.addEventListener('click', function () {
          refs.root.hidden = true;
          dismiss(item.id).catch(function () {});
        });

        return item;
      });
    }).catch(function (error) {
      // 网络失败、超时、JSON 异常、结构不符：一律静默降级
      console.warn('[公告] 加载失败，已忽略:', error && error.message ? error.message : error);
      return null;
    });
  }

  /**
   * 初始化公告
   * @param {{host?: string|Element}} options 挂载点（id 或元素）
   * @returns {Promise<Object|null>} 展示的公告，未展示为 null
   */
  function init(options) {
    var opts = options || {};
    var host = typeof opts.host === 'string' ? document.getElementById(opts.host) : opts.host;
    if (!host) return Promise.resolve(null);

    try {
      injectStyle();
      var refs = build(host);
      return load(refs);
    } catch (error) {
      console.warn('[公告] 初始化失败，已忽略:', error);
      return Promise.resolve(null);
    }
  }

  globalThis.__GHXAnnouncement = {
    init: init,
    pick: pick,
    normalize: normalize,
    LEVELS: LEVELS.slice()
  };
})();
