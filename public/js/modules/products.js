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
            <button class="btn btn-secondary" onclick="ProductsModule.showPriceImport('${system}')">📊 导入行情</button>
            <button class="btn btn-secondary" onclick="ProductsModule.manageTypes('${system}')">📑 管理类型</button>
            <button class="btn btn-secondary" id="smart-sort-btn-${system}" onclick="ProductsModule.smartSortClick('${system}')" title="把同一品牌的商品自动排到一起（只调顺序，可撤销）">🧠 智能整理</button>
          </div>
        </div>
      </div>
      <div id="products-dashboard-${system}"></div>
      <div id="products-list-${system}">
        <div class="card"><div class="card-body"><div class="empty-state"><div class="empty-icon">📦</div><p>加载中...</p></div></div></div>
      </div>
    `;

    await this.loadProducts(system);
    this._refreshSmartBtn(system);
  },

  async loadProducts(system) {
    const container = document.getElementById(`products-list-${system}`);
    try {
      // 所有产品统一加载（包含抖音刷券）
      const data = await API.get('/api/main/products');
      // 万一接口回的不是数组（网关报错页/格式变了），早报错，别硬跑下去把页面卡死
      if (!Array.isArray(data)) throw new Error('接口返回的不是商品列表');
      const filtered = data;
      this._allProducts = filtered; // 供搜索弹窗使用

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
        await this._renderDashboard(system, filtered);
        return;
      }

      // 按类型分组：所有产品平铺显示（无赠品嵌套）
      const groups = {};
      filtered.forEach(p => {
        const type = p.type || '未分类';
        if (!groups[type]) groups[type] = [];
        groups[type].push(p);
      });

      // 同一个「套装名」的多个编码合并成一行显示（详见文件顶部套装说明）
      this._rowRefs = {};        // 套装行索引 → 成员信息（按钮回调按索引取，避免把中文/引号拼进 onclick）
      let rowSeq = 0;

      let html = '';
      let groupIndex = 0;
      for (const [type, items] of Object.entries(groups)) {
        const idx = groupIndex++;
        const collapsed = localStorage.getItem('pg-collapse-' + idx) === '1';
        const rows = this._buildDisplayRows(items);

        const rowsHtml = rows.map(row => {
          const first = row.items[0];

          // ---------- 普通商品：一件一行 ----------
          if (!row.isSet) {
            const p = first;
            return `
                      <tr draggable="true" data-pid="${p.id}" data-pids="${p.id}" onclick="ProductsModule.editProduct('${system}','${p.code}','${p.id}')" style="cursor:grab;">
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
          }

          // ---------- 套装：多个编码挤在同一行，共用一个名称，整套一个价 ----------
          const rowId = rowSeq++;
          const setId = `chart-${system}-set-${rowId}`;
          this._rowRefs[rowId] = { system, setName: row.set_name, members: row.items, chartId: setId };
          const codesHtml = row.items.map(p => `
                        <div style="margin-bottom:2px;">
                          <code style="background:#f0f0f0;padding:2px 6px;border-radius:4px;font-size:12px;cursor:pointer;" title="点击编辑这个编码" onclick="event.stopPropagation();ProductsModule.editProduct('${system}','${p.code}','${p.id}')">${p.code}</code>
                        </div>`).join('');
          const namesText = this._uniqList(row.items.map(p => p.name)).map(v => this._esc(v)).join(' / ');
          const specText = this._uniqList(row.items.map(p => p.spec)).map(v => this._esc(v)).join(' / ');
          const unitText = this._uniqList(row.items.map(p => p.unit)).map(v => this._esc(v)).join(' / ');
          const mpText = this._uniqList(row.items.map(p => p.market_price)).map(v => this._esc(v)).join(' / ');
          // 整套只有一个行情价 → 整行只画一个图，不按编码分开出现行情图
          const chartsHtml = `
                        <div style="display:flex;align-items:center;gap:6px;">
                          <span style="font-size:10px;color:var(--text-light);flex:0 0 auto;">整套</span>
                          <div class="chart-container" id="${setId}" style="flex:1;min-width:0;"></div>
                        </div>`;
          return `
                      <tr draggable="true" data-pid="${first.id}" data-pids="${row.items.map(p => p.id).join(',')}" onclick="ProductsModule.editProduct('${system}','${first.code}','${first.id}')" style="cursor:grab;background:#fbf9fe;">
                        <td style="vertical-align:top;">${codesHtml}</td>
                        <td style="vertical-align:top;">
                          <strong>${namesText}</strong>
                          <span class="badge" style="background:#ede7f6;color:#5e35b1;font-size:10px;margin-left:4px;" title="这 ${row.items.length} 个编码共用同一个名称，算利润时按一整套只算一次">套装 · ${row.items.length} 个编码</span>
                          ${(!type || !specText || !unitText) ? '<span style="color:var(--danger);font-size:10px;">待补充</span>' : ''}
                        </td>
                        <td style="vertical-align:top;">${specText || '<span style="color:#bbb;">-</span>'}</td>
                        <td style="vertical-align:top;">${unitText || '<span style="color:#bbb;">-</span>'}</td>
                        <td style="vertical-align:top;">${type || '<span style="color:#bbb;">-</span>'}</td>
                        <td style="vertical-align:top;">${mpText || '<span style="color:#bbb;">-</span>'}</td>
                        <td>${chartsHtml}</td>
                        <td style="white-space:nowrap;vertical-align:top;">
                          <button class="btn btn-sm btn-primary" onclick="event.stopPropagation();ProductsModule.editProduct('${system}','${first.code}','${first.id}')" title="编辑套装里的第一个编码（点上方编码可编辑指定的那个）">编辑</button>
                          <button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();ProductsModule.addCodeToSet('${system}', ${rowId})" title="再扫一个码加进这一套">＋ 加码</button>
                          <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();ProductsModule.deleteSet('${system}', ${rowId})">删除套装</button>
                          <button class="btn btn-sm btn-success" onclick="event.stopPropagation();ProductsModule.setPriceForSet('${system}', ${rowId})">💰 套装价</button>
                        </td>
                      </tr>`;
        }).join('');

        html += `
          <div class="card">
            <div class="card-header" style="cursor:pointer;user-select:none;" onclick="ProductsModule.toggleGroup(${idx})" title="${collapsed ? '点击展开' : '点击折叠'}">
              <h3 style="color:var(--primary);font-size:14px;">📁 ${type} <span id="group-arrow-${idx}" style="font-size:12px;color:var(--text-light);">${collapsed ? '▸' : '▾'}</span></h3>
              <span style="font-size:12px;color:var(--text-light);">共 ${rows.length} 项${rows.length !== items.length ? `（${items.length} 个编码）` : ''}</span>
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
${rowsHtml}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `;
      }

      container.innerHTML = html;

      // ❗仪表盘放在列表之后渲染：它内部还要再拉一次库存接口，慢或失败都不该拖住整张列表
      await this._renderDashboard(system, filtered);

      // 绑定每组分组的拖拽排序
      document.querySelectorAll('#products-list-' + system + ' tbody[data-group]').forEach(tbody => {
        this._enableRowDrag(tbody, system);
      });

      // 渲染每个产品的波形图（套装成员不再单独画，整行只画一个「整套」图）
      const memberIds = new Set();
      Object.values(this._rowRefs || {}).forEach(ref => (ref.members || []).forEach(m => memberIds.add(String(m.id))));
      for (const p of filtered) {
        if (memberIds.has(String(p.id))) continue;
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

      // 套装行：整行只画一个「整套」行情图（用户只填一套价，不必按编码分开出现）
      for (const [rowId, ref] of Object.entries(this._rowRefs || {})) {
        const el = document.getElementById(ref.chartId);
        if (!el) continue;
        try {
          const svg = await PriceChart.renderSet(ref.chartId, ref.members);
          el.innerHTML = `
              <div onclick="ProductsModule.showSetChart('${ref.system}', ${rowId})" style="cursor:pointer;" title="点击放大查看整套行情">
                ${svg || '<div style="color:var(--text-light);font-size:11px;padding:8px;">-</div>'}
              </div>
            `;
        } catch (e) {
          console.error('套装行情图渲染失败:', e);
          el.innerHTML = '<div style="color:var(--text-light);font-size:11px;text-align:center;padding:8px;">图表加载失败</div>';
        }
      }
    } catch (e) {
      const msg = (e && e.message) || '未知错误';
      showToast('加载产品数据失败: ' + msg);
      // ❗以前只弹 2.5 秒提示就没了，页面永远停在「加载中...」——现在给明确的失败界面 + 重试入口
      if (container) {
        container.innerHTML = `
          <div class="card">
            <div class="card-body">
              <div class="empty-state">
                <div class="empty-icon">⚠️</div>
                <p style="color:var(--danger);font-weight:600;">产品数据加载失败</p>
                <p style="color:var(--text-secondary);font-size:13px;margin:6px 0 14px;">${this._esc(msg)}</p>
                <button class="btn btn-primary" onclick="ProductsModule.loadProducts('${system}')">🔄 重新加载</button>
              </div>
            </div>
          </div>
        `;
      }
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
        ${this._setBlockHtml('product')}
        <div class="form-actions">
          <button type="submit" class="btn btn-primary btn-lg">保存</button>
          <button type="button" class="btn btn-secondary btn-lg" onclick="closeModal()">取消</button>
        </div>
      </form>
    `;

    // 加载类型选项
    this._resetSetCodes('product');
    this._loadTypeOptions(system);
  },

  // 「是否套装」区块（添加/编辑共用）：选"是" → 出现「再扫一个码」输入
  // ❗不再让用户手填套装名：同一套装的几个编码共用「物品名称」，后端按名称归组
  _setBlockHtml(prefix, isSet, extraTopHtml) {
    const shown = isSet ? '' : 'display:none;';
    return `
        <div class="form-group">
          <label>是否套装</label>
          <select id="${prefix}-is-set" onchange="ProductsModule._onSetChange('${prefix}')" style="max-width:160px;">
            <option value="0"${isSet ? '' : ' selected'}>否</option>
            <option value="1"${isSet ? ' selected' : ''}>是</option>
          </select>
        </div>
        <div class="form-group" id="${prefix}-set-wrap" style="${shown}">
          <label>这个套装的其它编码</label>
          ${extraTopHtml || ''}
          <div class="input-with-btn">
            <input type="text" id="${prefix}-set-code-input" placeholder="再扫一个码，或手动输入" />
            <button type="button" class="btn btn-sm btn-secondary" onclick="triggerBarcodeScan('${prefix}-set-code-input','set-${prefix}')">📷 扫码</button>
            <button type="button" class="btn btn-sm btn-primary" onclick="ProductsModule.addSetCode('${prefix}')">＋ 加入</button>
          </div>
          <div id="${prefix}-set-code-list" style="margin-top:8px;"></div>
          <div style="font-size:11px;color:var(--text-light);margin-top:6px;line-height:1.6;">
            一个套装 = <b>同一个商品的多个条码</b>（上面填的是第一个码）。这些编码共用同一个名称/规格/单位/行情/类型，
            在商品信息表里显示成同一行；算利润时按<b>一整套</b>只算一次。
          </div>
        </div>`;
  },

  // 「是否套装」切换：选"是"才显示多码输入区
  _onSetChange(prefix) {
    const sel = document.getElementById(prefix + '-is-set');
    const on = sel && sel.value === '1';
    const wrap = document.getElementById(prefix + '-set-wrap');
    if (wrap) wrap.style.display = on ? '' : 'none';
    if (on) this._renderSetCodeList(prefix);
  },

  // 表单里已经加进来的「其它编码」（key = 表单前缀 product / edit / setadd）
  _setCodesOf(prefix) {
    if (!this._setCodes) this._setCodes = {};
    if (!this._setCodes[prefix]) this._setCodes[prefix] = [];
    return this._setCodes[prefix];
  },

  _resetSetCodes(prefix) { if (!this._setCodes) this._setCodes = {}; this._setCodes[prefix] = []; },

  // 把一个扫码/手输的编码加进当前表单的套装列表
  addSetCode(prefix) {
    const input = document.getElementById(prefix + '-set-code-input');
    if (!input) return;
    const code = String(input.value || '').trim();
    if (!code) { showToast('先扫码或输入一个编码'); return; }
    const mainCode = String((document.getElementById(prefix === 'edit' ? 'edit-product-code' : 'product-code') || {}).value || '').trim();
    const list = this._setCodesOf(prefix);
    if (code === mainCode) { showToast('这就是第一个编码，不用重复加'); return; }
    if (list.indexOf(code) >= 0) { showToast('这个编码已经加过了'); return; }
    list.push(code);
    input.value = '';
    this._renderSetCodeList(prefix);
    showToast('已加入：' + code);
  },

  removeSetCode(prefix, code) {
    const list = this._setCodesOf(prefix);
    const i = list.indexOf(code);
    if (i >= 0) list.splice(i, 1);
    this._renderSetCodeList(prefix);
  },

  _renderSetCodeList(prefix) {
    const box = document.getElementById(prefix + '-set-code-list');
    if (!box) return;
    const list = this._setCodesOf(prefix);
    if (!list.length) {
      box.innerHTML = '<div style="font-size:12px;color:var(--text-light);">还没加其它编码（只有上面那一个码）</div>';
      return;
    }
    box.innerHTML = list.map(c => `
      <span style="display:inline-flex;align-items:center;gap:6px;background:#ede7f6;color:#5e35b1;
        padding:3px 8px;border-radius:12px;font-size:12px;margin:0 6px 6px 0;">
        ${this._esc(c)}
        <span style="cursor:pointer;font-weight:700;" title="移除" onclick="ProductsModule.removeSetCode('${prefix}','${this._esc(c)}')">×</span>
      </span>`).join('') +
      `<div style="font-size:11px;color:var(--text-light);margin-top:2px;">这一套共 ${list.length + 1} 个编码，保存后显示成同一行</div>`;
  },

  // 把一个编码并入套装：已存在的商品挂到这一套（并改成这一套的名称），不存在才新建
  // ❗名称就是归组键 → 并进来必须把它的名称改成这一套的名称，否则合不到一行
  // ❗带上 sync_rename:false：只改这一个编码，别把它原先同名的商品一起拖进来
  async _joinSet(code, setName, fields) {
    const nm = String(setName || '').trim();
    const exist = (this._allProducts || []).find(p => String(p.code) === String(code));
    if (exist) {
      await API.put(`/api/main/products/id/${exist.id}`, {
        code: exist.code, name: nm || exist.name, spec: exist.spec, unit: exist.unit,
        market_price: exist.market_price, type: exist.type, bundle_qty: exist.bundle_qty,
        is_set: true, set_name: nm, sync_rename: false
      });
      return 'joined';
    }
    await API.post('/api/main/products', Object.assign({}, fields, {
      name: nm || fields.name, code, is_set: true, set_name: nm
    }));
    return 'created';
  },

  // HTML 转义：套装名等用户输入要拼进 innerHTML，必须转义再拼
  _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  // 套装归组键 = 商品名称（用户不手填套装名）
  // ❗不读 set_name 字段做归组：历史数据里可能有手打错别字（Whoo水姸/Whoo水妍），
  //   那样同一套会被显示成两行。只要勾了套装就按名称归组（与后端 setKeyOfProduct 同口径）
  _setKeyOf(p) {
    if (!p) return '';
    const flagged = p.is_set === true || p.is_set === 'true' || p.is_set === 1 || p.is_set === '1';
    const nm = String(p.name || '').trim();
    const sn = String(p.set_name || '').trim();
    if (!flagged && !sn) return '';
    return nm || sn;
  },

  // ===== 套装：列表里同一套装名的多个编码合成一行 =====
  // 把某类型下的产品按「套装」合并成显示行：
  //   套装名非空的多个组成商品 → 合成一行（多个编码同格、共用一个名称）
  //   普通商品 → 各自一行
  // 返回 [{ isSet, set_name, items: [产品...] }]
  // ⚠️ 只影响「怎么显示」，不影响入库/出库/利润计算（那边按编码各存各的）
  _buildDisplayRows(items) {
    const rows = [];
    const pos = {};
    (items || []).forEach(p => {
      const sn = this._setKeyOf(p);
      if (!sn) { rows.push({ isSet: false, set_name: '', items: [p] }); return; }
      const key = 'sn:' + sn;
      if (pos[key] === undefined) {
        pos[key] = rows.length;
        rows.push({ isSet: true, set_name: sn, items: [p] });
      } else {
        rows[pos[key]].items.push(p);
      }
    });
    return rows;
  },

  // 去重（保持顺序、去空值、trim）—— 合成行里规格/单位等取并集显示
  _uniqList(arr) {
    const out = [];
    (arr || []).forEach(v => {
      const s = String(v == null ? '' : v).trim();
      if (s && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  },

  // 本地时区的今天（❌ 别用 toISOString，会差 8 小时）
  _todayStr() {
    const d = new Date(); const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  },

  // 从行索引取回套装成员（按钮回调用；列表重绘过就失效，提示刷新）
  _setRef(rowId) {
    const ref = (this._rowRefs || {})[rowId];
    if (!ref || !ref.members || !ref.members.length) {
      showToast('数据已刷新，请再点一次');
      return null;
    }
    return ref;
  },

  // 点击套装行的行情图 → 放大看「整套」走势（多个编码合并成一条线）
  showSetChart(system, rowId) {
    const ref = this._setRef(rowId);
    if (!ref) return;
    PriceChart.showLargeSet(system, ref.members);
  },

  // 删除整个套装（该套装名下的所有编码）
  async deleteSet(system, rowId) {
    const ref = this._setRef(rowId);
    if (!ref) return;
    const codes = ref.members.map(m => m.code).join('、');
    if (!confirm(`确认删除套装「${ref.setName}」的全部 ${ref.members.length} 个编码？\n\n${codes}`)) return;
    try {
      for (const m of ref.members) {
        await API.del(`/api/main/products/id/${encodeURIComponent(m.id)}`);
      }
      showToast(`已删除套装「${ref.setName}」`);
      await this.loadProducts(system);
    } catch (e) {
      showToast('删除失败: ' + e.message);
    }
  },

  // 录入「整套价」：一套只有一个价，同时记到该套装的每个编码上
  // （利润计算取的是组内第一个编码的行情，全都写上最稳妥）
  async setPriceForSet(system, rowId) {
    const ref = this._setRef(rowId);
    if (!ref) return;
    const first = ref.members[0];
    try {
      const latest = await API.get(`/api/main/price-history/${encodeURIComponent(first.code)}/latest?product_id=${first.id}`);
      const lastPrice = latest.price || 0;
      const codeList = ref.members.map(m => m.code).join('、');
      showModal(`录入套装行情价 - ${ref.setName}`);
      const body = document.getElementById('modal-body');
      body.innerHTML = `
        <div style="text-align:center;">
          <p style="color:var(--text-secondary);margin-bottom:6px;">今日日期: ${this._todayStr()}</p>
          <p style="font-size:12px;color:var(--text-light);margin-bottom:16px;line-height:1.6;">
            这是<b>一整套</b>的价格，会同时记到该套装的每个编码上（${this._esc(codeList)}）。<br/>
            算利润时每套只算一次，不会按每个编码各算一遍。
          </p>
          <div class="form-group" style="max-width:300px;margin:0 auto;">
            <label>今日整套价格 (上次价格: ¥${lastPrice})</label>
            <input type="number" id="price-input" step="0.01" value="${lastPrice}" style="font-size:24px;padding:12px;text-align:center;" autofocus />
          </div>
          <div style="display:flex;gap:10px;justify-content:center;margin-top:16px;">
            <button class="btn btn-primary btn-lg" onclick="ProductsModule.submitSetPrice('${system}', ${rowId})">确认提交</button>
            <button class="btn btn-secondary btn-lg" onclick="closeModal()">取消</button>
          </div>
        </div>
      `;
    } catch (e) {
      showToast('获取价格失败');
    }
  },

  async submitSetPrice(system, rowId) {
    const ref = this._setRef(rowId);
    if (!ref) return;
    const price = parseFloat(document.getElementById('price-input').value) || 0;
    const date = this._todayStr();
    try {
      for (const m of ref.members) {
        await API.post('/api/main/price-history', {
          product_code: m.code, price, product_id: parseInt(m.id), date
        });
      }
      showToast(`套装价已更新（${ref.members.length} 个编码）`);
      closeModal();
      await this.loadProducts(system);
    } catch (e) {
      showToast('提交失败: ' + e.message);
    }
  },

  // 给已有套装「再扫一个码」：已存在的编码并进来，新编码按本套装的信息建
  addCodeToSet(system, rowId) {
    const ref = this._setRef(rowId);
    if (!ref) return;
    this._setAddCtx = { system, rowId };
    const lead = ref.members[0];
    showModal(`给套装「${lead.name}」再加一个编码`);
    const body = document.getElementById('modal-body');
    body.innerHTML = `
      <div>
        <div style="font-size:12px;color:var(--text-secondary);margin-bottom:10px;line-height:1.6;">
          这一套现在有 ${ref.members.length} 个编码：<b>${ref.members.map(m => this._esc(m.code)).join('、')}</b><br/>
          新加的编码会显示在同一行，和它们共用同一个名称，算利润时仍按<b>一整套只算一次</b>。
        </div>
        <div class="form-group">
          <label>要加入的编码</label>
          <div class="input-with-btn">
            <input type="text" id="setadd-code" placeholder="扫码或手动输入编码" autofocus />
            <button type="button" class="btn btn-sm btn-secondary" onclick="triggerBarcodeScan('setadd-code','setadd')">📷 扫码</button>
          </div>
        </div>
        <div style="font-size:11px;color:var(--text-light);line-height:1.6;">
          · 系统中已存在的编码 → 直接并入这一套（不动它原有的规格等信息）<br/>
          · 全新的编码 → 按本套装的名称/规格/单位/行情/类型新建一条
        </div>
        <div class="form-actions" style="margin-top:16px;">
          <button class="btn btn-primary btn-lg" onclick="ProductsModule.submitAddCodeToSet()">加入</button>
          <button class="btn btn-secondary btn-lg" onclick="closeModal()">取消</button>
        </div>
      </div>
    `;
  },

  async submitAddCodeToSet() {
    const c = this._setAddCtx;
    if (!c) return;
    const ref = this._setRef(c.rowId);
    if (!ref) return;
    const input = document.getElementById('setadd-code');
    const code = String((input && input.value) || '').trim();
    if (!code) { showToast('先扫码或输入一个编码'); return; }
    if (ref.members.some(m => String(m.code) === code)) { showToast('这个编码已经在这一套里了'); return; }
    const lead = ref.members[0];
    const setName = this._setKeyOf(lead) || String(lead.name || '').trim();
    try {
      // 重新拉一次商品表，确保能判断这个编码是否已存在
      try { this._allProducts = await API.get('/api/main/products'); } catch (e) { /* 用缓存兜底 */ }
      const beforeIds = this._idSnapshot();
      const r = await this._joinSet(code, setName, {
        name: lead.name, spec: lead.spec, unit: lead.unit,
        market_price: lead.market_price, type: lead.type, bundle_qty: lead.bundle_qty
      });
      showToast(r === 'joined' ? `${code} 已并入这一套` : `已新增编码 ${code} 并加入这一套`);
      closeModal();
      await this._reloadPlaced(c.system, beforeIds);
    } catch (e) {
      showToast('加入失败: ' + (e.message || ''));
    }
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
    // 是否套装：同一个商品的多个条码共用「名称」，后端按名称归组 → 按"套"计价
    const isSet = (document.getElementById('product-is-set')?.value === '1');
    const extraCodes = isSet ? this._setCodesOf('product').slice() : [];

    if (!code || !name) {
      showToast('请填写物品编码和名称');
      return;
    }

    try {
      const beforeIds = this._idSnapshot();   // 记下录入前的商品，之后好认出"哪几个是刚录的"
      // 套装不再手填套装名：归组键就是商品名称（详见文件顶部套装说明）
      const body = { code, name, spec, unit, market_price: marketPrice, type, is_set: isSet };
      if (isSet) body.set_name = name;
      if (type === '抖音刷券') body.bundle_qty = bundleQty;
      // 统一用主系统 API 存储（按类型区分）
      await API.post('/api/main/products', body);

      // 套装：把「其它编码」一起建出来 / 并入这一套
      if (isSet) {
        for (const c of extraCodes) {
          await this._joinSet(c, name, { name, spec, unit, market_price: marketPrice, type, bundle_qty: bundleQty });
        }
      }
      this._resetSetCodes('product');
      showToast(isSet && extraCodes.length ? `添加成功：这一套共 ${extraCodes.length + 1} 个编码` : '添加成功！');

      closeModal();
      await this._reloadPlaced(system, beforeIds);   // 自动插到同品牌旁边，再刷新
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
      const beforeIds = this._idSnapshot();
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
      await this._reloadPlaced(system, beforeIds);
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
        // 收集新顺序并保存（套装行带多个编码 → data-pids，普通行只有一个）
        const orderedIds = [];
        Array.from(tbody.querySelectorAll('tr')).forEach(r => {
          const raw = r.dataset.pids || r.dataset.pid || '';
          String(raw).split(',').forEach(s => {
            const n = parseInt(s, 10);
            if (!isNaN(n)) orderedIds.push(n);
          });
        });
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

  // ==================== 🧠 智能整理：同一品牌的商品自动排到一起 ====================
  // 商品名里没有独立的「品牌」字段，只能从名称里认。三层策略：
  //   ① 内置品牌词表（含别名，命中的关键词最长者胜出）—— 日常商品基本都靠这层
  //   ② 词表认不出的：名称开头连续 ≥2 个字相同的互相抱团（一次录入多个新品牌商品时能自动聚起来）
  //   ③ 还认不出的：保持原位置不动
  // ❗只写排序字段 sort_order，不改任何商品数据；整理前顺序记在本地，随时能撤销。
  // ❗单字关键词（如"后"）一律不参与「包含」匹配，否则满屏误伤。
  _brandTable() {
    if (this._brandCache) return this._brandCache;
    this._brandCache = [
      { brand: '海飞丝', keys: ['海飞丝', 'head&shoulders'] },
      { brand: '沙宣', keys: ['沙宣', 'vidalsassoon'] },
      { brand: '潘婷', keys: ['潘婷', 'pantene'] },
      { brand: '欧莱雅', keys: ['欧莱雅', '巴黎欧莱雅', 'loreal'] },
      { brand: '李施德林', keys: ['李施德林', 'listerine'] },
      { brand: '苏菲', keys: ['苏菲', 'sofy'] },
      { brand: '乐而雅', keys: ['乐而雅', 'laurier'] },
      { brand: '护舒宝', keys: ['护舒宝', 'whisper'] },
      { brand: '她研社', keys: ['她研社'] },
      { brand: '淘淘氧棉', keys: ['淘淘氧棉'] },
      { brand: '舒适达', keys: ['舒适达', 'sensodyne'] },
      { brand: '吉列', keys: ['吉列', 'gillette'] },
      { brand: '欧乐B', keys: ['欧乐b', 'oral-b', 'oralb'] },
      { brand: '珂润', keys: ['珂润', 'curel'] },
      { brand: '芙丽芳丝', keys: ['芙丽芳丝', 'freeplus'] },
      { brand: '适乐肤', keys: ['适乐肤', 'cerave'] },
      { brand: '贝德玛', keys: ['贝德玛', 'bioderma'] },
      { brand: '理肤泉', keys: ['理肤泉', 'laroche'] },
      { brand: '依泉', keys: ['依泉', 'uriage'] },
      { brand: '颐莲', keys: ['颐莲'] },
      { brand: '瑷尔博士', keys: ['瑷尔博士', 'dr.alva'] },
      { brand: '芬浓', keys: ['芬浓', 'fino'] },
      { brand: '芭妮兰', keys: ['芭妮兰', 'banila'] },
      { brand: '妮维雅', keys: ['妮维雅', 'nivea'] },
      { brand: '韩束', keys: ['韩束', 'kans'] },
      { brand: '当妮', keys: ['当妮', 'downy'] },
      { brand: '美宝莲', keys: ['美宝莲', 'maybelline'] },
      { brand: 'LaboLabo', keys: ['labolabo', '城野医生', 'dr.ci:labo'] },
      { brand: '拍立得', keys: ['拍立得', 'instax', 'fujifilm', '富士'] },
      { brand: '小米', keys: ['小米', 'xiaomi', '米家', 'mijia', '小爱', 'redmi', 'redml', 'redme', '红米'] },
      { brand: '华为', keys: ['华为', 'huawei'] },
      { brand: '荣耀', keys: ['荣耀', 'honor'] },
      { brand: 'OPPO', keys: ['oppo'] },
      { brand: '罗技', keys: ['罗技', 'logitech', 'gpw'] },
      { brand: '奔富', keys: ['奔富', 'penfolds'] },
      { brand: 'SK-II', keys: ['skii', 'sk-ii', 'sk2', '神仙水'] },
      { brand: '科颜氏', keys: ['科颜氏', 'kiehl'] },
      { brand: '海蓝之谜', keys: ['海蓝之谜', 'lamer'] },
      { brand: '兰蔻', keys: ['兰蔻', 'lancome'] },
      { brand: '资生堂', keys: ['资生堂', 'shiseido'] },
      { brand: '娇韵诗', keys: ['娇韵诗', 'clarins'] },
      { brand: '娇兰', keys: ['娇兰', 'guerlain'] },
      { brand: '欧舒丹', keys: ['欧舒丹', 'loccitane'] },
      { brand: '范思哲', keys: ['范思哲', 'versace'] },
      { brand: '爱马仕', keys: ['hermes', '爱马仕'] },
      { brand: 'CPB', keys: ['cpb', '肌肤之钥'] },
      { brand: 'IPSA', keys: ['ipsa', '茵芙莎'] },
      { brand: 'FANCL', keys: ['fancl', '芳珂'] },
      { brand: '芭比布朗', keys: ['芭比布朗', 'bobbibrown'] },
      { brand: 'Whoo', keys: ['whoo', '水妍', '天气丹', '天率丹'] },
      { brand: '悦木之源', keys: ['悦木之源', 'origins', '菌菇水'] },
    ];
    return this._brandCache;
  },

  // 名称归一：全角转半角、去掉所有空格、转小写（RedMi / Redmi / redmi 视为同一写法）
  _normText(s) {
    return String(s == null ? '' : s).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  },

  // 从商品名里认品牌：所有关键词里命中最长的那个
  _brandOf(name) {
    const n = this._normText(name);
    if (!n) return null;
    let best = null;
    let bestLen = 0;
    for (const g of this._brandTable()) {
      for (const k of g.keys) {
        const kk = this._normText(k);
        if (kk.length < 2) continue;
        if (n.indexOf(kk) >= 0 && kk.length > bestLen) { best = g.brand; bestLen = kk.length; }
      }
    }
    return best;
  },

  // 两个名称开头连续相同的字数（用于词表没收录的新品牌之间互相抱团）
  _commonHeadLen(a, b) {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a.charAt(i) === b.charAt(i)) i++;
    return i;
  },

  // 算「一个类型分组」整理后的新顺序（纯计算，不写库）
  _smartPlanForType(items) {
    const rows = this._buildDisplayRows(items); // 套装先按名称合成一行，与列表显示同口径
    rows.forEach((r, i) => {
      r._i = i;
      r._brand = this._brandOf((r.items[0] || {}).name || r.set_name || '');
    });

    // 词表认不出的：名称开头 ≥2 个字相同的互相抱团（≥2 行才算一团）
    const unknownRows = rows.filter(r => !r._brand);
    const clusters = [];
    unknownRows.forEach(r => {
      const n = this._normText((r.items[0] || {}).name || '');
      let hit = null;
      let hitLen = 1;
      clusters.forEach(c => {
        const l = this._commonHeadLen(n, c.head);
        if (l >= 2 && l > hitLen) { hit = c; hitLen = l; }
      });
      if (hit) hit.rows.push(r);
      else clusters.push({ head: n, rows: [r] });
    });
    clusters.forEach(c => {
      if (c.rows.length < 2) return;
      const label = String((c.rows[0].items[0] || {}).name || '').slice(0, 6);
      c.rows.forEach(r => { r._brand = '≈' + label; });
    });

    // 每个品牌团的「首次出现位置」当主排序键：品牌聚成一团，团与团之间保持原来的大致先后
    const boot = {};
    rows.forEach(r => {
      const k = r._brand || ('~' + r._i);
      if (boot[k] === undefined) boot[k] = r._i;
    });

    const sorted = rows.slice().sort((a, b) => {
      const ka = a._brand || ('~' + a._i);
      const kb = b._brand || ('~' + b._i);
      if (boot[ka] !== boot[kb]) return boot[ka] - boot[kb];
      const ai = a.items[0] || {};
      const bi = b.items[0] || {};
      const na = this._normText(ai.name) + '|' + this._normText(ai.spec);
      const nb = this._normText(bi.name) + '|' + this._normText(bi.spec);
      return na.localeCompare(nb, 'zh-Hans-CN'); // 团内：先名称、再规格
    });

    const brandList = [];
    sorted.forEach(r => {
      const k = r._brand || '（没认出品牌）';
      const last = brandList[brandList.length - 1];
      if (last && last.name === k) { last.count++; return; }
      brandList.push({ name: k, count: 1 });
    });

    const orderedIds = [];
    sorted.forEach(r => (r.items || []).forEach(p => orderedIds.push(p.id)));

    return { rows: sorted, orderedIds, brandList, unknown: unknownRows.length };
  },

  // 全部类型分组的整理方案（按类型分开算 → 每个类型的 sort_order 各自从 1 开始）
  _buildSmartPlan(products) {
    const byType = {};
    const order = [];
    (products || []).forEach(p => {
      const t = p.type || '未分类';
      if (!byType[t]) { byType[t] = []; order.push(t); }
      byType[t].push(p);
    });
    const groups = order.map(t => Object.assign({ type: t }, this._smartPlanForType(byType[t])));
    const rowCount = groups.reduce((s, g) => s + g.rows.length, 0);
    const unknown = groups.reduce((s, g) => s + g.unknown, 0);
    const brandCount = groups.reduce((s, g) => s + g.brandList.length, 0);
    return { groups, rowCount, unknown, brandCount };
  },

  _undoKey(system) { return 'products-smart-undo-' + system; },

  _readUndo(system) {
    try {
      const raw = localStorage.getItem(this._undoKey(system));
      if (!raw) return null;
      const o = JSON.parse(raw);
      return (o && o.groups) ? o : null;
    } catch (e) { return null; }
  },

  _writeUndo(system, groups) {
    try {
      localStorage.setItem(this._undoKey(system), JSON.stringify({ at: this._nowStamp(), groups }));
    } catch (e) { /* 隐私模式写不了就算了，不影响整理本身 */ }
  },

  _clearUndo(system) {
    try { localStorage.removeItem(this._undoKey(system)); } catch (e) { /* ignore */ }
  },

  _nowStamp() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${this._todayStr()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  // 按钮文字随「有没有可撤销的记录」切换
  _refreshSmartBtn(system) {
    const btn = document.getElementById('smart-sort-btn-' + system);
    if (!btn) return;
    const undo = this._readUndo(system);
    if (undo) {
      btn.dataset.act = 'undo';
      btn.textContent = '↩️ 撤销整理';
      btn.title = `还原到 ${undo.at} 整理之前的顺序`;
    } else {
      delete btn.dataset.act;
      btn.textContent = '🧠 智能整理';
      btn.title = '把同一品牌的商品自动排到一起（只调顺序，可撤销）';
    }
  },

  smartSortClick(system) {
    const btn = document.getElementById('smart-sort-btn-' + system);
    if (btn && btn.dataset.act === 'undo') { this.showUndoSmartSort(system); return; }
    this.showSmartSort(system);
  },

  // 先出预览：让用户看清会排成什么样，再决定要不要应用
  showSmartSort(system) {
    const products = this._allProducts || [];
    if (!products.length) { showToast('还没有商品'); return; }
    const plan = this._buildSmartPlan(products);
    this._smartPending = { system, plan };

    const groupsHtml = plan.groups.map(g => `
      <div style="margin-bottom:12px;">
        <div style="font-weight:600;font-size:13px;color:var(--primary);margin-bottom:5px;">
          📁 ${this._esc(g.type)} · ${g.rows.length} 行
          ${g.unknown ? `<span style="color:var(--text-light);font-weight:400;">（其中 ${g.unknown} 项没认出品牌，保持原位）</span>` : ''}
        </div>
        <div style="font-size:12px;color:var(--text-secondary);line-height:2;">
          ${g.brandList.map((b, i) => `<span style="display:inline-block;background:#f5f2fb;border-radius:10px;padding:0 8px;margin:0 4px 4px 0;">${i + 1}. ${this._esc(b.name)}${b.count > 1 ? ' × ' + b.count : ''}</span>`).join('')}
        </div>
      </div>`).join('');

    showModal('🧠 按品牌整理排序');
    const body = document.getElementById('modal-body');
    body.innerHTML = `
      <p style="font-size:13px;color:var(--text-secondary);margin-bottom:10px;line-height:1.7;">
        把<b>同一品牌</b>的商品排到一起（只在各自的「类型」分组内调整），同一品牌里再按名称、规格排列。
        <br/>只改排列顺序，不动任何商品数据。整理前的顺序会先记下来，随时能点「↩️ 撤销整理」还原。
      </p>
      <div style="max-height:44vh;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:10px;background:#fafafa;">
        ${groupsHtml}
      </div>
      <p style="font-size:12px;color:var(--text-light);margin-top:8px;">
        共 ${plan.rowCount} 行 → ${plan.brandCount} 个品牌分组${plan.unknown ? `，另有 ${plan.unknown} 项没认出品牌（留在原位）` : ''}。
      </p>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary btn-lg" onclick="closeModal()">取消</button>
        <button type="button" class="btn btn-primary btn-lg" onclick="ProductsModule.applySmartSort('${system}')">✅ 应用排序</button>
      </div>
    `;
  },

  async applySmartSort(system) {
    const pending = this._smartPending;
    if (!pending || pending.system !== system) { showToast('请重新点「🧠 智能整理」'); return; }
    const plan = pending.plan;

    // 先把整理前的顺序按类型记下来（撤销时按这个还原）
    const before = {};
    (this._allProducts || []).forEach(p => {
      const t = p.type || '未分类';
      (before[t] = before[t] || []).push(p.id);
    });
    this._writeUndo(system, before);

    const btn = document.getElementById('smart-sort-btn-' + system);
    if (btn) { btn.disabled = true; btn.textContent = '整理中…'; }
    try {
      for (const g of plan.groups) {
        if (!g.orderedIds.length) continue;
        await API.post('/api/main/products/reorder', { orderedIds: g.orderedIds });
      }
      this._smartPending = null;
      closeModal();
      await this.loadProducts(system);
      this._refreshSmartBtn(system);
      showToast(`已按品牌整理完成：${plan.rowCount} 行 → ${plan.brandCount} 个品牌分组`);
    } catch (e) {
      // 失败时保留撤销记录：能一键还原回整理前，不至于卡在半路
      showToast('整理保存失败: ' + e.message);
      if (btn) btn.disabled = false;
      this._refreshSmartBtn(system);
    }
  },

  showUndoSmartSort(system) {
    const undo = this._readUndo(system);
    if (!undo) { showToast('没有可撤销的整理记录'); this._refreshSmartBtn(system); return; }
    showModal('↩️ 撤销整理');
    const body = document.getElementById('modal-body');
    body.innerHTML = `
      <p style="font-size:13px;color:var(--text-secondary);line-height:1.7;">
        恢复到 <b>${this._esc(undo.at)}</b> 那次整理之前的排列顺序？
      </p>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary btn-lg" onclick="closeModal()">取消</button>
        <button type="button" class="btn btn-primary btn-lg" onclick="ProductsModule.undoSmartSort('${system}')">↩️ 确认撤销</button>
      </div>
    `;
  },

  async undoSmartSort(system) {
    const undo = this._readUndo(system);
    if (!undo) { showToast('没有可撤销的整理记录'); return; }
    const btn = document.getElementById('smart-sort-btn-' + system);
    if (btn) { btn.disabled = true; btn.textContent = '还原中…'; }
    try {
      for (const [type, ids] of Object.entries(undo.groups || {})) {
        if (!ids || !ids.length) continue;
        await API.post('/api/main/products/reorder', { orderedIds: ids });
      }
      this._clearUndo(system);
      closeModal();
      await this.loadProducts(system);
      this._refreshSmartBtn(system);
      showToast('已还原到整理前的顺序');
    } catch (e) {
      showToast('还原失败: ' + e.message);
      if (btn) btn.disabled = false;
      this._refreshSmartBtn(system);
    }
  },

  // ==================== 新录入的商品自动插到「同品牌旁边」 ====================
  // 上面是「一键整理」；这里是「录完就自动归位」——不用等你想起来点整理。
  // 做法：录入后算一次它在类型内的位置（插到同品牌、名字开头最像的那一行后面），再刷新列表。
  // ❗整套都是新商品的才算「新行」；新编码并进已有套装的行保持原位（否则会把老套装整行挪走）
  // ❗归位只是锦上添花：算不出来 / 写失败都不影响「商品已经录进去」这件事，只留在末尾
  _placeNewRows(items, newSet) {
    const rows = this._buildDisplayRows(items);
    const isNewRow = r => (r.items || []).length > 0 && r.items.every(p => newSet.has(String(p.id)));
    const baseRows = rows.filter(r => !isNewRow(r));
    const newRows = rows.filter(isNewRow);
    // 没有任何老商品（整个类型都是新录的）→ 不用动，原样返回
    if (!newRows.length || !baseRows.length) return { rows, brands: [], loose: 0 };

    const byAnchor = new Map();
    const loose = [];
    newRows.forEach(nr => {
      const a = this._findBrandAnchor(baseRows, nr);
      if (!a) { loose.push(nr); return; }
      if (!byAnchor.has(a)) byAnchor.set(a, []);
      byAnchor.get(a).push(nr);
    });

    const out = [];
    baseRows.forEach(r => {
      out.push(r);
      if (byAnchor.has(r)) byAnchor.get(r).forEach(nr => out.push(nr));
    });
    loose.forEach(nr => out.push(nr));

    // 收集「插到了哪些品牌旁边」，用于给用户一句明确交代（不然他们会以为商品没录进去）
    const brands = [];
    byAnchor.forEach((list, anchor) => {
      const bn = this._brandOf((anchor.items[0] || {}).name || '') || String((anchor.items[0] || {}).name || '').slice(0, 6);
      if (bn && brands.indexOf(bn) < 0) brands.push(bn);
    });
    return { rows: out, brands, loose: loose.length };
  },

  // 在同一类型里找「同品牌、名字开头最像」的那一行；一样像就取靠后的那个（新商品落在品牌团末尾）
  _findBrandAnchor(baseRows, nr) {
    const name = (nr.items[0] || {}).name || nr.set_name || '';
    const brand = this._brandOf(name);
    if (!brand) return null;                      // 认不出品牌 → 老实待在末尾
    const n = this._normText(name);
    let best = null;
    let bestScore = -1;
    baseRows.forEach((r, i) => {
      const rn = (r.items[0] || {}).name || r.set_name || '';
      if (this._brandOf(rn) !== brand) return;
      // 主看「名字开头相同的字数」，一样才比位置 → 保证是品牌团里最后一个
      const score = this._commonHeadLen(n, this._normText(rn)) * 1000 + i;
      if (score > bestScore) { bestScore = score; best = r; }
    });
    return best;
  },

  // 录入前的 id 快照：录入后拿差集就是这次新增的商品（批量导入也能一次全找出来）
  _idSnapshot() {
    return new Set((this._allProducts || []).map(p => String(p.id)));
  },

  // 录入后统一走这里：先归位、再刷新列表（只重绘一次，用户看不到「先跑到最上面又跳回去」）
  async _reloadPlaced(system, beforeIds) {
    // ❗产品列表还没加载过就不猜「哪些是新的」——否则会把表里原有的商品全当成新商品、白重排一遍
    if (!beforeIds || !(this._allProducts || []).length) { await this.loadProducts(system); return; }
    try {
      const data = await API.get('/api/main/products');
      if (!Array.isArray(data)) throw new Error('接口返回的不是商品列表');
      const newIds = new Set(data.filter(p => !beforeIds.has(String(p.id))).map(p => String(p.id)));
      const brandNames = [];
      let loose = 0;
      if (newIds.size) {
        // 只重排「有新增商品」的那些类型，其它类型一动不动
        const byType = {};
        const order = [];
        data.forEach(p => {
          const t = p.type || '未分类';
          if (!byType[t]) { byType[t] = []; order.push(t); }
          byType[t].push(p);
        });
        for (const t of order) {
          const items = byType[t];
          if (!items.some(p => newIds.has(String(p.id)))) continue;
          const plan = this._placeNewRows(items, newIds);
          const ids = [];
          plan.rows.forEach(r => (r.items || []).forEach(p => ids.push(p.id)));
          if (ids.length === items.length) {
            await API.post('/api/main/products/reorder', { orderedIds: ids });
          }
          plan.brands.forEach(b => { if (brandNames.indexOf(b) < 0) brandNames.push(b); });
          loose += plan.loose;
        }
      }
      // 说清楚插到哪了 —— 不然新商品不在列表末尾，用户会以为没录进去
      if (brandNames.length) {
        const head = brandNames.slice(0, 2).join('、');
        showToast(brandNames.length > 2
          ? `已插到同品牌旁边：${head} 等 ${brandNames.length} 个品牌`
          : `已插到「${head}」旁边`);
      } else if (loose) {
        showToast(`已添加 ${loose} 个商品（没认出品牌，加在类型末尾）`);
      }
    } catch (e) {
      // 归位失败不影响录入结果，顺序下次点「🧠 智能整理」也能修回来
      console.warn('新商品自动归位失败：', e);
    }
    await this.loadProducts(system);
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

      // 已经是套装的：把同一套里已有的其它编码列出来（只展示，加新码用下面的输入框）
      // ❗用 _setKeyOf（= 名称）找同套成员，别读 set_name 字段（可能是历史错别字）
      const setName0 = this._setKeyOf(product);
      const siblings = setName0
        ? all.filter(p => this._setKeyOf(p) === setName0 && String(p.id) !== String(product.id))
        : [];
      const siblingsHint = siblings.length
        ? `<div style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;line-height:1.6;">
             这一套现在的编码：<b>${this._esc(product.code)}</b>（本商品）${siblings.map(s => '、' + this._esc(s.code)).join('')}
           </div>`
        : '';

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
          ${this._setBlockHtml('edit', !!this._setKeyOf(product), siblingsHint)}
          <div class="form-actions">
            <button type="submit" class="btn btn-primary btn-lg">保存修改</button>
            <button type="button" class="btn btn-secondary btn-lg" onclick="closeModal()">取消</button>
          </div>
        </form>
      `;

      // 表单里的「其它编码」只表示"这次要加进来的"，已存在的同套编码只做展示
      this._resetSetCodes('edit');
      this._renderSetCodeList('edit');

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
    // 是否套装（归组键 = 商品名称，用户不填套装名）
    const isSet = (document.getElementById('edit-product-is-set')?.value === '1');
    const setName = isSet ? name : '';
    const extraCodes = isSet ? this._setCodesOf('edit').slice() : [];
    // 编码（可修改，后端会级联同步历史记录）
    const codeInput = document.getElementById('edit-product-code');
    const newCode = codeInput ? codeInput.value.trim() : code;

    if (!name) { showToast('请填写物品名称'); return; }
    if (!newCode) { showToast('请填写物品编码'); return; }

    try {
      const body = { code: newCode, name, spec, unit, market_price: marketPrice, type, is_set: isSet, set_name: setName };
      if (bundleQty) body.bundle_qty = bundleQty;
      // 有 ID 则用 ID 更新（精确匹配），否则用 code+type
      const url = id ? `/api/main/products/id/${encodeURIComponent(id)}` : `/api/main/products/${encodeURIComponent(code)}?type=${encodeURIComponent(type)}`;
      await API.put(url, body);
      // 套装：把新加的编码并进这一套（名称跟着本商品走，保证归到同一组）
      for (const c of extraCodes) {
        await this._joinSet(c, name, { name, spec, unit, market_price: marketPrice, type, bundle_qty: bundleQty });
      }
      this._resetSetCodes('edit');
      showToast(newCode !== code ? `修改成功，已同步更新历史记录` : (extraCodes.length ? `修改成功，已加入 ${extraCodes.length} 个编码` : '修改成功'));
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
    const beforeIds = this._idSnapshot();   // 导入完成后统一按品牌归位

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
      await this._reloadPlaced(system, beforeIds);   // 批量导入的也一起插到同品牌旁边
    }
  },

  // ===== 导入行情（2026-10-01）=====
  // 行情表上的商品名跟系统里录的名字对不上 → 算法只给候选，**逐条由人确认**，
  // 确认过的写进别名表，下次同名直接命中、不再问。
  // ❗任何一条都不会自动拍板 —— 就算算法很确定，也要你点一下（用户明确要求过）。
  showPriceImport(system) {
    showModal('导入行情');
    const body = document.getElementById('modal-body');
    const d = new Date();
    const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    body.innerHTML = `
      <div style="padding:8px;max-height:72vh;overflow-y:auto;">
        <p style="color:var(--text-secondary);margin-bottom:10px;font-size:13px;line-height:1.8;">
          把行情表里的「商品名 + 结算价」贴进来，<strong>一行一个</strong>，价格写在行尾。<br/>
          只贴<span style="color:var(--text);">你系统里有的</span>商品，其余的不用管。<br/>
          系统先自动找最像的，<strong>然后一条一条让你确认</strong> —— 确认过的会记住，下次直接对上。
        </p>
        <textarea id="price-import-text" rows="8"
          style="width:100%;padding:10px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:monospace;resize:vertical;box-sizing:border-box;"
          placeholder="奔富407 500&#10;mini相纸10张锡纸 57&#10;小米手环11nc 银 333&#10;富士拍立得mini13国行 香芋紫 605"></textarea>
        <div style="display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap;">
          <label style="font-size:13px;color:var(--text-secondary);">行情生效日</label>
          <input type="date" id="price-import-date" value="${ymd}"
            style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;" />
          <button class="btn btn-primary" onclick="ProductsModule.submitPriceMatch()">开始配对</button>
          <button class="btn btn-secondary" onclick="closeModal()">取消</button>
        </div>
        <div id="price-import-result" style="margin-top:14px;"></div>
      </div>
    `;
    this._priceRows = [];
  },

  // 解析成 [{name, price}]。兼容 tab / 多空格 / ¥ 前缀，
  // 并处理行情表里「黑/银 273/280」这种一行多色多价（拆完仍会逐条让人确认）
  _parsePriceText(text) {
    const COLOR = '黑白蓝绿紫粉灰银金红橙黄棕青';
    const SKIP = /结算价|行情|地址|不代表|报单群|画风|收到货|不包|不退|不换|国补|政府|全系|备注|说明|以上|以下|均价|准成交|品类/;
    const out = [];
    String(text || '').split(/\r?\n/).forEach(line => {
      const s = line.replace(/\u3000/g, ' ').replace(/\|/g, '\t').trim();
      if (!s) return;
      if (SKIP.test(s)) return;
      // 行尾的价格表达式：500 / ¥500 / 255/265（一行多色多价）
      const m = s.match(/(?:^|[\s\t])([¥￥]?\s*\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)*)\s*(?:元|块)?\s*$/);
      if (!m) return;
      // ❗0 是合法价：行情表标「停收」的商品，用户要求**照录、价填 0**（10-05 拍板）
      //   这里只挡「非数字」，不再挡 0；负数/NaN 才丢。
      const prices = m[1].replace(/[¥￥\s]/g, '').split('/').map(Number).filter(n => Number.isFinite(n) && n >= 0);
      if (!prices.length) return;
      const name = s.slice(0, m.index).replace(/\t/g, ' ').replace(/[\s:：\-–—\/]+$/, '').replace(/\s+/g, ' ').trim();
      if (!name) return;
      // 名字里带斜杠（"小米手环10黑/银"）→ 按段拆开，第二段起补回前缀
      if (name.indexOf('/') >= 0) {
        const names = name.split('/').map(x => x.trim()).filter(Boolean);
        // ❗只有「斜杠后面是颜色/型号后缀」才当多色拆（"黑/银"）；
        //   "相纸 -60张/盒" 这种斜杠是量词（每盒一个价），拆了就毁了 → 用单位字挡掉
        const unitTail = names.slice(1).some(x => /[张盒个只瓶包袋支片条件套台克斤升米双对数]|\d|ml|cm|mm|kg/i.test(x));
        if (names.length > 1 && !unitTail && (prices.length === 1 || prices.length === names.length)) {
          let prefix = names[0];
          while (prefix.length && COLOR.indexOf(prefix[prefix.length - 1]) >= 0) prefix = prefix.slice(0, -1);
          names.forEach((n, i) => {
            const nm = i === 0 ? n : (n.length <= 3 ? prefix + n : n);
            const pr = prices.length === 1 ? prices[0] : prices[i];
            if (nm && Number.isFinite(pr) && pr >= 0) out.push({ name: nm, price: pr });
          });
          return;
        }
      }
      if (Number.isFinite(prices[0]) && prices[0] >= 0) out.push({ name, price: prices[0] });
    });
    return out;
  },

  async submitPriceMatch() {
    const ta = document.getElementById('price-import-text');
    const el = document.getElementById('price-import-result');
    const rows = this._parsePriceText(ta ? ta.value : '');
    if (!rows.length) {
      el.innerHTML = '<p style="color:var(--danger);font-size:13px;">没解析到「名字 + 价格」。每行一个，价格写在行尾（500 或 ¥500 都行）。</p>';
      return;
    }
    el.innerHTML = '<p style="font-size:13px;color:var(--text-secondary);">正在配对…</p>';
    try {
      const r = await API.post('/api/main/price-import/match', { rows });
      this._priceRows = (r && r.rows) || [];
      this._priceAll = this._allProducts || [];
      this._renderPriceMatch();
    } catch (e) {
      el.innerHTML = '<p style="color:var(--danger);font-size:13px;">配对失败：' + this._esc(e.message) + '</p>';
    }
  },

  _renderPriceMatch() {
    const el = document.getElementById('price-import-result');
    if (!el) return;
    const rows = this._priceRows || [];
    const hit = rows.filter(r => r.code).length;
    const BADGE = {
      alias:     ['已记住',            '#5f5e5a', '#f1efe8'],
      auto:      ['很可能是这个',      '#0f6e56', '#e1f5ee'],
      likely:    ['应该是这个',        '#185fa5', '#e6f1fb'],
      ambiguous: ['有几个像的，挑一个', '#854f0b', '#faeeda'],
      low:       ['不太确定，你选',    '#a32d2d', '#fcebeb'],
      none:      ['没找到，你选',      '#a32d2d', '#fcebeb']
    };
    let html = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;">
      <span style="font-size:13px;">解析出 <b>${rows.length}</b> 行，<b>${hit}</b> 行有候选</span>
      <button class="btn btn-sm btn-secondary" onclick="ProductsModule._priceCheckAll(true)">全选</button>
      <button class="btn btn-sm btn-secondary" onclick="ProductsModule._priceCheckAll(false)">全不选</button>
    </div>`;
    if (!rows.length) {
      html += '<p style="font-size:13px;color:var(--text-secondary);">没有可确认的行。</p>';
      el.innerHTML = html;
      return;
    }
    rows.forEach(r => {
      const b = BADGE[r.source] || BADGE.none;
      html += `<div style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <input type="checkbox" id="pi-ck-${r.idx}" style="width:16px;height:16px;flex:none;" />
          <span style="font-size:13px;font-weight:500;">${this._esc(r.raw)}</span>
          <span style="font-size:13px;color:var(--text-secondary);">¥${r.price}</span>
          <span style="margin-left:auto;font-size:11px;padding:2px 7px;border-radius:10px;background:${b[2]};color:${b[1]};white-space:nowrap;">${b[0]}</span>
        </div>
        <select id="pi-sel-${r.idx}" style="width:100%;margin-top:6px;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;box-sizing:border-box;">
          ${this._priceOptions(r)}
        </select>
      </div>`;
    });
    html += `<div style="margin-top:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
      <button class="btn btn-primary btn-lg" onclick="ProductsModule.confirmPriceImport()">确认导入勾选的</button>
      <span style="font-size:12px;color:var(--text-light);">没勾选的一律不导入</span>
    </div>`;
    el.innerHTML = html;
  },

  // 下拉：先列算法给的候选（带匹配度），再把全部商品按类型分好，兜底让你自己挑
  _priceOptions(r) {
    const all = this._priceAll || [];
    const seen = {};
    let cand = '';
    (r.candidates || []).forEach(c => {
      seen[c.code] = 1;
      cand += `<option value="${this._esc(c.code)}"${c.code === r.code ? ' selected' : ''}>${this._esc(c.name)}${c.spec ? '（' + this._esc(c.spec) + '）' : ''} · ${(c.score * 100).toFixed(0)}%</option>`;
    });
    if (!cand) {
      // ❗别名命中的行（badge「已记住」）后端只回 code、不回 candidates，
      //   下拉会退化成空 value 的占位项 → 勾了也导不进去。这里把命中的商品
      //   补成一个 selected 项（不然用户看到的是「全选了却没反应」）。
      if (r.code) {
        const p = all.find(x => String(x.code) === String(r.code));
        const nm = r.match_name || (p && p.name) || r.code;
        const sp = r.match_spec || (p && p.spec) || '';
        cand = `<option value="${this._esc(r.code)}" selected>${this._esc(nm)}${sp ? '（' + this._esc(sp) + '）' : ''} · 已记住</option>`;
        seen[r.code] = 1;
      } else {
        cand = '<option value="">（没有候选，从下面选）</option>';
      }
    }
    const groups = {};
    all.forEach(p => { if (!seen[p.code]) (groups[p.type || '其它'] = groups[p.type || '其它'] || []).push(p); });
    let rest = '';
    Object.keys(groups).forEach(t => {
      rest += `<optgroup label="${this._esc(t)}">`;
      groups[t].forEach(p => {
        rest += `<option value="${this._esc(p.code)}">${this._esc(p.name)}${p.spec ? '（' + this._esc(p.spec) + '）' : ''}</option>`;
      });
      rest += '</optgroup>';
    });
    return `<optgroup label="系统猜的">${cand}</optgroup>` + rest;
  },

  _priceCheckAll(v) {
    (this._priceRows || []).forEach(r => {
      const ck = document.getElementById('pi-ck-' + r.idx);
      if (ck) ck.checked = !!v;
    });
  },

  async confirmPriceImport() {
    const dateEl = document.getElementById('price-import-date');
    const date = dateEl ? dateEl.value : '';
    const items = [];
    let noSel = 0;   // 勾了但没选具体商品的行（提醒要说得准，别让人以为勾选没生效）
    (this._priceRows || []).forEach(r => {
      const ck = document.getElementById('pi-ck-' + r.idx);
      const sel = document.getElementById('pi-sel-' + r.idx);
      if (!ck || !ck.checked) return;
      if (!sel || !sel.value) { noSel++; return; }
      items.push({ raw: r.raw, price: r.price, code: sel.value });
    });
    if (!items.length) {
      showToast(noSel ? ('勾选的 ' + noSel + ' 行还没选具体商品，请在每行下面挑一个') : '先勾选要导入的行');
      return;
    }
    const el = document.getElementById('price-import-result');
    el.innerHTML = '<p style="font-size:13px;">正在写入行情…</p>';
    try {
      const res = await API.post('/api/main/price-import/commit', { date, items });
      closeModal();
      await this.loadProducts(this.currentSystem);
      // ❗这条提示要能自解释（2026-10-05 用户问「为什么说只有 1 条对应」）：
      //   saved  = 真正写进行情表的产品数（同一天同一商品再导 = 覆盖，也算 1 条）
      //   aliased= 同时记进「行情名 ↔ 商品」对照表的条数 —— 每写成功一条就记一条，
      //            所以它**天生等于 saved**，不是两个独立指标（别让人误读成"只对了1条"）
      //   生效日必须写出来：用户会把生效日填成表头那天（如 10-04），只报条数会让人
      //   去今天的行情表里翻，翻不到就以为没写进去。
      let msg = '导入完成：写入 ' + res.saved + ' 条行情（生效日 ' + (res.date || date || '') +
        '），同时记住这 ' + res.aliased + ' 个行情名';
      if (res.failed) msg += '，失败 ' + res.failed + ' 条';
      if (noSel) msg += '；另有 ' + noSel + ' 行没选商品，未导入';
      showToast(msg);
    } catch (e) {
      el.innerHTML = '<p style="color:var(--danger);font-size:13px;">写入失败：' + this._esc(e.message) + '</p>';
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
// afterToken（可选）：扫完后自动执行的动作，省掉再点一次按钮
//   'set-product' → 加入「添加物品」表单的套装编码列表
//   'set-edit'    → 加入「编辑物品」表单的套装编码列表
//   'setadd'      → 直接提交「给套装加一个码」弹窗
function triggerBarcodeScan(inputId, afterToken) {
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
    // 套装多码输入：扫完直接加进去，不用再点「＋ 加入」
    const actions = {
      'set-product': () => ProductsModule.addSetCode('product'),
      'set-edit': () => ProductsModule.addSetCode('edit'),
      'setadd': () => ProductsModule.submitAddCodeToSet(),
    };
    if (afterToken && actions[afterToken]) {
      try { actions[afterToken](); return; } catch (e) { console.error('扫码后续动作失败:', e); }
    }
    showToast('已填入编码: ' + code);
  });
}
