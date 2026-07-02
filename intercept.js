// 拦截页面逻辑 - AdGuard 风格
(function () {
  'use strict';

  // 从 URL 参数获取原始链接和加速链接
  const urlParams = new URLSearchParams(window.location.search);
  const originalUrl = urlParams.get('url');
  let acceleratedUrl = urlParams.get('accel');
  const refererUrl = urlParams.get('referer');

  console.log('[Intercept] 初始化参数:');
  console.log('[Intercept] originalUrl:', originalUrl);
  console.log('[Intercept] acceleratedUrl:', acceleratedUrl);
  console.log('[Intercept] refererUrl:', refererUrl);

  // DOM 元素
  const originalUrlEl = document.getElementById('original-url');
  const accelUrlEl = document.getElementById('accel-url');
  const copyOriginalBtn = document.getElementById('copy-original-btn');
  const copyAccelBtn = document.getElementById('copy-accel-btn');
  const accelerateBtn = document.getElementById('accelerate-btn');
  const directBtn = document.getElementById('direct-btn');
  const backBtn = document.getElementById('back-btn');
  const timerEl = document.getElementById('timer');
  const countdownEl = document.getElementById('countdown');
  const alwaysAccelerateEl = document.getElementById('always-accelerate');

  const locationStatusEl = document.getElementById('location-status');
  const locationTextEl = document.getElementById('location-text');
  const refreshLocationBtn = document.getElementById('refresh-location-btn');
  const nodeSelect = document.getElementById('node-select');
  const latencyBadge = document.getElementById('latency-badge');

  // 地理位置状态
  let isProxyEnabled = null; // null: 检测中，true: 已开启代理，false: 未开启代理

  // 提取域名
  let currentDomain = '';
  try {
    currentDomain = new URL(originalUrl).hostname;
  } catch (e) {
    currentDomain = 'github.com';
  }

  // 初始化
  init();

  function init() {
    if (!originalUrl || !acceleratedUrl) {
      originalUrlEl.textContent = '无效的链接参数';
      accelerateBtn.style.display = 'none';
      directBtn.style.display = 'none';
      countdownEl.style.display = 'none';
      document.querySelector('.options').style.display = 'none';
      locationStatusEl.style.display = 'none';
      return;
    }

    // 显示原始链接
    originalUrlEl.textContent = originalUrl;

    // 显示加速链接
    if (accelUrlEl) accelUrlEl.textContent = acceleratedUrl || '生成中...';

    // 设置按钮链接
    accelerateBtn.href = acceleratedUrl;
    directBtn.href = originalUrl;

    // 检测是否开启代理
    detectProxyStatus();

    // 加载用户偏好设置
    loadUserPreferences();

    // 加载节点选择
    loadNodeSelector();

    // 绑定事件
    bindEvents();
  }

  function loadUserPreferences() {
    browser.storage.local.get([
      'gh_accelerator_always_accelerate'
    ]).then((result) => {
      if (result.gh_accelerator_always_accelerate) {
        alwaysAccelerateEl.checked = true;
      }
    });
  }

  async function loadNodeSelector() {
    try {
      const cached = await browser.storage.local.get(['gh_accelerator_best_node', 'gh_accelerator_node_list']);
      const currentData = cached.gh_accelerator_best_node;
      const apiNodeList = cached.gh_accelerator_node_list || [];

      const customNodesResult = await browser.runtime.sendMessage({ type: 'GET_CUSTOM_NODES' });
      const customNodes = customNodesResult?.customNodes || [];

      const sortedApiNodes = apiNodeList.sort((a, b) => {
        if (a.latency === -1) return 1;
        if (b.latency === -1) return -1;
        return a.latency - b.latency;
      });

      const sortedCustomNodes = customNodes.sort((a, b) => {
        if (a.latency === -1) return 1;
        if (b.latency === -1) return -1;
        return a.latency - b.latency;
      });

      const allNodes = [
        ...sortedCustomNodes.map(n => ({ ...n, _isCustom: true })),
        ...sortedApiNodes
      ];

      const currentUrl = currentData?.node?.url || '';

      let optionsHTML = '';
      allNodes.forEach((node, index) => {
        const domain = extractDomain(node.url);
        const latencyStr = node.latency > 0 ? `${node.latency}ms` : '默认';
        const selected = node.url === currentUrl ? 'selected' : '';

        let emoji;
        if (node._isCustom) {
          emoji = '⭐';
        } else if (node.isUserSelected === true) {
          emoji = '🎯';
        } else if (node.latency > 0) {
          const customCount = allNodes.filter(n => n._isCustom).length;
          const apiIndex = index - customCount;
          const totalApiNodes = allNodes.length - customCount;
          const ratio = totalApiNodes > 0 ? apiIndex / totalApiNodes : 0;
          if (ratio < 0.33) {
            emoji = '🟢';
          } else if (ratio < 0.66) {
            emoji = '🟠';
          } else {
            emoji = '🔴';
          }
        } else {
          emoji = '⚪';
        }

        optionsHTML += `<option value="${node.url}" ${selected}>${emoji} ${domain} (${latencyStr})</option>`;
      });

      nodeSelect.innerHTML = optionsHTML;

      // 更新当前节点延迟显示
      if (currentData?.node?.latency > 0) {
        latencyBadge.textContent = `${currentData.node.latency}ms`;
        if (currentData.node.latency < 200) {
          latencyBadge.className = 'latency-badge good';
        } else if (currentData.node.latency < 500) {
          latencyBadge.className = 'latency-badge default';
        }
      } else {
        latencyBadge.textContent = '-';
        latencyBadge.className = 'latency-badge default';
      }

      // 节点选择事件
      nodeSelect.onchange = async (e) => {
        const selectedUrl = e.target.value;
        const selectedNode = allNodes.find(n => n.url === selectedUrl);

        if (selectedNode) {
          console.log('[Intercept] 用户选择节点:', selectedNode);

          const nodeToSave = {
            ...selectedNode,
            isCustom: selectedNode._isCustom || false,
            isUserSelected: !selectedNode._isCustom ? true : undefined
          };

          await browser.storage.local.set({
            gh_accelerator_best_node: {
              node: nodeToSave,
              timestamp: Date.now()
            }
          });

          const response = await browser.runtime.sendMessage({ type: 'UPDATE_NODE', node: nodeToSave });
          if (response && response.success) {
            const proxyBaseUrl = selectedNode.url.replace(/\/$/, '');
            const transformed = transformUrl(originalUrl);

            if (transformed) {
              acceleratedUrl = `${proxyBaseUrl}/${transformed}`;
              accelerateBtn.href = acceleratedUrl;
            } else {
              acceleratedUrl = `${proxyBaseUrl}/${originalUrl}`;
              accelerateBtn.href = acceleratedUrl;
            }
            if (accelUrlEl) accelUrlEl.textContent = acceleratedUrl;

            if (countdownTimer) {
              clearInterval(countdownTimer);
              countdownTimer = null;
              startCountdown();
            }

            if (selectedNode.latency > 0) {
              latencyBadge.textContent = `${selectedNode.latency}ms`;
              if (selectedNode.latency < 200) {
                latencyBadge.className = 'latency-badge good';
              } else if (selectedNode.latency < 500) {
                latencyBadge.className = 'latency-badge default';
              }
            } else {
              latencyBadge.textContent = '-';
              latencyBadge.className = 'latency-badge default';
            }

            console.log('[Intercept] 节点已更新:', selectedNode.url);
          }
        }
      };
    } catch (error) {
      console.error('[Intercept] 加载节点失败:', error);
    }
  }

  function extractDomain(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
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
          return `https://github.com/${user}/${repo}/archive/${ref}${extension}`;
        }
        return null;
      }

      if (hostname === 'github.com' && pathname.includes('/blob/')) {
        const transformed = pathname.replace('/blob/', '/raw/');
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

      return null;
    } catch (error) {
      console.error('[Intercept] URL 转换失败:', error);
      return null;
    }
  }

  // 检测是否开启代理
  async function detectProxyStatus() {
    console.log('[Intercept] 开始检测代理状态...');

    // 使用后台 script 的 GET_LOCATION 消息
    try {
      const response = await browser.runtime.sendMessage({ type: 'GET_LOCATION' });
      console.log('[Intercept] 收到位置响应:', response);

      if (response && response.location) {
        const location = response.location;
        // 如果不在大陆（isChinaMainland === false），说明开启了代理
        isProxyEnabled = location.isChinaMainland === false;

        console.log('[Intercept] 代理状态:', isProxyEnabled ? '已开启' : '未开启');
        updateProxyStatus(location);
        checkAutoAccelerate();
      } else {
        console.warn('[Intercept] 位置检测失败，默认未开启代理');
        isProxyEnabled = false;
        updateProxyStatus({ country: 'unknown', isChinaMainland: true });
        checkAutoAccelerate();
      }
    } catch (error) {
      console.warn('[Intercept] 位置检测出错:', error);
      isProxyEnabled = false;
      updateProxyStatus({ country: 'unknown', isChinaMainland: true });
      checkAutoAccelerate();
    }
  }

  function updateProxyStatus(location) {
    const countryNames = {
      'CN': '中国大陆',
      'HK': '中国香港',
      'TW': '中国台湾',
      'US': '美国',
      'JP': '日本',
      'KR': '韩国',
      'SG': '新加坡',
      'DE': '德国',
      'GB': '英国',
      'FR': '法国'
    };

    const countryName = countryNames[location.country] || location.country;
    const hasProxy = isProxyEnabled === true;

    locationStatusEl.className = 'location-status ' + (hasProxy ? 'location-status-cn' : 'location-status-global');

    if (hasProxy) {
      locationTextEl.textContent = `${countryName} · 已开启代理 · 请手动选择`;
      locationStatusEl.style.display = 'flex';
    } else {
      locationTextEl.textContent = `${countryName} · 未开启代理 · 将自动加速`;
      locationStatusEl.style.display = 'flex';
    }
  }

  function checkAutoAccelerate() {
    console.log('[Intercept] === checkAutoAccelerate 调用 ===');
    console.log('[Intercept] isProxyEnabled:', isProxyEnabled);

    // 如果用户开启了代理，不启动倒计时，需要用户手动选择
    if (isProxyEnabled === true) {
      console.log('[Intercept] 已开启代理，不启动倒计时');
      countdownEl.classList.add('hidden');
      return;
    }

    // 未开启代理（大陆用户直连），检查用户偏好
    browser.storage.local.get([
      'gh_accelerator_always_accelerate',
      'gh_accelerator_disable_session',
      'gh_accelerator_domain_preferences'
    ], (result) => {
      console.log('[Intercept] 用户偏好:', result);

      // 检查是否会话临时禁用
      if (result.gh_accelerator_disable_session) {
        console.log('[Intercept] 会话临时禁用，直接访问原始链接');
        window.location.href = originalUrl;
        return;
      }

      // 检查域名特定偏好
      const preferences = result.gh_accelerator_domain_preferences || {};
      const domainPref = preferences[currentDomain];
      console.log('[Intercept] 域名偏好:', domainPref);

      if (domainPref === 'always_accelerate') {
        console.log('[Intercept] 域名偏好为始终加速，启动倒计时');
        startCountdown();
        return;
      } else if (domainPref === 'always_direct') {
        console.log('[Intercept] 域名偏好为始终直接访问，跳转到原始链接');
        window.location.href = originalUrl;
        return;
      }

      // 检查全局始终加速
      if (result.gh_accelerator_always_accelerate) {
        console.log('[Intercept] 全局始终加速，启动倒计时');
        startCountdown();
        return;
      }

      // 默认模式：不启动倒计时，用户手动选择
      console.log('[Intercept] 默认模式，等待用户手动选择');
      countdownEl.classList.add('hidden');
    });
  }

  function bindEvents() {
    // 使用加速链接按钮点击
    accelerateBtn.addEventListener('click', (e) => {
      console.log('[Intercept] 用户选择使用加速链接');
      console.log('[Intercept] 加速链接:', acceleratedUrl);
      saveUserPreferences();
      // 不阻止默认行为，让浏览器自然跳转（IDM 可以捕获）
      // href 已经在 init() 中设置
    });

    // 复制按钮
    if (copyOriginalBtn) {
      copyOriginalBtn.addEventListener('click', () => copyToClipboard(originalUrl, copyOriginalBtn, '📋 复制', '✅ 已复制'));
    }
    if (copyAccelBtn) {
      copyAccelBtn.addEventListener('click', () => {
        const text = accelUrlEl.textContent;
        if (text === '生成中...') return;
        copyToClipboard(text, copyAccelBtn, '⚡ 复制', '✅ 已复制');
      });
    }

    // 直接访问按钮点击 - 通知 background 在 10s 内不拦截该 URL
    directBtn.addEventListener('click', (e) => {
      console.log('[Intercept] 用户选择直接访问，跳过拦截 10s');
      browser.runtime.sendMessage({ type: 'SKIP_INTERCEPT', url: originalUrl, duration: 10000 });
      saveUserPreferences();
    });

    // 返回按钮点击
    backBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('[Intercept] 用户点击返回');

      // 使用浏览器历史返回，而不是直接跳转
      if (window.history.length > 1) {
        console.log('[Intercept] 使用 history.back() 返回上一页');
        window.history.back();
      } else if (refererUrl) {
        console.log('[Intercept] 无历史记录，跳转到 refererUrl:', refererUrl);
        window.location.href = refererUrl;
      } else {
        console.log('[Intercept] 无历史记录和 referer，跳转到 GitHub 首页');
        window.location.href = 'https://github.com';
      }
    });

    // 始终加速复选框
    alwaysAccelerateEl.addEventListener('change', async (e) => {
      const shouldAccelerate = e.target.checked;

      if (shouldAccelerate) {
        const selectedNodeUrl = nodeSelect.value;
        if (selectedNodeUrl) {
          const selectedNode = await getNodeByUrl(selectedNodeUrl);
          if (selectedNode) {
            const nodeToSave = {
              ...selectedNode,
              isCustom: selectedNode._isCustom || false,
              isUserSelected: !selectedNode._isCustom ? true : undefined
            };

            await browser.storage.local.set({
              gh_accelerator_best_node: {
                node: nodeToSave,
                timestamp: Date.now()
              }
            });

            await browser.runtime.sendMessage({ type: 'UPDATE_NODE', node: nodeToSave });

            const proxyBaseUrl = selectedNode.url.replace(/\/$/, '');
            const transformed = transformUrl(originalUrl);
            if (transformed) {
              acceleratedUrl = `${proxyBaseUrl}/${transformed}`;
            } else {
              acceleratedUrl = `${proxyBaseUrl}/${originalUrl}`;
            }
            if (accelUrlEl) accelUrlEl.textContent = acceleratedUrl;
          }
        }

        browser.storage.local.set({
          gh_accelerator_always_accelerate: true
        });

        removeDomainPreference();

        console.log('[Intercept] 用户勾选始终加速，跳转到:', acceleratedUrl);
        window.location.href = acceleratedUrl;
      } else {
        browser.storage.local.remove('gh_accelerator_always_accelerate');
        stopCountdown();
      }
    });

    async function getNodeByUrl(url) {
      try {
        const customNodesResult = await browser.runtime.sendMessage({ type: 'GET_CUSTOM_NODES' });
        const customNodes = customNodesResult?.customNodes || [];
        const cached = await browser.storage.local.get('gh_accelerator_node_list');
        const apiNodes = cached.gh_accelerator_node_list || [];

        const customNode = customNodes.find(n => n.url === url);
        if (customNode) {
          return { ...customNode, _isCustom: true };
        }

        const apiNode = apiNodes.find(n => n.url === url);
        if (apiNode) {
          return apiNode;
        }

        return { url, latency: -1, _isCustom: false };
      } catch (error) {
        console.error('[Intercept] 获取节点失败:', error);
        return null;
      }
    }

    // 重新测试IP按钮
    if (refreshLocationBtn) {
      refreshLocationBtn.addEventListener('click', async () => {
        refreshLocationBtn.disabled = true;
        refreshLocationBtn.textContent = '🌍 重新检测中...';
        locationTextEl.textContent = '重新检测中...';

        try {
          const response = await browser.runtime.sendMessage({ type: 'REFRESH_LOCATION' });
          if (response && response.success) {
            updateProxyStatus(response.location);
          }
        } catch (error) {
          console.error('[Intercept] 重新测试IP失败:', error);
          locationTextEl.textContent = '检测失败';
        } finally {
          refreshLocationBtn.disabled = false;
          refreshLocationBtn.textContent = '🌍 重新测试IP地址';
        }
      });
    }
  }

  function saveUserPreferences() {
    // 这里可以根据需要保存更多状态
  }

  function showDomainPreferenceDialog() {
    const choice = confirm('请选择要记住的偏好：\n\n点击"确定"：对该域名始终使用加速链接\n点击"取消"：对该域名始终直接访问');

    if (choice) {
      // 始终加速
      saveDomainPreference('always_accelerate');
      alwaysAccelerateEl.checked = true;
      startCountdown();
    } else {
      // 始终直接访问
      saveDomainPreference('always_direct');
      window.location.href = originalUrl;
    }
  }

  function saveDomainPreference(preference) {
    browser.storage.local.get(['gh_accelerator_domain_preferences'], (result) => {
      const preferences = result.gh_accelerator_domain_preferences || {};
      preferences[currentDomain] = preference;

      browser.storage.local.set({
        gh_accelerator_domain_preferences: preferences
      });
    });
  }

  function removeDomainPreference() {
    browser.storage.local.get(['gh_accelerator_domain_preferences'], (result) => {
      const preferences = result.gh_accelerator_domain_preferences || {};
      delete preferences[currentDomain];

      browser.storage.local.set({
        gh_accelerator_domain_preferences: preferences
      });
    });
  }

  let countdownTimer = null;

  function startCountdown() {
    // 先停止现有的倒计时（如果存在）
    stopCountdown();

    console.log('[Intercept] === 开始倒计时 ===');
    console.log('[Intercept] acceleratedUrl:', acceleratedUrl);

    // 验证 acceleratedUrl 是否有效
    if (!acceleratedUrl) {
      console.error('[Intercept] acceleratedUrl 为空！无法跳转');
      return;
    }

    countdownEl.classList.remove('hidden');
    let seconds = 10;
    timerEl.textContent = seconds;

    countdownTimer = setInterval(() => {
      seconds--;
      timerEl.textContent = seconds;

      if (seconds <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        console.log('[Intercept] === 倒计时结束，跳转 ===');
        console.log('[Intercept] 目标 URL:', acceleratedUrl);

        // 先隐藏倒计时区域
        countdownEl.classList.add('hidden');

        // 使用 location.href 跳转
        window.location.href = acceleratedUrl;
      }
    }, 1000);
  }

  function stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    countdownEl.classList.add('hidden');
  }

  function copyToClipboard(text, btn, defaultText, successText) {
    if (!text) return;
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) { /* noop */ }
      ta.remove();
    };

    const onSuccess = () => {
      if (!btn) return;
      btn.classList.add('copied');
      btn.textContent = successText;
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.textContent = defaultText;
      }, 1500);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
        fallback();
        onSuccess();
      });
    } else {
      fallback();
      onSuccess();
    }
  }
})();
