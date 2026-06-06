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
  const refreshLocationBtn = document.getElementById('refresh-location-btn');
  const customNodeUrlInput = document.getElementById('custom-node-url');
  const addCustomNodeBtn = document.getElementById('add-custom-node-btn');

  await loadLocationInfo();
  await loadNodeInfo();
  await loadAlwaysAccelerateSetting();
  await loadCustomNodes();

  const privacyLink = document.getElementById('privacy-link');
  if (privacyLink) {
    privacyLink.addEventListener('click', () => {
      browser.tabs.create({ url: browser.runtime.getURL('privacy.html') });
    });
  }

  alwaysAccelerateCheckbox.addEventListener('change', async (e) => {
    const shouldAccelerate = e.target.checked;

    if (shouldAccelerate) {
      await browser.storage.local.set({
        gh_accelerator_always_accelerate: true
      });
      console.log('[Popup] 已启用始终加速');
    } else {
      await browser.storage.local.remove('gh_accelerator_always_accelerate');
      console.log('[Popup] 已禁用始终加速');
    }
  });

  speedtestBtn.addEventListener('click', async () => {
    speedtestBtn.disabled = true;
    speedtestBtn.innerHTML = '<span class="loading-spinner"></span> 测速中...';
    statusText.textContent = '测速中（将清除自选状态）';

    try {
      const response = await browser.runtime.sendMessage({ type: 'REFRESH_NODE' });
      if (!response || !response.success) {
        throw new Error('刷新失败');
      }

      await loadNodeInfo();
      await loadCustomNodes();
      statusText.textContent = '测速完成';
    } catch (error) {
      console.error('测速失败:', error);
      statusText.textContent = '测速失败';
    } finally {
      speedtestBtn.disabled = false;
      speedtestBtn.innerHTML = '⚡ 节点测速';

      setTimeout(async () => {
        if (speedtestBtn.disabled === false) {
          const cached = await browser.storage.local.get(['gh_accelerator_best_node']);
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

  refreshLocationBtn.addEventListener('click', async () => {
    refreshLocationBtn.disabled = true;
    refreshLocationBtn.innerHTML = '<span class="loading-spinner"></span> 检测中...';
    locationInfoEl.textContent = '重新检测中...';

    try {
      const response = await browser.runtime.sendMessage({ type: 'REFRESH_LOCATION' });
      if (response && response.success) {
        await loadLocationInfo();
      }
    } catch (error) {
      console.error('重新测试IP失败:', error);
      locationInfoEl.textContent = '检测失败';
    } finally {
      refreshLocationBtn.disabled = false;
      refreshLocationBtn.innerHTML = '🌍 重测IP';
    }
  });

  addCustomNodeBtn.addEventListener('click', async () => {
    const url = customNodeUrlInput.value.trim();
    if (!url) {
      alert('请输入节点URL');
      return;
    }

    if (!url.startsWith('https://')) {
      alert('节点URL必须以https://开头');
      return;
    }

    addCustomNodeBtn.disabled = true;
    addCustomNodeBtn.textContent = '添加中...';

    try {
      const response = await browser.runtime.sendMessage({ type: 'ADD_CUSTOM_NODE', url });
      if (response && response.success) {
        customNodeUrlInput.value = '';
        await loadCustomNodes();
        await loadNodeInfo();
      } else {
        alert('添加失败: ' + (response?.error || '未知错误'));
      }
    } catch (error) {
      console.error('添加自定义节点失败:', error);
      alert('添加失败');
    } finally {
      addCustomNodeBtn.disabled = false;
      addCustomNodeBtn.textContent = '➕ 添加';
    }
  });

  customNodeUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addCustomNodeBtn.click();
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
    const cached = await browser.storage.local.get(['gh_accelerator_best_node', 'gh_accelerator_node_list']);
    const currentData = cached.gh_accelerator_best_node;
    const apiNodeList = cached.gh_accelerator_node_list || [];

    if (currentData && currentData.node) {
      statusText.textContent = '运行中';
      statusText.style.color = '#2e7d32';

      const currentUrl = currentData.node.url;

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
        ...sortedCustomNodes.map(n => ({...n, _isCustom: true})),
        ...sortedApiNodes
      ];

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

      nodeSelect.onchange = async (e) => {
        const selectedUrl = e.target.value;
        const selectedNode = allNodes.find(n => n.url === selectedUrl);

        if (selectedNode) {
          console.log('[Popup] 用户选择节点:', selectedNode);

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
          console.log('[Popup] 缓存已更新');

          const response = await browser.runtime.sendMessage({ type: 'UPDATE_NODE', node: nodeToSave });
          if (!response || !response.success) {
            console.error('[Popup] Background 更新失败:', response);
            throw new Error('更新失败');
          }
          console.log('[Popup] Background 已更新节点:', response.node);

          await loadNodeInfo();
        }
      };
  
      nodeSelect.disabled = false;

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

async function loadCustomNodes() {
  const customNodesList = document.getElementById('custom-nodes-list');
  if (!customNodesList) return;

  try {
    const response = await browser.runtime.sendMessage({ type: 'GET_CUSTOM_NODES' });
    const customNodes = response?.customNodes || [];

    if (customNodes.length === 0) {
      customNodesList.innerHTML = '<div style="font-size: 12px; color: #999; text-align: center; padding: 8px;">暂无自定义节点</div>';
      return;
    }

    let html = '';
    customNodes.forEach(node => {
      const domain = extractDomain(node.url);
      const latencyStr = node.latency > 0 ? `${node.latency}ms` : '未测速';
      html += `
        <div class="custom-node-item" style="display: flex; align-items: center; gap: 8px; padding: 8px; background: #f8f9fa; border-radius: 6px; margin-bottom: 8px;">
          <span style="flex: 1; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${node.url}">
            ⭐ ${domain}
          </span>
          <span style="font-size: 12px; color: ${node.latency > 0 ? (node.latency < 200 ? '#2e7d32' : '#ef6c00') : '#999'};">
            ${latencyStr}
          </span>
          <button class="edit-custom-node-btn" data-url="${node.url}" style="padding: 4px 8px; font-size: 12px; border: 1px solid #ddd; background: white; border-radius: 4px; cursor: pointer;">✏️</button>
          <button class="remove-custom-node-btn" data-url="${node.url}" style="padding: 4px 8px; font-size: 12px; border: 1px solid #ff4444; background: white; color: #ff4444; border-radius: 4px; cursor: pointer;">🗑️</button>
        </div>
      `;
    });

    customNodesList.innerHTML = html;

    document.querySelectorAll('.edit-custom-node-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const oldUrl = e.target.dataset.url;
        const newUrl = prompt('编辑节点URL:', oldUrl);
        if (newUrl && newUrl !== oldUrl && newUrl.startsWith('https://')) {
          await browser.runtime.sendMessage({ type: 'UPDATE_CUSTOM_NODE', oldUrl, newUrl });
          await loadCustomNodes();
          await loadNodeInfo();
        }
      });
    });

    document.querySelectorAll('.remove-custom-node-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        if (confirm('确定要删除此自定义节点吗？')) {
          const url = e.target.dataset.url;
          await browser.runtime.sendMessage({ type: 'REMOVE_CUSTOM_NODE', url });
          await loadCustomNodes();
          await loadNodeInfo();
        }
      });
    });
  } catch (error) {
    console.error('加载自定义节点失败:', error);
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
    const response = await browser.runtime.sendMessage({ type: 'GET_LOCATION' });

    if (response && response.location) {
      const loc = response.location;
      const countryNames = {
        'CN': '中国大陆',
        'HK': '香港',
        'TW': '台湾',
        'US': '美国',
        'JP': '日本',
        'KR': '韩国',
        'SG': '新加坡',
        'DE': '德国',
        'GB': '英国',
        'FR': '法国'
      };

      const countryName = countryNames[loc.country] || loc.country;

      let statusText, statusColor, tooltip;
      if (loc.needProxy) {
        statusText = 'GFW限制';
        statusColor = '#c62828';
        tooltip = `IP: ${loc.ip}\n地区: ${countryName}\n状态: 受长城防火墙(GFW)限制\n⚠️ 必须使用代理才能正常访问 GitHub`;
      } else if (loc.isChinaMainland === false && loc.country !== 'unknown') {
        statusText = '可直连';
        statusColor = '#2e7d32';
        tooltip = `IP: ${loc.ip}\n地区: ${countryName}\n状态: 无GFW限制，可直接访问 GitHub`;
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
    const result = await browser.storage.local.get(['gh_accelerator_always_accelerate']);

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
