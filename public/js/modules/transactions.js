// ===== 出入库登记模块（入库表 + 出库表 + 信息台账）=====
const TransactionsModule = {
  currentSystem: 'main',
  currentTab: 'inbound-form',
  inboundImages: [],
  outboundImages: [],

  // 预定义颜色选项
  ROW_COLORS: [
    { val: '', label: '无', bg: '#fff', border: '#ddd' },
    { val: '#ffebee', label: '红色', bg: '#ffebee', border: '#ef9a9a' },
    { val: '#fff3e0', label: '橙色', bg: '#fff3e0', border: '#ffcc80' },
    { val: '#fff9c4', label: '黄色', bg: '#fff9c4', border: '#fff176' },
    { val: '#e8f5e9', label: '绿色', bg: '#e8f5e9', border: '#a5d6a7' },
    { val: '#e3f2fd', label: '蓝色', bg: '#e3f2fd', border: '#90caf9' },
    { val: '#f3e5f5', label: '紫色', bg: '#f3e5f5', border: '#ce93d8' },
    { val: '#fce4ec', label: '粉色', bg: '#fce4ec', border: '#f48fb1' },
  ],

  // 生成行颜色标记HTML（整格填色，点击弹出选色器）
  _renderColorCell(rowId, type, currentColor) {
    const c = currentColor || '';
    const bg = c || '#f9fafb';
    const borderStyle = c ? '' : 'border:1px dashed #d1d5db;';
    return `
      <div style="position:relative;">
        <div onclick="TransactionsModule._toggleColorPicker('${rowId}','${type}',this)"
             style="background:${bg};cursor:pointer;padding:4px 2px;text-align:center;border-radius:4px;${borderStyle}min-height:20px;display:flex;align-items:center;justify-content:center;">
          ${!c ? '<span style="font-size:11px;color:#9ca3af;">点击标记</span>' : '<span style="font-size:10px;color:' + (c === '#fff9c4' ? '#666' : '#fff') + ';">●</span>'}
        </div>
        <div id="cp-${rowId}" style="display:none;position:absolute;z-index:100;top:30px;left:-10px;background:#fff;border:1px solid #e0e0e0;border-radius:10px;padding:8px;box-shadow:0 6px 20px rgba(0,0,0,0.2);white-space:nowrap;">
          <div style="font-size:11px;color:#666;margin-bottom:4px;text-align:center;">选择颜色</div>
          ${this.ROW_COLORS.map(clr => `
            <div onclick="TransactionsModule._setColor('${rowId}','${type}','${clr.val}')"
                 style="width:28px;height:28px;border-radius:50%;background:${clr.bg};border:2px solid ${clr.border};cursor:pointer;display:inline-block;margin:3px;vertical-align:middle;${clr.val === c ? 'transform:scale(1.25);box-shadow:0 0 0 2px #333;' : ''}"
                 title="${clr.label}"></div>
          `).join('')}
          <div style="margin-top:4px;text-align:center;font-size:10px;color:#999;">点击切换颜色</div>
        </div>
      </div>`;
  },

  // 切换颜色选择器
  _toggleColorPicker(rowId, type, el) {
    const picker = document.getElementById(`cp-${rowId}`);
    if (!picker) return;
    // 关闭其他打开的
    document.querySelectorAll('[id^="cp-"]').forEach(p => { if (p.id !== `cp-${rowId}`) p.style.display = 'none'; });
    picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
    // 点击外部关闭
    if (picker.style.display === 'block') {
      const closeHandler = (e) => {
        if (!picker.contains(e.target) && !el.contains(e.target)) {
          picker.style.display = 'none';
          document.removeEventListener('click', closeHandler);
        }
      };
      setTimeout(() => document.addEventListener('click', closeHandler), 10);
    }
  },

  // 设置颜色
  async _setColor(rowId, type, color) {
    try {
      await API.patch(`/api/${this.currentSystem}/${type}/${rowId}/color`, { color });
      // 刷新当前视图
      if (this.currentTab === 'inbound-form' || this.currentTab === 'inbound') {
        await this._refreshInboundTable(this.currentSystem);
      } else if (this.currentTab === 'outbound-form' || this.currentTab === 'outbound') {
        await this._refreshOutboundTable(this.currentSystem);
      } else if (this.currentTab === 'ledger') {
        await this.renderLedgerTab(this.currentSystem);
      }
    } catch (e) {
      showToast('设置颜色失败');
    }
  },

  async render(system) {
    this.currentSystem = system;
    const container = document.getElementById(`page-${system}-ledger`);
    const label = system === 'main' ? '主' : '抖音刷券';

    container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h3 style="font-size:18px;">出入库台账 - ${label}系统</h3>
        </div>
      </div>
      <!-- 三个标签页：入库表、出库表、信息台账 -->
      <div class="tabs">
        <div class="tab active" data-tab="inbound-form" onclick="TransactionsModule.switchTab('${system}','inbound-form',this)">入库登记单</div>
        <div class="tab" data-tab="outbound-form" onclick="TransactionsModule.switchTab('${system}','outbound-form',this)">出库信息单</div>
        <div class="tab" data-tab="ledger" onclick="TransactionsModule.switchTab('${system}','ledger',this)">信息台账</div>
      </div>
      <div id="transactions-content-${system}"></div>
    `;

    await this.renderInboundTab(system);
  },

  switchTab(system, tab, el) {
    this.currentTab = tab;
    document.querySelectorAll(`#page-${system}-ledger .tab`).forEach(t => t.classList.remove('active'));
    el.classList.add('active');

    if (tab === 'inbound-form') this.renderInboundTab(system);
    else if (tab === 'outbound-form') this.renderOutboundTab(system);
    else if (tab === 'ledger') this.renderLedgerTab(system);
  },

  // ================================================================
  //  标签页1：入库登记单（表单 + 入库记录表）
  // ================================================================
  async renderInboundTab(system) {
    this.inboundImages = [];
    const container = document.getElementById(`transactions-content-${system}`);

    container.innerHTML = `
      <div class="card" style="border:2px solid #e6f4ea;">
        <div class="card-header" style="background:#e6f4ea;">
          <h3 style="color:var(--success);">入库登记单</h3>
        </div>
        <div class="card-body">
          <form id="inbound-form" class="form-grid" onsubmit="TransactionsModule.submitInbound('${system}');return false;">
            <div class="form-group">
              <label>物品编码 <span style="color:var(--danger)">*</span></label>
              <div class="input-with-btn">
                <input type="text" id="inbound-code" placeholder="手动输入或扫描条码" required list="product-codes-${system}" />
                <button type="button" class="btn btn-sm btn-secondary" onclick="triggerBarcodeScan('inbound-code')">扫码</button>
              </div>
            </div>
            <div class="form-group">
              <label>登记数量 <span style="color:var(--danger)">*</span></label>
              <input type="number" id="inbound-qty" placeholder="入库数量" required step="0.01" min="0.01" />
            </div>
            <div class="form-group">
              <label>下单设备/下级</label>
              <input type="text" id="inbound-device" placeholder="设备名称或下级单位" />
            </div>
            <div class="form-group">
              <label>渠道</label>
              <div style="display:flex;gap:8px;">
                <select id="inbound-channel" style="flex:1;"></select>
                <button type="button" class="btn btn-sm btn-secondary" onclick="TransactionsModule.manageChannels('${system}')">管理</button>
              </div>
            </div>
            <div class="form-group">
              <label>订单号/快递单号</label>
              <div class="input-with-btn">
                <input type="text" id="inbound-order" placeholder="订单号或快递单号" />
                <button type="button" class="btn btn-sm btn-secondary" onclick="triggerBarcodeScan('inbound-order')">扫码</button>
              </div>
            </div>
            <div class="form-group">
              <label>购买价格</label>
              <input type="number" id="inbound-price" placeholder="0.00" step="0.01" min="0" />
            </div>
            <div class="form-group">
              <label>备注</label>
              <textarea id="inbound-remark" placeholder="其他备注信息" rows="2"></textarea>
            </div>
            <div class="form-group">
              <label>入库图片</label>
              <div id="inbound-image-preview" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;"></div>
              <button type="button" class="btn btn-sm btn-secondary" onclick="TransactionsModule.captureInboundImage('${system}')">拍照上传</button>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-success btn-lg">提交入库</button>
              <button type="reset" class="btn btn-secondary btn-lg" onclick="TransactionsModule.resetInboundForm()">清空</button>
            </div>
          </form>
        </div>
      </div>
      <!-- 入库记录表 -->
      <div class="card" style="margin-top:16px;">
        <div class="card-header">
          <h3>入库记录表</h3>
          <span style="font-size:12px;color:var(--text-light);" id="inbound-count-label">加载中...</span>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>标记</th>
                  <th>登记日期时间</th>
                  <th>物品编码</th>
                  <th>物品名称</th>
                  <th>规格</th>
                  <th>登记数量</th>
                  <th>渠道</th>
                  <th>价格</th>
                  <th>图片</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody id="inbound-table-body">
                <tr><td colspan="8" style="text-align:center;color:var(--text-light);padding:20px;">加载中...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    await this._loadChannelOptions(system);
    await this._loadProductSuggestions(system);
    await this._refreshInboundTable(system);
  },

  async _refreshInboundTable(system) {
    const tbody = document.getElementById('inbound-table-body');
    const label = document.getElementById('inbound-count-label');
    if (!tbody) return;
    try {
      const records = await API.get(`/api/${system}/inbound`);
      const products = await API.get(`/api/${system}/products`);
      if (label) label.textContent = `共 ${records.length} 条记录`;

      if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text-light);padding:20px;">暂无入库记录</td></tr>';
        return;
      }

      tbody.innerHTML = records.map(r => {
        const p = products.find(x => x.code === r.product_code);
        const bgColor = r.row_color || '';
        return `<tr class="${bgColor ? 'row-color' : ''}" ${bgColor ? "style='--row-bg:" + bgColor + ";--row-bg-hover:" + bgColor + "'" : ''}>
          <td>${this._renderColorCell(r.id, 'inbound', r.row_color)}</td>
          <td style="white-space:nowrap;font-size:12px;">${r.created_at}</td>
          <td><code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:11px;">${r.product_code}</code></td>
          <td>${p ? p.name : '-'}</td>
          <td>${p ? (p.spec || '-') : '-'}</td>
          <td><strong style="color:var(--success);">+${r.quantity}</strong></td>
          <td><span class="badge badge-inbound">${r.channel || '-'}</span></td>
          <td>${r.purchase_price ? '¥' + r.purchase_price : '-'}</td>
          <td>${r.image_path ? `<div class="image-preview" onclick="showImagePreview('${r.image_path}')"><img src="${r.image_path}" /></div>` : '-'}</td>
          <td><button class="btn btn-sm btn-danger" onclick="TransactionsModule.deleteInbound('${system}',${r.id})">删除</button></td>
        </tr>`;
      }).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--danger);padding:20px;">加载失败: ${e.message}</td></tr>`;
    }
  },

  async submitInbound(system) {
    const code = document.getElementById('inbound-code').value.trim();
    const quantity = parseFloat(document.getElementById('inbound-qty').value);
    const device = document.getElementById('inbound-device').value.trim();
    const channel = document.getElementById('inbound-channel').value;
    const orderNo = document.getElementById('inbound-order').value.trim();
    const price = parseFloat(document.getElementById('inbound-price').value) || 0;
    const remark = document.getElementById('inbound-remark').value.trim();
    const imagePath = this.inboundImages.length > 0 ? this.inboundImages[0] : '';

    if (!code || !quantity) { showToast('请填写编码和数量'); return; }

    try {
      await API.post(`/api/${system}/inbound`, {
        product_code: code, quantity, device, channel, remark,
        order_no: orderNo, image_path: imagePath, purchase_price: price
      });
      showToast('入库登记成功！');
      this.inboundImages = [];
      document.getElementById('inbound-form').reset();
      document.getElementById('inbound-image-preview').innerHTML = '';
      await this._refreshInboundTable(system);
      // 如果当前在台账tab，也刷新
      if (this.currentTab === 'ledger') await this.renderLedgerTab(system);
    } catch (e) {
      showToast('入库登记失败: ' + e.message);
    }
  },

  resetInboundForm() {
    document.getElementById('inbound-form').reset();
    this.inboundImages = [];
    const preview = document.getElementById('inbound-image-preview');
    if (preview) preview.innerHTML = '';
  },

  captureInboundImage(system) {
    CameraCapture.openCamera((path) => {
      this.inboundImages.push(path);
      const preview = document.getElementById('inbound-image-preview');
      if (preview) {
        const div = document.createElement('div');
        div.className = 'image-preview';
        div.innerHTML = `<img src="${path}" onclick="showImagePreview('${path}')" />`;
        preview.appendChild(div);
      }
    });
  },

  async deleteInbound(system, id) {
    if (!confirm('确认删除该入库记录？')) return;
    try {
      await API.del(`/api/${system}/inbound/${id}`);
      showToast('删除成功');
      await this._refreshInboundTable(system);
    } catch (e) {
      showToast('删除失败');
    }
  },

  // ================================================================
  //  标签页2：出库信息单（表单 + 出库记录表）
  // ================================================================
  async renderOutboundTab(system) {
    this.outboundImages = [];
    const container = document.getElementById(`transactions-content-${system}`);

    container.innerHTML = `
      <div class="card" style="border:2px solid #fce8e6;">
        <div class="card-header" style="background:#fce8e6;">
          <h3 style="color:var(--danger);">出库信息单</h3>
        </div>
        <div class="card-body">
          <form id="outbound-form" class="form-grid" onsubmit="TransactionsModule.submitOutbound('${system}');return false;">
            <div class="form-group">
              <label>物品编码 <span style="color:var(--danger)">*</span></label>
              <div class="input-with-btn">
                <input type="text" id="outbound-code" placeholder="手动输入或扫描条码" required list="product-codes-${system}" />
                <button type="button" class="btn btn-sm btn-secondary" onclick="triggerBarcodeScan('outbound-code')">扫码</button>
              </div>
            </div>
            <div class="form-group">
              <label>登记数量 <span style="color:var(--danger)">*</span></label>
              <input type="number" id="outbound-qty" placeholder="出库数量" required step="0.01" min="0.01" />
            </div>
            <div class="form-group">
              <label>地点</label>
              <input type="text" id="outbound-location" placeholder="发货地点" />
            </div>
            <div class="form-group">
              <label>发货图片</label>
              <div id="outbound-image-preview" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;"></div>
              <button type="button" class="btn btn-sm btn-secondary" onclick="TransactionsModule.captureOutboundImage('${system}')">拍照上传</button>
            </div>
            <div class="form-actions">
              <button type="submit" class="btn btn-warning btn-lg">提交出库</button>
              <button type="reset" class="btn btn-secondary btn-lg" onclick="TransactionsModule.resetOutboundForm()">清空</button>
            </div>
          </form>
        </div>
      </div>
      <!-- 出库记录表 -->
      <div class="card" style="margin-top:16px;">
        <div class="card-header">
          <h3>出库记录表</h3>
          <span style="font-size:12px;color:var(--text-light);" id="outbound-count-label">加载中...</span>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>标记</th>
                  <th>登记日期时间</th>
                  <th>物品编码</th>
                  <th>物品名称</th>
                  <th>规格</th>
                  <th>登记数量</th>
                  <th>地点</th>
                  <th>图片</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody id="outbound-table-body">
                <tr><td colspan="8" style="text-align:center;color:var(--text-light);padding:20px;">加载中...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    await this._loadProductSuggestions(system);
    await this._refreshOutboundTable(system);
  },

  async _refreshOutboundTable(system) {
    const tbody = document.getElementById('outbound-table-body');
    const label = document.getElementById('outbound-count-label');
    if (!tbody) return;
    try {
      const records = await API.get(`/api/${system}/outbound`);
      const products = await API.get(`/api/${system}/products`);
      if (label) label.textContent = `共 ${records.length} 条记录`;

      if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-light);padding:20px;">暂无出库记录</td></tr>';
        return;
      }

      tbody.innerHTML = records.map(r => {
        const p = products.find(x => x.code === r.product_code);
        const bgColor = r.row_color || '';
        return `<tr class="${bgColor ? 'row-color' : ''}" ${bgColor ? "style='--row-bg:" + bgColor + ";--row-bg-hover:" + bgColor + "'" : ''}>
          <td>${this._renderColorCell(r.id, 'outbound', r.row_color)}</td>
          <td style="white-space:nowrap;font-size:12px;">${r.created_at}</td>
          <td><code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:11px;">${r.product_code}</code></td>
          <td>${p ? p.name : '-'}</td>
          <td>${p ? (p.spec || '-') : '-'}</td>
          <td><strong style="color:var(--danger);">-${r.quantity}</strong></td>
          <td>${r.location || '-'}</td>
          <td>${r.image_path ? `<div class="image-preview" onclick="showImagePreview('${r.image_path}')"><img src="${r.image_path}" /></div>` : '-'}</td>
          <td><button class="btn btn-sm btn-danger" onclick="TransactionsModule.deleteOutbound('${system}',${r.id})">删除</button></td>
        </tr>`;
      }).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--danger);padding:20px;">加载失败: ${e.message}</td></tr>`;
    }
  },

  async submitOutbound(system) {
    const code = document.getElementById('outbound-code').value.trim();
    const quantity = parseFloat(document.getElementById('outbound-qty').value);
    const location = document.getElementById('outbound-location').value.trim();
    const imagePath = this.outboundImages.length > 0 ? this.outboundImages[0] : '';

    if (!code || !quantity) { showToast('请填写编码和数量'); return; }

    try {
      await API.post(`/api/${system}/outbound`, {
        product_code: code, quantity, image_path: imagePath, location
      });
      showToast('出库登记成功！');
      this.outboundImages = [];
      document.getElementById('outbound-form').reset();
      document.getElementById('outbound-image-preview').innerHTML = '';
      await this._refreshOutboundTable(system);
      if (this.currentTab === 'ledger') await this.renderLedgerTab(system);
    } catch (e) {
      showToast('出库登记失败: ' + e.message);
    }
  },

  resetOutboundForm() {
    document.getElementById('outbound-form').reset();
    this.outboundImages = [];
    const preview = document.getElementById('outbound-image-preview');
    if (preview) preview.innerHTML = '';
  },

  captureOutboundImage(system) {
    CameraCapture.openCamera((path) => {
      this.outboundImages.push(path);
      const preview = document.getElementById('outbound-image-preview');
      if (preview) {
        const div = document.createElement('div');
        div.className = 'image-preview';
        div.innerHTML = `<img src="${path}" onclick="showImagePreview('${path}')" />`;
        preview.appendChild(div);
      }
    });
  },

  async deleteOutbound(system, id) {
    if (!confirm('确认删除该出库记录？')) return;
    try {
      await API.del(`/api/${system}/outbound/${id}`);
      showToast('删除成功');
      await this._refreshOutboundTable(system);
    } catch (e) {
      showToast('删除失败');
    }
  },

  // ================================================================
  //  标签页3：信息台账（按订单号分组展示入库/出库）
  // ================================================================
  async renderLedgerTab(system) {
    const container = document.getElementById(`transactions-content-${system}`);
    container.innerHTML = '<div class="card"><div class="card-body" style="text-align:center;padding:30px;">加载台账数据...</div></div>';

    try {
      // 如果已有缓存数据且系统未变，直接用缓存
      let inbound, outbound;
      if (this._ledgerData && this._ledgerSystem === system) {
        inbound = this._ledgerData.inbound;
        outbound = this._ledgerData.outbound;
      } else {
        const data = await API.get(`/api/${system}/ledger`);
        inbound = data.inbound;
        outbound = data.outbound;
        // 类型分离：主系统只留屈臣氏，抖音刷券只留抖音刷券
        if (system === 'main') {
          inbound = inbound.filter(r => r.product_type !== '抖音刷券');
          outbound = outbound.filter(r => r.product_type !== '抖音刷券');
        } else {
          inbound = inbound.filter(r => r.product_type === '抖音刷券' || !r.product_type);
          outbound = outbound.filter(r => r.product_type === '抖音刷券' || !r.product_type);
        }
        this._ledgerData = { inbound, outbound };
        this._ledgerSystem = system;
      }

      if (inbound.length === 0 && outbound.length === 0) {
        container.innerHTML = `
          <div class="card"><div class="card-body">
            <div class="empty-state"><div class="empty-icon">📋</div><p>暂无出入库记录</p></div>
          </div></div>
        `;
        return;
      }

      let html = '';

      // 全局筛选表单
      html += `
        <div class="card" style="margin-bottom:12px;">
          <div class="card-body" style="padding:10px 16px;">
            <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:end;">
              <div style="flex:1;min-width:120px;">
                <label style="font-size:11px;color:var(--text-light);display:block;margin-bottom:2px;">订单号</label>
                <input type="text" id="ledger-filter-order" placeholder="订单号/快递单号" oninput="TransactionsModule._applyLedgerFilter()"
                       style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;" />
              </div>
              <div style="flex:1;min-width:120px;">
                <label style="font-size:11px;color:var(--text-light);display:block;margin-bottom:2px;">物品编码/名称</label>
                <input type="text" id="ledger-filter-keyword" placeholder="编码或名称" oninput="TransactionsModule._applyLedgerFilter()"
                       style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px;" />
              </div>
              <div style="min-width:80px;">
                <button class="btn btn-sm btn-secondary" onclick="TransactionsModule._clearLedgerFilter()" style="width:100%;">清空</button>
              </div>
            </div>
          </div>
        </div>
      `;

      // 使用缓存数据（renderLedgerTab中已设置）

      // ====== 入库台账（按订单号分组）======
      const filteredIn = this._filterLedgerInbound(inbound);
      if (filteredIn.length > 0) {
        const groups = this._groupByOrderNo(filteredIn);
        html += `
          <div class="card">
            <div class="card-header">
              <h3 style="color:var(--success);">入库台账</h3>
              <span style="font-size:12px;color:var(--text-light);">${filteredIn.length === inbound.length ? `共 ${inbound.length} 条记录，${groups.length} 单` : `筛选出 ${filteredIn.length}/${inbound.length} 条，${groups.length} 单`}</span>
            </div>
            <div class="card-body" style="padding:0;">
        `;
        for (const group of groups) {
          html += this._renderOrderGroup(group, 'inbound');
        }
        html += `</div></div>`;
      } else if (inbound.length > 0) {
        html += `
          <div class="card">
            <div class="card-header"><h3 style="color:var(--success);">入库台账</h3></div>
            <div class="card-body" style="padding:20px;text-align:center;color:var(--text-light);">无匹配的入库记录</div>
          </div>
        `;
      }

      // ====== 出库台账（平铺列表）======
      const filteredOut = this._filterLedgerOutbound(outbound);
      if (filteredOut.length > 0) {
        html += `
          <div class="card">
            <div class="card-header">
              <h3 style="color:var(--danger);">出库台账</h3>
              <span style="font-size:12px;color:var(--text-light);">${filteredOut.length === outbound.length ? `共 ${outbound.length} 条记录` : `筛选出 ${filteredOut.length}/${outbound.length} 条`}</span>
            </div>
            <div class="card-body" style="padding:0;">
              <div class="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>标记</th>
                      <th>登记日期时间</th>
                      <th>物品编码</th>
                      <th>物品名称</th>
                      <th>规格</th>
                      <th>套组倍数</th>
                      <th>登记数量</th>
                      <th>地点</th>
                      <th>售价</th>
                      <th>成本</th>
                      <th>利润</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${filteredOut.map(r => {
                      const profit = parseFloat(r.profit) || 0;
                      const profitClass = profit > 0 ? 'var(--success)' : profit < 0 ? 'var(--danger)' : 'var(--text-light)';
                      const bgColor = r.row_color || '';
                      const sys = TransactionsModule.currentSystem;
                      const bq = parseInt(r.bundle_qty) || 1;
                      const showBq = r.product_type === '抖音刷券' || !r.product_type;
                      return `<tr class="${bgColor ? 'row-color' : ''}" ${bgColor ? "style='--row-bg:" + bgColor + ";--row-bg-hover:" + bgColor + "'" : ''}>
                      <td>${TransactionsModule._renderColorCell(r.id, 'outbound', r.row_color)}</td>
                      <td style="white-space:nowrap;font-size:12px;">${r.created_at}</td>
                      <td><code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:11px;">${r.product_code}</code></td>
                      <td>${r.product_name || '-'}</td>
                      <td>${r.product_spec || '-'}</td>
                      <td style="text-align:center;">${showBq && bq > 1 ? '<span style="color:#fbbc04;font-weight:500;">×' + bq + '</span>' : '<span style="color:#bbb;">-</span>'}</td>
                      <td><strong style="color:var(--danger);">-${r.quantity}</strong></td>
                      <td>${r.location || '-'}</td>
                      <td>${r.sale_price ? '¥' + r.sale_price : '-'}</td>
                      <td>${r.cost_price ? '¥' + r.cost_price : '-'}</td>
                      <td><strong style="color:${profitClass};">${profit >= 0 ? '+' : ''}¥${profit.toFixed(2)}</strong></td>
                      <td><button class="btn btn-sm btn-danger" onclick="TransactionsModule._deleteLedgerRecord('${sys}','outbound',${r.id})">删除</button></td>
                    </tr>`;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;
      } else if (outbound.length > 0) {
        html += `
          <div class="card">
            <div class="card-header"><h3 style="color:var(--danger);">出库台账</h3></div>
            <div class="card-body" style="padding:20px;text-align:center;color:var(--text-light);">无匹配的出库记录</div>
          </div>
        `;
      }

      container.innerHTML = html;
    } catch (e) {
      container.innerHTML = `<div class="card"><div class="card-body"><p style="color:var(--danger);">加载失败: ${e.message}</p></div></div>`;
    }
  },

  // ===== 台账筛选 =====
  _getFilterValue(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim().toLowerCase() : '';
  },

  _filterLedgerInbound(records) {
    const orderFilter = this._getFilterValue('ledger-filter-order');
    const keywordFilter = this._getFilterValue('ledger-filter-keyword');
    if (!orderFilter && !keywordFilter) return records;
    return records.filter(r => {
      if (orderFilter && (!r.order_no || !r.order_no.toLowerCase().includes(orderFilter))) return false;
      if (keywordFilter) {
        const kw = keywordFilter;
        const code = (r.product_code || '').toLowerCase();
        const name = (r.product_name || '').toLowerCase();
        if (!code.includes(kw) && !name.includes(kw)) return false;
      }
      return true;
    });
  },

  _filterLedgerOutbound(records) {
    const keywordFilter = this._getFilterValue('ledger-filter-keyword');
    if (!keywordFilter) return records;
    const kw = keywordFilter;
    return records.filter(r => {
      const code = (r.product_code || '').toLowerCase();
      const name = (r.product_name || '').toLowerCase();
      return code.includes(kw) || name.includes(kw);
    });
  },

  _applyLedgerFilter() {
    if (this._ledgerData) {
      this.renderLedgerTab(this.currentSystem);
    }
  },

  _clearLedgerFilter() {
    ['ledger-filter-order', 'ledger-filter-keyword'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    if (this._ledgerData) {
      this.renderLedgerTab(this.currentSystem);
    }
  },

  // 台账中删除记录
  async _deleteLedgerRecord(system, type, id) {
    if (!confirm(`确认删除该${type === 'inbound' ? '入库' : '出库'}记录？`)) return;
    try {
      await API.del(`/api/${system}/${type}/${id}`);
      showToast('删除成功');
      // 清除缓存，重新加载
      this._ledgerData = null;
      await this.renderLedgerTab(system);
    } catch (e) {
      showToast('删除失败: ' + e.message);
    }
  },

  // 按订单号分组
  _groupByOrderNo(records) {
    const map = {};
    for (const r of records) {
      const key = r.order_no || '__no_order__';
      if (!map[key]) map[key] = { orderNo: r.order_no || '', items: [] };
      map[key].items.push(r);
    }
    // 按时间排序组（取组内最早时间）
    const groups = Object.values(map);
    groups.sort((a, b) => {
      const tA = a.items[0].created_at || '';
      const tB = b.items[0].created_at || '';
      return tB.localeCompare(tA); // 最新的在前面
    });
    // 把无订单号的放到最后
    const noOrder = groups.filter(g => !g.orderNo);
    const hasOrder = groups.filter(g => g.orderNo);
    return [...hasOrder, ...noOrder];
  },

  // 渲染一个订单分组
  _renderOrderGroup(group, type) {
    const isInbound = type === 'inbound';
    const isNoOrder = !group.orderNo;

    // 统计该单总数量和总金额
    const totalQty = group.items.reduce((s, r) => s + r.quantity, 0);
    const totalPrice = isInbound ? group.items.reduce((s, r) => s + (parseFloat(r.purchase_price) || 0), 0) : 0;

    let html = `
      <div class="product-group">
        <div class="product-group-title" style="display:flex;align-items:center;gap:8px;padding:10px 16px;background:${isInbound ? '#f0fdf4' : '#fef2f2'};border-bottom:1px solid ${isInbound ? '#bbf7d0' : '#fecaca'};">
          <span style="font-size:14px;font-weight:600;">
            ${isNoOrder ? '📦 未填写订单号' : '📦 订单号: ' + group.orderNo}
          </span>
          <span style="font-size:12px;color:var(--text-light);">${group.items.length} 项商品</span>
          <span style="font-size:12px;color:var(--text-light);">总数量: <strong>${totalQty}</strong></span>
          ${isInbound && totalPrice > 0 ? `<span style="font-size:12px;color:var(--text-light);">总金额: <strong>¥${totalPrice.toFixed(2)}</strong></span>` : ''}
          <span style="font-size:11px;color:var(--text-light);margin-left:auto;">
            ${new Date(group.items[0].created_at).toLocaleDateString('zh-CN')}
          </span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>标记</th>
                <th>登记日期时间</th>
                <th>物品编码</th>
                <th>物品名称</th>
                <th>规格</th>
                <th>套组倍数</th>
                <th>登记数量</th>
                ${isInbound ? '<th>渠道</th><th>价格</th>' : '<th>地点</th>'}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
    `;

    for (const r of group.items) {
      const bgColor = r.row_color || '';
      const sys = TransactionsModule.currentSystem;
      const bq = parseInt(r.bundle_qty) || 1;
      const showBq = r.product_type === '抖音刷券' || !r.product_type;
      html += `<tr class="${bgColor ? 'row-color' : ''}" ${bgColor ? "style='--row-bg:" + bgColor + ";--row-bg-hover:" + bgColor + "'" : ''}>
        <td>${this._renderColorCell(r.id, isInbound ? 'inbound' : 'outbound', r.row_color)}</td>
        <td style="white-space:nowrap;font-size:12px;">${r.created_at}</td>
        <td><code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:11px;">${r.product_code}</code></td>
        <td>${r.product_name || '-'}</td>
        <td>${r.product_spec || '-'}</td>
        <td style="text-align:center;">${showBq && bq > 1 ? '<span style="color:#fbbc04;font-weight:500;">×' + bq + '</span>' : '<span style="color:#bbb;">-</span>'}</td>
        <td><strong style="color:${isInbound ? 'var(--success)' : 'var(--danger)'};">${isInbound ? '+' : '-'}${r.quantity}</strong></td>
        ${isInbound ? `<td>${r.channel || '-'}</td><td>${r.purchase_price ? '¥' + r.purchase_price : '-'}</td>` : `<td>${r.location || '-'}</td>`}
        <td><button class="btn btn-sm btn-danger" onclick="TransactionsModule._deleteLedgerRecord('${sys}','${isInbound ? 'inbound' : 'outbound'}',${r.id})">删除</button></td>
      </tr>`;
    }

    html += `</tbody></table></div>`;
    
    // 如果是最后一个组不加分隔线
    return html + '</div>';
  },

  // ================================================================
  //  通用辅助方法
  // ================================================================
  async _loadChannelOptions(system) {
    const select = document.getElementById('inbound-channel');
    if (!select) return;
    const options = await ConfigManager.getOptions(system, 'channel_options');
    select.innerHTML = '<option value="">请选择渠道</option>' +
      options.map(o => `<option value="${o}">${o}</option>`).join('') +
      '<option value="其他">其他</option>';
  },

  async _loadProductSuggestions(system) {
    try {
      const products = await API.get(`/api/${system}/products`);
      let list = document.getElementById(`product-codes-${system}`);
      if (!list) {
        list = document.createElement('datalist');
        list.id = `product-codes-${system}`;
        document.body.appendChild(list);
      }
      list.innerHTML = products.map(p => `<option value="${p.code}">${p.code} - ${p.name}</option>`).join('');
    } catch (e) { /* ignore */ }
  },

  async manageChannels(system) {
    await ConfigManager.getOptions(system, 'channel_options');
    showModal('管理渠道选项');
    const body = document.getElementById('modal-body');
    body.innerHTML = ConfigManager.renderOptionEditor(system, 'channel_options', '渠道管理', '输入新渠道名称');
  }
};
