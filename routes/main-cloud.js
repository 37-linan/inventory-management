/**
 * 主系统路由 - PostgreSQL 云模式（异步版）
 */
const express = require('express');

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
      const { name, spec, unit, market_price, type, bundle_qty } = req.body;
      await db.query(
        `UPDATE main_products SET name=?, spec=?, unit=?, market_price=?, type=?, bundle_qty=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [name, spec, unit, market_price, type || '', parseInt(bundle_qty) || 1, req.params.id]
      );
      res.json({ success: true });
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

      let totalSale = 0;
      let hasOut = false;   // 是否有商品出库过
      let allOut = true;    // 是否全部出完
      const detail = [];

      for (const item of orderItems) {
        const code = item.product_code;
        const inQty = Number(item.quantity) || 0;
        // 取商品名（用最新一条产品）
        const prodRec = await db.query('SELECT name FROM main_products WHERE code = ? ORDER BY id DESC LIMIT 1', [code]);
        const name = prodRec.rows[0]?.name || code;

        const outSum = await db.query(
          'SELECT COALESCE(SUM(quantity),0) as q FROM main_outbound WHERE product_code = ?',
          [code]
        );
        const outQty = Number(outSum.rows[0].q) || 0;
        if (outQty < inQty) allOut = false;

        const row = { code, name, in_qty: inQty, out_qty: outQty, out_date: '', next_day: '', next_day_price: 0, sale: 0 };

        if (outQty > 0) {
          hasOut = true;
          // 出库行情：
          //  1. 优先：出库日次日(D+1)录的价
          //  2. 次日没录：用出库日当天/之前最近价（即23:30自动沿用的前一天价）
          const lastOut = await db.query(
            'SELECT MAX(created_at) as t FROM main_outbound WHERE product_code = ?',
            [code]
          );
          const outDate = lastOut.rows[0].t ? new Date(lastOut.rows[0].t).toISOString().slice(0, 10) : '';
          row.out_date = outDate;
          let salePrice = 0;
          let usedDate = '';
          if (outDate) {
            // 次日
            const nextDay = new Date(outDate); nextDay.setDate(nextDay.getDate() + 1);
            const nextDayStr = `${nextDay.getFullYear()}-${String(nextDay.getMonth()+1).padStart(2,'0')}-${String(nextDay.getDate()).padStart(2,'0')}`;
            const nextRec = await db.query(
              'SELECT price, to_char(date, \'YYYY-MM-DD\') as d FROM main_price_history WHERE product_code = ? AND date = ?::date LIMIT 1',
              [code, nextDayStr]
            );
            if (nextRec.rows[0]) {
              salePrice = Number(nextRec.rows[0].price);
              usedDate = nextRec.rows[0].d;
            } else {
              // 次日没录：用出库日当天/之前最近价（23:30沿用的前一天价）
              const beforeRec = await db.query(
                'SELECT price, to_char(date, \'YYYY-MM-DD\') as d FROM main_price_history WHERE product_code = ? AND date <= ?::date ORDER BY date DESC LIMIT 1',
                [code, outDate]
              );
              if (beforeRec.rows[0]) {
                salePrice = Number(beforeRec.rows[0].price);
                usedDate = beforeRec.rows[0].d;
              }
            }
            row.next_day = usedDate;
            row.next_day_price = salePrice;
          }
          // 销售额 = 行情价 × 本单该商品的全部数量
          const saleTotal = salePrice * inQty;
          totalSale += saleTotal;
          row.sale = Number(saleTotal.toFixed(2));
        }
        detail.push(row);
      }

      res.json({
        sale_price: Number(totalSale.toFixed(2)),
        cost_price: Number(totalCost.toFixed(2)),
        profit: Number((totalSale - totalCost).toFixed(2)),
        has_out: hasOut,
        has_market: hasOut && totalSale > 0,
        completed: allOut,
        detail
      });
    } catch (e) {
      console.error('[order-profit] 错误:', e.message);
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
               '出库' as type, o.created_at as record_time
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

      // 逐条出库记录：售价（当天/之前最近一次录的价格）× 数量 = 销售额，成本 = FIFO 具体成本
      for (const ob of outbound.rows) {
        const outDate = ob.created_at ? new Date(ob.created_at).toISOString().slice(0, 10) : '';
        if (outDate) {
          const priceRec = await db.query(
            `SELECT price FROM main_price_history 
             WHERE product_code = ? AND date <= ?::date
             ORDER BY date DESC LIMIT 1`,
            [ob.product_code, outDate]
          );
          const salePrice = priceRec.rows[0] ? Number(priceRec.rows[0].price) : 0;
          const totalCost = costByOutId[ob.id] || 0;
          const totalSale = salePrice * Number(ob.quantity || 0);
          ob.sale_price = Number(totalSale.toFixed(2));   // 整单销售额
          ob.cost_price = Number(totalCost.toFixed(2));   // 整单成本（FIFO 具体成本）
          ob.profit = Number((totalSale - totalCost).toFixed(2));
        } else {
          ob.sale_price = 0;
          ob.cost_price = 0;
          ob.profit = 0;
        }
      }

      res.json({ inbound: inbound.rows, outbound: outbound.rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
