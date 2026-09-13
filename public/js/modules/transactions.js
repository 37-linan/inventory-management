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

  // 数量显示：整数不带小数（1.00 → 1），真小数保留（1.50 → 1.5）
  _fmtQty(n) {
    const v = parseFloat(n);
    if (isNaN(v)) return n || '';
    return String(v);
  },

  // 日期格式化：ISO 时间 → YYYY-MM-DD HH:mm:ss（本地时区）
  _fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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
              <label>订单号/快递单号 <span style="color:var(--danger)">*</span> <span style="color:var(--text-light);font-size:11px;">(一单多品时后续自动沿用)</span></label>
              <div class="input-with-btn">
                <input type="text" id="inbound-order" placeholder="订单号或快递单号" required />
                <button type="button" class="btn btn-sm btn-secondary" onclick="triggerBarcodeScan('inbound-order')">扫码</button>
              </div>
            </div>
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
              <label>整单金额 <span style="color:var(--text-light);font-size:11px;">(仅本单首个商品填写整单总金额)</span></label>
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
        <div style="padding:8px 12px 0;font-size:12px;color:var(--text-secondary);">💡 登记数量、渠道、价格可以直接点击修改，改完自动重算库存与金额</div>
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

      // 按订单号分组
      const groups = {};
      records.forEach(r => {
        const key = r.order_no || '（无单号）';
        if (!groups[key]) groups[key] = [];
        groups[key].push(r);
      });
      // 组内按时间倒序：最新入库的在上，先入库的在下
      Object.values(groups).forEach(items => {
        items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      });
      // 缓存统计用
      this._groupStatsCache = {};
      // 缓存每条记录原始值，供行内编辑取用（避免把值拼进 onclick 里，渠道名带引号会出错）
      this._inboundRowCache = {};
      records.forEach(r => { this._inboundRowCache[r.id] = r; });
      // 组按最新时间倒序（最新单号在上）
      const sortedKeys = Object.keys(groups).sort((a, b) => {
        const ta = new Date(groups[a][0].created_at).getTime();
        const tb = new Date(groups[b][0].created_at).getTime();
        return tb - ta;
      });
      const groupCount = sortedKeys.length;
      if (label) label.textContent = `共 ${records.length} 条记录 / ${groupCount} 个单号`;

      if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--text-light);padding:20px;">暂无入库记录</td></tr>';
        return;
      }

      let html = '';
      sortedKeys.forEach((orderNo, gi) => {
        const items = groups[orderNo];
        const totalQty = items.reduce((s, r) => s + parseFloat(r.quantity || 0), 0);
        // 整单总金额 = 本单第一个商品填的金额（用户约定：整单金额填在第一个商品上，不乘数量）
        const firstItem = [...items].sort((a, b) => a.id - b.id)[0];
        const orderTotal = parseFloat(firstItem.purchase_price || 0);
        const firstTime = items[0].created_at;
        // 组头颜色：仅当本单所有商品标了同一种颜色才整单着色；单个商品标记只影响自己那行
        const allSameColor = items.every(r => r.row_color && r.row_color === items[0].row_color);
        const groupColor = allSameColor ? (items[0].row_color || '') : '';
        const groupId = `inb-grp-${gi}`;
        const cacheKey = `g${gi}`;
        this._groupStatsCache[cacheKey] = items;

        // 组头行：跨整行，显示订单号 + 汇总信息
        html += `<tr class="group-header" style="cursor:pointer;background:${groupColor || '#eef2f7'};font-weight:600;" onclick="TransactionsModule._toggleGroupRows('${groupId}','${cacheKey}')">
          <td colspan="10" style="padding:8px 12px;border-top:2px solid ${groupColor || 'transparent'};">
            <span style="display:inline-block;width:14px;text-align:center;" id="${groupId}-icon">▾</span>
            <span style="color:var(--primary);">📦 ${orderNo}</span>
            <span style="color:var(--text-secondary);margin-left:12px;font-size:12px;font-weight:normal;">${firstTime}</span>
            <span style="color:var(--text-secondary);margin-left:12px;font-size:12px;font-weight:normal;">商品 ${items.length} 种 · 总数量 ${this._fmtQty(totalQty)}</span>
            ${orderTotal > 0 ? `<span style="color:var(--success);margin-left:12px;font-size:12px;font-weight:normal;">整单金额 ¥${orderTotal.toFixed(2)}</span>` : ''}
            <button class="btn btn-sm btn-secondary" style="float:right;margin-left:6px;" onclick="event.stopPropagation();TransactionsModule._showGroupStats('${cacheKey}','${orderNo.replace(/'/g, "\\'")}')">📊 统计</button>
            <button class="btn btn-sm btn-danger" style="float:right;" onclick="event.stopPropagation();TransactionsModule._deleteGroup('${cacheKey}','${orderNo.replace(/'/g, "\\'")}')">删除整单</button>
          </td>
        </tr>`;

        // 明细行（每行用自己的标记颜色）
        items.forEach(r => {
          const p = products.find(x => x.code === r.product_code);
          const rowColor = r.row_color || '';
          html += `<tr class="${groupId}-rows ${rowColor ? 'row-color' : ''}" ${rowColor ? "style='--row-bg:" + rowColor + ";--row-bg-hover:" + rowColor + "'" : ''}>
            <td>${this._renderColorCell(r.id, 'inbound', r.row_color)}</td>
            <td style="white-space:nowrap;font-size:12px;">${this._fmtDateTime(r.created_at)}</td>
            <td><code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:11px;">${r.product_code}</code></td>
            <td>${p ? p.name : '-'}</td>
            <td>${p ? (p.spec || '-') : '-'}</td>
            <td style="cursor:pointer;" onclick="TransactionsModule._editInboundCell('${system}','quantity',${r.id},this)" title="点击修改数量"><strong style="color:var(--success);">+${this._fmtQty(r.quantity)}</strong></td>
            <td style="cursor:pointer;" onclick="TransactionsModule._editInboundCell('${system}','channel',${r.id},this)" title="点击修改渠道"><span class="badge badge-inbound">${r.channel || '-'}</span></td>
            <td style="cursor:pointer;" onclick="TransactionsModule._editInboundCell('${system}','purchase_price',${r.id},this)" title="点击修改价格">${r.purchase_price ? '¥' + r.purchase_price : '-'}</td>
            <td>${r.image_path ? `<a href="javascript:void(0)" onclick="showImagePreview('${r.image_path}')" style="color:var(--primary);font-size:12px;text-decoration:none;white-space:nowrap;">📷 图片查看</a>` : '-'}</td>
            <td><button class="btn btn-sm btn-danger" onclick="TransactionsModule.deleteInbound('${system}',${r.id})">删除</button></td>
          </tr>`;
        });
      });

      tbody.innerHTML = html;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--danger);padding:20px;">加载失败: ${e.message}</td></tr>`;
    }
  },

  // 折叠/展开单号组
  _toggleGroupRows(groupId, cacheKey) {
    const icon = document.getElementById(groupId + '-icon');
    const rows = document.querySelectorAll('.' + groupId + '-rows');
    const collapsed = icon.textContent.trim() === '▸';
    rows.forEach(r => r.style.display = collapsed ? '' : 'none');
    icon.textContent = collapsed ? '▾' : '▸';
  },

  // ===== 行内编辑：点一下「数量 / 渠道 / 价格」就地改，不用删了重填 =====
  async _editInboundCell(system, field, id, el) {
    if (el.dataset.editing === '1') return;
    const rec = (this._inboundRowCache || {})[id];
    if (!rec) { showToast('数据已刷新，请重新点击'); return; }

    el.dataset.editing = '1';
    const originalHTML = el.innerHTML;
    let done = false;
    let cancelled = false;

    const restore = () => {
      el.innerHTML = originalHTML;
      delete el.dataset.editing;
    };

    const commit = async (rawVal) => {
      if (done) return;
      done = true;
      if (cancelled) return restore();

      const body = {};
      if (field === 'quantity') {
        const q = parseFloat(rawVal);
        if (!q || q <= 0) { showToast('数量必须大于 0'); return restore(); }
        if (q === parseFloat(rec.quantity)) return restore();
        body.quantity = q;
      } else if (field === 'purchase_price') {
        if (String(rawVal).trim() === '') return restore();
        const p = parseFloat(rawVal);
        if (isNaN(p) || p < 0) { showToast('价格不能为负数'); return restore(); }
        if (p === parseFloat(rec.purchase_price || 0)) return restore();
        body.purchase_price = p;
      } else if (field === 'channel') {
        const ch = String(rawVal).trim();
        if (ch === (rec.channel || '')) return restore();
        body.channel = ch;
      } else {
        return restore();
      }

      el.innerHTML = '<span style="color:var(--text-secondary);font-size:12px;">保存中...</span>';
      try {
        await API.patch(`/api/${system}/inbound/${id}`, body);
        showToast('已修改');
        // 重量刷新：库存、整单总数量、整单金额、单利润都会跟着重算
        await this._refreshInboundTable(system);
      } catch (e) {
        showToast('修改失败: ' + e.message);
        restore();
      }
    };

    if (field === 'channel') {
      const options = await this._getChannelOptions(system);
      const cur = rec.channel || '';
      if (cur && !options.includes(cur)) options.unshift(cur);
      el.innerHTML = `<select style="width:100%;min-width:96px;padding:4px;font-size:12px;border:1px solid var(--primary);border-radius:4px;background:#fff;">
          <option value="">（不填）</option>
          ${options.map(o => `<option value="${o}"${o === cur ? ' selected' : ''}>${o}</option>`).join('')}
        </select>`;
      const sel = el.querySelector('select');
      sel.focus();
      sel.addEventListener('change', () => commit(sel.value));
      // 兜底：用户开了下拉又没选（值没变）→ 收回编辑器
      sel.addEventListener('blur', () => setTimeout(() => { if (!done && sel.value === cur) commit(cur); }, 200));
    } else {
      const isPrice = field === 'purchase_price';
      const cur = isPrice ? (rec.purchase_price || '') : (rec.quantity || '');
      el.innerHTML = `<input type="number" inputmode="decimal" step="0.01" min="0" value="${cur}"
        style="width:100%;min-width:72px;padding:4px;font-size:13px;border:1px solid var(--primary);border-radius:4px;text-align:center;background:#fff;box-sizing:border-box;" />`;
      const input = el.querySelector('input');
      input.focus();
      try { input.select(); } catch (e) {}
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        else if (e.key === 'Escape') { cancelled = true; input.blur(); }
      });
      input.addEventListener('blur', () => commit(input.value));
    }
  },

  // 渠道下拉选项（按系统缓存，避免每次点击都请求）
  async _getChannelOptions(system) {
    this._channelOptionsCache = this._channelOptionsCache || {};
    if (this._channelOptionsCache[system]) return [...this._channelOptionsCache[system]];
    let options = [];
    try {
      options = await ConfigManager.getOptions(system, 'channel_options');
    } catch (e) { options = []; }
    if (!options || options.length === 0) {
      options = ['淘宝', '京东', '拼多多', '抖音', '美团', '唯品会', '微信小程序', '淘宝闪购', '百度直播', '支付宝惊喜市集', '其他'];
    }
    this._channelOptionsCache[system] = options;
    return [...options];
  },

  // 单号统计弹窗
  _showGroupStats(cacheKey, orderNo) {
    const items = this._groupStatsCache[cacheKey] || [];
    if (items.length === 0) { showToast('无数据'); return; }
    const totalQty = items.reduce((s, r) => s + parseFloat(r.quantity || 0), 0);
    // 整单总金额 = 本单第一个商品（id最小）填的金额，不乘数量
    const firstItem = [...items].sort((a, b) => a.id - b.id)[0];
    const orderTotal = parseFloat(firstItem.purchase_price || 0);

    // 按渠道汇总（数量按每条算；金额只在第一个商品所在渠道计整单金额）
    const byChannel = {};
    items.forEach(r => {
      const ch = r.channel || '未填';
      if (!byChannel[ch]) byChannel[ch] = { qty: 0, amt: 0, count: 0, isFirst: false };
      byChannel[ch].qty += parseFloat(r.quantity || 0);
      byChannel[ch].count++;
      if (r.id === firstItem.id) byChannel[ch].isFirst = true;
    });
    Object.values(byChannel).forEach(v => { if (v.isFirst) v.amt = orderTotal; });

    showModal('📊 单号统计');
    document.getElementById('modal-body').innerHTML = `
      <div style="padding:4px 0 12px;">
        <div style="background:var(--bg);padding:12px;border-radius:8px;margin-bottom:12px;display:flex;gap:12px;align-items:flex-start;">
          <div style="flex:1;">
            <div style="font-size:12px;color:var(--text-secondary);">订单号</div>
            <div style="font-size:15px;font-weight:600;color:var(--primary);margin-top:4px;">${orderNo}</div>
            <div style="font-size:12px;color:var(--text-secondary);margin-top:8px;">${this._fmtDateTime(items[0].created_at)}</div>
            ${(() => {
              const devices = [...new Set(items.map(r => (r.device || '').trim()).filter(Boolean))];
              if (devices.length === 0) return '';
              return `
              <div style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border);">
                <div style="font-size:12px;color:var(--text-secondary);">下单设备/下级</div>
                <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-top:4px;">${devices.join('、')}</div>
              </div>`;
            })()}
          </div>
          <div id="order-profit-box" style="min-width:130px;background:rgba(52,168,83,0.08);border:1px solid rgba(52,168,83,0.2);border-radius:8px;padding:10px 12px;text-align:center;cursor:pointer;" onclick="TransactionsModule._showOrderProfitDetail(this.dataset.orderNo)" data-order-no="${orderNo}" title="点击查看单利润计算过程">
            <div style="font-size:11px;color:var(--text-secondary);">单利润  ⓘ</div>
            <div id="order-profit-value" style="font-size:20px;font-weight:600;color:var(--success);margin-top:4px;">计算中...</div>
            <div id="order-profit-detail" style="font-size:10px;color:var(--text-secondary);margin-top:4px;line-height:1.4;"></div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
          <div style="background:var(--bg);padding:10px;border-radius:6px;text-align:center;">
            <div style="font-size:11px;color:var(--text-secondary);">商品种数</div>
            <div style="font-size:20px;font-weight:600;color:var(--primary);">${items.length}</div>
          </div>
          <div style="background:var(--bg);padding:10px;border-radius:6px;text-align:center;">
            <div style="font-size:11px;color:var(--text-secondary);">总数量</div>
            <div style="font-size:20px;font-weight:600;color:var(--success);">${this._fmtQty(totalQty)}</div>
          </div>
          ${orderTotal > 0 ? `<div style="background:var(--bg);padding:10px;border-radius:6px;text-align:center;grid-column:span 2;">
            <div style="font-size:11px;color:var(--text-secondary);">整单金额（首个商品填写）</div>
            <div style="font-size:22px;font-weight:600;color:var(--success);">¥${orderTotal.toFixed(2)}</div>
          </div>` : ''}
        </div>
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;">按渠道汇总：</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          ${Object.entries(byChannel).map(([ch, v]) => `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:6px;">${ch}</td>
              <td style="text-align:right;padding:6px;">${v.count} 种</td>
              <td style="text-align:right;padding:6px;">${this._fmtQty(v.qty)}</td>
              <td style="text-align:right;padding:6px;color:var(--success);">${v.amt > 0 ? '¥' + v.amt.toFixed(2) : '-'}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    `;

    // 异步加载单利润（成本=整单金额始终显示；有出库才计销售额）
    API.get(`/api/main/order-profit?orderNo=${encodeURIComponent(orderNo)}`).then(res => {
      const valEl = document.getElementById('order-profit-value');
      const detEl = document.getElementById('order-profit-detail');
      const boxEl = document.getElementById('order-profit-box');
      if (!valEl) return;
      const cost = parseFloat(res.cost_price) || 0;

      // 还没出库：只显示成本，利润待出库
      if (!res.has_out) {
        valEl.style.color = 'var(--text-secondary)';
        valEl.textContent = '待出库';
        detEl.innerHTML = `成本 ¥${cost.toFixed(2)}<br>销售 待出库`;
        return;
      }
      // 已出库但出库次日还没录行情：待行情
      if (!res.has_market) {
        valEl.style.color = 'var(--text-secondary)';
        valEl.textContent = '待行情';
        detEl.innerHTML = `成本 ¥${cost.toFixed(2)}<br>销售 待行情`;
        return;
      }

      const profit = parseFloat(res.profit) || 0;
      const color = profit > 0 ? 'var(--success)' : (profit < 0 ? 'var(--danger)' : 'var(--text-light)');
      valEl.style.color = color;
      valEl.textContent = (profit >= 0 ? '+¥' : '-¥') + Math.abs(profit).toFixed(2);
      if (profit < 0 && boxEl) {
        boxEl.style.borderColor = 'rgba(217,48,37,0.3)';
        boxEl.style.background = 'rgba(217,48,37,0.06)';
      }
      detEl.innerHTML = `销售 ¥${(parseFloat(res.sale_price) || 0).toFixed(2)}<br>成本 ¥${cost.toFixed(2)}`;
    }).catch(() => {
      const valEl = document.getElementById('order-profit-value');
      if (valEl) valEl.textContent = '-';
      const detEl = document.getElementById('order-profit-detail');
      if (detEl) detEl.textContent = '加载失败';
    });
  },

  // 显示单利润计算过程详情
  async _showOrderProfitDetail(orderNo) {
    if (!orderNo) {
      const box = document.getElementById('order-profit-box');
      orderNo = box?.dataset?.orderNo;
    }
    if (!orderNo) return;
    showModal('📊 单利润计算过程');
    document.getElementById('modal-body').innerHTML = '<div style="text-align:center;padding:30px;color:var(--text-secondary);">计算中...</div>';
    try {
      const res = await API.get(`/api/main/order-profit?orderNo=${encodeURIComponent(orderNo)}`);
      const cost = parseFloat(res.cost_price) || 0;
      const sale = parseFloat(res.sale_price) || 0;
      const profit = parseFloat(res.profit) || 0;
      const profitColor = profit > 0 ? 'var(--success)' : (profit < 0 ? 'var(--danger)' : 'var(--text-light)');

      let detailRows = '';
      if (res.detail && res.detail.length) {
        detailRows = res.detail.map(r => {
          const saleFormula = r.out_qty > 0
            ? `¥${(r.next_day_price || 0).toFixed(2)} × ${r.in_qty}（本单内数量） = <strong>¥${r.sale.toFixed(2)}</strong>`
            : '<span style="color:var(--text-light);">未出库，无销售</span>';
          const statusBadge = r.out_qty > 0
            ? (r.next_day_price > 0 ? '<span class="badge badge-stock-normal">已算</span>' : '<span class="badge badge-stock-low">待行情</span>')
            : '<span class="badge" style="background:#f0f0f0;color:#666;">未出</span>';
          return `
            <tr style="border-bottom:1px solid var(--border);">
              <td style="padding:8px;vertical-align:top;">
                <div style="font-size:12px;"><code>${r.code}</code></div>
                <div style="font-size:13px;font-weight:600;">${r.name}</div>
                <div style="font-size:11px;color:var(--text-secondary);">本单入库 ${r.in_qty}，累计已出 ${r.out_qty}</div>
              </td>
              <td style="padding:8px;vertical-align:top;font-size:12px;">
                ${r.out_date ? `<div>出库日：<strong>${r.out_date}</strong></div><div>次日：<strong>${r.next_day}</strong></div>` : '<span style="color:var(--text-light);">—</span>'}
              </td>
              <td style="padding:8px;vertical-align:top;font-size:12px;">
                ${r.next_day_price > 0 ? `<div>次日价：<strong>¥${r.next_day_price.toFixed(2)}</strong></div>` : '<span style="color:var(--text-light);">—</span>'}
              </td>
              <td style="padding:8px;vertical-align:top;font-size:12px;">
                ${saleFormula}
              </td>
              <td style="padding:8px;vertical-align:top;text-align:center;">${statusBadge}</td>
            </tr>`;
        }).join('');
      }

      let summaryText;
      if (!res.has_out) summaryText = '<span style="color:var(--text-secondary);">尚未出库，无法计算</span>';
      else if (!res.has_market) summaryText = '<span style="color:var(--text-secondary);">出库次日行情未录，暂无法计算</span>';
      else summaryText = `<strong>销售 ${res.detail.filter(r => r.out_qty > 0).length} 项</strong> = ¥${sale.toFixed(2)}`;

      document.getElementById('modal-body').innerHTML = `
        <div style="padding:4px 0;">
          <div style="background:var(--bg);padding:10px;border-radius:6px;margin-bottom:12px;font-size:12px;color:var(--text-secondary);">
            <div>订单号：<strong style="color:var(--primary);">${orderNo}</strong></div>
            <div>成本（整单金额）：<strong>¥${cost.toFixed(2)}</strong></div>
            <div>销售（出库次日行情 × 本单数量）：<strong>${summaryText}</strong></div>
            <div>单利润：<strong style="color:${profitColor};font-size:16px;">${profit >= 0 ? '+' : ''}¥${profit.toFixed(2)}</strong></div>
          </div>
          <div style="font-size:12px;color:var(--text-secondary);margin-bottom:6px;">各商品计算明细：</div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
              <thead>
                <tr style="background:var(--bg);">
                  <th style="padding:8px;text-align:left;">商品</th>
                  <th style="padding:8px;text-align:left;">出库/次日</th>
                  <th style="padding:8px;text-align:left;">行情</th>
                  <th style="padding:8px;text-align:left;">销售</th>
                  <th style="padding:8px;">状态</th>
                </tr>
              </thead>
              <tbody>${detailRows || '<tr><td colspan="5" style="padding:20px;text-align:center;color:var(--text-light);">暂无明细</td></tr>'}</tbody>
            </table>
          </div>
          <p style="margin-top:12px;padding:10px;background:rgba(26,115,232,0.06);border-left:3px solid var(--primary);font-size:12px;color:var(--text-secondary);line-height:1.6;">
            <strong>计算规则：</strong>成本 = 整单金额（首个商品填的金额）；销售 = 各商品「出库日次日」录的行情价 × 该商品在本单内的全部数量；利润 = 销售 - 成本。次日行情固定时点，后续不再变。
          </p>
        </div>
      `;
    } catch (e) {
      document.getElementById('modal-body').innerHTML = `<div style="text-align:center;padding:30px;color:var(--danger);">加载失败：${e.message}</div>`;
    }
  },

  // 删除整单（一个订单号的所有记录）
  async _deleteGroup(cacheKey, orderNo) {
    if (!confirm(`确认删除订单号 "${orderNo}" 的所有入库记录？此操作不可恢复！`)) return;
    const items = this._groupStatsCache[cacheKey] || [];
    for (const r of items) {
      try { await API.del(`/api/${this.currentSystem || 'main'}/inbound/${r.id}`); } catch (e) {}
    }
    showToast(`已删除 ${items.length} 条记录`);
    const sys = this.currentSystem || 'main';
    await this._refreshInboundTable(sys);
    if (this.currentTab === 'ledger') await this.renderLedgerTab(sys);
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
    // 一单多品：首个商品必须登记单号
    if (!orderNo) { showToast('请填写订单号（一单多品首个商品必填）'); return; }

    try {
      await API.post(`/api/${system}/inbound`, {
        product_code: code, quantity, device, channel, remark,
        order_no: orderNo, image_path: imagePath, purchase_price: price
      });
      showToast('入库登记成功！');
      this.inboundImages = [];
      document.getElementById('inbound-image-preview').innerHTML = '';
      await this._refreshInboundTable(system);
      // 如果当前在台账tab，也刷新
      if (this.currentTab === 'ledger') await this.renderLedgerTab(system);
      // 询问是否继续添加该单其他商品
      this._askContinueInbound(system, orderNo);
    } catch (e) {
      showToast('入库登记失败: ' + e.message);
    }
  },

  // 一单多品：提交成功后询问是否继续
  _askContinueInbound(system, orderNo) {
    showModal('✅ 入库登记成功');
    const body = document.getElementById('modal-body');
    body.innerHTML = `
      <div style="text-align:center;padding:10px 0;">
        <p style="margin-bottom:4px;font-size:15px;">商品已入库</p>
        <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px;">
          当前单号：<strong style="color:var(--primary);">${orderNo || '-'}</strong>
        </p>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <button class="btn btn-success btn-lg" onclick="TransactionsModule.continueInbound('${system}')">📦 继续添加该单其他商品</button>
          <button class="btn btn-secondary btn-lg" onclick="TransactionsModule.finishInbound('${system}')">✔ 结束</button>
        </div>
      </div>
    `;
  },

  // 继续添加该单其他商品：清空商品字段，保留单号
  continueInbound(system) {
    const orderInput = document.getElementById('inbound-order');
    const orderNo = orderInput ? orderInput.value : '';
    closeModal();
    document.getElementById('inbound-form').reset();
    if (orderInput) orderInput.value = orderNo; // 沿用单号，不用再录
    this.inboundImages = [];
    const preview = document.getElementById('inbound-image-preview');
    if (preview) preview.innerHTML = '';
    setTimeout(() => document.getElementById('inbound-code')?.focus(), 100);
  },

  // 结束：清空整单，不再弹窗
  finishInbound(system) {
    closeModal();
    this.resetInboundForm();
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
              <label>订单号/快递单号 <span style="color:var(--text-light);font-size:11px;">(可后补)</span></label>
              <div class="input-with-btn">
                <input type="text" id="outbound-order-no" placeholder="选填，之后可批量补录" />
                <button type="button" class="btn btn-sm btn-secondary" onclick="triggerBarcodeScan('outbound-order-no')">扫码</button>
              </div>
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
          <div style="display:flex;align-items:center;gap:10px;">
            <button class="btn btn-sm btn-primary" onclick="TransactionsModule.showFillOrderModal('${system}')">📝 补录订单号</button>
            <span style="font-size:12px;color:var(--text-light);" id="outbound-count-label">加载中...</span>
          </div>
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
                  <th>订单号</th>
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
          <td style="white-space:nowrap;font-size:12px;">${this._fmtDateTime(r.created_at)}</td>
          <td><code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:11px;">${r.product_code}</code></td>
          <td>${p ? p.name : '-'}</td>
          <td>${p ? (p.spec || '-') : '-'}</td>
          <td><strong style="color:var(--danger);">-${this._fmtQty(r.quantity)}</strong></td>
          <td>${r.location || '-'}</td>
          <td>${r.order_no ? '<span style="color:var(--primary);font-size:12px;">📦 ' + r.order_no + '</span>' : '<span style="color:#bbb;font-size:11px;">未填</span>'}</td>
          <td>${r.image_path ? `<a href="javascript:void(0)" onclick="showImagePreview('${r.image_path}')" style="color:var(--primary);font-size:12px;text-decoration:none;white-space:nowrap;">📷 图片查看</a>` : '-'}</td>
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
    const orderNo = document.getElementById('outbound-order-no').value.trim();
    const imagePath = this.outboundImages.length > 0 ? this.outboundImages[0] : '';

    if (!code || !quantity) { showToast('请填写编码和数量'); return; }

    try {
      await API.post(`/api/${system}/outbound`, {
        product_code: code, quantity, image_path: imagePath, location, order_no: orderNo
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

  // ===== 补录出库订单号 =====
  async showFillOrderModal(system) {
    try {
      const records = await API.get(`/api/${system}/outbound`);
      const products = await API.get(`/api/${system}/products`);
      // 只显示未填订单号的记录
      const pending = records.filter(r => !r.order_no);
      showModal('📝 补录出库订单号');
      const body = document.getElementById('modal-body');

      if (pending.length === 0) {
        body.innerHTML = `<div style="text-align:center;padding:30px;">
          <div style="font-size:48px;">🎉</div>
          <p style="color:var(--text-secondary);margin-top:12px;">所有出库记录都已填过订单号</p>
        </div>`;
        return;
      }

      body.innerHTML = `
        <div style="max-height:300px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:12px;">
          <table style="width:100%;">
            <thead><tr>
              <th style="padding:8px;"><input type="checkbox" id="fill-all-check" onchange="TransactionsModule._toggleAllFill(this)" checked /></th>
              <th>日期时间</th><th>编码</th><th>名称</th><th>规格</th><th>数量</th>
            </tr></thead>
            <tbody>
              ${pending.map(r => {
                const p = products.find(x => x.code === r.product_code);
                return `<tr>
                  <td style="text-align:center;"><input type="checkbox" class="fill-check" value="${r.id}" checked /></td>
                  <td style="font-size:11px;white-space:nowrap;">${this._fmtDateTime(r.created_at)}</td>
                  <td><code style="background:#f0f0f0;padding:1px 5px;border-radius:4px;font-size:11px;">${r.product_code}</code></td>
                  <td>${p ? p.name : '-'}</td>
                  <td>${p ? (p.spec || '-') : '-'}</td>
                  <td style="color:var(--danger);">-${this._fmtQty(r.quantity)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="form-group">
          <label>订单号/快递单号 <span style="color:var(--danger)">*</span></label>
          <div class="input-with-btn">
            <input type="text" id="fill-order-no" placeholder="输入本次出库的订单号" />
            <button type="button" class="btn btn-sm btn-secondary" onclick="triggerBarcodeScan('fill-order-no')">扫码</button>
          </div>
        </div>
        <div style="display:flex;gap:10px;margin-top:14px;">
          <button class="btn btn-primary btn-lg" style="flex:1;" onclick="TransactionsModule.submitFillOrder('${system}')">保存订单号</button>
          <button class="btn btn-secondary btn-lg" style="flex:1;" onclick="closeModal()">取消</button>
        </div>
      `;
      setTimeout(() => document.getElementById('fill-order-no')?.focus(), 100);
    } catch (e) {
      showToast('加载失败: ' + e.message);
    }
  },

  _toggleAllFill(el) {
    document.querySelectorAll('.fill-check').forEach(c => c.checked = el.checked);
  },

  async submitFillOrder(system) {
    const orderNo = document.getElementById('fill-order-no').value.trim();
    const ids = Array.from(document.querySelectorAll('.fill-check:checked')).map(c => parseInt(c.value));
    if (!orderNo) { showToast('请填写订单号'); return; }
    if (ids.length === 0) { showToast('请至少勾选一条出库记录'); return; }
    try {
      await API.patch(`/api/${system}/outbound/batch-order`, { ids, order_no: orderNo });
      showToast(`已为 ${ids.length} 条记录补录订单号 ${orderNo}`);
      closeModal();
      await this._refreshOutboundTable(system);
      if (this.currentTab === 'ledger') await this.renderLedgerTab(system);
    } catch (e) {
      showToast('补录失败: ' + e.message);
    }
  },

  resetOutboundForm() {
    document.getElementById('outbound-form').reset();
    this.outboundImages = [];    const preview = document.getElementById('outbound-image-preview');
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
                      <th>销售额</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${filteredOut.map(r => {
                      const bgColor = r.row_color || '';
                      const sys = TransactionsModule.currentSystem;
                      const bq = parseInt(r.bundle_qty) || 1;
                      const showBq = r.product_type === '抖音刷券' || !r.product_type;
                      return `<tr class="${bgColor ? 'row-color' : ''}" ${bgColor ? "style='--row-bg:" + bgColor + ";--row-bg-hover:" + bgColor + "'" : ''}>
                      <td>${TransactionsModule._renderColorCell(r.id, 'outbound', r.row_color)}</td>
                      <td style="white-space:nowrap;font-size:12px;">${this._fmtDateTime(r.created_at)}</td>
                      <td><code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:11px;">${r.product_code}</code></td>
                      <td>${r.product_name || '-'}</td>
                      <td>${r.product_spec || '-'}</td>
                      <td style="text-align:center;">${showBq && bq > 1 ? '<span style="color:#fbbc04;font-weight:500;">×' + bq + '</span>' : '<span style="color:#bbb;">-</span>'}</td>
                      <td><strong style="color:var(--danger);">-${this._fmtQty(r.quantity)}</strong></td>
                      <td>${r.location || '-'}</td>
                      <td>${r.sale_price ? '¥' + r.sale_price : '-'}</td>
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
          <span style="font-size:12px;color:var(--text-light);">总数量: <strong>${this._fmtQty(totalQty)}</strong></span>
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
        <td style="white-space:nowrap;font-size:12px;">${this._fmtDateTime(r.created_at)}</td>
        <td><code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:11px;">${r.product_code}</code></td>
        <td>${r.product_name || '-'}</td>
        <td>${r.product_spec || '-'}</td>
        <td style="text-align:center;">${showBq && bq > 1 ? '<span style="color:#fbbc04;font-weight:500;">×' + bq + '</span>' : '<span style="color:#bbb;">-</span>'}</td>
        <td><strong style="color:${isInbound ? 'var(--success)' : 'var(--danger)'};">${isInbound ? '+' : '-'}${this._fmtQty(r.quantity)}</strong></td>
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
