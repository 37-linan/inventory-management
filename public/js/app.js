// ========== 应用主入口 ==========

// 网站访问密码与权限
// admin: 2312666  全部权限
// viewer: 2312    只读，可看整个系统
// limited: 666    只读，只能看产品信息表

function getRole() {
  return sessionStorage.getItem('inventory_role') || '';
}
function canEdit() {
  return getRole() === 'admin';
}

function checkLogin() {
  const input = document.getElementById('login-password');
  const val = input ? input.value : '';
  let role = '';
  if (val === '2312666') role = 'admin';
  else if (val === '2312') role = 'viewer';
  else if (val === '666') role = 'limited';

  if (role) {
    sessionStorage.setItem('inventory_role', role);
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.style.display = 'none';
    if (input) input.value = '';
    applyRoleClass();
    // 受限角色强制进产品表，其他按设备进入首页/产品表
    navigateTo(role === 'limited' ? 'main-products' : (isMobile() ? 'home' : 'main-products'));
  } else {
    const err = document.getElementById('login-error');
    if (err) err.style.display = 'block';
    if (input) { input.value = ''; input.focus(); }
  }
}

// 应用权限 class 到 body（CSS 统一控制只读/隐藏）
function applyRoleClass() {
  const body = document.body;
  body.classList.remove('perm-readonly', 'perm-limited');
  const role = getRole();
  if (role === 'viewer' || role === 'limited') body.classList.add('perm-readonly');
  if (role === 'limited') body.classList.add('perm-limited');
}

let currentPage = 'main-products';

// 是否移动端
function isMobile() {
  return window.innerWidth <= 768;
}

// 页面导航
function navigateTo(page) {
  // 受限角色（666）只能看产品信息表
  if (getRole() === 'limited' && (page === 'main-ledger' || page === 'main-inventory')) {
    page = 'main-products';
  }

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
  if (isMobile()) {
    toggleSidebar(false);
  }
  
  // 渲染对应页面内容
  renderPage(page);
}

// 移动端首页：3个板块导航卡片
function renderHomePage() {
  const container = document.getElementById('page-home');
  if (!container) return;
  const role = getRole();
  // 受限角色（666）首页只显示产品信息表卡片
  const showLedger = role !== 'limited';
  const showInventory = role !== 'limited';
  container.innerHTML = `
    <div style="padding:16px;">
      <div style="text-align:center;padding:26px 0 8px;">
        <div style="font-size:42px;">📦</div>
        <h2 style="margin:10px 0 4px;font-size:20px;">库存管理工作台</h2>
        <p style="color:var(--text-secondary);font-size:13px;margin:0;">选择功能板块进入</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:14px;margin-top:18px;">
        <div onclick="navigateTo('main-products')" style="display:flex;align-items:center;gap:16px;background:var(--card-bg,#fff);border:1px solid var(--border);border-radius:14px;padding:18px 16px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <div style="width:52px;height:52px;border-radius:12px;background:rgba(26,115,232,0.12);display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0;">📋</div>
          <div style="flex:1;">
            <div style="font-size:17px;font-weight:600;">主产品信息表</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">产品信息、价格行情、库存管理</div>
          </div>
          <span style="color:var(--text-light);font-size:22px;">›</span>
        </div>
        ${showLedger ? `
        <div onclick="navigateTo('main-ledger')" style="display:flex;align-items:center;gap:16px;background:var(--card-bg,#fff);border:1px solid var(--border);border-radius:14px;padding:18px 16px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <div style="width:52px;height:52px;border-radius:12px;background:rgba(52,168,83,0.12);display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0;">📊</div>
          <div style="flex:1;">
            <div style="font-size:17px;font-weight:600;">主出入库台账</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">入库登记、出库登记、台账明细</div>
          </div>
          <span style="color:var(--text-light);font-size:22px;">›</span>
        </div>` : ''}
        ${showInventory ? `
        <div onclick="navigateTo('main-inventory')" style="display:flex;align-items:center;gap:16px;background:var(--card-bg,#fff);border:1px solid var(--border);border-radius:14px;padding:18px 16px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <div style="width:52px;height:52px;border-radius:12px;background:rgba(251,188,4,0.15);display:flex;align-items:center;justify-content:center;font-size:26px;flex-shrink:0;">📈</div>
          <div style="flex:1;">
            <div style="font-size:17px;font-weight:600;">主库存看板</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">库存总览、预警、统计</div>
          </div>
          <span style="color:var(--text-light);font-size:22px;">›</span>
        </div>` : ''}
      </div>
    </div>
  `;
}

// 页面渲染
function renderPage(page) {
  // 清空配置缓存（保持数据新鲜）
  ConfigManager.clearCache();

  // 移动端：非首页时显示返回按钮（2312只读访客可返回首页；666受限角色不显示返回键）
  const backBtn = document.getElementById('mobile-back-btn');
  if (isMobile()) {
    if (page === 'home' || getRole() === 'limited') {
      backBtn.style.display = 'none';
    } else {
      backBtn.style.display = 'flex';
    }
  }

  switch (page) {
    case 'home':
      renderHomePage();
      break;
    case 'main-products':
      ProductsModule.render('main');
      break;
    case 'main-ledger':
      TransactionsModule.render('main');
      break;
    case 'main-inventory':
      InventoryModule.render('main');
      break;
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

  // 连带关掉叠在它上面的第二层弹窗，避免留下一个关不掉的浮层
  const overlay2 = document.getElementById('modal-overlay-2');
  if (overlay2) overlay2.classList.remove('show');

  // 停止相机
  CameraCapture.closeCamera();
  BarcodeScanner.stopScan();
  
  // 清理临时覆盖层
  document.querySelectorAll('#scan-overlay, #temp-scanner').forEach(el => el.remove());
}

// 第二层弹窗（弹窗里再弹一个），关闭后回到下面那层
function closeModal2(e) {
  if (e && e.target !== document.getElementById('modal-overlay-2')) return;
  const overlay2 = document.getElementById('modal-overlay-2');
  if (overlay2) overlay2.classList.remove('show');
}

// 打开/更新第二层弹窗
function showModal2(title) {
  const overlay2 = document.getElementById('modal-overlay-2');
  if (!overlay2) return;
  const titleEl = document.getElementById('modal-title-2');
  if (titleEl) titleEl.textContent = title || '明细';
  overlay2.classList.add('show');
}

// ========== 页面加载初始化 ==========
document.addEventListener('DOMContentLoaded', async () => {
  // 密码验证：未登录则显示登录层
  if (!sessionStorage.getItem('inventory_role')) {
    const overlay = document.getElementById('login-overlay');
    if (overlay) overlay.style.display = 'flex';
    const input = document.getElementById('login-password');
    if (input) setTimeout(() => input.focus(), 300);
    // 回车提交
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') checkLogin(); });
  } else {
    // 已登录：应用权限 class
    applyRoleClass();
  }

  // 创建 Service Worker（PWA）
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('ServiceWorker 注册成功');
    } catch (e) {
      console.log('ServiceWorker 注册失败:', e);
    }
  }

  // 初始加载：手机版进入首页导航，电脑版直接进产品信息表；受限角色只能进产品表
  if (getRole() === 'limited') {
    navigateTo('main-products');
  } else {
    navigateTo(isMobile() ? 'home' : 'main-products');
  }
});

// ========== 键盘快捷键 ==========
document.addEventListener('keydown', (e) => {
  // Esc 关闭弹窗
  if (e.key === 'Escape') {
    closeModal();
  }
});
