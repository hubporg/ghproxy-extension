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
  FALLBACK_NODES: [
    'https://gh.llkk.cc',
    'https://gh.dpik.top',
    'https://github.tbedu.top'
  ],
  URL_PATTERNS: [
    '*://github.com/*/releases/download/*',
    '*://github.com/*/archive/*',
    '*://github.com/*/raw/*',
    '*://github.com/*/blob/*',
    '*://codeload.github.com/*',
    '*://raw.githubusercontent.com/*',
    '*://gist.githubusercontent.com/*/raw/*'
  ]
};

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
        console.log(`[URL Transform] codeload → archive: ${pathname} -> /${user}/${repo}/archive/${ref}${extension}`);
        return `https://github.com/${user}/${repo}/archive/${ref}${extension}`;
      }
      return null;
    }

    if (hostname === 'github.com' && pathname.includes('/blob/')) {
      const transformed = pathname.replace('/blob/', '/raw/');
      console.log(`[URL Transform] blob → raw: ${pathname} -> ${transformed}`);
      return `https://github.com${transformed}`;
    }

    if (hostname === 'raw.githubusercontent.com') {
      return originalUrl;
    }

    if (hostname === 'github.com') {
      if (pathname.includes('/releases/download/') || pathname.includes('/archive/')) {
        return originalUrl;
      }
    }

    if (hostname === 'gist.githubusercontent.com') {
      console.warn('[URL Transform] gist 域名可能不被支持:', originalUrl);
      return originalUrl;
    }

    return null;
  } catch (error) {
    console.error('[URL Transform] 解析 URL 失败:', error);
    return null;
  }
}

async function detectLocation() {
  try {
    console.log('[GitHub Accelerator] 正在检测地理位置...');

    // 尝试使用 api.ipapi.is
    let data;
    try {
      const response1 = await fetch('https://api.ipapi.is/', {
        headers: {
          'Origin': 'https://test.hubp.org'
        }
      });
      data = await response1.json();
    } catch (error1) {
      // 如果失败，尝试备用 API api.ip.sb/geoip
      console.warn('[GitHub Accelerator] api.ipapi.is 失败，尝试备用 API...', error1);
      const response2 = await fetch('https://api.ip.sb/geoip', {
        headers: {
          'Origin': 'https://test.hubp.org'
        }
      });
      data = await response2.json();
    }

    // 解析 JSON 响应
    const countryCode = data.country_code || data.location?.country_code || 'unknown';
    const ip = data.ip || 'unknown';

    const location = {
      ip: ip,
      country: countryCode,
      isChinaMainland: countryCode === 'CN', // 只有大陆有 GFW 防火墙
      needProxy: countryCode === 'CN' // 只有大陆必须用代理
    };

    console.log(`[GitHub Accelerator] 地理位置：${location.country} (${location.ip})`);
    console.log(`[GitHub Accelerator] 是否受 GFW 限制（需代理）: ${location.needProxy ? '✅ 是（中国大陆）' : '❌ 否（可直接访问）'}`);

    return location;
  } catch (error) {
    console.warn('[GitHub Accelerator] 地理位置检测失败，默认启用加速:', error);
    return { ip: 'unknown', country: 'unknown', isChinaMainland: false, needProxy: true };
  }
}

// 检测用户代理状态
async function checkProxyStatus() {
  try {
    console.log('[GitHub Accelerator] 正在检测用户代理状态...');

    // 检测地理位置
    const location = await detectLocation();

    // 如果用户在中国大陆，检查是否开启了代理
    if (location.isChinaMainland) {
      // 尝试访问 GitHub，检测是否开启代理
      const startTime = Date.now();
      let githubAccessible = false;

      try {
        // 使用 HEAD 请求快速检测 GitHub 是否可访问
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 秒超时

        await fetch('https://github.com', {
          method: 'HEAD',
          signal: controller.signal,
          headers: {
            'Origin': 'https://test.hubp.org'
          }
        });

        clearTimeout(timeoutId);
        githubAccessible = true;
      } catch (error) {
        githubAccessible = false;
      }

      const latency = Date.now() - startTime;

      if (githubAccessible && latency < 1000) {
        // GitHub 访问很快，可能开启了代理
        console.log(`[GitHub Accelerator] ✅ 检测到您可能已开启代理（访问延迟：${latency}ms）`);
        console.log(`[GitHub Accelerator] ℹ️ 如果已开启代理，可以关闭扩展，直接使用代理访问 GitHub`);
      } else {
        console.log(`[GitHub Accelerator] ℹ️ 未检测到代理，GitHub 访问延迟：${githubAccessible ? latency + 'ms' : '超时'}`);
      }
    }
  } catch (error) {
    console.warn('[GitHub Accelerator] 代理状态检测失败:', error);
  }
}

async function fetchProxyNodes() {
  const response = await fetch(CONFIG.API_URL, {
    headers: {
      'Origin': 'https://test.hubp.org'
    }
  });
  const data = await response.json();
  return data.data || [];
}

async function speedTestNodes(nodes) {
  console.log(`[GitHub Accelerator] 开始并发测速... (共 ${nodes.length} 个节点)`);
  const testNodes = CONFIG.SPEED_TEST_COUNT === 'all'
    ? nodes
    : nodes.slice(0, CONFIG.SPEED_TEST_COUNT);

  console.log(`[GitHub Accelerator] 将测试 ${testNodes.length} 个节点`);
  console.log(`[GitHub Accelerator] 使用 ${CONFIG.LATENCY_TEST_IMAGE_URLS.length} 个图片资源进行延迟测试`);

  // 在测速前随机选择一个图片，所有节点使用同一个图片测试（保证公平性）
  const randomIndex = Math.floor(Math.random() * CONFIG.LATENCY_TEST_IMAGE_URLS.length);
  const selectedImageUrl = CONFIG.LATENCY_TEST_IMAGE_URLS[randomIndex];
  console.log(`[测速] 随机选择图片 ${randomIndex + 1}/4: ${selectedImageUrl}`);

  const promises = testNodes.map(node =>
    testSingleNodeWithImage(node.url, selectedImageUrl).then(result => {
      console.log(`[GitHub Accelerator] ${node.url}: ${result.latency}ms`);
      return result;
    }).catch(error => {
      console.warn(`[GitHub Accelerator] ${node.url} 测速失败:`, error);
      return null;
    })
  );

  const results = await Promise.allSettled(promises)
    .then(settled => settled.map(s => s.value));

  const validResults = results
    .filter(r => r !== null)
    .sort((a, b) => a.latency - b.latency);

  if (validResults.length > 0) {
    console.log(`[GitHub Accelerator] 最优节点：${validResults[0].url} (${validResults[0].latency}ms)`);

    // 清除所有节点的自选标记，然后保存
    const cleanedResults = validResults.map(node => {
      const { isUserSelected, ...rest } = node;
      return rest;
    });

    // 保存所有有效节点到 storage（供用户手动选择）
    await chrome.storage.local.set({
      gh_accelerator_node_list: cleanedResults
    });

    return cleanedResults[0];
  }

  console.log('[GitHub Accelerator] 所有节点失败，使用兜底节点');
  return { url: CONFIG.FALLBACK_NODES[0], latency: -1 };
}

async function testSingleNodeWithImage(proxyUrl, imageUrl) {
  const startTime = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.SPEED_TEST_TIMEOUT);

  try {
    const proxyBaseUrl = proxyUrl.replace(/\/$/, '');
    const testUrl = `${proxyBaseUrl}/${imageUrl}`;

    const response = await fetch(testUrl, {
      method: 'HEAD',
      signal: controller.signal,
      cache: 'no-cache',
      headers: {
        'Origin': 'https://test.hubp.org'
      }
    });

    if (!response.ok) {
      throw new Error('Image fetch failed');
    }

    const latency = Math.round(performance.now() - startTime);
    return {
      url: proxyUrl,
      latency: latency,
      successfulCount: 1,
      totalCount: 1
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getCachedNode() {
  const cached = await chrome.storage.local.get(CONFIG.CACHE_KEY);
  if (cached[CONFIG.CACHE_KEY]) {
    const { node, timestamp } = cached[CONFIG.CACHE_KEY];
    const age = Date.now() - timestamp;

    if (age < CONFIG.CACHE_DURATION) {
      console.log(`[GitHub Accelerator] 使用缓存节点 (${Math.round(age / 60000)}分钟前)`);
      return node;
    }

    console.log('[GitHub Accelerator] 缓存已过期');
  }

  return null;
}

async function setCachedNode(node) {
  await chrome.storage.local.set({
    [CONFIG.CACHE_KEY]: {
      node,
      timestamp: Date.now()
    }
  });

  console.log('[GitHub Accelerator] 右键菜单监听器已创建');
}

async function clearCache() {
  await chrome.storage.local.remove(CONFIG.CACHE_KEY);
  console.log('[GitHub Accelerator] 缓存已清除');
}

function setupWebRequestListener() {
  let currentProxyUrl = null;
  let currentLocation = null;
  let userSelectedNode = false; // 标记用户是否手动选择了节点
  let cacheExpiryCheckInterval = null;
  let navigatingToInternceptPage = false; // 防止重复导航到拦截页面的标记

  // 检查缓存是否过期，如果过期则自动重新测速
  async function checkCacheExpiry() {
    const cached = await chrome.storage.local.get(CONFIG.CACHE_KEY);
    if (cached[CONFIG.CACHE_KEY]) {
      const { timestamp } = cached[CONFIG.CACHE_KEY];
      const age = Date.now() - timestamp;

      if (age >= CONFIG.CACHE_DURATION) {
        console.log('[GitHub Accelerator] 缓存已过期，自动重新测速...');
        userSelectedNode = false; // 清除用户自选标记
        await clearCache();
        const newNode = await initBestNode();
        currentProxyUrl = newNode;
        console.log('[GitHub Accelerator] 自动更新节点:', currentProxyUrl);
      } else {
        const remainingMinutes = Math.round((CONFIG.CACHE_DURATION - age) / 60000);
        console.log(`[GitHub Accelerator] 缓存未过期，剩余 ${remainingMinutes} 分钟`);
      }
    }
  }

  // 从缓存恢复当前代理节点
  chrome.storage.local.get([CONFIG.CACHE_KEY], (result) => {
    if (result[CONFIG.CACHE_KEY]) {
      currentProxyUrl = result[CONFIG.CACHE_KEY].node.url;
      console.log('[GitHub Accelerator] 从缓存恢复代理节点:', currentProxyUrl);

      // 启动缓存过期检查定时器（每 5 分钟检查一次）
      cacheExpiryCheckInterval = setInterval(checkCacheExpiry, 5 * 60 * 1000);
      console.log('[GitHub Accelerator] 缓存过期检查定时器已启动（5 分钟）');
    }

    // 如果没有缓存，则初始化
    if (!currentProxyUrl) {
      initBestNode().then(url => {
        currentProxyUrl = url;
        console.log('[GitHub Accelerator] 重定向服务已启动:', currentProxyUrl);
        // 启动缓存过期检查定时器
        cacheExpiryCheckInterval = setInterval(checkCacheExpiry, 5 * 60 * 1000);
        console.log('[GitHub Accelerator] 缓存过期检查定时器已启动（5 分钟）');
      });
    } else {
      console.log('[GitHub Accelerator] 重定向服务已启动（缓存）:', currentProxyUrl);
    }
  });

  detectLocation().then(location => {
    currentLocation = location;
    console.log('[GitHub Accelerator] 地理位置已缓存:', location);

    // 启动代理检测定时器（30 分钟）
    setInterval(() => {
      checkProxyStatus();
    }, 30 * 60 * 1000);

    // 立即检测一次
    checkProxyStatus();
  });

  console.log('[GitHub Accelerator] ⚠️ tabs.onUpdated 拦截器已禁用（使用 webRequest 代替）');

  // 使用 webNavigation 在导航开始前拦截（比 webRequest 更早）
  chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    // 只处理主框架
    if (details.frameId !== 0) {
      return;
    }

    const url = details.url;

    // 跳过拦截页面本身（检查 chrome-extension:// 协议的 intercept.html）
    if (url.startsWith('chrome-extension://') && url.includes('intercept.html')) {
      console.log('[GitHub Accelerator] 跳过拦截页面本身:', url);
      // 重置导航标记
      setTimeout(() => { navigatingToInternceptPage = false; }, 1000);
      return;
    }

    // 检查是否是 GitHub 下载链接
    const isGitHubDownload = (() => {
      try {
        const urlObj = new URL(url);
        const hostname = urlObj.hostname.toLowerCase();

        console.log(`[GitHub Accelerator] 检查 URL: ${url}`);
        console.log(`[GitHub Accelerator] Hostname: ${hostname}`);
        console.log(`[GitHub Accelerator] navigatingToInternceptPage: ${navigatingToInternceptPage}`);

        // 必须是 github.com 或其子域名（排除代理域名）
        if (hostname !== 'github.com' &&
          !hostname.endsWith('.github.com') &&
          hostname !== 'codeload.github.com' &&
          hostname !== 'raw.githubusercontent.com' &&
          hostname !== 'gist.githubusercontent.com') {
          console.log(`[GitHub Accelerator] ❌ 非 GitHub 域名，跳过`);
          return false;
        }

        // 检查路径模式
        const matches = CONFIG.URL_PATTERNS.some(pattern => {
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
          return regex.test(url);
        });
        console.log(`[GitHub Accelerator] 路径匹配结果：${matches}`);
        return matches;
      } catch (e) {
        console.error('[GitHub Accelerator] URL 解析错误:', e);
        return false;
      }
    })();

    if (isGitHubDownload && currentProxyUrl && !navigatingToInternceptPage) {
      console.log(`\n[GitHub Accelerator] ✅ 开始拦截：${url}`);

      const transformedUrl = transformUrl(url);
      if (transformedUrl) {
        const proxyBaseUrl = currentProxyUrl.replace(/\/$/, '');
        const acceleratedUrl = `${proxyBaseUrl}/${transformedUrl}`;

        // 检查用户偏好
        chrome.storage.local.get([
          'gh_accelerator_always_accelerate',
          'gh_accelerator_disable_session'
        ], (result) => {
          if (result.gh_accelerator_disable_session) {
            console.log(`  ℹ️ 会话临时禁用，不拦截`);
            return;
          }

          if (result.gh_accelerator_always_accelerate) {
            console.log(`  🚀 始终加速模式，直接跳转：${acceleratedUrl}`);
            navigatingToInternceptPage = true;
            // 使用 replace 而不是 update，避免在历史中留下记录
            chrome.tabs.update(details.tabId, { url: acceleratedUrl }, () => {
              // 导航开始后重置标记
              setTimeout(() => { navigatingToInternceptPage = false; }, 300);
            });
            return;
          }

          // 打开拦截页面
          console.log(`  🚀 打开拦截页面`);
          const interceptUrl = chrome.runtime.getURL('intercept.html') +
            '?url=' + encodeURIComponent(url) +
            '&accel=' + encodeURIComponent(acceleratedUrl) +
            '&referer=' + encodeURIComponent(details.url);
          navigatingToInternceptPage = true;
          chrome.tabs.update(details.tabId, { url: interceptUrl }, () => {
            // 导航开始后重置标记
            setTimeout(() => { navigatingToInternceptPage = false; }, 300);
          });
        });
      }
    }
  });

  console.log('[GitHub Accelerator] ✅ webNavigation 拦截器已注册');

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'REFRESH_NODE') {
      // 如果用户手动选择了节点，先清除自选状态，然后重新测速
      if (userSelectedNode) {
        console.log('[GitHub Accelerator] 用户已手动选择节点，清除自选状态并重新测速');
        userSelectedNode = false;
      }

      clearCache().then(() => {
        return initBestNode();
      }).then(newUrl => {
        currentProxyUrl = newUrl;
        console.log('[GitHub Accelerator] 重新测速完成:', currentProxyUrl);
        sendResponse({ success: true, node: currentProxyUrl });
      });
      return true;
    }

    if (message.type === 'UPDATE_NODE') {
      // 用户手动选择了节点
      const node = message.node;
      if (node) {
        currentProxyUrl = node.url;
        userSelectedNode = true; // 标记用户已手动选择

        // 保存到缓存
        chrome.storage.local.set({
          [CONFIG.CACHE_KEY]: {
            node: node,
            timestamp: Date.now()
          }
        });

        console.log(`[GitHub Accelerator] 用户手动选择节点：${node.url} (${node.latency}ms)`);
        console.log(`[GitHub Accelerator] 当前代理节点已更新：${currentProxyUrl}`);
        console.log(`[GitHub Accelerator] 缓存已更新`);
        sendResponse({ success: true, node: currentProxyUrl });
      } else {
        sendResponse({ success: false, error: 'Invalid node' });
      }
      return false;
    }

    if (message.type === 'GET_CURRENT_NODE') {
      sendResponse({ node: currentProxyUrl });
      return false;
    }

    if (message.type === 'GET_CACHE_INFO') {
      chrome.storage.local.get(CONFIG.CACHE_KEY).then(cached => {
        sendResponse({ data: cached[CONFIG.CACHE_KEY] || null });
      });
      return true;
    }

    if (message.type === 'GET_LOCATION') {
      sendResponse({ location: currentLocation });
      return false;
    }
  });

  return currentProxyUrl;
}

async function initBestNode() {
  const location = await detectLocation();

  if (!location.needProxy) {
    console.log(`[GitHub Accelerator] 检测到 ${location.country} 地区，无GFW限制，GitHub可直接访问`);
  } else {
    console.log('[GitHub Accelerator] 检测到中国大陆地区，受GFW限制，必须使用代理加速');
  }

  let bestNode = await getCachedNode();

  if (!bestNode) {
    try {
      const nodes = await fetchProxyNodes();
      bestNode = await speedTestNodes(nodes);
      await setCachedNode(bestNode);
    } catch (error) {
      console.error('[GitHub Accelerator] 初始化失败:', error);
      bestNode = { url: CONFIG.FALLBACK_NODES[0], latency: -1 };
    }
  }

  return bestNode.url || CONFIG.FALLBACK_NODES[0];
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('[GitHub Accelerator] 扩展已安装/更新');
  initBestNode().catch(console.error);
  createContextMenus();
});

setupWebRequestListener();
setupContextMenuHandler();

console.log('[GitHub Accelerator] 后台服务已启动');

function createContextMenus() {
  chrome.contextMenus.create({
    id: 'github-accelerator-copy',
    title: '🚀 复制 GitHub 加速链接',
    contexts: ['link', 'selection']
  });

  chrome.contextMenus.create({
    id: 'github-accelerator-open',
    title: '⚡ 打开 GitHub 加速链接（新标签页）',
    contexts: ['link', 'selection']
  });

  console.log('[GitHub Accelerator] 右键菜单已创建');
}

function setupContextMenuHandler() {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    // 从缓存获取当前代理节点
    const cacheKey = 'gh_accelerator_best_node';
    const result = await chrome.storage.local.get([cacheKey]);

    let proxyUrl;
    if (result[cacheKey]) {
      proxyUrl = result[cacheKey].node.url;
      console.log(`[GitHub Accelerator] 右键菜单：从缓存获取节点 ${proxyUrl}`);
    } else {
      proxyUrl = await initBestNode();
      console.log(`[GitHub Accelerator] 右键菜单：初始化节点 ${proxyUrl}`);
    }

    const originalUrl = info.linkUrl || info.selectionText;

    if (!originalUrl || !isGitHubUrl(originalUrl)) {
      showNotification(tab.id, '❌ 请选择或右键点击一个 GitHub 链接');
      return;
    }

    const transformed = transformUrl(originalUrl) || originalUrl;
    const acceleratedUrl = `${proxyUrl.replace(/\/$/, '')}/${transformed}`;

    console.log(`[GitHub Accelerator] 右键菜单操作:`);
    console.log(`  原始链接：${originalUrl}`);
    console.log(`  加速链接：${acceleratedUrl}`);
    console.log(`  使用节点：${proxyUrl}`);

    switch (info.menuItemId) {
      case 'github-accelerator-copy':
        try {
          await copyToClipboard(acceleratedUrl);
          showNotification(tab.id, '✅ 加速链接已复制到剪贴板！', acceleratedUrl);
        } catch (error) {
          showNotification(tab.id, '❌ 复制失败: ' + error.message);
        }
        break;

      case 'github-accelerator-open':
        chrome.tabs.create({ url: acceleratedUrl });
        showNotification(tab.id, '⚡ 正在打开加速链接...', acceleratedUrl);
        break;
    }
  });

  console.log('[GitHub Accelerator] 右键菜单监听器已创建');
}

function isGitHubUrl(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'github.com' ||
      hostname.endsWith('.github.com') ||
      hostname === 'codeload.github.com' ||
      hostname === 'raw.githubusercontent.com' ||
      hostname === 'gist.githubusercontent.com';
  } catch {
    return false;
  }
}

async function copyToClipboard(text) {
  await navigator.clipboard.writeText(text);
}

function showNotification(tabId, message, details) {
  chrome.scripting.executeScript({
    target: { tabId },
    func: (msg, detail) => {
      const notification = document.createElement('div');
      notification.innerHTML = `
        <div style="
          position: fixed;
          top: 20px;
          right: 20px;
          z-index: 2147483647;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 16px 20px;
          border-radius: 10px;
          font-size: 14px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          box-shadow: 0 8px 24px rgba(0,0,0,0.3);
          max-width: 400px;
          line-height: 1.5;
          animation: slideIn 0.3s ease-out;
        ">
          <strong style="font-size: 15px;">${msg}</strong>
          ${detail ? `<br><span style="font-size: 11px; opacity: 0.9; word-break: break-all; margin-top: 6px; display: block;">${detail}</span>` : ''}
        </div>
        <style>
          @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
        </style>
      `;
      document.body.appendChild(notification);

      setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.5s ease';
        setTimeout(() => notification.remove(), 500);
      }, 3000);
    },
    args: [message, details]
  }).catch(err => {
    console.warn('[GitHub Accelerator] 无法显示通知:', err);
  });
}
