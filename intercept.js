// 拦截页面逻辑 - AdGuard 风格
(function () {
  'use strict';

  // 从 URL 参数获取原始链接和加速链接
  const urlParams = new URLSearchParams(window.location.search);
  const originalUrl = urlParams.get('url');
  const acceleratedUrl = urlParams.get('accel');

  // DOM 元素
  const originalUrlEl = document.getElementById('original-url');
  const accelerateBtn = document.getElementById('accelerate-btn');
  const directBtn = document.getElementById('direct-btn');
  const timerEl = document.getElementById('timer');
  const countdownEl = document.getElementById('countdown');
  const alwaysAccelerateEl = document.getElementById('always-accelerate');
  const rememberDomainEl = document.getElementById('remember-domain');
  const disableForSessionEl = document.getElementById('disable-for-session');
  const advancedToggle = document.getElementById('advanced-toggle');
  const advancedContent = document.getElementById('advanced-content');
  const advancedArrow = document.getElementById('advanced-arrow');
  const helpLink = document.getElementById('help-link');

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
      return;
    }

    // 显示原始链接
    originalUrlEl.textContent = originalUrl;

    // 设置按钮链接
    accelerateBtn.href = acceleratedUrl;
    directBtn.href = originalUrl;

    // 加载用户偏好设置
    loadUserPreferences();

    // 绑定事件
    bindEvents();

    // 检查是否应该自动加速
    checkAutoAccelerate();
  }

  function loadUserPreferences() {
    chrome.storage.local.get([
      'gh_accelerator_always_accelerate',
      'gh_accelerator_domain_preferences',
      'gh_accelerator_disable_session'
    ], (result) => {
      // 始终加速
      if (result.gh_accelerator_always_accelerate) {
        alwaysAccelerateEl.checked = true;
      }

      // 域名偏好
      if (result.gh_accelerator_domain_preferences) {
        const domainPref = result.gh_accelerator_domain_preferences[currentDomain];
        if (domainPref === 'always_accelerate') {
          alwaysAccelerateEl.checked = true;
        } else if (domainPref === 'always_direct') {
          // 用户对该域名偏好直接访问
          directBtn.click();
        }
      }

      // 会话临时禁用
      if (result.gh_accelerator_disable_session) {
        disableForSessionEl.checked = true;
      }
    });
  }

  function checkAutoAccelerate() {
    chrome.storage.local.get([
      'gh_accelerator_always_accelerate',
      'gh_accelerator_domain_preferences',
      'gh_accelerator_disable_session'
    ], (result) => {
      // 检查是否会话临时禁用
      if (result.gh_accelerator_disable_session) {
        // 本次会话禁用，直接访问
        return;
      }

      // 检查是否始终加速
      if (result.gh_accelerator_always_accelerate) {
        // 始终加速模式
        startCountdown();
        return;
      }

      // 检查域名偏好
      if (result.gh_accelerator_domain_preferences) {
        const domainPref = result.gh_accelerator_domain_preferences[currentDomain];
        if (domainPref === 'always_accelerate') {
          startCountdown();
        }
      }
    });
  }

  function bindEvents() {
    // 加速按钮点击
    accelerateBtn.addEventListener('click', (e) => {
      e.preventDefault();
      saveUserPreferences();
      window.location.href = acceleratedUrl;
    });

    // 直接访问按钮点击
    directBtn.addEventListener('click', (e) => {
      e.preventDefault();
      saveUserPreferences();
      window.location.href = originalUrl;
    });

    // 始终加速复选框
    alwaysAccelerateEl.addEventListener('change', (e) => {
      const shouldAccelerate = e.target.checked;

      if (shouldAccelerate) {
        // 全局始终加速
        chrome.storage.local.set({
          gh_accelerator_always_accelerate: true
        });

        // 清除域名特定偏好
        removeDomainPreference();

        startCountdown();
      } else {
        chrome.storage.local.remove('gh_accelerator_always_accelerate');
        stopCountdown();
      }
    });

    // 记住域名复选框
    rememberDomainEl.addEventListener('change', (e) => {
      if (e.target.checked) {
        // 询问用户要记住什么选择
        showDomainPreferenceDialog();
      } else {
        removeDomainPreference();
      }
    });

    // 会话临时禁用
    disableForSessionEl.addEventListener('change', (e) => {
      chrome.storage.local.set({
        gh_accelerator_disable_session: e.target.checked
      });

      if (e.target.checked) {
        // 立即跳转到原始链接
        window.location.href = originalUrl;
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
      chrome.tabs.create({ url: 'https://github.com/akams-cn/github-accelerator/wiki/Help' });
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
    chrome.storage.local.get(['gh_accelerator_domain_preferences'], (result) => {
      const preferences = result.gh_accelerator_domain_preferences || {};
      preferences[currentDomain] = preference;

      chrome.storage.local.set({
        gh_accelerator_domain_preferences: preferences
      });
    });
  }

  function removeDomainPreference() {
    chrome.storage.local.get(['gh_accelerator_domain_preferences'], (result) => {
      const preferences = result.gh_accelerator_domain_preferences || {};
      delete preferences[currentDomain];

      chrome.storage.local.set({
        gh_accelerator_domain_preferences: preferences
      });
    });
  }

  let countdownTimer = null;

  function startCountdown() {
    countdownEl.classList.remove('hidden');
    let seconds = 10;
    timerEl.textContent = seconds;

    countdownTimer = setInterval(() => {
      seconds--;
      timerEl.textContent = seconds;

      if (seconds <= 0) {
        stopCountdown();
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
