// GitHub Accelerator - 桥接脚本（ISOLATED world）
//
// 接收 MAIN world（content/main-hooks.js）通过 window.postMessage
// 转交的下载点击事件，校验后转发给 background 裁决：
//   - active === false（未启用）→ 告知 MAIN world 保持 arm=false，页面行为不受影响
//   - 后台返回 'replay' → 转告 MAIN world 放行该 URL 的原生点击
//   - 后台返回 'done'   → 转告 MAIN world 该 URL 已被接管，清除待放行记录
(function () {
  'use strict';

  // 模式来自 shared/link-patterns.js（manifest 中本文件前置加载），与 background 单一来源
  var patterns = window.__GHX_LINK_PATTERNS__;

  function isValidInterceptUrl(url) {
    if (typeof url !== 'string' || url.length > 2048) return false;
    if (!patterns) return false;
    // 双重校验（域名 + 路径模式）：与 background 双保险，防止页面伪造消息
    if (!patterns.isGitHubHostname(new URL(url).hostname)) return false;
    return patterns.isGitHubDownloadUrl(url);
  }

  function postToMain(type, url) {
    try {
      window.postMessage({ __ghAccelBridge: true, type: type, url: url }, window.location.origin);
    } catch (e) { /* noop */ }
  }

  function reloadStateAndArm() {
    chrome.runtime.sendMessage({ type: 'GET_INTERCEPT_STATE' })
      .then(function (res) {
        postToMain('arm', !!(res && res.active));
      })
      .catch(function () {
        postToMain('arm', false);
      });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var d = event.data;
    if (!d || d.__ghAccelBridge !== true || d.type !== 'intercept') return;
    var url = typeof d.url === 'string' ? d.url.trim() : '';
    // 同步校验域名 + 下载路径模式（与 background 双保险，防页面伪造消息）
    try {
      if (!isValidInterceptUrl(url)) return;
    } catch (e) { return; }

    chrome.runtime.sendMessage({ type: 'INTERCEPT_DOWNLOAD', url: url })
      .then(function (res) {
        if (!res) return;
        postToMain(res.action === 'replay' ? 'replay' : 'done', url);
      })
      .catch(function () { /* noop */ });
  });

  // 隐私/会话状态变化时同步 arm 状态
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'local') return;
    if (changes.privacy_accepted || changes.gh_accelerator_disable_session) {
      reloadStateAndArm();
    }
  });

  reloadStateAndArm();
})();