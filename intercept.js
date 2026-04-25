// 拦截页面逻辑 - AdGuard 风格
(function () {
  'use strict';

  // 从 URL 参数获取原始链接和加速链接
  const urlParams = new URLSearchParams(window.location.search);
  const originalUrl = urlParams.get('url');
  const acceleratedUrl = urlParams.get('accel');
  const refererUrl = urlParams.get('referer');

  console.log('[Intercept] 初始化参数:');
  console.log('[Intercept] originalUrl:', originalUrl);
  console.log('[Intercept] acceleratedUrl:', acceleratedUrl);
  console.log('[Intercept] refererUrl:', refererUrl);

  // DOM 元素
  const originalUrlEl = document.getElementById('original-url');
  const accelerateBtn = document.getElementById('accelerate-btn');
  const directBtn = document.getElementById('direct-btn');
  const backBtn = document.getElementById('back-btn');
  const timerEl = document.getElementById('timer');
  const countdownEl = document.getElementById('countdown');
  const alwaysAccelerateEl = document.getElementById('always-accelerate');
  const advancedToggle = document.getElementById('advanced-toggle');
  const advancedContent = document.getElementById('advanced-content');
  const advancedArrow = document.getElementById('advanced-arrow');
  const helpLink = document.getElementById('help-link');
  const locationStatusEl = document.getElementById('location-status');
  const locationTextEl = document.getElementById('location-text');

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

    // 设置按钮链接
    accelerateBtn.href = acceleratedUrl;
    directBtn.href = originalUrl;

    // 检测是否开启代理
    detectProxyStatus();

    // 加载用户偏好设置
    loadUserPreferences();

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
      'CN': '🇨🇳 中国大陆',
      'HK': '🇭🇰 中国香港',
      'TW': '🇹🇼 中国台湾',
      'US': '🇺🇸 美国',
      'JP': '🇯🇵 日本',
      'KR': '🇰🇷 韩国',
      'SG': '🇸🇬 新加坡',
      'DE': '🇩🇪 德国',
      'GB': '🇬🇧 英国',
      'FR': '🇫🇷 法国'
    };

    const countryName = countryNames[location.country] || `🌐 ${location.country}`;
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
    alwaysAccelerateEl.addEventListener('change', (e) => {
      const shouldAccelerate = e.target.checked;

      if (shouldAccelerate) {
        // 全局始终加速
        browser.storage.local.set({
          gh_accelerator_always_accelerate: true
        });

        // 清除域名特定偏好
        removeDomainPreference();

        console.log('[Intercept] 用户勾选始终加速，立即跳转');
        // 立即跳转到加速链接，不再显示此页面
        window.location.href = acceleratedUrl;
      } else {
        browser.storage.local.remove('gh_accelerator_always_accelerate');
        stopCountdown();
      }
    });

    // 高级选项切换
    advancedToggle.addEventListener('click', (e) => {
      e.preventDefault();
      advancedContent.classList.toggle('show');
      advancedArrow.textContent = advancedContent.classList.contains('show') ? '▲' : '▼';
    });

    // 帮助链接
    helpLink.addEventListener('click', (e) => {
      e.preventDefault();
      browser.tabs.create({ url: 'https://github.com/akams-cn/github-accelerator/wiki/Help' });
    });
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
})();
