// GitHub Accelerator - 站点桥接（hubp.org）
//
// 在 hubp.org 页面里把扩展本地的节点测速结果、使用计数交给网站展示。
// 只读：扩展不接收网站写回的数据，也不会把这些数据发往任何服务器。
(function () {
  'use strict';

  if (window.__ghAccelSiteBridge) return;
  window.__ghAccelSiteBridge = true;

  var KEYS = {
    list: 'gh_accelerator_node_list',
    listAt: 'gh_accelerator_node_list_at',
    best: 'gh_accelerator_best_node',
    jumps: 'gh_accelerator_jump_count',
    installs: 'gh_accelerator_install_count',
    privacy: 'privacy_accepted'
  };

  function send(payload) {
    try {
      window.postMessage({ __ghAccelSite: true, type: 'state', payload: payload }, window.location.origin);
    } catch (e) { /* noop */ }
  }

  function readStorage() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get([
          KEYS.list, KEYS.listAt, KEYS.best, KEYS.jumps, KEYS.installs, KEYS.privacy
        ], function (res) {
          resolve(res || {});
        });
      } catch (e) {
        resolve({});
      }
    });
  }

  function buildPayload(res) {
    var list = Array.isArray(res[KEYS.list]) ? res[KEYS.list] : [];
    var best = res[KEYS.best] || null;
    var nodes = [];
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (!n || typeof n.url !== 'string' || typeof n.latency !== 'number' || !(n.latency > 0)) continue;
      nodes.push({ url: n.url, latency: Math.round(n.latency) });
    }
    var testedAt =
      typeof res[KEYS.listAt] === 'number'
        ? res[KEYS.listAt]
        : best && typeof best.timestamp === 'number'
          ? best.timestamp
          : null;
    var version = '';
    try { version = chrome.runtime.getManifest().version || ''; } catch (e) { /* noop */ }
    return {
      version: version,
      privacyAccepted: res[KEYS.privacy] === true,
      nodes: nodes,
      nodesTestedAt: testedAt,
      bestNode: best && best.node
        ? {
            url: best.node.url,
            latency: typeof best.node.latency === 'number' ? best.node.latency : -1,
            timestamp: typeof best.timestamp === 'number' ? best.timestamp : 0
          }
        : null,
      counts: {
        jumps: Number(res[KEYS.jumps]) || 0,
        installs: Number(res[KEYS.installs]) || 0
      }
    };
  }

  function push() {
    readStorage().then(function (res) { send(buildPayload(res)); });
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    var d = event.data;
    if (!d || d.__ghAccelSite !== true || d.type !== 'request') return;
    push();
  });

  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== 'local') return;
      if (
        changes[KEYS.list] || changes[KEYS.listAt] || changes[KEYS.best] ||
        changes[KEYS.jumps] || changes[KEYS.installs]
      ) {
        push();
      }
    });
  } catch (e) { /* noop */ }

  push();
  setTimeout(push, 1200);
})();
