// 库存看板模块
const InventoryModule = {
  currentSystem: 'main',

  async render(system) {
    this.currentSystem = system;
    const container = document.getElementById(`page-${system}-inventory`);
    const systemLabel = system === 'main' ? '主' : '抖音刷券';

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>📈 ${systemLabel}库存看板</h3>
          <button class="btn btn-secondary" onclick="InventoryModule.refresh('${system}')">🔄 刷新</button>
        </div>
      </div>
      <div id="inventory-content-${system}">
        <div class="card"><div class="card-body"><div class="empty-state"><div class="empty-icon">📈</div><p>加载中...</p></div></div></div>
      </div>
    `;

    await this.loadData(system);
  },

  async loadData(system) {
    const container = document.getElementById(`inventory-content-${system}`);
    try {
      const data = await API.get(`/api/${system}/inventory`);
      const { inventory, recentInbound, recentOutbound } = data;

      // 统计
      const totalProducts = inventory.length;
      const totalStock = inventory.reduce((sum, p) => sum + Math.max(0, p.stock), 0);
      const totalIn = inventory.reduce((sum, p) => sum + p.total_in, 0);
      const totalOut = inventory.reduce((sum, p) => sum + p.total_out, 0);
      const lowStock = inventory.filter(p => p.stock <= 0).length;

      let html = `
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-value" style="color:var(--primary);">${totalProducts}</div>
            <div class="stat-label">产品种类</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color:var(--success);">${totalStock.toFixed(1)}</div>
            <div class="stat-label">总库存量</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color:var(--info);">${totalIn.toFixed(1)}</div>
            <div class="stat-label">总入库</div>
          </div>
          <div class="stat-card">
            <div class="stat-value" style="color:var(--danger);">${totalOut.toFixed(1)}</div>
            <div class="stat-label">总出库</div>
          </div>
        </div>
      `;

      // 库存明细表格
      if (inventory.length > 0) {
        html += `
          <div class="card">
            <div class="card-header">
              <h3>库存明细</h3>
              <span class="badge ${lowStock > 0 ? 'badge-stock-low' : 'badge-stock-normal'}" style="font-size:12px;">
                ${lowStock > 0 ? `⚠️ ${lowStock} 项库存不足` : '✅ 库存正常'}
              </span>
            </div>
            <div class="card-body" style="padding:0;">
              <div class="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>物品编码</th>
                      <th>物品名称</th>
                      <th>类型</th>
                      <th>规格</th>
                      <th>总入库</th>
                      <th>总出库</th>
                      <th>当前库存</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${inventory.map(p => {
                      const stockClass = p.stock <= 0 ? 'color:var(--danger);' : 'color:var(--success);';
                      return `<tr>
                        <td><code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:11px;">${p.code}</code></td>
                        <td><strong>${p.name}</strong></td>
                        <td><span class="badge badge-inbound">${p.type || '-'}</span></td>
                        <td>${p.spec || '-'}</td>
                        <td>${p.total_in}</td>
                        <td>${p.total_out}</td>
                        <td style="${stockClass};font-weight:700;font-size:16px;">${p.stock}</td>
                        <td>${p.stock <= 0 ? '<span class="badge badge-stock-low">缺货</span>' : '<span class="badge badge-stock-normal">有货</span>'}</td>
                      </tr>`;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;
      } else {
        html += `
          <div class="card"><div class="card-body">
            <div class="empty-state"><div class="empty-icon">📦</div><p>暂无库存数据，请先添加产品和出入库记录</p></div>
          </div></div>
        `;
      }

      // 最近出入库动态
      html += `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div class="card">
            <div class="card-header"><h3 style="font-size:14px;color:var(--success);">📥 最近入库</h3></div>
            <div class="card-body" style="padding:0;max-height:300px;overflow-y:auto;">
              ${recentInbound.length > 0 ? `
                <div class="table-wrapper">
                  <table>
                    <thead><tr><th>时间</th><th>物品</th><th>数量</th></tr></thead>
                    <tbody>${recentInbound.map(r => 
                      `<tr><td style="font-size:11px;">${r.created_at}</td><td>${r.product_name || r.product_code}</td><td style="color:var(--success);">+${r.quantity}</td></tr>`
                    ).join('')}</tbody>
                  </table>
                </div>
              ` : '<div style="padding:20px;text-align:center;color:var(--text-light);">暂无入库</div>'}
            </div>
          </div>
          <div class="card">
            <div class="card-header"><h3 style="font-size:14px;color:var(--danger);">📤 最近出库</h3></div>
            <div class="card-body" style="padding:0;max-height:300px;overflow-y:auto;">
              ${recentOutbound.length > 0 ? `
                <div class="table-wrapper">
                  <table>
                    <thead><tr><th>时间</th><th>物品</th><th>数量</th></tr></thead>
                    <tbody>${recentOutbound.map(r => 
                      `<tr><td style="font-size:11px;">${r.created_at}</td><td>${r.product_name || r.product_code}</td><td style="color:var(--danger);">-${r.quantity}</td></tr>`
                    ).join('')}</tbody>
                  </table>
                </div>
              ` : '<div style="padding:20px;text-align:center;color:var(--text-light);">暂无出库</div>'}
            </div>
          </div>
        </div>
      `;

      container.innerHTML = html;
    } catch (e) {
      container.innerHTML = `<div class="card"><div class="card-body"><p style="color:var(--danger);">加载失败: ${e.message}</p></div></div>`;
    }
  },

  async refresh(system) {
    await this.loadData(system);
    showToast('已刷新');
  }
};
