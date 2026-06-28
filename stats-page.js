/**
 * stats-page.js - 统计页面逻辑
 * 展示本地存储和云端聚合数据
 */

const STATS_SUMMARY_URL = 'https://addon-analytics.hubp.org/stats/summary';
const STATS_FALLBACK_URL = 'https://addon-analytics-hubp.tbedu.top/stats/summary';
const STATS_COLLECT_URL = 'https://addon-analytics.hubp.org/stats/collect';
const STATS_COLLECT_FALLBACK_URL = 'https://addon-analytics-hubp.tbedu.top/stats/collect';

/**
 * 手动上报本地 pending 数据（不依赖 background.js 消息）
 */
async function flushPendingStats() {
  const keys = {
    pending: 'gh_accelerator_pending_report',
    privacy: 'privacy_accepted',
  };
  const result = await browser.storage.local.get([keys.pending, keys.privacy]);
  if (result[keys.privacy] !== true) return { skipped: 'privacy' };

  const pending = result[keys.pending];
  if (!pending || (pending.jump === 0 && pending.install === 0)) return { skipped: 'empty' };

  // 检测浏览器类型
  const ua = (navigator.userAgent || '').toLowerCase();
  const browserType = ua.includes('firefox') ? 'firefox' : 'chromium';
  const manifest = browser.runtime.getManifest();

  const payload = {
    jumps: pending.jump || 0,
    installs: pending.install || 0,
    browser: browserType,
    version: manifest.version,
    timestamp: Date.now(),
  };

  // 先主源后备用源
  for (const url of [STATS_COLLECT_URL, STATS_COLLECT_FALLBACK_URL]) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        await browser.storage.local.set({ [keys.pending]: { jump: 0, install: 0 } });
        return { success: true, payload };
      }
    } catch (err) {
      console.warn('上报失败，尝试下一个源:', url, err);
    }
  }
  return { success: false };
}

async function loadStats() {
  const contentEl = document.getElementById('content');

  try {
    // 1. 读取本地数据
    const localResult = await browser.storage.local.get([
      'gh_accelerator_jump_count',
      'gh_accelerator_install_count',
      'privacy_accepted',
    ]);
    const localStats = {
      jumpCount: localResult.gh_accelerator_jump_count || 0,
      installCount: localResult.gh_accelerator_install_count || 0,
    };
    const privacyAccepted = localResult.privacy_accepted === true;

    // 2. 读取云端数据
    let cloudStats = null;
    let cloudError = null;
    try {
      const res = await fetch(STATS_SUMMARY_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      cloudStats = await res.json();
    } catch (err1) {
      console.warn('主源失败，尝试备用源:', err1);
      try {
        const res2 = await fetch(STATS_FALLBACK_URL);
        if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
        cloudStats = await res2.json();
      } catch (err2) {
        cloudError = err2.message;
        console.error('备用源也失败:', err2);
      }
    }

    // 3. 渲染
    renderStats(contentEl, localStats, cloudStats, cloudError, privacyAccepted);
  } catch (err) {
    contentEl.innerHTML = `
      <div class="notice-card error">
        <p><strong>加载失败</strong>：${err.message}</p>
      </div>
    `;
  }
}

function formatNumber(n) {
  if (n === undefined || n === null) return '-';
  if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
  if (n >= 10000) return (n / 10000).toFixed(1) + '万';
  return n.toLocaleString();
}

function formatTime(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 天前`;
}

function renderStats(container, local, cloud, cloudError, privacyAccepted) {
  let html = '';

  // 隐私状态
  html += `
    <div class="section">
      <div class="section-title">隐私状态</div>
      <div class="notice-card ${privacyAccepted ? 'info' : 'warning'}">
        <p><strong>匿名统计：${privacyAccepted ? '已启用' : '已禁用'}</strong></p>
        <p>${privacyAccepted
      ? '统计数据会定期上传至云端进行汇总，不包含任何个人信息。'
      : '匿名统计已关闭，不会上传任何数据。您可以在隐私政策页面重新启用。'
    }</p>
      </div>
    </div>
  `;

  // 本机统计
  html += `
    <div class="section">
      <div class="section-title">本机数据</div>
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-number">${formatNumber(local.jumpCount)}</div>
          <div class="stat-label">本机加速次数</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">${formatNumber(local.installCount)}</div>
          <div class="stat-label">本机安装/更新</div>
        </div>
      </div>
      <div class="notice-card">
        <p>以上数据仅存储在本浏览器中，不会单独上传。</p>
      </div>
    </div>
  `;

  // 云端统计
  if (cloud) {
    const installsBrowser = cloud.installs_by_browser || {};
    const jumpsBrowser = cloud.jumps_by_browser || {};
    const installsVersion = cloud.installs_by_version || {};
    const jumpsVersion = cloud.jumps_by_version || {};

    html += `
      <div class="section">
        <div class="section-title">全网数据（所有用户）</div>
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-number">${formatNumber(cloud.total_jumps)}</div>
            <div class="stat-label">累计加速</div>
          </div>
          <div class="stat-card">
            <div class="stat-number">${formatNumber(cloud.total_installs)}</div>
            <div class="stat-label">累计安装/更新</div>
          </div>
        </div>
      </div>
    `;

    // 按浏览器拆分
    html += `
      <div class="section">
        <div class="section-title">按浏览器统计</div>
        <table class="data-table">
          <thead>
            <tr>
              <th>浏览器</th>
              <th>加速次数</th>
              <th>安装/更新</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Chromium</td>
              <td>${formatNumber(jumpsBrowser.chromium || 0)}</td>
              <td>${formatNumber(installsBrowser.chromium || 0)}</td>
            </tr>
            <tr>
              <td>Firefox</td>
              <td>${formatNumber(jumpsBrowser.firefox || 0)}</td>
              <td>${formatNumber(installsBrowser.firefox || 0)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    // 按版本拆分
    const allVersions = Array.from(new Set([...Object.keys(installsVersion), ...Object.keys(jumpsVersion)]))
      .sort((a, b) => b.localeCompare(a));

    if (allVersions.length > 0) {
      let versionRows = '';
      for (const v of allVersions) {
        const j = jumpsVersion[v] || 0;
        const i = installsVersion[v] || 0;
        versionRows += `
          <tr>
            <td>v${v}</td>
            <td>${formatNumber(j)}</td>
            <td>${formatNumber(i)}</td>
          </tr>
        `;
      }
      html += `
        <div class="section">
          <div class="section-title">按版本统计</div>
          <table class="data-table">
            <thead>
              <tr>
                <th>版本</th>
                <th>加速次数</th>
                <th>安装/更新</th>
              </tr>
            </thead>
            <tbody>
              ${versionRows}
            </tbody>
          </table>
        </div>
      `;
    }

    // 最后更新 + 刷新按钮
    html += `
      <div class="section" style="text-align: center;">
        <p style="font-size: 12px; color: #999; margin-bottom: 12px;">数据更新于 ${formatTime(cloud.last_updated)}</p>
        <button class="btn btn-secondary" data-action="refresh">刷新数据</button>
      </div>
    `;
  } else if (cloudError) {
    html += `
      <div class="section">
        <div class="section-title">全网数据</div>
        <div class="notice-card error">
          <p><strong>云端数据加载失败</strong>：${cloudError}</p>
        </div>
        <div style="text-align: center;">
          <button class="btn btn-secondary" data-action="retry">重试</button>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

// 隐私政策链接
document.getElementById('privacy-link').addEventListener('click', (e) => {
  e.preventDefault();
  browser.tabs.create({ url: browser.runtime.getURL('privacy.html') });
});

// 触发一次上报并刷新数据
async function refreshAndFlush() {
  const result = await flushPendingStats();
  console.log('[Stats] 手动上报结果:', result);
  await loadStats();
}

// 初始化
loadStats();

// 事件委托：处理动态生成的按钮
document.getElementById('content').addEventListener('click', (e) => {
  const btn = e.target instanceof Element ? e.target.closest('[data-action]') : null;
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'refresh') {
    refreshAndFlush();
  } else if (action === 'retry') {
    loadStats();
  }
});
