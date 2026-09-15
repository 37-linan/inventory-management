/**
 * 主系统路由 - PostgreSQL 云模式（异步版）
 */
const express = require('express');

// ============================================================================
// 出库归属计算（先进先出 FIFO）
// ----------------------------------------------------------------------------
// 背景：main_outbound 只记 product_code，没有和入库单号挂钩，所以系统无法直接
//       知道「哪一单的货出库了」。
//       ❌ 旧实现退化成「这个编码只要出过库，就算这单已出库」——于是 09-14 才入库、
//          而该编码早在 09-06 出过库的单，被误判成「已出库」，凭空算出一笔销售。
// ✅ 口径：同一编码内按入库时间先后排队，出库量从最早批次开始依次消耗（先进先出）。
//          某入库批次被消耗掉 >0，才算「这一单的该商品已出库」。
// 返回：{ [inbound_id]: { out_qty, out_date } }，out_date 取最后消耗它的那次出库日
// ============================================================================
async function computeOutboundAlloc(db) {
  const inRes = await db.query(
    "SELECT id, product_code, quantity, to_char(created_at,'YYYY-MM-DD HH24:MI:SS') AS ts FROM main_inbound ORDER BY product_code ASC, created_at ASC, id ASC"
  );
  const outRes = await db.query(
    "SELECT product_code, quantity, to_char(created_at,'YYYY-MM-DD HH24:MI:SS') AS ts FROM main_outbound ORDER BY product_code ASC, created_at ASC, id ASC"
  );
  const byCode = {};
  inRes.rows.forEach(r => {
    const qty = Number(r.quantity) || 0;
    const g = byCode[r.product_code] || (byCode[r.product_code] = { batches: [], outs: [] });
    g.batches.push({ id: r.id, remain: qty, got: 0, lastTs: '' });
  });
  outRes.rows.forEach(r => {
    const g = byCode[r.product_code];
    if (g) g.outs.push({ qty: Number(r.quantity) || 0, ts: String(r.ts || '') });
  });

  const alloc = {};
  Object.values(byCode).forEach(g => {
    let p = 0;
    g.outs.forEach(o => {
      let q = o.qty;
      while (q > 0 && p < g.batches.length) {
        const b = g.batches[p];
        const take = Math.min(q, b.remain);
        if (take > 0) { b.remain -= take; b.got += take; b.lastTs = o.ts; q -= take; }
        if (b.remain <= 1e-6) p++; else break;
      }
    });
    g.batches.forEach(b => {
      alloc[b.id] = { out_qty: b.got, out_date: b.lastTs ? b.lastTs.slice(0, 10) : '' };
    });
  });
  return alloc;
}

// 全部行情价：{ code: [{d:'YYYY-MM-DD', p:Number}...] }（按日期升序）
async function loadPriceMap(db) {
  const prRes = await db.query(
    "SELECT product_code, to_char(date,'YYYY-MM-DD') AS d, price FROM main_price_history ORDER BY product_code ASC, date ASC"
  );
  const map = {};
  prRes.rows.forEach(p => {
    (map[p.product_code] || (map[p.product_code] = [])).push({ d: p.d, p: Number(p.price) || 0 });
  });
  return map;
}

const pad2 = n => String(n).padStart(2, '0');
function nextDayOf(day) {
  const d = new Date(day + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 服务器「今天」（取数据库时区 Asia/Shanghai，别用 Node 本地时区自己算，容易差一天）
async function todayOf(db) {
  const r = await db.query("SELECT to_char(now(),'YYYY-MM-DD') AS t");
  return r.rows[0].t;
}

// 行情价：① 出库日次日(D+1)优先 ② 次日没录 → 出库日当天/之前最近一天（不往后找）
// 返回 { price, date, fromNextDay } 或 null
function pickMarketPrice(priceMap, code, outDay) {
  if (!outDay) return null;
  const list = priceMap[code] || [];
  if (list.length === 0) return null;
  const nd = nextDayOf(outDay);
  const hit = list.find(x => x.d === nd);
  if (hit) return { price: hit.p, date: hit.d, fromNextDay: true };
  let before = null;
  for (const x of list) { if (x.d <= outDay) before = x; else break; }
  return before ? { price: before.p, date: before.d, fromNextDay: false } : null;
}

module.exports = function(db) {
  const router = express.Router();

  // ========== 产品信息管理 ==========

  router.get('/products', async (req, res) => {
    try {
      // type 参数过滤：主系统传 type=屈臣氏 只显示该类型，抖音系统传 type=抖音刷券
      const typeFilter = req.query.type;
      let sql = 'SELECT * FROM main_products';
      let params = [];
      if (typeFilter) {
        sql += ' WHERE type = ?';
        params.push(typeFilter);
      }
      // 组内按 sort_order 排序（手动调序），其次按 id
      sql += ' ORDER BY type, sort_order, id';
      const result = await db.query(sql, params);
      res.json(result.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 调换产品顺序（同一类型分组内上移/下移）
  router.post('/products/move', async (req, res) => {
    try {
      const { id, direction } = req.body;
      if (!id || !['up', 'down'].includes(direction)) return res.status(400).json({ error: '参数错误' });

      const cur = await db.query('SELECT * FROM main_products WHERE id = ?', [id]);
      if (!cur.rows[0]) return res.status(404).json({ error: '产品不存在' });
      const type = cur.rows[0].type || '未分类';

      // 同类型产品按 sort_order 排序
      const siblings = await db.query(
        'SELECT id, sort_order FROM main_products WHERE COALESCE(type, ?) = ? ORDER BY sort_order, id',
        ['未分类', type]
      );
      const idx = siblings.rows.findIndex(r => Number(r.id) === Number(id));
      const target = direction === 'up' ? idx - 1 : idx + 1;
      if (idx < 0 || target < 0 || target >= siblings.rows.length) {
        return res.json({ success: true, moved: false }); // 已在最前/最后
      }
      const a = siblings.rows[idx];
      const b = siblings.rows[target];
      await db.query('UPDATE main_products SET sort_order = ? WHERE id = ?', [b.sort_order, a.id]);
      await db.query('UPDATE main_products SET sort_order = ? WHERE id = ?', [a.sort_order, b.id]);
      res.json({ success: true, moved: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 拖拽排序：一次性更新整个类型分组的顺序（orderedIds 按新顺序排列）
  router.post('/products/reorder', async (req, res) => {
    try {
      const { orderedIds } = req.body;
      if (!orderedIds || !Array.isArray(orderedIds) || orderedIds.length === 0) {
        return res.status(400).json({ error: '参数错误' });
      }
      for (let i = 0; i < orderedIds.length; i++) {
        await db.query('UPDATE main_products SET sort_order = ? WHERE id = ?', [i + 1, orderedIds[i]]);
      }
      res.json({ success: true, updated: orderedIds.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/products/:code', async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM main_products WHERE code = ?', [req.params.code]);
      if (!result.rows[0]) return res.status(404).json({ error: '产品不存在' });
      res.json(result.rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/products', async (req, res) => {
    try {
      const { code, name, spec, unit, market_price, type, gift_of, bundle_qty } = req.body;
      if (!code || !name) return res.status(400).json({ error: '编码和名称为必填项' });

      // 不做重复检查，同一个编码可在不同类型和不同套餐中重复出现
      const result = await db.query(
        'INSERT INTO main_products (code, name, spec, unit, market_price, type, gift_of, bundle_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
        [code, name, spec || '', unit || '', market_price || '', type || '', gift_of || null, parseInt(bundle_qty) || 1]
      );

      res.json({ success: true, id: result.rows[0].id, gift_of: gift_of || null });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/products/:code', async (req, res) => {
    try {
      const { name, spec, unit, market_price, type, gift_of, bundle_qty } = req.body;
      const existing = await db.query('SELECT id FROM main_products WHERE code = ?', [req.params.code]);
      if (!existing.rows[0]) return res.status(404).json({ error: '产品不存在' });

      // 支持更新 gift_of 字段
      if (gift_of !== undefined) {
        await db.query(
          `UPDATE main_products SET name=?, spec=?, unit=?, market_price=?, type=?, gift_of=?, bundle_qty=?, updated_at=CURRENT_TIMESTAMP WHERE code=?`,
          [name, spec, unit, market_price, type, gift_of || null, parseInt(bundle_qty) || 1, req.params.code]
        );
      } else {
        await db.query(
          `UPDATE main_products SET name=?, spec=?, unit=?, market_price=?, type=?, bundle_qty=?, updated_at=CURRENT_TIMESTAMP WHERE code=?`,
          [name, spec, unit, market_price, type, parseInt(bundle_qty) || 1, req.params.code]
        );
      }
      
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 按 ID 更新产品（精确匹配，同编码不同规格用）
  router.put('/products/id/:id', async (req, res) => {
    try {
      const { name, spec, unit, market_price, type, bundle_qty, code } = req.body;
      // 当前产品编码
      const cur = await db.query('SELECT code FROM main_products WHERE id = ?', [req.params.id]);
      if (!cur.rows[0]) return res.status(404).json({ error: '产品不存在' });
      const oldCode = cur.rows[0].code;

      const newCode = (code !== undefined && code !== null) ? String(code).trim() : oldCode;
      if (!newCode) return res.status(400).json({ error: '编码不能为空' });

      if (newCode !== oldCode) {
        // 新编码不能与其他产品重复（同 code 多行会导致历史数据归属混乱，禁止改重）
        const dup = await db.query('SELECT id FROM main_products WHERE code = ? AND id <> ? LIMIT 1', [newCode, req.params.id]);
        if (dup.rows[0]) return res.status(409).json({ error: '该编码已被其他物品使用，不能改成重复编码' });
        // 级联同步历史：出入库/价格按 code 整体换名（出入库只按 code 关联）
        await db.query('UPDATE main_inbound SET product_code = ? WHERE product_code = ?', [newCode, oldCode]);
        await db.query('UPDATE main_outbound SET product_code = ? WHERE product_code = ?', [newCode, oldCode]);
        await db.query('UPDATE main_price_history SET product_code = ? WHERE product_code = ?', [newCode, oldCode]);
      }

      await db.query(
        `UPDATE main_products SET code=?, name=?, spec=?, unit=?, market_price=?, type=?, bundle_qty=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [newCode, name, spec, unit, market_price, type || '', parseInt(bundle_qty) || 1, req.params.id]
      );
      res.json({ success: true, renamed: newCode !== oldCode });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 按 ID 删除产品（精确匹配）
  router.delete('/products/id/:id', async (req, res) => {
    try {
      const result = await db.query('DELETE FROM main_products WHERE id = ? RETURNING id', [req.params.id]);
      res.json({ success: true, deleted: result.rows.length > 0 });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/products/:code', async (req, res) => {
    try {
      // 支持按 type 过滤删除（同一个编码在不同类型下视为不同产品）
      if (req.query.type) {
        await db.query('DELETE FROM main_products WHERE code = ? AND type = ?', [req.params.code, req.query.type]);
      } else {
        // 没有传 type 时只删一条（随机留一条，避免误删）
        await db.query('DELETE FROM main_products WHERE id = (SELECT id FROM main_products WHERE code = ? LIMIT 1)', [req.params.code]);
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 价格历史（支持按产品 ID 隔离）==========

  router.get('/price-history/:productCode', async (req, res) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    try {
      const pid = req.query.product_id;
      // 注意：to_char(date,'YYYY-MM-DD') 把 DATE 转字符串，避免前端 toISOString() 字符串匹配不上
      const sql = pid
        ? `SELECT id, product_code, product_id, price, to_char(date, 'YYYY-MM-DD') as date, created_at
           FROM main_price_history WHERE product_id = ? ORDER BY date DESC LIMIT 30`
        : `SELECT id, product_code, product_id, price, to_char(date, 'YYYY-MM-DD') as date, created_at
           FROM main_price_history WHERE product_code = ? ORDER BY date DESC LIMIT 30`;
      const params = pid ? [pid] : [req.params.productCode];
      const result = await db.query(sql, params);
      res.json(result.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/price-history/:productCode/latest', async (req, res) => {
    try {
      const pid = req.query.product_id;
      const sql = pid
        ? `SELECT price, to_char(date, 'YYYY-MM-DD') as date FROM main_price_history WHERE product_id = ? ORDER BY date DESC LIMIT 1`
        : `SELECT price, to_char(date, 'YYYY-MM-DD') as date FROM main_price_history WHERE product_code = ? ORDER BY date DESC LIMIT 1`;
      const params = pid ? [pid] : [req.params.productCode];
      const result = await db.query(sql, params);
      res.json(result.rows[0] || { price: 0 });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/price-history', async (req, res) => {
    try {
      const { product_code, price, product_id, date } = req.body;
      // 优先用前端传来的本地日期（避免服务器 UTC 切片造成偏移）
      const today = date || new Date().toISOString().slice(0, 10);
      
      const existing = product_id
        ? await db.query('SELECT id FROM main_price_history WHERE product_id = ? AND date = ?', [product_id, today])
        : await db.query('SELECT id FROM main_price_history WHERE product_code = ? AND date = ?', [product_code, today]);
      if (existing.rows[0]) {
        await db.query(
          'UPDATE main_price_history SET price = ?, product_id = COALESCE(?, product_id) WHERE id = ?',
          [price, product_id || null, existing.rows[0].id]
        );
      } else {
        await db.query(
          'INSERT INTO main_price_history (product_code, price, date, product_id) VALUES (?, ?, ?, ?)',
          [product_code, price, today, product_id || null]
        );
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 入库管理 ==========

  router.get('/inbound', async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM main_inbound ORDER BY created_at DESC');
      res.json(result.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/inbound', async (req, res) => {
    try {
      const { product_code, quantity, device, channel, remark, order_no, image_path, purchase_price } = req.body;
      if (!product_code || !quantity) return res.status(400).json({ error: '编码和数量为必填项' });

      const result = await db.query(
        `INSERT INTO main_inbound (product_code, quantity, device, channel, remark, order_no, image_path, purchase_price) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [product_code, quantity, device || '', channel || '', remark || '', order_no || '', image_path || '', purchase_price || 0]
      );
      
      res.json({ success: true, id: result.rows[0].id });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/inbound/:id', async (req, res) => {
    try {
      await db.query('DELETE FROM main_inbound WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 行内编辑：修改单条入库记录的数量 / 渠道 / 价格（只更新传进来的字段）
  router.patch('/inbound/:id', async (req, res) => {
    try {
      const { quantity, channel, purchase_price } = req.body;
      const sets = [];
      const params = [];

      if (quantity !== undefined) {
        const q = parseFloat(quantity);
        if (!q || q <= 0) return res.status(400).json({ error: '数量必须大于 0' });
        sets.push('quantity = ?'); params.push(q);
      }
      if (channel !== undefined) {
        sets.push('channel = ?'); params.push(channel || '');
      }
      if (purchase_price !== undefined) {
        const p = parseFloat(purchase_price);
        if (isNaN(p) || p < 0) return res.status(400).json({ error: '价格不能为负数' });
        sets.push('purchase_price = ?'); params.push(p);
      }

      if (sets.length === 0) return res.status(400).json({ error: '没有需要修改的内容' });

      params.push(req.params.id);
      await db.query(`UPDATE main_inbound SET ${sets.join(', ')} WHERE id = ?`, params);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 出库管理 ==========

  router.get('/outbound', async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM main_outbound ORDER BY created_at DESC');
      res.json(result.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/outbound', async (req, res) => {
    try {
      const { product_code, quantity, image_path, location, order_no } = req.body;
      if (!product_code || !quantity) return res.status(400).json({ error: '编码和数量为必填项' });

      await db.query(
        'INSERT INTO main_outbound (product_code, quantity, image_path, location, order_no) VALUES (?, ?, ?, ?, ?)',
        [product_code, quantity, image_path || '', location || '', order_no || '']
      );
      
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 批量补录出库订单号（选择多条出库记录，补同一个订单号）
  router.patch('/outbound/batch-order', async (req, res) => {
    try {
      const { ids, order_no } = req.body;
      if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '请选择出库记录' });
      if (!order_no) return res.status(400).json({ error: '请填写订单号' });

      const placeholders = ids.map(() => '?').join(',');
      await db.query(
        `UPDATE main_outbound SET order_no = ? WHERE id IN (${placeholders})`,
        [order_no, ...ids]
      );
      res.json({ success: true, updated: ids.length });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/outbound/:id', async (req, res) => {
    try {
      await db.query('DELETE FROM main_outbound WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 行颜色标记 ==========
  router.patch('/inbound/:id/color', async (req, res) => {
    try {
      const { color } = req.body;
      await db.query('UPDATE main_inbound SET row_color = ? WHERE id = ?', [color || '', req.params.id]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.patch('/outbound/:id/color', async (req, res) => {
    try {
      const { color } = req.body;
      await db.query('UPDATE main_outbound SET row_color = ? WHERE id = ?', [color || '', req.params.id]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 库存汇总 ==========

  router.get('/inventory', async (req, res) => {
    try {
      const inboundSummary = await db.query(
        'SELECT product_code, SUM(quantity) as total_in FROM main_inbound GROUP BY product_code'
      );
      const outboundSummary = await db.query(
        'SELECT product_code, SUM(quantity) as total_out FROM main_outbound GROUP BY product_code'
      );
      const products = await db.query('SELECT * FROM main_products');

      const inventory = products.rows.map(p => {
        const inbound = inboundSummary.rows.find(i => i.product_code === p.code);
        const outbound = outboundSummary.rows.find(o => o.product_code === p.code);
        const totalIn = inbound ? Number(inbound.total_in) : 0;
        const totalOut = outbound ? Number(outbound.total_out) : 0;
        const bundleQty = parseInt(p.bundle_qty) || 1;
        const stock = totalIn - totalOut;
        return {
          ...p,
          bundle_qty: bundleQty,
          total_in: totalIn,
          total_out: totalOut,
          stock: stock,
          actual_stock: p.type === '抖音刷券' ? stock * bundleQty : stock
        };
      });

      const recentInbound = await db.query(`
        SELECT i.*,
               (SELECT name FROM main_products p WHERE p.code = i.product_code ORDER BY p.id DESC LIMIT 1) as product_name,
               (SELECT spec FROM main_products p WHERE p.code = i.product_code ORDER BY p.id DESC LIMIT 1) as product_spec,
               (SELECT unit FROM main_products p WHERE p.code = i.product_code ORDER BY p.id DESC LIMIT 1) as product_unit
        FROM main_inbound i 
        ORDER BY i.created_at DESC LIMIT 20
      `);

      const recentOutbound = await db.query(`
        SELECT o.*,
               (SELECT name FROM main_products p WHERE p.code = o.product_code ORDER BY p.id DESC LIMIT 1) as product_name,
               (SELECT spec FROM main_products p WHERE p.code = o.product_code ORDER BY p.id DESC LIMIT 1) as product_spec,
               (SELECT unit FROM main_products p WHERE p.code = o.product_code ORDER BY p.id DESC LIMIT 1) as product_unit
        FROM main_outbound o 
        ORDER BY o.created_at DESC LIMIT 20
      `);

      res.json({ inventory, recentInbound: recentInbound.rows, recentOutbound: recentOutbound.rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 配置管理 ==========

  router.get('/config/:key', async (req, res) => {
    try {
      const result = await db.query('SELECT config_value FROM main_config WHERE config_key = ?', [req.params.key]);
      res.json({ value: result.rows[0] ? JSON.parse(result.rows[0].config_value) : [] });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/config/:key', async (req, res) => {
    try {
      const { value } = req.body;
      const existing = await db.query('SELECT id FROM main_config WHERE config_key = ?', [req.params.key]);
      if (existing.rows[0]) {
        await db.query('UPDATE main_config SET config_value = ? WHERE config_key = ?', [JSON.stringify(value), req.params.key]);
      } else {
        await db.query('INSERT INTO main_config (config_key, config_value) VALUES (?, ?)', [req.params.key, JSON.stringify(value)]);
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 单利润汇总（按入库单号）==========
  // 规则：
  //  1. 成本 = 整单金额（首个商品填的 purchase_price），不随出库变化
  //  2. 销售额 = 商品出库后最早录的行情价 × 该商品在本单的数量（有出库记录才计）
  //  3. 出完即锁定：公式只用"出库后最早行情"这个固定值，天然不会再变
  router.get('/order-profit', async (req, res) => {
    try {
      const orderNo = req.query.orderNo;
      if (!orderNo) return res.json({ profit: 0, sale_price: 0, cost_price: 0, has_out: false, has_market: false, completed: false, detail: [] });

      const orderInRes = await db.query(
        'SELECT * FROM main_inbound WHERE order_no = ? ORDER BY id ASC',
        [orderNo]
      );
      const orderItems = orderInRes.rows;
      if (orderItems.length === 0) return res.json({ profit: 0, sale_price: 0, cost_price: 0, has_out: false, has_market: false, completed: false, detail: [] });

      // 成本 = 整单金额（首个商品填的），始终显示
      const totalCost = Number(orderItems[0].purchase_price) || 0;

      // 出库归属（FIFO）+ 行情表 + 商品名，一次性取出，避免在循环里 N 次查库
      const alloc = await computeOutboundAlloc(db);
      const priceMap = await loadPriceMap(db);
      const today = await todayOf(db);
      const nameRes = await db.query('SELECT code, name FROM main_products ORDER BY id ASC');
      const nameMap = {};
      nameRes.rows.forEach(r => { nameMap[r.code] = r.name; });   // 后者覆盖前者 = 取最新一条

      let totalSale = 0;
      let hasOut = false;   // 本单是否有商品出库过
      let allOut = true;    // 本单是否全部出完
      const detail = [];

      for (const item of orderItems) {
        const code = item.product_code;
        const inQty = Number(item.quantity) || 0;

        // 本单这一条入库记录，按 FIFO 实际被出库消耗掉多少
        const a = alloc[item.id] || { out_qty: 0, out_date: '' };
        const outQty = Number(a.out_qty) || 0;
        const outDate = a.out_date || '';
        if (outQty < inQty) allOut = false;

        const row = {
          code, name: nameMap[code] || code,
          in_qty: inQty, out_qty: outQty,
          out_date: outDate,
          next_day: outDate ? nextDayOf(outDate) : '',   // 字面次日（出库日+1）
          price_date: '',                                 // 行情价实际取自哪一天
          next_day_price: 0,
          sale: 0,
          // 出库日次日还没到（今天才出库）→ 现在用的价只是暂计，
          // 明天录了次日价会自动改用次日价重算，前端提示「待次日行情」
          await_price: false
        };
        // 只有真的出库了、且次日还没到来，才算「等次日行情」
        row.await_price = !!(outQty > 0 && row.next_day && row.next_day > today);

        if (outQty > 0) {
          hasOut = true;
          const mp = pickMarketPrice(priceMap, code, outDate);
          const salePrice = mp ? mp.price : 0;
          if (mp) row.price_date = mp.date;
          row.next_day_price = salePrice;
          // 销售额 = 行情价 × 本单该商品的全部数量
          const saleTotal = salePrice * inQty;
          totalSale += saleTotal;
          row.sale = Number(saleTotal.toFixed(2));
        }
        detail.push(row);
      }

      const awaitRows = detail.filter(r => r.await_price);

      res.json({
        sale_price: Number(totalSale.toFixed(2)),
        cost_price: Number(totalCost.toFixed(2)),
        profit: Number((totalSale - totalCost).toFixed(2)),
        has_out: hasOut,
        has_market: hasOut && totalSale > 0,
        completed: allOut,
        await_price: awaitRows.length > 0,               // 本单是否在「等次日行情」
        await_count: awaitRows.length,
        await_date: awaitRows[0] ? awaitRows[0].next_day : '',   // 等的是哪一天
        today,
        detail
      });
    } catch (e) {
      console.error('[order-profit] 错误:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 盈亏仪表盘 ==========

  // 口径（2026-09-14 与用户确认定稿）：
  //   1. 只统计「已出库」的单号（本单有商品出过库）——未出库的单不参与，等出库后自动进榜
  //   2. 成本 = 该单第一条商品的 purchase_price（整单金额），与 order-profit 完全一致
  //   3. 收益 = Σ 各商品（行情价 × 入库数量），行情价 = 出库日次日价，没录则取出库日当天/之前最近价
  //   4. 走势图按「出库日期」归到自然周（周一起）
  router.get('/dashboard', async (req, res) => {
    try {
      const inRes = await db.query(
        "SELECT id, order_no, product_code, quantity, purchase_price, COALESCE(NULLIF(device,''),'') AS device FROM main_inbound ORDER BY id ASC"
      );

      // 出库归属：按编码「先进先出」分配到具体入库批次（详见文件顶部 computeOutboundAlloc）
      // ——本单是否出库，取决于「本单这批货」有没有被出库消耗，而不是「这个编码有没有出过库」
      const alloc = await computeOutboundAlloc(db);
      const priceMap = await loadPriceMap(db);
      const today = await todayOf(db);

      const pad = n => String(n).padStart(2, '0');

      // 按单号聚合
      const orders = {};
      inRes.rows.forEach(r => {
        const key = r.order_no || '（无单号）';
        (orders[key] || (orders[key] = [])).push(r);
      });

      let invest = 0, revenue = 0, pendingInvest = 0, pendingCount = 0, outCount = 0, awaitCount = 0, awaitRevenue = 0;
      const weekMap = {};
      const devMap = {};
      const orderList = [];

      Object.keys(orders).forEach(orderNo => {
        const items = orders[orderNo];
        const cost = Number(items[0].purchase_price) || 0;   // 整单金额：取首商品
        // 下单设备/下级：单内一般一致，取本单首个填了值的商品
        const devItem = items.find(x => String(x.device || '').trim() !== '');
        const device = devItem ? String(devItem.device).trim() : '';
        let sale = 0, hasOut = false, lastDay = '', awaitFlag = false;

        items.forEach(it => {
          const a = alloc[it.id];
          if (!a || !(a.out_qty > 0)) return;   // 本单这条没被出库消耗 → 不算
          hasOut = true;
          if (a.out_date > lastDay) lastDay = a.out_date;
          // 出库日次日还没到（今天才出库）→ 这一单的收益只是暂计，明天录价后会自动重算
          if (a.out_date && nextDayOf(a.out_date) > today) awaitFlag = true;
          const mp = pickMarketPrice(priceMap, it.product_code, a.out_date);
          if (mp) sale += mp.price * (Number(it.quantity) || 0);
        });

        if (!hasOut) { pendingInvest += cost; pendingCount++; return; }

        sale = Number(sale.toFixed(2));
        const profit = Number((sale - cost).toFixed(2));
        invest += cost;
        revenue += sale;
        outCount++;
        if (awaitFlag) { awaitCount++; awaitRevenue += sale; }
        orderList.push({ order_no: orderNo, cost, sale, profit, out_date: lastDay || '', device, await_price: awaitFlag });

        // 按下单设备/下级汇总（只统计已出库单，与「总投入」口径一致）
        const devKey = device || '（未填）';
        const dv = devMap[devKey] || (devMap[devKey] = { device: devKey, invest: 0, revenue: 0, profit: 0, orders: 0 });
        dv.invest += cost; dv.revenue += sale; dv.profit += profit; dv.orders++;

        // 归到自然周（周一为一周起点）
        const d = new Date((lastDay || '1970-01-01') + 'T00:00:00');
        d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        const wk = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const w = weekMap[wk] || (weekMap[wk] = { week_start: wk, profit: 0, revenue: 0, cost: 0, orders: 0 });
        w.profit += profit; w.revenue += sale; w.cost += cost; w.orders++;
      });

      invest = Number(invest.toFixed(2));
      revenue = Number(revenue.toFixed(2));
      const profit = Number((revenue - invest).toFixed(2));

      let acc = 0;
      const weekly = Object.keys(weekMap).sort().map(k => {
        const w = weekMap[k];
        acc = Number((acc + w.profit).toFixed(2));
        return {
          week_start: w.week_start,
          profit: Number(w.profit.toFixed(2)),
          revenue: Number(w.revenue.toFixed(2)),
          cost: Number(w.cost.toFixed(2)),
          orders: w.orders,
          cumulative: acc
        };
      });

      // 按下单设备/下级汇总，投入降序
      const byDevice = Object.keys(devMap).map(k => {
        const d = devMap[k];
        d.invest = Number(d.invest.toFixed(2));
        d.revenue = Number(d.revenue.toFixed(2));
        d.profit = Number(d.profit.toFixed(2));
        return d;
      }).sort((a, b) => b.invest - a.invest);

      res.json({
        success: true,
        totals: {
          invest,
          revenue,
          profit,
          rate: invest > 0 ? Number((profit / invest * 100).toFixed(1)) : 0,
          order_count: outCount,
          pending_count: pendingCount,
          pending_invest: Number(pendingInvest.toFixed(2)),
          // 其中「今天出库、出库次日行情还没到」的单：收益只是暂计，明天录价后自动重算
          await_count: awaitCount,
          await_revenue: Number(awaitRevenue.toFixed(2))
        },
        weekly,
        by_device: byDevice,
        orders: orderList
      });
    } catch (e) {
      console.error('[dashboard] 错误:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 台账 ==========

  router.get('/ledger', async (req, res) => {
    try {
      // 用 DISTINCT ON 取每个 code 唯一一条产品（最新创建的那条），避免同 code 多产品错配
      const inbound = await db.query(`
        SELECT i.*,
               (SELECT name FROM main_products p WHERE p.code = i.product_code ORDER BY p.id DESC LIMIT 1) as product_name,
               (SELECT spec FROM main_products p WHERE p.code = i.product_code ORDER BY p.id DESC LIMIT 1) as product_spec,
               (SELECT unit FROM main_products p WHERE p.code = i.product_code ORDER BY p.id DESC LIMIT 1) as product_unit,
               (SELECT type FROM main_products p WHERE p.code = i.product_code ORDER BY p.id DESC LIMIT 1) as product_type,
               (SELECT bundle_qty FROM main_products p WHERE p.code = i.product_code ORDER BY p.id DESC LIMIT 1) as bundle_qty,
               '入库' as type, i.created_at as record_time
        FROM main_inbound i 
        ORDER BY i.created_at DESC
      `);

      const outbound = await db.query(`
        SELECT o.*,
               (SELECT name FROM main_products p WHERE p.code = o.product_code ORDER BY p.id DESC LIMIT 1) as product_name,
               (SELECT spec FROM main_products p WHERE p.code = o.product_code ORDER BY p.id DESC LIMIT 1) as product_spec,
               (SELECT unit FROM main_products p WHERE p.code = o.product_code ORDER BY p.id DESC LIMIT 1) as product_unit,
               (SELECT type FROM main_products p WHERE p.code = o.product_code ORDER BY p.id DESC LIMIT 1) as product_type,
               (SELECT bundle_qty FROM main_products p WHERE p.code = o.product_code ORDER BY p.id DESC LIMIT 1) as bundle_qty,
               '出库' as type, o.created_at as record_time,
               to_char(o.created_at,'YYYY-MM-DD') as out_day
        FROM main_outbound o 
        ORDER BY o.created_at DESC
      `);

      // ========== 利润计算（FIFO 先进先出）==========
      // 规则：整单金额（首个商品填的 purchase_price）是该入库单的总成本；
      //       按该单所有商品数量分摊出"单位成本"，FIFO 消耗时 单位成本 × 出库数量
      //       收入 = 信息表单价（price_history 最新价）× 出库数量
      const costByOutId = {};
      try {
        // 1. 按 order_no 聚合所有入库单，算每单的总数量与整单金额 → 单位分摊成本
        const allIns = await db.query('SELECT * FROM main_inbound ORDER BY created_at ASC, id ASC');
        const insGroups = {};
        allIns.rows.forEach(r => {
          const key = r.order_no || ('__no_order_' + r.id);
          if (!insGroups[key]) insGroups[key] = [];
          insGroups[key].push(r);
        });
        const orderInfo = {}; // key -> { unitPrice }
        Object.entries(insGroups).forEach(([key, items]) => {
          const totalQty = items.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
          // 整单金额 = 本单第一个商品（id 最小）填的金额
          const firstItem = [...items].sort((a, b) => a.id - b.id)[0];
          const orderTotal = Number(firstItem.purchase_price) || 0;
          orderInfo[key] = {
            unitPrice: totalQty > 0 ? orderTotal / totalQty : 0
          };
        });

        // 2. 每个商品做 FIFO：入库批次成本用"整单分摊单位成本"
        const outCodes = await db.query('SELECT DISTINCT product_code FROM main_outbound');
        for (const { product_code } of outCodes.rows) {
          const ins = await db.query(
            'SELECT * FROM main_inbound WHERE product_code = ? ORDER BY created_at ASC, id ASC',
            [product_code]
          );
          const outs = await db.query(
            'SELECT * FROM main_outbound WHERE product_code = ? ORDER BY created_at ASC, id ASC',
            [product_code]
          );
          // FIFO 队列：按入库时间排，先入库先消耗
          const queue = ins.rows.map(r => {
            const key = r.order_no || ('__no_order_' + r.id);
            const info = orderInfo[key] || { unitPrice: 0 };
            return { qty: Number(r.quantity) || 0, price: info.unitPrice };
          });
          for (const ob of outs.rows) {
            let remaining = Number(ob.quantity) || 0;
            let totalCost = 0;
            while (remaining > 0 && queue.length > 0) {
              const batch = queue[0];
              const take = Math.min(remaining, batch.qty);
              totalCost += take * batch.price;
              batch.qty -= take;
              remaining -= take;
              if (batch.qty <= 0) queue.shift();
            }
            costByOutId[ob.id] = totalCost;
          }
        }
      } catch (e) {
        console.error('FIFO 成本计算失败:', e.message);
      }

      // 逐条出库记录：售价 × 数量 = 销售额，成本 = FIFO 具体成本
      // ⚠️ 取价口径必须与「单利润 / 盈亏总览」完全一致（2026-09-15 对齐）：
      //    出库次日(D+1)优先，次日没录 → 出库日当天/之前最近一天，不往后找
      //    这里不能写成 date <= 出库日，否则出库当天录了次日价时对不上
      const priceMap = await loadPriceMap(db);
      for (const ob of outbound.rows) {
        const outDate = ob.out_day || '';
        if (outDate) {
          const mp = pickMarketPrice(priceMap, ob.product_code, outDate);
          const salePrice = mp ? mp.price : 0;
          const totalCost = costByOutId[ob.id] || 0;
          const totalSale = salePrice * Number(ob.quantity || 0);
          ob.sale_price = Number(totalSale.toFixed(2));   // 整单销售额
          ob.cost_price = Number(totalCost.toFixed(2));   // 整单成本（FIFO 具体成本）
          ob.profit = Number((totalSale - totalCost).toFixed(2));
          ob.price_date = mp ? mp.date : '';              // 行情价实际取自哪一天
        } else {
          ob.sale_price = 0;
          ob.cost_price = 0;
          ob.profit = 0;
          ob.price_date = '';
        }
      }

      res.json({ inbound: inbound.rows, outbound: outbound.rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
