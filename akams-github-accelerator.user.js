// ==UserScript==
// @name         Github Accelerator
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  智能 GitHub 下载加速器 - DOM href 修改 + 域名转换
// @author       You
// @match        https://github.com/*
// @match        https://*.github.com/*
// @connect      api.akams.cn
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const CONFIG = {
    API_URL: 'https://api.akams.cn/github',
    CACHE_KEY: 'gh_accelerator_best_node',
    CACHE_DURATION: 2 * 60 * 60 * 1000,
    SPEED_TEST_COUNT: 'all',
    SPEED_TEST_TIMEOUT: 5000,
    LATENCY_TEST_IMAGE_URLS: [
      'https://raw.githubusercontent.com/microsoft/terminal/refs/heads/main/res/terminal/images/SmallTile.scale-125.png',
      'https://raw.githubusercontent.com/microsoft/vscode/refs/heads/main/resources/linux/code.png',
      'https://raw.githubusercontent.com/facebook/react/refs/heads/main/fixtures/dom/public/favicon.ico',
      'https://raw.githubusercontent.com/python/cpython/refs/heads/main/PC/icons/python.ico'
    ],
    FALLBACK_NODES: ['https://gh.llkk.cc', 'https://gh.dpik.top'],
    PATTERNS: [
      /releases\/download\//,
      /archive\/refs\//,
      /codeload\.github\.com\//,
      /raw\.githubusercontent\.com\//
    ]
  };

  let proxyUrl = null;
  let currentLocation = null;

  init();

  async function init() {
    console.log('[Github Accelerator] 🐵 油猴脚本版本初始化...');
    console.log('[Github Accelerator] ⚠️  注意: 本版本使用 DOM 修改模式（非302重定向）');
    console.log('[Github Accelerator] ✅ 但对 IDM 等下载工具完全兼容！');

    GM_registerMenuCommand('🔄 刷新节点', () => {
      GM_setValue(CONFIG.CACHE_KEY, null);
      location.reload();
    });

    currentLocation = await detectLocation();
    proxyUrl = await getBestNode();
    console.log(`[Github Accelerator] 当前节点: ${proxyUrl}`);

    processAllLinks();
    setupMutationObserver();
    showStatusBadge();
  }

  async function getBestNode() {
    const cached = GM_getValue(CONFIG.CACHE_KEY, null);

    if (cached) {
      const { node, timestamp } = cached;
      if (Date.now() - timestamp < CONFIG.CACHE_DURATION) {
        return node.url;
      }
    }

    const nodes = await fetchProxyNodes();
    const bestNode = await speedTestNodes(nodes);

    GM_setValue(CONFIG.CACHE_KEY, {
      node: bestNode,
      timestamp: Date.now()
    });

    return bestNode.url;
  }

  function detectLocation() {
    return new Promise((resolve) => {
      console.log('[Github Accelerator] 正在检测地理位置...');
      GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://api.ipapi.is/',
        onload: (response) => {
          try {
            const data = JSON.parse(response.responseText);
            const countryCode = data.country_code || data.location?.country_code || 'unknown';
            const ip = data.ip || 'unknown';

            const location = {
              ip: ip,
              country: countryCode,
              isChinaMainland: countryCode === 'CN', // 只有大陆有 GFW
              needProxy: countryCode === 'CN' // 只有大陆必须用代理
            };

            console.log(`[Github Accelerator] 地理位置：${location.country} (${location.ip})`);
            console.log(`[Github Accelerator] 是否受 GFW 限制（需代理）: ${location.needProxy ? '✅ 是（中国大陆）' : '❌ 否（可直接访问）'}`);

            resolve(location);
          } catch (e) {
            console.warn('[Github Accelerator] api.ipapi.is 失败，尝试备用 API...', e);
            tryBackupAPI(resolve);
          }
        },
        onerror: () => {
          console.warn('[Github Accelerator] api.ipapi.is 失败，尝试备用 API...');
          tryBackupAPI(resolve);
        }
      });

      function tryBackupAPI(resolve) {
        GM_xmlhttpRequest({
          method: 'GET',
          url: 'https://api.ip.sb/geoip',
          onload: (response2) => {
            try {
              const data = JSON.parse(response2.responseText);
              const countryCode = data.country_code || data.location?.country_code || 'unknown';
              const ip = data.ip || 'unknown';

              const location = {
                ip: ip,
                country: countryCode,
                isChinaMainland: countryCode === 'CN',
                needProxy: countryCode === 'CN'
              };

              resolve(location);
            } catch (e2) {
              console.warn('[Github Accelerator] 地理位置检测失败，默认启用加速');
              resolve({ ip: 'unknown', country: 'unknown', isChinaMainland: false, needProxy: true });
            }
          },
          onerror: () => {
            console.warn('[Github Accelerator] 地理位置检测失败，默认启用加速');
            resolve({ ip: 'unknown', country: 'unknown', isChinaMainland: false, needProxy: true });
          }
        });
      }
    });
  }

  function fetchProxyNodes() {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: CONFIG.API_URL,
        onload: (response) => {
          try {
            const data = JSON.parse(response.responseText);
            resolve(data.data || []);
          } catch (e) {
            reject(e);
          }
        },
        onerror: reject
      });
    });
  }

  async function speedTestNodes(nodes) {
    console.log(`[Github Accelerator] 开始并发测速... (共 ${nodes.length} 个节点)`);
    const testNodes = CONFIG.SPEED_TEST_COUNT === 'all'
      ? nodes
      : nodes.slice(0, CONFIG.SPEED_TEST_COUNT);

    console.log(`[Github Accelerator] 将测试 ${testNodes.length} 个节点`);
    console.log(`[Github Accelerator] 使用 ${CONFIG.LATENCY_TEST_IMAGE_URLS.length} 个图片资源进行延迟测试`);

    const promises = testNodes.map(node => testNodeWithImages(node.url).catch(() => null));
    const results = await Promise.allSettled(promises).then(s => s.map(x => x.value));
    const valid = results.filter(r => r !== null).sort((a, b) => a.latency - b.latency);
    return valid[0] || { url: CONFIG.FALLBACK_NODES[0], latency: -1 };
  }

  async function testNodeWithImages(url) {
    const start = performance.now();
    const proxyBaseUrl = url.replace(/\/$/, '');

    return new Promise((resolve, reject) => {
      const imagePromises = CONFIG.LATENCY_TEST_IMAGE_URLS.map(imageUrl => {
        return new Promise((resolveImg, rejectImg) => {
          GM_xmlhttpRequest({
            method: 'HEAD',
            url: `${proxyBaseUrl}/${imageUrl}`,
            timeout: CONFIG.SPEED_TEST_TIMEOUT,
            onload: () => resolveImg({ success: true }),
            onerror: rejectImg,
            ontimeout: rejectImg
          });
        });
      });

      Promise.allSettled(imagePromises).then(results => {
        const successfulCount = results.filter(r => r.status === 'fulfilled').length;

        if (successfulCount === 0) {
          reject(new Error('No images loaded successfully'));
          return;
        }

        const latency = Math.round(performance.now() - start);
        resolve({
          url,
          latency,
          successfulCount,
          totalCount: CONFIG.LATENCY_TEST_IMAGE_URLS.length
        });
      });
    });
  }

  function transformUrl(originalUrl) {
    try {
      const url = new URL(originalUrl);
      const hostname = url.hostname;
      const pathname = url.pathname;

      if (hostname === 'codeload.github.com') {
        const match = pathname.match(/^\/([^\/]+)\/([^\/]+)\/(zip|tar\.gz)\/(.+)$/);
        if (match) {
          const [, user, repo, format, ref] = match;
          const extension = format === 'zip' ? '.zip' : '.tar.gz';
          console.log(`[URL Transform] codeload → archive`);
          return `https://github.com/${user}/${repo}/archive/${ref}${extension}`;
        }
        return null;
      }

      if (hostname === 'github.com' && pathname.includes('/blob/')) {
        console.log(`[URL Transform] blob → raw`);
        return `https://github.com${pathname.replace('/blob/', '/raw/')}`;
      }

      if ((hostname === 'github.com' && (pathname.includes('/releases/download/') || pathname.includes('/archive/'))) ||
        hostname === 'raw.githubusercontent.com') {
        return originalUrl;
      }

      return null;
    } catch (error) {
      console.error('[URL Transform] 解析失败:', error);
      return null;
    }
  }

  function processLink(link) {
    try {
      const originalHref = link.href;

      if (!originalHref || link.dataset.ghAccelerated) {
        return;
      }

      const shouldProcess = CONFIG.PATTERNS.some(pattern => pattern.test(originalHref));

      if (shouldProcess && proxyUrl) {
        const transformed = transformUrl(originalHref);

        if (transformed) {
          const finalUrl = `${proxyUrl.replace(/\/$/, '')}/${transformed}`;

          console.log(`[Github Accelerator] ✅ 链接已替换:`);
          console.log(`  原始: ${originalHref}`);
          console.log(`  加速: ${finalUrl}`);

          link.href = finalUrl;
          link.dataset.originalHref = originalHref;
          link.dataset.ghAccelerated = 'true';

          link.style.borderLeft = '3px solid #155DFC';
          link.style.paddingLeft = '4px';
          link.title = `🚀 已通过 Github Accelerator 加速\n原始链接: ${originalHref}`;
        }
      }
    } catch (error) {
      console.error('[Github Accelerator] 处理链接失败:', error);
    }
  }

  function processAllLinks() {
    console.log('[Github Accelerator] 扫描页面链接...');
    document.querySelectorAll('a').forEach(processLink);
    console.log('[Github Accelerator] 链接扫描完成');
  }

  function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'A') {
              processLink(node);
            }
            node.querySelectorAll('a').forEach(processLink);
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('[Github Accelerator] MutationObserver 已启动');
  }

  function showStatusBadge() {
    const countryNames = {
      'CN': '🇨🇳 中国大陆',
      'HK': '🇭🇰 香港',
      'TW': '🇹🇼 台湾',
      'US': '🇺🇸 美国',
      'JP': '🇯🇵 日本',
      'KR': '🇰🇷 韩国'
    };

    const loc = currentLocation || { country: '...', ip: '...' };
    const countryName = countryNames[loc.country] || `🌐 ${loc.country}`;

    let statusLabel, statusColor;
    if (loc.needProxy) {
      statusLabel = '🔒 GFW限制';
      statusColor = '#ffcdd2'; // 浅红色
    } else if (loc.isChinaMainland === false && loc.country !== 'unknown') {
      statusLabel = '✅ 可直连';
      statusColor = '#c8e6c9'; // 浅绿色
    } else {
      statusLabel = '...';
      statusColor = 'rgba(255,255,255,0.2)';
    }

    const badge = document.createElement('div');
    badge.innerHTML = `
      <div style="
        position: fixed;
        top: 12px;
        right: 12px;
        z-index: 99999;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 14px 18px;
        border-radius: 10px;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        box-shadow: 0 6px 20px rgba(0,0,0,0.25);
        cursor: pointer;
        user-select: none;
        line-height: 1.6;
        max-width: 300px;
      ">
        <strong style="font-size: 15px;">🚀 Github Accelerator</strong><br>
        <span style="font-size: 11px; opacity: 0.95; display: block; margin-top: 4px;">
          🌍 ${countryName} <span style="background: ${statusColor}; color: #333; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600;">${statusLabel}</span><br>
          DOM 修改模式 · IDM 完美兼容<br>
          <span style="opacity: 0.8;">节点: ${proxyUrl ? new URL(proxyUrl).hostname : '...'}</span>
        </span><br>
        <span style="font-size: 10px; opacity: 0.7; display: block; margin-top: 6px;">
          点击关闭 (8秒后自动消失)
        </span>
      </div>
    `;
    badge.onclick = () => badge.remove();
    document.body.appendChild(badge);

    setTimeout(() => {
      if (document.body.contains(badge)) {
        badge.style.opacity = '0';
        badge.style.transition = 'opacity 0.5s ease';
        setTimeout(() => badge.remove(), 500);
      }
    }, 8000);
  }
})();
