// GitHub Accelerator - 链接匹配模式公共模块（单一来源）
//
// 扩展中所有「GitHub 下载链接」的识别都从 globalThis.__GHX_LINK_PATTERNS__ 读取，
// 避免 background / bridge / main-hooks 各自维护一份 URL_PATTERNS 导致静默漂移。
//
// 使用场景：
//   - background.js：顶部 import（ESM SW / Firefox classic background），读 globalThis
//   - content/bridge.js（ISOLATED world）：manifest 中在本文件前置本脚本，读 window
//
// 注意：content/main-hooks.js 运行在 MAIN world，页面脚本可篡改全局属性，
// 因此必须保持内联自包含（见其文件头注释），不得引用本模块。
(function () {
  'use strict';

  var URL_PATTERNS = [
    '*://github.com/*/releases/download/*',
    '*://github.com/*/archive/*',
    '*://github.com/*/raw/*',
    '*://github.com/*/blob/*',
    '*://codeload.github.com/*',
    '*://raw.githubusercontent.com/*',
    '*://gist.githubusercontent.com/*/raw/*'
  ];

  var URL_PATTERN_RE = URL_PATTERNS.map(function (p) {
    // *:// 严格对应 https?://，锚定主机名，防止 https://gh.llkk.cc/https://github.com/... 之类误匹配
    return new RegExp('^' + p.replace(/^\*:\/\//, 'https?:\\/\\/').replace(/\*/g, '.*') + '$');
  });

  function isGitHubHostname(hostname) {
    if (!hostname || typeof hostname !== 'string') return false;
    var h = hostname.toLowerCase();
    return h === 'github.com' ||
      h.endsWith('.github.com') ||
      h === 'codeload.github.com' ||
      h === 'raw.githubusercontent.com' ||
      h === 'gist.githubusercontent.com';
  }

  // 校验 URL 是否命中下载模式（http/https + 路径匹配，忽略 hash）
  function isGitHubDownloadUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      var u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      var canonical = u.href.replace(/#.*$/, '');
      for (var i = 0; i < URL_PATTERN_RE.length; i++) {
        if (URL_PATTERN_RE[i].test(canonical)) return true;
      }
    } catch (e) { /* noop */ }
    return false;
  }

  globalThis.__GHX_LINK_PATTERNS__ = Object.freeze({
    URL_PATTERNS: URL_PATTERNS,
    isGitHubHostname: isGitHubHostname,
    isGitHubDownloadUrl: isGitHubDownloadUrl
  });
})();