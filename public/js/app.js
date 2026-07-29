// ========== 应用主入口 ==========

let currentPage = 'main-products';

// 页面导航
function navigateTo(page) {
  currentPage = page;
  
  // 隐藏所有页面
  document.querySelectorAll('.page-container').forEach(el => el.style.display = 'none');
  
  // 显示目标页面
  const target = document.getElementById(`page-${page}`);
  if (target) target.style.display = 'block';
  
  // 更新导航状态
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
  
  // 移动端关闭侧边栏
  if (window.innerWidth <= 768) {
    toggleSidebar(false);
  }
  
  // 渲染对应页面内容
  renderPage(page);
}

// 页面渲染
function renderPage(page) {
  // 清空配置缓存（保持数据新鲜）
  ConfigManager.clearCache();

  switch (page) {
    case 'main-products':
      ProductsModule.render('main');
      break;
    case 'main-ledger':
      TransactionsModule.render('main');
      break;
    case 'main-inventory':
      InventoryModule.render('main');
      break;
    case 'douyin-products':
    case 'douyin-ledger':
    case 'douyin-inventory': {
      const container = document.getElementById(`page-${page}`);
      if (container) {
        container.innerHTML = `
          <div class="card" style="margin-top:60px;">
            <div class="card-body" style="text-align:center;padding:60px 20px;">
              <div style="font-size:64px;margin-bottom:16px;">🎫</div>
              <h3 style="margin-bottom:12px;">抖音刷券系统暂未启用</h3>
              <p style="color:var(--text-secondary);">如需启用，请在 index.html 中将 douyin-nav-group 的 display:none 移除</p>
              <p style="color:var(--text-light);font-size:12px;margin-top:8px;">后台接口和代码已就绪，取消隐藏即可使用</p>
            </div>
          </div>
        `;
      }
      break;
    }
  }
}

// 侧边栏切换（移动端）
function toggleSidebar(force) {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  const isOpen = sidebar.classList.contains('open');
  
  if (force !== undefined) {
    if (force === isOpen) return;
    sidebar.classList.toggle('open', force);
    overlay.classList.toggle('open', force);
  } else {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
  }
}

// ========== 弹窗管理 ==========

function showModal(title) {
  const overlay = document.getElementById('modal-overlay');
  const titleEl = document.getElementById('modal-title');
  titleEl.textContent = title || '操作';
  overlay.classList.add('show');
}

function closeModal(e) {
  if (e && e.target !== document.getElementById('modal-overlay')) return;
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('show');
  
  // 停止相机
  CameraCapture.closeCamera();
  BarcodeScanner.stopScan();
  
  // 清理临时覆盖层
  document.querySelectorAll('#scan-overlay, #temp-scanner').forEach(el => el.remove());
}

// ========== 页面加载初始化 ==========
document.addEventListener('DOMContentLoaded', async () => {
  // 创建 Service Worker（PWA）
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('ServiceWorker 注册成功');
    } catch (e) {
      console.log('ServiceWorker 注册失败:', e);
    }
  }

  // 初始加载主产品信息表
  navigateTo('main-products');
});

// ========== 键盘快捷键 ==========
document.addEventListener('keydown', (e) => {
  // Esc 关闭弹窗
  if (e.key === 'Escape') {
    closeModal();
  }
});
