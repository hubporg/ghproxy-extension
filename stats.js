/**
 * stats.js - 匿名统计模块
 *
 * 职责：
 *  1. 累计加速跳转次数（每次拦截/加速成功 +1）
 *  2. 累计安装/更新次数（onInstalled 时 +1，install 和 update 合并计数）
 *  3. 上报到云端（https://addon-analytics.hubp.org）
 *
 * 数据全部匿名，不收集个人信息。统计行为受用户隐私同意控制。
 */

import './browser-polyfill.js';

const STATS_API_URL = 'https://addon-analytics.hubp.org';
const STATS_API_FALLBACK_URL = 'https://addon-analytics-hubp.tbedu.top';

const STORAGE_KEYS = {
  JUMP_COUNT: 'gh_accelerator_jump_count',
  INSTALL_COUNT: 'gh_accelerator_install_count',
  PENDING_REPORT: 'gh_accelerator_pending_report',
  PRIVACY_ACCEPTED: 'privacy_accepted',
};

const BATCH_THRESHOLD = 5; // 累积 5 次提交一次
const REPORT_INTERVAL = 5 * 60 * 1000; // 或每 5 分钟提交一次（与缓存检查同步）

/**
 * 检测浏览器类型
 */
function detectBrowser() {
  if (typeof browser !== 'undefined' && browser.runtime && browser.runtime.getBrowserInfo) {
    return browser.runtime.getBrowserInfo().then(info => {
      return info.name.toLowerCase().includes('firefox') ? 'firefox' : 'chromium';
    }).catch(() => detectByUA());
  }
  return Promise.resolve(detectByUA());
}

function detectByUA() {
  const ua = (navigator.userAgent || '').toLowerCase();
  return ua.includes('firefox') ? 'firefox' : 'chromium';
}

/**
 * 检查用户是否已同意隐私政策
 */
async function isPrivacyAccepted() {
  const result = await browser.storage.local.get(STORAGE_KEYS.PRIVACY_ACCEPTED);
  return result[STORAGE_KEYS.PRIVACY_ACCEPTED] === true;
}

/**
 * 读取本地计数（不增加）
 */
async function getLocalStats() {
  const result = await browser.storage.local.get([
    STORAGE_KEYS.JUMP_COUNT,
    STORAGE_KEYS.INSTALL_COUNT,
  ]);
  return {
    jumpCount: result[STORAGE_KEYS.JUMP_COUNT] || 0,
    installCount: result[STORAGE_KEYS.INSTALL_COUNT] || 0,
  };
}

/**
 * 增加加速跳转计数并标记上报
 */
async function incrementJumpCount() {
  if (!(await isPrivacyAccepted())) return;
  const result = await browser.storage.local.get(STORAGE_KEYS.JUMP_COUNT);
  const current = result[STORAGE_KEYS.JUMP_COUNT] || 0;
  await browser.storage.local.set({ [STORAGE_KEYS.JUMP_COUNT]: current + 1 });
  await enqueueReport('jump');
}

/**
 * 增加安装/更新计数并标记上报
 */
async function incrementInstallCount() {
  // 始终增加本地计数，不受隐私状态影响
  const result = await browser.storage.local.get(STORAGE_KEYS.INSTALL_COUNT);
  const current = result[STORAGE_KEYS.INSTALL_COUNT] || 0;
  await browser.storage.local.set({ [STORAGE_KEYS.INSTALL_COUNT]: current + 1 });
  // 仅在用户同意隐私政策后才加入上报队列
  if (await isPrivacyAccepted()) {
    await enqueueReport('install');
  }
}

/**
 * 将待上报事件加入队列
 */
async function enqueueReport(action) {
  const result = await browser.storage.local.get(STORAGE_KEYS.PENDING_REPORT);
  const pending = result[STORAGE_KEYS.PENDING_REPORT] || { jump: 0, install: 0 };
  pending[action] = (pending[action] || 0) + 1;
  await browser.storage.local.set({ [STORAGE_KEYS.PENDING_REPORT]: pending });

  if (pending.jump + pending.install >= BATCH_THRESHOLD) {
    flushStats().catch(err => console.warn('[Stats] 上报失败:', err));
  }
}

/**
 * 上报累积的统计到云端
 */
async function flushStats() {
  if (!(await isPrivacyAccepted())) return;

  const result = await browser.storage.local.get(STORAGE_KEYS.PENDING_REPORT);
  const pending = result[STORAGE_KEYS.PENDING_REPORT];
  if (!pending || (pending.jump === 0 && pending.install === 0)) return;

  const browserType = await detectBrowser();
  const manifest = browser.runtime.getManifest();
  const payload = {
    jumps: pending.jump || 0,
    installs: pending.install || 0,
    browser: browserType,
    version: manifest.version,
    timestamp: Date.now(),
  };

  try {
    // 先尝试主源，失败则回退到备用源
    let lastError;
    for (const baseUrl of [STATS_API_URL, STATS_API_FALLBACK_URL]) {
      try {
        await fetch(`${baseUrl}/stats/collect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        // 上报成功后清空队列
        await browser.storage.local.set({
          [STORAGE_KEYS.PENDING_REPORT]: { jump: 0, install: 0 },
        });
        console.log('[Stats] 上报成功:', baseUrl, payload);
        return;
      } catch (err) {
        lastError = err;
        console.warn('[Stats] 上报失败，尝试下一个源:', baseUrl, err);
      }
    }
    throw lastError;
  } catch (err) {
    console.warn('[Stats] 全部上报源失败，保留待下次重试:', err);
  }
}

/**
 * 启动定时上报定时器
 */
function startReportScheduler() {
  setInterval(() => {
    flushStats().catch(err => console.warn('[Stats] 定时上报失败:', err));
  }, REPORT_INTERVAL);
}

export {
  incrementJumpCount,
  incrementInstallCount,
  getLocalStats,
  flushStats,
  startReportScheduler,
  detectBrowser,
};
