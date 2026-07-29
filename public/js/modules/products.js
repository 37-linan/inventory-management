// 产品信息表模块（主系统和抖音系统共用）
const ProductsModule = {
  currentSystem: 'main',

  async render(system) {
    this.currentSystem = system;
    const container = document.getElementById(`page-${system}-products`);
    const systemLabel = system === 'main' ? '主' : '抖音刷券';

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3>📋 ${systemLabel}产品信息表</h3>
          <div class="btn-group">
            <button class="btn btn-primary" onclick="ProductsModule.showAddForm('${system}')">➕ 添加物品</button>
            <button class="btn btn-success" onclick="ProductsModule.showBatchImport('${system}')">📥 批量导入</button>
            <button class="btn btn-secondary" onclick="ProductsModule.manageTypes('${system}')">📑 管理类型</button>
          </div>
        </div>
      </div>
      <div id="products-list-${system}">
        <div class="card"><div class="card-body"><div class="empty-state"><div class="empty-icon">📦</div><p>加载中...</p></div></div></div>
      </div>
    `;

    await this.loadProducts(system);
  },

  async loadProducts(system) {
    try {
      const products = await API.get(`/api/${system}/products`);
      const container = document.getElementById(`products-list-${system}`);
      
      if (products.length === 0) {
        container.innerHTML = `
          <div class="card">
            <div class="card-body">
              <div class="empty-state">
                <div class="empty-icon">📦</div>
                <p>暂无产品信息，点击"添加物品"开始录入</p>
              </div>
            </div>
          </div>
        `;
        return;
      }

      // 按类型分组
      const groups = {};
      products.forEach(p => {
        const type = p.type || '未分类';
        if (!groups[type]) groups[type] = [];
        groups[type].push(p);
      });

      let html = '';
      for (const [type, items] of Object.entries(groups)) {
        html += `
          <div class="card">
            <div class="card-header">
              <h3 style="color:var(--primary);font-size:14px;">📁 ${type}</h3>
              <span style="font-size:12px;color:var(--text-light);">共 ${items.length} 项</span>
            </div>
            <div class="card-body" style="padding:0;">
              <div class="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>编码</th>
                      <th>名称</th>
                      <th>规格</th>
                      <th>单位</th>
                      <th>类型</th>
                      <th>行情</th>
                      <th>实时行情图</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${items.map(p => `
                      <tr onclick="ProductsModule.editProduct('${system}','${p.code}')" style="cursor:pointer;">
                        <td><code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:12px;">${p.code}</code></td>
                        <td><strong>${p.name}</strong> ${(!p.type || !p.spec || !p.unit) ? '<span style="color:var(--danger);font-size:10px;">待补充</span>' : ''}</td>
                        <td>${p.spec || '<span style="color:#bbb;">-</span>'}</td>
                        <td>${p.unit || '<span style="color:#bbb;">-</span>'}</td>
                        <td>${p.type || '<span style="color:#bbb;">-</span>'}</td>
                        <td>${p.market_price || '<span style="color:#bbb;">-</span>'}</td>
                        <td>
                          <div class="chart-container" id="chart-${system}-${p.code}"></div>
                        </td>
                        <td style="white-space:nowrap;">
                          <button class="btn btn-sm btn-primary" onclick="event.stopPropagation();ProductsModule.editProduct('${system}','${p.code}')">编辑</button>
                          <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();ProductsModule.deleteProduct('${system}','${p.code}')">删除</button>
                          <button class="btn btn-sm btn-success" onclick="event.stopPropagation();ProductsModule.setPrice('${system}','${p.code}','${p.name}')">💰 价格</button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;
      }

      container.innerHTML = html;

      // 渲染每个产品的波形图
      for (const p of products) {
        const chartContainer = document.getElementById(`chart-${system}-${p.code}`);
        if (chartContainer) {
          const svg = await PriceChart.render(`chart-${system}-${p.code}`, system, p.code, chartContainer.offsetWidth);
          chartContainer.innerHTML = `
            <div onclick="PriceChart.showLarge('${system}','${p.code}')" style="cursor:pointer;" title="点击放大查看行情">
              ${svg}
            </div>
          `;
        }
      }
    } catch (e) {
      showToast('加载产品数据失败: ' + e.message);
    }
  },

  showAddForm(system) {
    const systemLabel = system === 'main' ? '主系统' : '抖音刷券';
    showModal(`添加物品 - ${systemLabel}`);

    const body = document.getElementById('modal-body');
    body.innerHTML = `
      <form id="add-product-form" class="form-grid" onsubmit="ProductsModule.submitAdd('${system}');return false;">
        <div class="form-group">
          <label>物品编码 <span style="color:var(--danger)">*</span></label>
          <div class="input-with-btn">
            <input type="text" id="product-code" placeholder="手动输入或扫描条码" required />
            <button type="button" class="btn btn-sm btn-secondary" onclick="triggerBarcodeScan('product-code')">📷</button>
          </div>
        </div>
        <div class="form-group">
          <label>物品名称 <span style="color:var(--danger)">*</span></label>
          <input type="text" id="product-name" placeholder="输入物品名称" required list="name-suggestions" />
          <datalist id="name-suggestions"></datalist>
        </div>
        <div class="form-group">
          <label>规格</label>
          <input type="text" id="product-spec" placeholder="如：500ml / A4 / 大号" />
        </div>
        <div class="form-group">
          <label>单位</label>
          <select id="product-unit">
            <option value="">请选择单位</option>
            <option value="个">个</option>
            <option value="箱">箱</option>
            <option value="件">件</option>
            <option value="套">套</option>
            <option value="kg">kg</option>
            <option value="g">g</option>
            <option value="ml">ml</option>
            <option value="L">L</option>
            <option value="米">米</option>
            <option value="包">包</option>
            <option value="瓶">瓶</option>
            <option value="盒">盒</option>
            <option value="只">只</option>
            <option value="双">双</option>
            <option value="条">条</option>
          </select>
        </div>
        <div class="form-group">
          <label>实时行情</label>
          <select id="product-market-price">
            <option value="">请选择行情类型</option>
            <option value="固定价格">固定价格</option>
            <option value="浮动价格">浮动价格</option>
            <option value="市场价">市场价</option>
            <option value="协议价">协议价</option>
            <option value="无">无</option>
          </select>
        </div>
        <div class="form-group">
          <label>类型</label>
          <select id="product-type"></select>
          <div style="margin-top:4px;"><button type="button" class="btn btn-sm btn-secondary" onclick="ProductsModule.showAddTypeOption('${system}')">+ 管理类型选项</button></div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-lg">保存</button>
          <button type="button" class="btn btn-secondary btn-lg" onclick="closeModal()">取消</button>
        </div>
      </form>
    `;

    // 加载类型选项
    this._loadTypeOptions(system);
  },

  async _loadTypeOptions(system) {
    const select = document.getElementById('product-type');
    if (!select) return;
    const options = await ConfigManager.getOptions(system, 'product_types');
    select.innerHTML = '<option value="">请选择类型</option>' + 
      options.map(o => `<option value="${o}">${o}</option>`).join('');
  },

  async submitAdd(system) {
    const code = document.getElementById('product-code').value.trim();
    const name = document.getElementById('product-name').value.trim();
    const spec = document.getElementById('product-spec').value.trim();
    const unit = document.getElementById('product-unit').value;
    const marketPrice = document.getElementById('product-market-price').value;
    const type = document.getElementById('product-type').value;

    if (!code || !name) {
      showToast('请填写物品编码和名称');
      return;
    }

    try {
      await API.post(`/api/${system}/products`, { code, name, spec, unit, market_price: marketPrice, type });
      showToast('添加成功！');
      closeModal();
      await this.loadProducts(system);
    } catch (e) {
      showToast('添加失败: ' + e.message);
    }
  },

  async deleteProduct(system, code) {
    if (!confirm(`确认删除编码为 "${code}" 的产品？`)) return;
    try {
      await API.del(`/api/${system}/products/${code}`);
      showToast('删除成功');
      await this.loadProducts(system);
    } catch (e) {
      showToast('删除失败: ' + e.message);
    }
  },

  async editProduct(system, code) {
    try {
      const product = await API.get(`/api/${system}/products/${code}`);
      const systemLabel = system === 'main' ? '主系统' : '抖音刷券';
      showModal(`编辑物品 - ${systemLabel}`);

      const body = document.getElementById('modal-body');
      body.innerHTML = `
        <form id="edit-product-form" class="form-grid" onsubmit="ProductsModule.submitEdit('${system}','${code}');return false;">
          <div class="form-group">
            <label>物品编码</label>
            <input type="text" value="${product.code}" disabled style="background:#f5f5f5;" />
          </div>
          <div class="form-group">
            <label>物品名称 <span style="color:var(--danger)">*</span></label>
            <input type="text" id="edit-product-name" value="${product.name}" required />
          </div>
          <div class="form-group">
            <label>规格</label>
            <input type="text" id="edit-product-spec" value="${product.spec}" />
          </div>
          <div class="form-group">
            <label>单位</label>
            <select id="edit-product-unit">
              <option value="">请选择单位</option>
              ${['个','箱','件','套','kg','g','ml','L','米','包','瓶','盒','只','双','条'].map(u => 
                `<option value="${u}" ${product.unit === u ? 'selected' : ''}>${u}</option>`
              ).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>实时行情</label>
            <select id="edit-product-market-price">
              <option value="">请选择</option>
              ${['固定价格','浮动价格','市场价','协议价','无'].map(p => 
                `<option value="${p}" ${product.market_price === p ? 'selected' : ''}>${p}</option>`
              ).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>类型</label>
            <select id="edit-product-type"></select>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-lg">保存修改</button>
            <button type="button" class="btn btn-secondary btn-lg" onclick="closeModal()">取消</button>
          </div>
        </form>
      `;

      const select = document.getElementById('edit-product-type');
      const options = await ConfigManager.getOptions(system, 'product_types');
      select.innerHTML = '<option value="">请选择类型</option>' + 
        options.map(o => `<option value="${o}" ${product.type === o ? 'selected' : ''}>${o}</option>`).join('');
    } catch (e) {
      showToast('加载产品信息失败');
    }
  },

  async submitEdit(system, code) {
    const name = document.getElementById('edit-product-name').value.trim();
    const spec = document.getElementById('edit-product-spec').value.trim();
    const unit = document.getElementById('edit-product-unit').value;
    const marketPrice = document.getElementById('edit-product-market-price').value;
    const type = document.getElementById('edit-product-type').value;

    if (!name) { showToast('请填写物品名称'); return; }

    try {
      await API.put(`/api/${system}/products/${code}`, { name, spec, unit, market_price: marketPrice, type });
      showToast('修改成功');
      closeModal();
      await this.loadProducts(system);
    } catch (e) {
      showToast('修改失败: ' + e.message);
    }
  },

  // 设置价格
  async setPrice(system, code, name) {
    // 获取最近价格
    try {
      const latest = await API.get(`/api/${system}/price-history/${code}/latest`);
      const lastPrice = latest.price || 0;

      showModal(`输入实时行情价格 - ${name}`);
      const body = document.getElementById('modal-body');
      const today = new Date().toISOString().slice(0, 10);
      
      body.innerHTML = `
        <div style="text-align:center;">
          <p style="color:var(--text-secondary);margin-bottom:16px;">今日日期: ${today}</p>
          <div class="form-group" style="max-width:300px;margin:0 auto;">
            <label>今日价格 (上次价格: ¥${lastPrice})</label>
            <input type="number" id="price-input" step="0.01" value="${lastPrice}" style="font-size:24px;padding:12px;text-align:center;" autofocus />
          </div>
          <div style="display:flex;gap:10px;justify-content:center;margin-top:16px;">
            <button class="btn btn-primary btn-lg" onclick="ProductsModule.submitPrice('${system}','${code}')">确认提交</button>
            <button class="btn btn-secondary btn-lg" onclick="closeModal()">取消</button>
          </div>
          <p style="color:var(--text-light);font-size:12px;margin-top:8px;">如不输入将使用上次价格 (¥${lastPrice})</p>
        </div>
      `;
    } catch (e) {
      showToast('获取价格失败');
    }
  },

  async submitPrice(system, code) {
    const priceInput = document.getElementById('price-input');
    const price = parseFloat(priceInput.value) || 0;
    try {
      await API.post(`/api/${system}/price-history`, { product_code: code, price });
      showToast('价格已更新！');
      closeModal();
      await this.loadProducts(system);
    } catch (e) {
      showToast('提交失败: ' + e.message);
    }
  },

  // 管理类型选项
  showAddTypeOption(system) {
    const body = document.getElementById('modal-body');
    body.innerHTML = ConfigManager.renderOptionEditor(system, 'product_types', '管理产品类型', '输入新类型名称');
  },

  // ===== 批量导入 =====
  showBatchImport(system) {
    showModal('批量导入物品');
    const body = document.getElementById('modal-body');
    body.innerHTML = `
      <div style="padding:8px;">
        <p style="color:var(--text-secondary);margin-bottom:12px;font-size:13px;">
          导入格式：<strong>编码, 名称, 规格, 单位, 行情类型, 类型</strong>
          <br/>支持用 <strong>英文逗号(,)</strong>、<strong>中文逗号(，)</strong> 或 <strong>Tab键</strong> 分隔
          <br/>每行一个物品，<span style="color:var(--danger);">编码和名称为必填</span>
        </p>
        <textarea id="batch-import-data" rows="10" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:monospace;resize:vertical;" 
          placeholder="6901234567890, 测试商品A, 500ml, 瓶, 浮动价格, 日用品&#10;6923456789012, 测试商品B, A4, 包, 固定价格, 办公用品"></textarea>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button class="btn btn-primary btn-lg" onclick="ProductsModule.submitBatchImport('${system}')">导入</button>
          <button class="btn btn-secondary" onclick="closeModal()">取消</button>
        </div>
        <div id="batch-import-result" style="margin-top:12px;"></div>
      </div>
    `;
  },

  async submitBatchImport(system) {
    const text = document.getElementById('batch-import-data').value.trim();
    if (!text) { showToast('请输入数据'); return; }

    const resultEl = document.getElementById('batch-import-result');
    resultEl.innerHTML = '正在导入...';

    const lines = text.split('\n').filter(l => l.trim());
    let success = 0, fail = 0, errors = [];

    for (let i = 0; i < lines.length; i++) {
      // 支持英文逗号、中文逗号、制表符作为分隔符
      const parts = lines[i].split(/[,，\t]+/).map(s => s.trim()).filter(s => s);
      const code = parts[0] || '';
      const name = parts[1] || '';
      const spec = parts[2] || '';
      const unit = parts[3] || '';
      const marketPrice = parts[4] || '';
      const type = parts[5] || '';

      if (!code || !name) {
        fail++;
        errors.push(`第${i+1}行: 编码和名称未填 (解析到: ${JSON.stringify(parts)})`);
        continue;
      }

      try {
        await API.post(`/api/${system}/products`, { code, name, spec, unit, market_price: marketPrice, type });
        success++;
      } catch (e) {
        fail++;
        errors.push(`第${i+1}行 (${code}): ${e.message}`);
      }
    }

    if (errors.length > 10) {
      errors = errors.slice(0, 10);
      errors.push(`...还有${fail - 10}条错误`);
    }

    resultEl.innerHTML = `
      <div style="padding:12px;border-radius:8px;background:${fail > 0 ? '#fff3e0' : '#e8f5e9'};">
        <p><strong>导入完成</strong>：成功 ${success} 条，失败 ${fail} 条</p>
        ${errors.length > 0 ? `<div style="margin-top:8px;font-size:12px;color:var(--danger);max-height:150px;overflow-y:auto;">${errors.map(e => '<div>⚠ ' + e + '</div>').join('')}</div>` : ''}
      </div>
    `;

    if (success > 0) {
      await this.loadProducts(system);
    }
  },

  async manageTypes(system) {
    await ConfigManager.getOptions(system, 'product_types');
    showModal(`管理类型 - ${system === 'main' ? '主系统' : '抖音刷券'}`);
    const body = document.getElementById('modal-body');
    body.innerHTML = ConfigManager.renderOptionEditor(system, 'product_types', '产品类型管理', '输入新类型名称');
  }
};

// 条码扫描触发函数
function triggerBarcodeScan(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;

  // 创建独立扫码面板（不占用主弹窗，避免关闭后丢失表单内容）
  const scanPanel = document.createElement('div');
  scanPanel.id = 'scan-panel';
  scanPanel.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:5000;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;';
  scanPanel.innerHTML = `
    <div style="background:#fff;border-radius:12px;width:90%;max-width:400px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.3);">
      <div style="padding:12px 16px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:600;">扫描物品编码</span>
        <button onclick="document.getElementById('scan-panel')?.remove();BarcodeScanner.stopScan()" style="background:none;border:none;font-size:20px;cursor:pointer;color:#666;">✕</button>
      </div>
      <div id="scan-panel-body" style="min-height:250px;">
        <div style="text-align:center;padding:24px;">
          <p style="color:var(--text-secondary);">启动中...</p>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(scanPanel);

  BarcodeScanner.startScan(document.getElementById('scan-panel-body'), (code) => {
    input.value = code;
    scanPanel.remove();
    BarcodeScanner.stopScan();
    showToast('已填入编码: ' + code);
  });
}
