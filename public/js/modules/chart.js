// 实时行情价格波形图模块（7天滚动）
const PriceChart = {
  charts: {},

  // 缺失日期自动沿用最近一次价格
  // 规则：每天23:30前今天的缺失不沿用（让用户补录），23:30后自动沿用最近价格
  _fillMissingPrices(prices, dateStrs, todayStr, priceHistory) {
    // 从 priceHistory 中找窗口开始日期之前最近的价（last 初值）
    let last = null;
    if (priceHistory && priceHistory.length > 0 && dateStrs.length > 0) {
      const earliestDate = dateStrs[0];
      const earlier = priceHistory
        .filter(p => p && p.date < earliestDate)
        .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
      if (earlier && !isNaN(parseFloat(earlier.price))) last = parseFloat(earlier.price);
    }
    // 是否已过今天 23:30（过了则今天的缺失也沿用）
    const now = new Date();
    const pastDeadline = now.getHours() > 23 || (now.getHours() === 23 && now.getMinutes() >= 30);

    return prices.map((p, i) => {
      if (p !== null && !isNaN(parseFloat(p))) {
        last = parseFloat(p);
        return last;
      }
      // 今天的缺失：23:30 前不沿用（保持空，等用户补录），23:30 后沿用
      if (dateStrs[i] === todayStr) {
        return pastDeadline ? last : null;
      }
      // 过去的缺失：沿用最近一次的价格
      return last;
    });
  },

  // 本地日期串（避免服务器 UTC 时区造成的日期偏移）
  _fmtLocalDate(d) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  },

  // 取最近 days 天的价格序列：缺失日期沿用最近一次价格（今天的缺失 23:30 前不沿用，留空等补录）
  _seriesFromHistory(priceHistory, days) {
    const list = priceHistory || [];
    const dates = [];
    const dateStrs = [];
    const prices = [];
    const today = new Date();
    const todayStr = this._fmtLocalDate(today);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = this._fmtLocalDate(d);
      dates.push(`${d.getMonth() + 1}/${d.getDate()}`);
      dateStrs.push(dateStr);
      const record = list.find(r => r.date === dateStr);
      prices.push(record ? record.price : null);
    }
    return { dates, prices: this._fillMissingPrices(prices, dateStrs, todayStr, list) };
  },

  // 渲染单个产品的价格波形图
  async render(canvasId, system, productCode, containerWidth, productId) {
    try {
      const pid = productId ? `?product_id=${productId}` : '';
      const priceHistory = await API.get(`/api/main/price-history/${productCode}${pid}`);
      const s = this._seriesFromHistory(priceHistory, 7);
      return this._drawSVG(canvasId, s.dates, s.prices, 0);
    } catch (e) {
      console.error('图表渲染失败:', e);
      return `<div style="color:var(--text-secondary);font-size:11px;text-align:center;padding:8px;">-</div>`;
    }
  },

  // ---------- 套装：整套只有一个行情价，把各编码的行情合并成一条 ----------
  // members: [{ code, id }] 同一套的几个编码（它们在库里录的是同一个套价）
  async fetchSetHistory(members) {
    const byDate = {};
    for (const m of (members || [])) {
      try {
        const h = await API.get(`/api/main/price-history/${m.code}?product_id=${m.id}`);
        (h || []).forEach(r => {
          if (!r || !r.date) return;
          const v = parseFloat(r.price);
          if (isNaN(v)) return;
          if (byDate[r.date] === undefined) byDate[r.date] = v;
        });
      } catch (e) { /* 单个编码取不到不影响整行 */ }
    }
    return Object.keys(byDate).sort().map(d => ({ date: d, price: byDate[d] }));
  },

  // 套装行的小图：整行只画一个（用户只填一套价，没必要按编码分开出现行情图）
  async renderSet(canvasId, members) {
    try {
      const history = await this.fetchSetHistory(members);
      const s = this._seriesFromHistory(history, 7);
      return this._drawSVG(canvasId, s.dates, s.prices, 0);
    } catch (e) {
      console.error('套装行情图渲染失败:', e);
      return `<div style="color:var(--text-secondary);font-size:11px;text-align:center;padding:8px;">-</div>`;
    }
  },

  _drawSVG(canvasId, dates, prices, latestPrice) {
    const width = 600;
    const height = 180;
    const padding = { top: 20, right: 20, bottom: 30, left: 50 };

    const validPrices = prices.filter(p => p !== null && !isNaN(parseFloat(p)));

    // 无价格数据时显示占位，避免空白
    if (validPrices.length === 0) {
      return `<div style="display:flex;align-items:center;justify-content:center;height:180px;color:var(--text-light);font-size:12px;">暂无价格数据</div>`;
    }

    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;
    // 统一转为数字
    const numericPrices = validPrices.map(v => parseFloat(v));
    let minPrice = Math.min(...numericPrices);
    let maxPrice = Math.max(...numericPrices);
    // 单点时给 ±10% 缓冲
    if (minPrice === maxPrice) {
      minPrice = minPrice * 0.9;
      maxPrice = maxPrice * 1.1;
    } else {
      minPrice = minPrice * 0.9;
      maxPrice = maxPrice * 1.1;
    }
    const priceRange = maxPrice - minPrice || 1;

    const getX = (i) => padding.left + (i / (dates.length - 1)) * chartW;
    const getY = (v) => v !== null ? padding.top + chartH - ((v - minPrice) / priceRange) * chartH : null;

    // 网格线
    let gridLines = '';
    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
      const y = padding.top + (i / gridCount) * chartH;
      const price = maxPrice - (i / gridCount) * priceRange;
      gridLines += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#e5e7eb" stroke-width="1" />`;
      gridLines += `<text x="${padding.left - 5}" y="${y + 4}" text-anchor="end" font-size="10" fill="#9ca3af">${price.toFixed(2)}</text>`;
    }

    // 日期轴
    let axisLabels = '';
    dates.forEach((d, i) => {
      const x = getX(i);
      axisLabels += `<text x="${x}" y="${height - 5}" text-anchor="middle" font-size="10" fill="#9ca3af">${d}</text>`;
    });

    // 折线
    let linePath = '';
    const points = prices.map((p, i) => {
      const x = getX(i);
      const y = getY(p);
      return { x, y, val: p };
    });

    const validPoints = points.filter(p => p.y !== null);
    if (validPoints.length > 0) {
      linePath = validPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    }

    // 数据点
    let dots = '';
    points.forEach((p, i) => {
      if (p.y !== null) {
        dots += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="#1a73e8" stroke="#fff" stroke-width="2" />`;
        dots += `<text x="${p.x.toFixed(1)}" y="${(p.y - 8).toFixed(1)}" text-anchor="middle" font-size="10" fill="#1a73e8" font-weight="500">${parseFloat(p.val).toFixed(2)}</text>`;
      }
    });

    const svg = `
      <svg viewBox="0 0 ${width} ${height}" style="width:100%;max-width:${width}px;height:${height}px;" xmlns="http://www.w3.org/2000/svg">
        ${gridLines}
        ${axisLabels}
        <path d="${linePath}" fill="none" stroke="#1a73e8" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
        <path d="${linePath}" fill="none" stroke="#1a73e8" stroke-width="6" stroke-linejoin="round" stroke-linecap="round" opacity="0.1" />
        ${dots}
      </svg>
    `;

    return svg;
  },

  // 大图（15天）的 SVG
  _buildLargeSvg(dates, prices) {
    const width = 900;
    const height = 360;
    const padding = { top: 30, right: 30, bottom: 40, left: 60 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const validPrices = prices.filter(p => p !== null && !isNaN(parseFloat(p)));
    const minPrice = validPrices.length > 0 ? Math.min(...validPrices) * 0.85 : 0;
    const maxPrice = validPrices.length > 0 ? Math.max(...validPrices) * 1.15 : 100;
    const priceRange = maxPrice - minPrice || 1;

    const getX = (i) => padding.left + (i / (dates.length - 1)) * chartW;
    const getY = (v) => v !== null ? padding.top + chartH - ((v - minPrice) / priceRange) * chartH : null;

    // 网格线
    let gridLines = '';
    const gridCount = 5;
    for (let i = 0; i <= gridCount; i++) {
      const y = padding.top + (i / gridCount) * chartH;
      const price = maxPrice - (i / gridCount) * priceRange;
      gridLines += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#e5e7eb" stroke-width="1" />`;
      gridLines += `<text x="${padding.left - 8}" y="${y + 5}" text-anchor="end" font-size="12" fill="#6b7280">${price.toFixed(2)}</text>`;
    }

    // 日期轴（每隔几天显示一个）
    let axisLabels = '';
    const step = Math.max(1, Math.floor(dates.length / 10));
    dates.forEach((d, i) => {
      if (i % step === 0 || i === dates.length - 1) {
        const x = getX(i);
        axisLabels += `<text x="${x}" y="${height - 10}" text-anchor="middle" font-size="11" fill="#6b7280">${d}</text>`;
      }
    });

    // 折线 + 填充区域
    const points = prices.map((p, i) => ({ x: getX(i), y: getY(p), val: p }));
    const validPoints = points.filter(p => p.y !== null);
    let linePath = '';
    if (validPoints.length > 0) {
      linePath = validPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      linePath += ` L ${validPoints[validPoints.length - 1].x.toFixed(1)} ${height} L ${validPoints[0].x.toFixed(1)} ${height} Z`;
    }

    let dots = '';
    points.forEach((p, i) => {
      if (p.y !== null) {
        dots += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="#1a73e8" stroke="#fff" stroke-width="2" />`;
        if (i === points.length - 1 || i === 0) {
          dots += `<text x="${p.x.toFixed(1)}" y="${(p.y - 12).toFixed(1)}" text-anchor="middle" font-size="12" fill="#1a73e8" font-weight="600">${parseFloat(p.val).toFixed(2)}</text>`;
        }
      }
    });

    return `
          <svg viewBox="0 0 ${width} ${height}" style="width:100%;max-height:70vh;" xmlns="http://www.w3.org/2000/svg">
            ${gridLines}
            ${axisLabels}
            <path d="${linePath}" fill="#1a73e8" fill-opacity="0.05" stroke="#1a73e8" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
            ${dots}
          </svg>`;
  },

  // 放大弹窗的外壳（单品 / 整套共用）
  _largeHtml({ title, sub, latestPrice, svg, editBtn }) {
    return `
        <div style="padding:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;">
            <span style="font-size:12px;color:var(--text-secondary);">点击右侧按钮可修改任意某天价格</span>
            ${editBtn}
          </div>
          <div style="margin-bottom:12px;text-align:center;">
            <strong style="font-size:16px;">${title}</strong>
            <span style="margin-left:8px;font-size:12px;color:var(--text-secondary);">${sub}</span>
            ${latestPrice ? `<span style="margin-left:8px;font-size:14px;color:var(--primary);font-weight:600;">最新: ¥${latestPrice}</span>` : ''}
          </div>
          ${svg}
          <p style="text-align:center;color:var(--text-light);font-size:11px;margin-top:8px;">近15天价格走势</p>
        </div>`;
  },

  // 放大显示行情图（弹窗）
  async showLarge(system, productCode, productId) {
    this._currentSystem = system;
    this._editMembers = null;        // 单品：只改这一个编码
    showModal('行情走势 - 点击空白关闭');
    const container = document.getElementById('modal-body');
    container.innerHTML = '<div style="text-align:center;padding:20px;"><p>加载中...</p></div>';

    try {
      const pid = productId ? `?product_id=${productId}` : '';
      const priceHistory = await API.get(`/api/main/price-history/${productCode}${pid}`);
      const latest = await API.get(`/api/${system}/price-history/${productCode}/latest`);
      const product = await API.get(`/api/${system}/products`);
      const prod = (product || []).find(p => p.code === productCode);
      const s = this._seriesFromHistory(priceHistory, 15);

      container.innerHTML = this._largeHtml({
        title: prod ? prod.name : productCode,
        sub: `编码: ${productCode}`,
        latestPrice: latest && latest.price ? latest.price : '',
        svg: this._buildLargeSvg(s.dates, s.prices),
        editBtn: `<button class="btn btn-sm btn-primary" onclick="PriceChart._openPriceEditModal('${productCode}', ${productId || 'null'})">✏️ 修改行情</button>`
      });
    } catch (e) {
      container.innerHTML = `<div style="text-align:center;padding:30px;color:var(--danger);">加载失败: ${e.message}</div>`;
    }
  },

  // 放大显示「整套」行情：同一套的几个编码合并成一条线（它们录的是同一个套价）
  async showLargeSet(system, members) {
    this._currentSystem = system;
    this._editMembers = members || [];   // 改价时整套一起改，避免各码价不一致
    showModal('行情走势 - 整套 - 点击空白关闭');
    const container = document.getElementById('modal-body');
    container.innerHTML = '<div style="text-align:center;padding:20px;"><p>加载中...</p></div>';

    try {
      const history = await this.fetchSetHistory(members);
      const s = this._seriesFromHistory(history, 15);
      const lead = (members && members[0]) || {};
      const nums = s.prices.filter(p => p !== null && !isNaN(parseFloat(p)));
      container.innerHTML = this._largeHtml({
        title: lead.name || '整套',
        sub: `整套 ${(members || []).length} 个编码: ${(members || []).map(m => m.code).join(' + ')}`,
        latestPrice: nums.length ? parseFloat(nums[nums.length - 1]) : '',
        svg: this._buildLargeSvg(s.dates, s.prices),
        editBtn: `<button class="btn btn-sm btn-primary" onclick="PriceChart._openPriceEditModal('${lead.code || ''}', ${lead.id || 'null'})">✏️ 修改整套行情</button>`
      });
    } catch (e) {
      container.innerHTML = `<div style="text-align:center;padding:30px;color:var(--danger);">加载失败: ${e.message}</div>`;
    }
  },

  // 打开"修改某日行情"弹窗
  _openPriceEditModal(productCode, productId) {
    const sys = this._currentSystem || 'main';
    showModal('✏️ 修改行情价格');
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const todayStr = fmt(now);
    const minDate = (() => { const m = new Date(now); m.setDate(m.getDate() - 14); return fmt(m); })();
    const maxDate = (() => { const m = new Date(now); m.setDate(m.getDate() + 30); return fmt(m); })();
    document.getElementById('modal-body').innerHTML = `
      <div style="padding:8px;">
        <p style="color:var(--text-secondary);font-size:13px;margin-bottom:16px;">选择要修改的日期，输入新价格（保存后立即生效，利润自动按新价重算）</p>
        <div class="form-group" style="margin-bottom:12px;">
          <label>选择日期</label>
          <input type="date" id="edit-price-date" value="${todayStr}" min="${minDate}" max="${maxDate}" style="width:100%;padding:10px;font-size:16px;" />
        </div>
        <div class="form-group" style="margin-bottom:16px;">
          <label>新价格 (¥)</label>
          <input type="number" id="edit-price-value" step="0.01" min="0" style="width:100%;padding:10px;font-size:18px;text-align:center;" placeholder="请输入新价格" autofocus />
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary" onclick="closeModal()" style="flex:1;">取消</button>
          <button class="btn btn-primary" onclick="PriceChart._savePriceEdit('${productCode}', ${productId || 'null'}, '${sys}')" style="flex:1;">💾 保存</button>
        </div>
      </div>
    `;
    setTimeout(() => document.getElementById('edit-price-value')?.focus(), 100);
  },

  // 保存修改的某日价格（套装：整套一起写，保证"一套一个价"）
  async _savePriceEdit(productCode, productId, system) {
    const date = document.getElementById('edit-price-date').value;
    const priceInput = document.getElementById('edit-price-value');
    const price = parseFloat(priceInput.value);
    if (!date) { showToast('请选择日期'); return; }
    if (isNaN(price) || price < 0) { showToast('请输入有效价格'); priceInput.focus(); return; }
    try {
      const members = (this._editMembers && this._editMembers.length)
        ? this._editMembers
        : [{ code: productCode, id: productId }];
      for (const m of members) {
        const body = { product_code: m.code, price, date };
        if (m.id) body.product_id = parseInt(m.id);
        await API.post('/api/main/price-history', body);
      }
      showToast(members.length > 1
        ? `已更新 ${date} 整套价格：¥${price.toFixed(2)}（${members.length} 个编码）`
        : `已更新 ${date} 的价格：¥${price.toFixed(2)}`);
      closeModal();
      if (members.length > 1) await this.showLargeSet(system, members);
      else await this.showLarge(system, productCode, productId);
    } catch (e) {
      showToast('保存失败：' + e.message);
    }
  }
};
