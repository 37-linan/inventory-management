// 实时行情价格波形图模块（7天滚动）
const PriceChart = {
  charts: {},

  // 渲染单个产品的价格波形图
  async render(canvasId, system, productCode, containerWidth) {
    try {
      const priceHistory = await API.get(`/api/${system}/price-history/${productCode}`);
      const latest = await API.get(`/api/${system}/price-history/${productCode}/latest`);
      
      // 生成7天日期序列
      const dates = [];
      const prices = [];
      const today = new Date();
      
      for (let i = 6; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const dateLabel = `${d.getMonth() + 1}/${d.getDate()}`;
        dates.push(dateLabel);
        
        const record = priceHistory.find(r => r.date === dateStr);
        prices.push(record ? record.price : null);
      }

      // 如果没有Chart.js库，用纯SVG绘制
      return this._drawSVG(canvasId, dates, prices, latest.price);
    } catch (e) {
      console.error('图表渲染失败:', e);
      return `<div style="color:var(--text-secondary);font-size:12px;text-align:center;padding:10px;">暂无价格数据</div>`;
    }
  },

  _drawSVG(canvasId, dates, prices, latestPrice) {
    const width = 600;
    const height = 180;
    const padding = { top: 20, right: 20, bottom: 30, left: 50 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const validPrices = prices.filter(p => p !== null);
    const minPrice = validPrices.length > 0 ? Math.min(...validPrices) * 0.9 : 0;
    const maxPrice = validPrices.length > 0 ? Math.max(...validPrices) * 1.1 : 100;
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
        dots += `<text x="${p.x.toFixed(1)}" y="${(p.y - 8).toFixed(1)}" text-anchor="middle" font-size="10" fill="#1a73e8" font-weight="500">${p.val.toFixed(2)}</text>`;
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

  // 放大显示行情图（弹窗）
  async showLarge(system, productCode) {
    showModal('行情走势 - 点击空白关闭');
    const container = document.getElementById('modal-body');
    container.innerHTML = '<div style="text-align:center;padding:20px;"><p>加载中...</p></div>';
    
    try {
      const priceHistory = await API.get(`/api/${system}/price-history/${productCode}`);
      const latest = await API.get(`/api/${system}/price-history/${productCode}/latest`);
      const product = await API.get(`/api/${system}/products`);
      const prod = product.find(p => p.code === productCode);
      
      // 生成30天价格数据
      const dates = [];
      const prices = [];
      const today = new Date();
      
      for (let i = 29; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const dateLabel = `${d.getMonth() + 1}/${d.getDate()}`;
        dates.push(dateLabel);
        const record = priceHistory.find(r => r.date === dateStr);
        prices.push(record ? record.price : null);
      }

      // 大尺寸SVG
      const width = 900;
      const height = 360;
      const padding = { top: 30, right: 30, bottom: 40, left: 60 };
      const chartW = width - padding.left - padding.right;
      const chartH = height - padding.top - padding.bottom;

      const validPrices = prices.filter(p => p !== null);
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

      // 折线
      const points = prices.map((p, i) => {
        const x = getX(i);
        const y = getY(p);
        return { x, y, val: p };
      });

      const validPoints = points.filter(p => p.y !== null);
      let linePath = '';
      if (validPoints.length > 0) {
        linePath = validPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
        // 填充区域
        const lastY = validPoints[validPoints.length - 1].y;
        const firstY = validPoints[0].y;
        linePath += ` L ${validPoints[validPoints.length - 1].x.toFixed(1)} ${height} L ${validPoints[0].x.toFixed(1)} ${height} Z`;
      }

      let dots = '';
      points.forEach((p, i) => {
        if (p.y !== null) {
          dots += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="#1a73e8" stroke="#fff" stroke-width="2" />`;
          if (i === points.length - 1 || (i === 0)) {
            dots += `<text x="${p.x.toFixed(1)}" y="${(p.y - 12).toFixed(1)}" text-anchor="middle" font-size="12" fill="#1a73e8" font-weight="600">${p.val.toFixed(2)}</text>`;
          }
        }
      });

      container.innerHTML = `
        <div style="padding:8px;">
          <div style="margin-bottom:12px;text-align:center;">
            <strong style="font-size:16px;">${prod ? prod.name : productCode}</strong>
            <span style="margin-left:8px;font-size:12px;color:var(--text-secondary);">编码: ${productCode}</span>
            ${latest && latest.price ? `<span style="margin-left:8px;font-size:14px;color:var(--primary);font-weight:600;">最新: ¥${latest.price}</span>` : ''}
          </div>
          <svg viewBox="0 0 ${width} ${height}" style="width:100%;max-height:70vh;" xmlns="http://www.w3.org/2000/svg">
            ${gridLines}
            ${axisLabels}
            <path d="${linePath}" fill="#1a73e8" fill-opacity="0.05" stroke="#1a73e8" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
            ${dots}
          </svg>
          <p style="text-align:center;color:var(--text-light);font-size:11px;margin-top:8px;">近30天价格走势</p>
        </div>
      `;
    } catch (e) {
      container.innerHTML = `<div style="text-align:center;padding:30px;color:var(--danger);">加载失败: ${e.message}</div>`;
    }
  }
};
