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
      <div id="products-dashboard-${system}"></div>
      <div id="products-list-${system}">
        <div class="card"><div class="card-body"><div class="empty-state"><div class="empty-icon">📦</div><p>加载中...</p></div></div></div>
      </div>
    `;

    await this.loadProducts(system);
  },

  async loadProducts(system) {
    try {
      // 所有产品统一加载（包含抖音刷券）
      const filtered = await API.get('/api/main/products');
      this._allProducts = filtered; // 供搜索弹窗使用
      const container = document.getElementById(`products-list-${system}`);
      // 渲染顶部仪表盘
      await this._renderDashboard(system, filtered);

      if (filtered.length === 0) {
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

      // 按类型分组：所有产品平铺显示（无赠品嵌套）
      const groups = {};
      filtered.forEach(p => {
        const type = p.type || '未分类';
        if (!groups[type]) groups[type] = [];
        groups[type].push(p);
      });

      let html = '';
      let groupIndex = 0;
      for (const [type, items] of Object.entries(groups)) {
        const idx = groupIndex++;
        const collapsed = localStorage.getItem('pg-collapse-' + idx) === '1';
        const totalCount = items.length;
        html += `
          <div class="card">
            <div class="card-header" style="cursor:pointer;user-select:none;" onclick="ProductsModule.toggleGroup(${idx})" title="${collapsed ? '点击展开' : '点击折叠'}">
              <h3 style="color:var(--primary);font-size:14px;">📁 ${type} <span id="group-arrow-${idx}" style="font-size:12px;color:var(--text-light);">${collapsed ? '▸' : '▾'}</span></h3>
              <span style="font-size:12px;color:var(--text-light);">共 ${items.length} 个产品</span>
            </div>
            <div class="card-body" style="padding:0;${collapsed ? 'display:none;' : ''}" id="group-body-${idx}">
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
                  <tbody id="group-tbody-${idx}" data-group="${idx}">
                    ${items.map(p => {
                      return `
                      <tr draggable="true" data-pid="${p.id}" onclick="ProductsModule.editProduct('${system}','${p.code}','${p.id}')" style="cursor:grab;">
                        <td>
                          <code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:12px;">${p.code}</code>
                        </td>
                        <td>
                          <strong>${p.name}</strong>
                          ${(!p.type || !p.spec || !p.unit) ? '<span style="color:var(--danger);font-size:10px;">待补充</span>' : ''}
                        </td>
                        <td>${p.spec || '<span style="color:#bbb;">-</span>'}</td>
                        <td>${p.unit || '<span style="color:#bbb;">-</span>'}</td>
                        <td>${p.type || '<span style="color:#bbb;">-</span>'}</td>
                        <td>${p.market_price || '<span style="color:#bbb;">-</span>'}</td>
                        <td>
                          <div class="chart-container" id="chart-${system}-${p.code}-${p.id}"></div>
                        </td>
                        <td style="white-space:nowrap;">
                          <button class="btn btn-sm btn-primary" onclick="event.stopPropagation();ProductsModule.editProduct('${system}','${p.code}','${p.id}')">编辑</button>
                          <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();ProductsModule.deleteProduct('${system}','${p.code}','${p.type}','${p.id}')">删除</button>
                          <button class="btn btn-sm btn-success" onclick="event.stopPropagation();ProductsModule.setPrice('${system}','${p.code}','${p.name}','${p.id}')">💰 价格</button>
                        </td>
                      </tr>`;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;
      }

      container.innerHTML = html;

      // 绑定每组分组的拖拽排序
      document.querySelectorAll('#products-list-' + system + ' tbody[data-group]').forEach(tbody => {
        this._enableRowDrag(tbody, system);
      });

      // 渲染每个产品的波形图
      for (const p of filtered) {
        const chartContainer = document.getElementById(`chart-${system}-${p.code}-${p.id}`);
        if (chartContainer) {
          try {
            // 用 product_id 加载独立行情
            const svg = await PriceChart.render(`chart-${system}-${p.code}`, system, p.code, chartContainer.offsetWidth, p.id);
            chartContainer.innerHTML = `
              <div onclick="PriceChart.showLarge('${system}','${p.code}','${p.id}')" style="cursor:pointer;" title="点击放大查看行情">
                ${svg || '<div style="color:var(--text-light);font-size:11px;padding:8px;">-</div>'}
              </div>
            `;
          } catch (e) {
            console.error('图表渲染失败:', e);
            chartContainer.innerHTML = '<div style="color:var(--text-light);font-size:11px;text-align:center;padding:8px;">图表加载失败</div>';
          }
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
            <option value="台">台</option>
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
        ${system === 'main' ? `
        <div class="form-group">
          <label>类型</label>
          <select id="product-type" onchange="ProductsModule._onTypeChange()"></select>
          <div style="margin-top:4px;"><button type="button" class="btn btn-sm btn-secondary" onclick="ProductsModule.showAddTypeOption('${system}')">+ 管理类型选项</button></div>
        </div>
        <div class="form-group" id="bundle-qty-group" style="display:none;">
          <label>套组数量 <span style="color:var(--info);">(抖音券专用)</span></label>
          <input type="number" id="product-bundle-qty" value="1" min="1" max="999" />
          <div style="font-size:11px;color:var(--text-light);margin-top:4px;">入库 × 套组数量 = 实际库存</div>
        </div>` : `
        <div class="form-group">
          <label>类型</label>
          <div style="padding:8px 12px;background:#fff8e1;border:1px solid #fbbc04;border-radius:8px;font-size:13px;color:#fbbc04;font-weight:500;">🎫 抖音刷券</div>
        </div>
        <div class="form-group" id="bundle-qty-group">
          <label>套组数量 <span style="color:var(--info);">(抖音券专用)</span></label>
          <input type="number" id="product-bundle-qty" value="1" min="1" max="999" />
          <div style="font-size:11px;color:var(--text-light);margin-top:4px;">入库 × 套组数量 = 实际库存</div>
        </div>`}
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
    // 主系统类型选项：排除"抖音刷券"（它已独立为单独系统）
    const options = await ConfigManager.getOptions(system, 'product_types');
    const filtered = system === 'main' ? options.filter(o => o !== '抖音刷券') : options;
    select.innerHTML = '<option value="">请选择类型</option>' + 
      filtered.map(o => `<option value="${o}">${o}</option>`).join('');
  },

  _onTypeChange() {
    const type = document.getElementById('product-type')?.value;
    const group = document.getElementById('bundle-qty-group');
    if (group) {
      group.style.display = type === '抖音刷券' ? 'block' : 'none';
    }
  },

  async submitAdd(system) {
    const code = document.getElementById('product-code').value.trim();
    const name = document.getElementById('product-name').value.trim();
    const spec = document.getElementById('product-spec').value.trim();
    const unit = document.getElementById('product-unit').value;
    const marketPrice = document.getElementById('product-market-price').value;
    const type = system === 'main' ? document.getElementById('product-type').value : '抖音刷券';
    const bundleQty = type === '抖音刷券' ? parseInt(document.getElementById('product-bundle-qty')?.value) || 1 : 1;

    if (!code || !name) {
      showToast('请填写物品编码和名称');
      return;
    }

    try {
      const body = { code, name, spec, unit, market_price: marketPrice, type };
      if (type === '抖音刷券') body.bundle_qty = bundleQty;
      // 统一用主系统 API 存储（按类型区分）
      const result = await API.post('/api/main/products', body);
      showToast('添加成功！');

      closeModal();
      await this.loadProducts(system);
    } catch (e) {
      showToast('添加失败: ' + e.message);
    }
  },

  // 生成赠品表单HTML（可复用）
  _renderGiftForm(system, mainId, mainCode, mainName) {
    return '<div style="background:var(--primary-light);padding:10px 14px;border-radius:8px;margin-bottom:14px;font-size:13px;">' +
      '主品: <strong>' + mainName + '</strong> (编码: ' + mainCode + ')' +
      '<span style="margin-left:8px;font-size:11px;color:var(--text-secondary);">赠品为选填，不需要可直接关闭</span></div>' +
      '<form id="add-gift-form" class="form-grid" onsubmit="ProductsModule.submitAddGift(\'' + system + '\',\'' + mainId + '\');return false;">' +
      '<div class="form-group"><label>赠品编码 <span style="color:var(--danger)">*</span></label>' +
      '<div class="input-with-btn"><input type="text" id="gift-code" placeholder="输入赠品编码" required />' +
      '<button type="button" class="btn btn-sm btn-secondary" onclick="triggerBarcodeScan(\'gift-code\')">📷</button></div></div>' +
      '<div class="form-group"><label>赠品名称 <span style="color:var(--danger)">*</span></label>' +
      '<input type="text" id="gift-name" placeholder="输入赠品名称" required /></div>' +
      '<div class="form-group"><label>规格</label><input type="text" id="gift-spec" placeholder="如：500ml / 白色" /></div>' +
      '<div class="form-group"><label>单位</label><select id="gift-unit">' +
      '<option value="">请选择单位</option>' +
      ['个','箱','件','套','kg','g','ml','L','米','包','瓶','盒','只','双','条','台']
        .map(function(u){return '<option value="'+u+'">'+u+'</option>';}).join('') + '</select></div>' +
      '<div class="form-group"><label>实时行情</label><select id="gift-market-price">' +
      '<option value="">请选择行情类型</option>' +
      ['固定价格','浮动价格','市场价','协议价','无']
        .map(function(p){return '<option value="'+p+'">'+p+'</option>';}).join('') + '</select></div>' +
      '<div class="form-group"><label>套组数量</label>' +
      '<input type="number" id="gift-bundle-qty" value="1" min="1" max="999" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;font-size:13px;" />' +
      '<div style="font-size:11px;color:var(--text-light);margin-top:4px;">库存 = 入库数量 × 套组数量</div></div>' +
      '<div style="font-size:12px;color:var(--text-secondary);padding:8px 0;">' +
      '<span style="color:var(--info);">提示:</span> 类型自动设为"抖音刷券"</div>' +
      '<div class="form-actions" style="display:flex;gap:10px;">' +
      '<button type="submit" class="btn btn-primary btn-lg" style="flex:1;">保存赠品</button>' +
      '<button type="button" class="btn btn-secondary btn-lg" style="flex:1;" onclick="closeModal();ProductsModule.loadProducts(\'' + system + '\')">跳过（不添加）</button>' +
      '</div></form>';
  },

  // 弹出赠品添加表单（兼容外部调用：传入主品编码时会自动查 ID）
  showAddGiftForm(system, mainCode, mainName) {
    showModal('添加赠品 - 为主品 "' + mainName + '" 添加赠品（选填）');
    // 调用时如果没传 ID，用编码作为 ID（旧数据兼容）
    const mainId = arguments.length > 2 ? mainCode : mainCode;
    document.getElementById('modal-body').innerHTML = ProductsModule._renderGiftForm(system, mainId, mainCode, mainName);
    setTimeout(function(){ var el = document.getElementById('gift-code'); if(el) el.focus(); }, 100);
  },

  async submitAddGift(system, mainId) {
    const code = document.getElementById('gift-code').value.trim();
    const name = document.getElementById('gift-name').value.trim();
    const spec = document.getElementById('gift-spec').value.trim();
    const unit = document.getElementById('gift-unit').value;
    const marketPrice = document.getElementById('gift-market-price').value;
    const bundleQty = parseInt(document.getElementById('gift-bundle-qty')?.value) || 1;

    if (!code || !name) {
      showToast('请填写赠品编码和名称');
      return;
    }

    try {
      await API.post('/api/main/products', {
        code,
        name,
        spec,
        unit,
        market_price: marketPrice,
        type: '抖音刷券',
        gift_of: mainId,  // 用主品 ID 关联，确保赠品归到指定规格
        bundle_qty: bundleQty
      });
      showToast('赠品添加成功！');
      closeModal();
      await this.loadProducts(system);
    } catch (e) {
      showToast('添加赠品失败: ' + e.message);
    }
  },

  // 启用表格行拖拽排序（HTML5 原生拖拽）
  _enableRowDrag(tbody, system) {
    let dragRow = null;

    tbody.addEventListener('dragstart', (e) => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      dragRow = tr;
      tr.classList.add('drag-source');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', tr.dataset.pid); } catch (err) {}
    });

    tbody.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const tr = e.target.closest('tr');
      tbody.querySelectorAll('tr').forEach(t => t.classList.remove('drag-over'));
      if (tr && tr !== dragRow) tr.classList.add('drag-over');
    });

    tbody.addEventListener('drop', (e) => {
      e.preventDefault();
      const target = e.target.closest('tr');
      if (target && dragRow && target !== dragRow) {
        const rows = Array.from(tbody.querySelectorAll('tr'));
        if (rows.indexOf(dragRow) < rows.indexOf(target)) {
          target.after(dragRow);
        } else {
          target.before(dragRow);
        }
        // 收集新顺序并保存
        const orderedIds = Array.from(tbody.querySelectorAll('tr'))
          .map(r => parseInt(r.dataset.pid))
          .filter(id => !isNaN(id));
        this._saveOrder(orderedIds, system);
      }
      dragRow = null;
      tbody.querySelectorAll('tr').forEach(t => t.classList.remove('drag-source', 'drag-over'));
    });

    tbody.addEventListener('dragend', () => {
      dragRow = null;
      tbody.querySelectorAll('tr').forEach(t => t.classList.remove('drag-source', 'drag-over'));
    });
  },

  // 保存整组新顺序到后端
  async _saveOrder(orderedIds, system) {
    try {
      await API.post('/api/main/products/reorder', { orderedIds });
      // 图表容器 id 依赖顺序，重新渲染列表保证一致性
      await this.loadProducts(system);
    } catch (e) {
      showToast('保存顺序失败: ' + e.message);
    }
  },

  // 上移/下移产品（同一类型分组内）
  async moveProduct(system, id, direction) {
    try {
      await API.post('/api/main/products/move', { id: parseInt(id), direction });
      await this.loadProducts(system);
    } catch (e) {
      showToast('调整顺序失败: ' + e.message);
    }
  },

  // ===== 顶部信息仪表盘 =====
  async _renderDashboard(system, products) {
    const dash = document.getElementById(`products-dashboard-${system}`);
    if (!dash) return;
    try {
      // 获取库存数据用于统计
      let invData = [];
      try {
        const data = await API.get(`/api/${system}/inventory`);
        invData = data.inventory || [];
      } catch (e) { /* 库存接口失败不影响仪表盘 */ }

      const totalProducts = products.length;
      // 按类型统计
      const typeCount = {};
      products.forEach(p => {
        const t = p.type || '未分类';
        typeCount[t] = (typeCount[t] || 0) + 1;
      });
      // 库存统计（按编码聚合，因为同编码可能有多个规格）
      const invByCode = {};
      invData.forEach(p => { invByCode[p.code] = p; });
      const totalStock = Object.values(invByCode).reduce((s, p) => s + Math.max(0, p.stock || 0), 0);
      const lowStock = Object.values(invByCode).filter(p => (p.stock || 0) <= 0).length;

      const typeCards = Object.entries(typeCount).map(([t, n]) => `
        <div class="stat-card" style="background:linear-gradient(135deg, #eef6ff, #fafcff);cursor:pointer;" onclick="ProductsModule.showSearchModal('${system}','${t.replace(/'/g, "\\'")}')" title="点击搜索该类型产品">
          <div class="stat-value" style="color:var(--primary);">${n}</div>
          <div class="stat-label">${t} 产品 🔍</div>
        </div>
      `).join('');

      dash.innerHTML = `
        <div class="stats-grid" style="margin-bottom:12px;">
          <div class="stat-card" style="cursor:pointer;" onclick="ProductsModule.showSearchModal('${system}','')" title="点击搜索全部产品">
            <div class="stat-value" style="color:var(--primary);">${totalProducts}</div>
            <div class="stat-label">产品总数 🔍</div>
          </div>
          ${typeCards}
        </div>
      `;
    } catch (e) {
      dash.innerHTML = '';
    }
  },

  // ===== 搜索弹窗（点击仪表盘卡片触发）=====
  showSearchModal(system, type) {
    // 缓存数据：没有就重新拉取
    const all = this._allProducts || [];
    if (all.length === 0) {
      API.get('/api/main/products').then(list => {
        this._allProducts = list;
        this._renderSearchModal(system, type);
      }).catch(e => showToast('加载失败: ' + e.message));
      return;
    }
    this._renderSearchModal(system, type);
  },

  _renderSearchModal(system, type) {
    const all = this._allProducts || [];
    showModal('🔍 搜索产品');
    const body = document.getElementById('modal-body');
    body.innerHTML = `
      <div class="form-group">
        <label>${type ? '正在搜索类型：' + type + '（可输入关键字过滤）' : '输入关键字搜索（名称/编码/规格）'}</label>
        <input type="text" id="search-kw" placeholder="输入几个字，如：海飞丝 / 69031" autofocus />
      </div>
      <div id="search-results" style="max-height:400px;overflow-y:auto;"></div>
    `;
    const input = document.getElementById('search-kw');
    const results = document.getElementById('search-results');

    const doSearch = () => {
      const kw = input.value.trim().toLowerCase();
      let list = all;
      if (type) list = list.filter(p => (p.type || '') === type);
      if (kw) {
        list = list.filter(p =>
          (p.name || '').toLowerCase().includes(kw) ||
          (p.code || '').toLowerCase().includes(kw) ||
          (p.spec || '').toLowerCase().includes(kw)
        );
      }
      if (list.length === 0) {
        results.innerHTML = '<div style="text-align:center;color:var(--text-light);padding:30px;">未找到匹配产品</div>';
        return;
      }
      results.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:var(--bg);border-bottom:2px solid var(--border);font-size:12px;color:var(--text-secondary);">
          <span>共 ${list.length} 条</span>
          <button class="btn btn-sm btn-primary" onclick="ProductsModule.showAddForm('${system}')">➕ 添加物品</button>
        </div>
        ${list.slice(0, 200).map(p => `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--border);cursor:pointer;" onclick="ProductsModule.closeSearchAndShowChart('${system}','${p.code}','${p.id}')">
          <div style="flex:1;min-width:0;">
            <code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:11px;">${p.code}</code>
            <strong style="margin-left:6px;font-size:13px;">${p.name}</strong>
            <span style="color:var(--text-light);font-size:12px;margin-left:6px;">${p.spec || ''} ${p.unit || ''}</span>
          </div>
          <span style="color:var(--primary);font-size:12px;flex-shrink:0;">${p.type || '未分类'}</span>
        </div>
        `).join('')}
      `;
    };

    input.addEventListener('input', doSearch);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    doSearch();
    setTimeout(() => input.focus(), 100);
  },

  // 搜索弹窗中点击产品：关闭搜索，打开行情图
  closeSearchAndShowChart(system, code, id) {
    closeModal();
    setTimeout(() => PriceChart.showLarge(system, code, id), 100);
  },

  // 折叠/展开类型分组
  toggleGroup(idx) {
    const body = document.getElementById('group-body-' + idx);
    const arrow = document.getElementById('group-arrow-' + idx);
    const collapsed = localStorage.getItem('pg-collapse-' + idx) === '1';
    const next = !collapsed;
    localStorage.setItem('pg-collapse-' + idx, next ? '1' : '0');
    if (body) body.style.display = next ? 'none' : '';
    if (arrow) arrow.textContent = next ? '▸' : '▾';
  },

  async deleteProduct(system, code, type, id) {
    if (!confirm(`确认删除编码为 "${code}" 的产品？`)) return;
    try {
      // 优先用 ID 删除（精确匹配，不误删其他规格）
      const url = id ? `/api/main/products/id/${encodeURIComponent(id)}` : (type ? `/api/main/products/${encodeURIComponent(code)}?type=${encodeURIComponent(type)}` : `/api/main/products/${encodeURIComponent(code)}`);
      await API.del(url);
      showToast('删除成功');
      await this.loadProducts(system);
    } catch (e) {
      showToast('删除失败: ' + e.message);
    }
  },

  async editProduct(system, code, id) {
    try {
      // 用 ID 查确切的产品（同编码不同规格也能准确找到）
      const all = await API.get('/api/main/products');
      const product = all.find(p => String(p.id) === String(id)) || all.find(p => p.code === code);
      if (!product) { showToast('产品不存在'); return; }
      const systemLabel = system === 'main' ? '主系统' : '抖音刷券';
      showModal(`编辑物品 - ${systemLabel}`);

      const body = document.getElementById('modal-body');
      body.innerHTML = `
        <form id="edit-product-form" class="form-grid" onsubmit="ProductsModule.submitEdit('${system}','${code}','${product.id}');return false;">
          <div class="form-group">
            <label>物品编码</label>
            <input type="text" id="edit-product-code" value="${product.code}" required placeholder="可修改，保存后自动同步出入库记录" />
            <div style="font-size:11px;color:var(--text-light);margin-top:2px;">修改后，该编码的所有出入库/价格记录会一起更新</div>
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
              ${['个','箱','件','套','kg','g','ml','L','米','包','瓶','盒','只','双','条','台'].map(u => 
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
            ${system === 'main' ? `<select id="edit-product-type"></select>` : `<div style="padding:8px 12px;background:#fff8e1;border:1px solid #fbbc04;border-radius:8px;font-size:13px;color:#fbbc04;font-weight:500;">🎫 抖音刷券</div>`}
          </div>
          ${product.type === '抖音刷券' ? `
          <div class="form-group">
            <label>套组数量</label>
            <input type="number" id="edit-bundle-qty" value="${product.bundle_qty || 1}" min="1" max="999" />
          </div>` : ''}
          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-lg">保存修改</button>
            <button type="button" class="btn btn-secondary btn-lg" onclick="closeModal()">取消</button>
          </div>
        </form>
      `;

      const select = document.getElementById('edit-product-type');
      if (select) {
        const options = await ConfigManager.getOptions(system, 'product_types');
        select.innerHTML = '<option value="">请选择类型</option>' + 
          options.map(o => `<option value="${o}" ${product.type === o ? 'selected' : ''}>${o}</option>`).join('');
      }
    } catch (e) {
      showToast('加载产品信息失败');
    }
  },

  async submitEdit(system, code, id = null) {
    const name = document.getElementById('edit-product-name').value.trim();
    const spec = document.getElementById('edit-product-spec').value.trim();
    const unit = document.getElementById('edit-product-unit').value;
    const marketPrice = document.getElementById('edit-product-market-price').value;
    const typeEl = document.getElementById('edit-product-type');
    const type = typeEl ? typeEl.value : (system === 'douyin' ? '抖音刷券' : '');
    const bundleQty = parseInt(document.getElementById('edit-bundle-qty')?.value) || undefined;
    // 编码（可修改，后端会级联同步历史记录）
    const codeInput = document.getElementById('edit-product-code');
    const newCode = codeInput ? codeInput.value.trim() : code;

    if (!name) { showToast('请填写物品名称'); return; }
    if (!newCode) { showToast('请填写物品编码'); return; }

    try {
      const body = { code: newCode, name, spec, unit, market_price: marketPrice, type };
      if (bundleQty) body.bundle_qty = bundleQty;
      // 有 ID 则用 ID 更新（精确匹配），否则用 code+type
      const url = id ? `/api/main/products/id/${encodeURIComponent(id)}` : `/api/main/products/${encodeURIComponent(code)}?type=${encodeURIComponent(type)}`;
      await API.put(url, body);
      showToast(newCode !== code ? `修改成功，已同步更新历史记录` : '修改成功');
      closeModal();
      await this.loadProducts(system);
    } catch (e) {
      showToast('修改失败: ' + (e.message || ''));
    }
  },

  // 设置价格
  async setPrice(system, code, name, id) {
    // 获取最近价格
    try {
      const url = id ? `/api/main/price-history/${code}/latest?product_id=${id}` : `/api/${system}/price-history/${code}/latest`;
      const latest = await API.get(url);
      const lastPrice = latest.price || 0;

      showModal(`输入实时行情价格 - ${name}`);
      const body = document.getElementById('modal-body');
      const now = new Date(); const pad = n => String(n).padStart(2,'0'); const today = now.getFullYear() + '-' + pad(now.getMonth()+1) + '-' + pad(now.getDate());
      
      body.innerHTML = `
        <div style="text-align:center;">
          <p style="color:var(--text-secondary);margin-bottom:16px;">今日日期: ${today}</p>
          <div class="form-group" style="max-width:300px;margin:0 auto;">
            <label>今日价格 (上次价格: ¥${lastPrice})</label>
            <input type="number" id="price-input" step="0.01" value="${lastPrice}" style="font-size:24px;padding:12px;text-align:center;" autofocus />
          </div>
          <div style="display:flex;gap:10px;justify-content:center;margin-top:16px;">
            <button class="btn btn-primary btn-lg" onclick="ProductsModule.submitPrice('${system}','${code}','${id}')">确认提交</button>
            <button class="btn btn-secondary btn-lg" onclick="closeModal()">取消</button>
          </div>
          <p style="color:var(--text-light);font-size:12px;margin-top:8px;">如不输入将使用上次价格 (¥${lastPrice})</p>
        </div>
      `;
    } catch (e) {
      showToast('获取价格失败');
    }
  },

  async submitPrice(system, code, id) {
    const priceInput = document.getElementById('price-input');
    const price = parseFloat(priceInput.value) || 0;
    try {
      // 用 main API + product_id 确保不同规格行情独立
      const body = { product_code: code, price };
      if (id) body.product_id = parseInt(id);
      // 本地日期（避免服务器 UTC 切片造成的日期偏移）
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      body.date = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
      await API.post('/api/main/price-history', body);
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
