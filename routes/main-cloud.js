/**
 * 主系统路由 - PostgreSQL 云模式（异步版）
 */
const express = require('express');

module.exports = function(db) {
  const router = express.Router();

  // ========== 产品信息管理 ==========

  router.get('/products', async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM main_products ORDER BY type, code');
      res.json(result.rows);
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
      const { code, name, spec, unit, market_price, type, gift_of } = req.body;
      if (!code || !name) return res.status(400).json({ error: '编码和名称为必填项' });
      
      const existing = await db.query('SELECT id FROM main_products WHERE code = ?', [code]);
      if (existing.rows[0]) return res.status(400).json({ error: '该产品编号已存在' });

      const result = await db.query(
        'INSERT INTO main_products (code, name, spec, unit, market_price, type, gift_of) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
        [code, name, spec || '', unit || '', market_price || '', type || '', gift_of || null]
      );
      
      res.json({ success: true, id: result.rows[0].id, gift_of: gift_of || null });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/products/:code', async (req, res) => {
    try {
      const { name, spec, unit, market_price, type, gift_of } = req.body;
      const existing = await db.query('SELECT id FROM main_products WHERE code = ?', [req.params.code]);
      if (!existing.rows[0]) return res.status(404).json({ error: '产品不存在' });

      // 支持更新 gift_of 字段
      if (gift_of !== undefined) {
        await db.query(
          `UPDATE main_products SET name=?, spec=?, unit=?, market_price=?, type=?, gift_of=?, updated_at=CURRENT_TIMESTAMP WHERE code=?`,
          [name, spec, unit, market_price, type, gift_of || null, req.params.code]
        );
      } else {
        await db.query(
          `UPDATE main_products SET name=?, spec=?, unit=?, market_price=?, type=?, updated_at=CURRENT_TIMESTAMP WHERE code=?`,
          [name, spec, unit, market_price, type, req.params.code]
        );
      }
      
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/products/:code', async (req, res) => {
    try {
      await db.query('DELETE FROM main_products WHERE code = ?', [req.params.code]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 价格历史 ==========

  router.get('/price-history/:productCode', async (req, res) => {
    try {
      const result = await db.query(
        'SELECT * FROM main_price_history WHERE product_code = ? ORDER BY date DESC LIMIT 7',
        [req.params.productCode]
      );
      res.json(result.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/price-history/:productCode/latest', async (req, res) => {
    try {
      const result = await db.query(
        'SELECT * FROM main_price_history WHERE product_code = ? ORDER BY date DESC LIMIT 1',
        [req.params.productCode]
      );
      res.json(result.rows[0] || { price: 0 });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/price-history', async (req, res) => {
    try {
      const { product_code, price } = req.body;
      const today = new Date().toISOString().slice(0, 10);
      
      const existing = await db.query(
        'SELECT id FROM main_price_history WHERE product_code = ? AND date = ?',
        [product_code, today]
      );
      if (existing.rows[0]) {
        await db.query(
          'UPDATE main_price_history SET price = ? WHERE product_code = ? AND date = ?',
          [price, product_code, today]
        );
      } else {
        await db.query(
          'INSERT INTO main_price_history (product_code, date, price) VALUES (?, ?, ?)',
          [product_code, today, price]
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
      const { product_code, quantity, image_path, location } = req.body;
      if (!product_code || !quantity) return res.status(400).json({ error: '编码和数量为必填项' });

      await db.query(
        'INSERT INTO main_outbound (product_code, quantity, image_path, location) VALUES (?, ?, ?, ?)',
        [product_code, quantity, image_path || '', location || '']
      );
      
      res.json({ success: true });
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
        return {
          ...p,
          total_in: totalIn,
          total_out: totalOut,
          stock: totalIn - totalOut
        };
      });

      const recentInbound = await db.query(`
        SELECT i.*, p.name as product_name, p.spec as product_spec, p.unit as product_unit
        FROM main_inbound i 
        LEFT JOIN main_products p ON i.product_code = p.code 
        ORDER BY i.created_at DESC LIMIT 20
      `);

      const recentOutbound = await db.query(`
        SELECT o.*, p.name as product_name, p.spec as product_spec, p.unit as product_unit
        FROM main_outbound o 
        LEFT JOIN main_products p ON o.product_code = p.code 
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

  // ========== 台账 ==========

  router.get('/ledger', async (req, res) => {
    try {
      const inbound = await db.query(`
        SELECT i.*, p.name as product_name, p.spec as product_spec, p.unit as product_unit,
               '入库' as type, i.created_at as record_time
        FROM main_inbound i 
        LEFT JOIN main_products p ON i.product_code = p.code 
        ORDER BY i.created_at DESC
      `);

      const outbound = await db.query(`
        SELECT o.*, p.name as product_name, p.spec as product_spec, p.unit as product_unit,
               '出库' as type, o.created_at as record_time
        FROM main_outbound o 
        LEFT JOIN main_products p ON o.product_code = p.code 
        ORDER BY o.created_at DESC
      `);

      // 利润计算
      for (const ob of outbound.rows) {
        const outDate = ob.created_at ? new Date(ob.created_at).toISOString().slice(0, 10) : '';
        if (outDate) {
          const d = new Date(outDate + 'T00:00:00');
          d.setDate(d.getDate() + 1);
          const nextDay = d.toISOString().slice(0, 10);

          const priceRec = await db.query(
            'SELECT price FROM main_price_history WHERE product_code = ? AND date = ?',
            [ob.product_code, nextDay]
          );

          const inboundRec = await db.query(
            `SELECT purchase_price FROM main_inbound 
             WHERE product_code = ? AND created_at <= ?::timestamp
             ORDER BY created_at DESC LIMIT 1`,
            [ob.product_code, ob.created_at]
          );

          const salePrice = priceRec.rows[0] ? Number(priceRec.rows[0].price) : 0;
          const costPrice = inboundRec.rows[0] ? Number(inboundRec.rows[0].purchase_price || 0) : 0;
          ob.sale_price = salePrice;
          ob.cost_price = costPrice;
          ob.profit = salePrice - costPrice;
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
