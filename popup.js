document.addEventListener('DOMContentLoaded', async () => {
  const nodeSelect = document.getElementById('node-select');
  const latencyBadge = document.getElementById('latency-badge');
  const nodeUrlEl = document.getElementById('node-url');
  const nodeLatencyEl = document.getElementById('node-latency');
  const cacheTtlEl = document.getElementById('cache-ttl');
  const statusText = document.getElementById('status-text');
  const locationInfoEl = document.getElementById('location-info');
  const speedtestBtn = document.getElementById('speedtest-btn');
  const copyBtn = document.getElementById('copy-btn');
  const alwaysAccelerateCheckbox = document.getElementById('always-accelerate-checkbox');

  await loadLocationInfo();
  await loadNodeInfo();
  await loadAlwaysAccelerateSetting();

  // 始终加速复选框事件
  alwaysAccelerateCheckbox.addEventListener('change', async (e) => {
    const shouldAccelerate = e.target.checked;

    if (shouldAccelerate) {
      await chrome.storage.local.set({
        gh_accelerator_always_accelerate: true
      });
      console.log('[Popup] 已启用始终加速');
    } else {
      await chrome.storage.local.remove('gh_accelerator_always_accelerate');
      console.log('[Popup] 已禁用始终加速');
    }
  });

  speedtestBtn.addEventListener('click', async () => {
    speedtestBtn.disabled = true;
    speedtestBtn.innerHTML = '<span class="loading-spinner"></span> 测速中...';
    statusText.textContent = '测速中（将清除自选状态）';

    try {
      await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: 'REFRESH_NODE' }, (response) => {
          if (response && response.success) {
            resolve(response);
          } else {
            reject(new Error('刷新失败'));
          }
        });
      });

      await loadNodeInfo();
      statusText.textContent = '测速完成';
    } catch (error) {
      console.error('测速失败:', error);
      statusText.textContent = '测速失败';
    } finally {
      speedtestBtn.disabled = false;
      speedtestBtn.innerHTML = '⚡ 节点测速';

      // 3 秒后恢复状态文本
      setTimeout(async () => {
        if (speedtestBtn.disabled === false) {
          const cached = await chrome.storage.local.get(['gh_accelerator_best_node']);
          if (cached.gh_accelerator_best_node) {
            statusText.textContent = '运行中';
            statusText.style.color = '#2e7d32';
          }
        }
      }, 3000);
    }
  });

  copyBtn.addEventListener('click', () => {
    const url = nodeUrlEl.textContent;
    if (url && url !== '-') {
      navigator.clipboard.writeText(url).then(() => {
        const originalText = copyBtn.innerHTML;
        copyBtn.innerHTML = '✅ 已复制';
        setTimeout(() => {
          copyBtn.innerHTML = originalText;
        }, 1500);
      });
    }
  });
});

async function loadNodeInfo() {
  const nodeSelect = document.getElementById('node-select');
  const latencyBadge = document.getElementById('latency-badge');
  const nodeUrlEl = document.getElementById('node-url');
  const nodeLatencyEl = document.getElementById('node-latency');
  const cacheTtlEl = document.getElementById('cache-ttl');
  const statusText = document.getElementById('status-text');

  try {
    // 获取缓存的节点列表和当前选择的节点
    const cached = await chrome.storage.local.get(['gh_accelerator_best_node', 'gh_accelerator_node_list']);
    const currentData = cached.gh_accelerator_best_node;
    const nodeList = cached.gh_accelerator_node_list;

    if (currentData && currentData.node) {
      statusText.textContent = '运行中';
      statusText.style.color = '#2e7d32';

      const currentUrl = currentData.node.url;

      // 如果有节点列表，显示所有节点；否则只显示当前节点
      if (nodeList && nodeList.length > 0) {
        // 按延迟排序
        const sortedNodes = nodeList.sort((a, b) => {
          if (a.latency === -1) return 1;
          if (b.latency === -1) return -1;
          return a.latency - b.latency;
        });

        // 检查是否存在用户自选的节点（标记为 isUserSelected）
        const userSelectedNode = sortedNodes.find(n => n.isUserSelected === true);

        // 如果有自选节点，将其移动到第一位
        let displayNodes = sortedNodes;
        if (userSelectedNode) {
          const index = sortedNodes.indexOf(userSelectedNode);
          if (index > 0) {
            displayNodes = [userSelectedNode, ...sortedNodes.filter((_, i) => i !== index)];
          }
        }

        // 构建下拉选项
        let optionsHTML = '';
        displayNodes.forEach((node, index) => {
          const domain = extractDomain(node.url);
          const latencyStr = node.latency > 0 ? `${node.latency}ms` : '默认';
          const selected = node.url === currentUrl ? 'selected' : '';

          // 显示逻辑：自选 > 🥇 > 🥈 > 🥉
          let emoji;
          if (node.isUserSelected === true) {
            emoji = '🎯 自选';
          } else if (node.latency > 0) {
            emoji = index === 0 ? '🥇' : (index === 1 ? '🥈' : (index === 2 ? '🥉' : '⚪'));
          } else {
            emoji = '⚪';
          }

          optionsHTML += `<option value="${node.url}" ${selected}>${emoji} ${domain} (${latencyStr})</option>`;
        });

        nodeSelect.innerHTML = optionsHTML;

        // 添加节点选择事件监听
        nodeSelect.onchange = async (e) => {
          const selectedUrl = e.target.value;
          const selectedNode = sortedNodes.find(n => n.url === selectedUrl);

          if (selectedNode) {
            console.log('[Popup] 用户选择节点:', selectedNode);

            // 标记为用户自选节点
            const userSelectedNode = {
              ...selectedNode,
              isUserSelected: true
            };

            // 更新当前选择的节点
            await chrome.storage.local.set({
              gh_accelerator_best_node: {
                node: userSelectedNode,
                timestamp: Date.now()
              }
            });
            console.log('[Popup] 缓存已更新');

            // 通知 background 更新，并等待响应
            await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ type: 'UPDATE_NODE', node: userSelectedNode }, (response) => {
                if (response && response.success) {
                  console.log('[Popup] Background 已更新节点:', response.node);
                  resolve(response);
                } else {
                  console.error('[Popup] Background 更新失败:', response);
                  reject(new Error('更新失败'));
                }
              });
            });

            // 刷新显示
            await loadNodeInfo();
          }
        };
      } else {
        // 只有单个节点
        nodeSelect.innerHTML = `<option value="${currentUrl}" selected>⚪ ${extractDomain(currentUrl)} (${currentData.node.latency > 0 ? `${currentData.node.latency}ms` : '默认'})</option>`;
      }

      nodeSelect.disabled = false;

      // 更新详细信息显示
      nodeUrlEl.textContent = currentUrl.length > 40 ? currentUrl.substring(0, 37) + '...' : currentUrl;
      nodeUrlEl.title = currentUrl;

      if (currentData.node.latency > 0) {
        const latencyStr = `${currentData.node.latency}ms`;
        nodeLatencyEl.textContent = latencyStr;
        latencyBadge.textContent = `${(currentData.node.latency / 1000).toFixed(2)} s`;

        if (currentData.node.latency < 200) {
          latencyBadge.className = 'latency-badge good';
        } else if (currentData.node.latency < 500) {
          latencyBadge.className = 'latency-badge default';
        } else {
          latencyBadge.className = 'latency-badge';
        }
      } else {
        nodeLatencyEl.textContent = '默认节点';
        latencyBadge.textContent = '-';
        latencyBadge.className = 'latency-badge default';
      }

      const age = Date.now() - currentData.timestamp;
      const remaining = Math.max(0, 2 * 60 * 60 * 1000 - age);
      const minutes = Math.floor(remaining / 60000);
      cacheTtlEl.textContent = `${minutes} 分钟`;
    } else {
      showLoadingState();
    }
  } catch (error) {
    console.error('加载节点信息失败:', error);
    showLoadingState();
  }
}

function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function showLoadingState() {
  const statusText = document.getElementById('status-text');
  const nodeSelect = document.getElementById('node-select');
  const latencyBadge = document.getElementById('latency-badge');

  statusText.textContent = '初始化中';
  statusText.style.color = '#666';
  nodeSelect.innerHTML = '<option value="">等待节点...</option>';
  nodeSelect.disabled = true;
  latencyBadge.textContent = '-';
  latencyBadge.className = 'latency-badge default';
  document.getElementById('node-url').textContent = '-';
  document.getElementById('node-latency').textContent = '-';
  document.getElementById('cache-ttl').textContent = '-';
}

async function loadLocationInfo() {
  const locationInfoEl = document.getElementById('location-info');

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_LOCATION' }, (response) => {
        resolve(response);
      });
    });

    if (response && response.location) {
      const loc = response.location;
      const countryNames = {
        'CN': '🇨🇳 中国大陆',
        'HK': '🇭🇰 香港',
        'TW': '🇹🇼 台湾',
        'US': '🇺🇸 美国',
        'JP': '🇯🇵 日本',
        'KR': '🇰🇷 韩国',
        'SG': '🇸🇬 新加坡',
        'DE': '🇩🇪 德国',
        'GB': '🇬🇧 英国',
        'FR': '🇫🇷 法国'
      };

      const countryName = countryNames[loc.country] || `🌐 ${loc.country}`;

      let statusText, statusColor, tooltip;
      if (loc.needProxy) {
        statusText = '🔒 GFW限制';
        statusColor = '#c62828'; // 红色
        tooltip = `IP: ${loc.ip}\n地区: ${countryName}\n状态: 受长城防火墙(GFW)限制\n⚠️ 必须使用代理才能正常访问 GitHub`;
      } else if (loc.isChinaMainland === false && loc.country !== 'unknown') {
        statusText = '✅ 可直连';
        statusColor = '#2e7d32'; // 绿色
        tooltip = `IP: ${loc.ip}\n地区: ${countryName}\n状态: 无GFW限制，可直接访问 GitHub\n`;
      } else {
        statusText = '检测中...';
        statusColor = '#666';
        tooltip = '';
      }

      locationInfoEl.innerHTML = `${countryName} <span style="color: ${statusColor}; font-size: 11px; font-weight: 600;">[${statusText}]</span>`;
      if (tooltip) locationInfoEl.title = tooltip;
    } else {
      locationInfoEl.textContent = '检测中...';
    }
  } catch (error) {
    console.error('获取地理位置失败:', error);
    locationInfoEl.textContent = '检测失败';
  }
}

async function loadAlwaysAccelerateSetting() {
  const alwaysAccelerateCheckbox = document.getElementById('always-accelerate-checkbox');

  try {
    const result = await chrome.storage.local.get(['gh_accelerator_always_accelerate']);

    if (result.gh_accelerator_always_accelerate) {
      alwaysAccelerateCheckbox.checked = true;
    } else {
      alwaysAccelerateCheckbox.checked = false;
    }
  } catch (error) {
    console.error('加载加速设置失败:', error);
    alwaysAccelerateCheckbox.checked = false;
  }
}
