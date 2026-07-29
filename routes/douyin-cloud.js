/**
 * 抖音刷券系统路由 - PostgreSQL 云模式（异步版）
 */
const express = require('express');

module.exports = function(db) {
  const router = express.Router();

  // ========== 产品信息管理 ==========

  router.get('/products', async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM douyin_products ORDER BY type, code');
      res.json(result.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/products/:code', async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM douyin_products WHERE code = ?', [req.params.code]);
      if (!result.rows[0]) return res.status(404).json({ error: '产品不存在' });
      res.json(result.rows[0]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/products', async (req, res) => {
    try {
      const { code, name, spec, unit, market_price, type } = req.body;
      if (!code || !name) return res.status(400).json({ error: '编码和名称为必填项' });
      
      const existing = await db.query('SELECT id FROM douyin_products WHERE code = ?', [code]);
      if (existing.rows[0]) return res.status(400).json({ error: '该产品编号已存在' });

      await db.query(
        'INSERT INTO douyin_products (code, name, spec, unit, market_price, type) VALUES (?, ?, ?, ?, ?, ?)',
        [code, name, spec || '', unit || '', market_price || '', type || '']
      );
      
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/products/:code', async (req, res) => {
    try {
      const { name, spec, unit, market_price, type } = req.body;
      const existing = await db.query('SELECT id FROM douyin_products WHERE code = ?', [req.params.code]);
      if (!existing.rows[0]) return res.status(404).json({ error: '产品不存在' });

      await db.query(
        `UPDATE douyin_products SET name=?, spec=?, unit=?, market_price=?, type=?, updated_at=CURRENT_TIMESTAMP WHERE code=?`,
        [name, spec, unit, market_price, type, req.params.code]
      );
      
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/products/:code', async (req, res) => {
    try {
      await db.query('DELETE FROM douyin_products WHERE code = ?', [req.params.code]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 价格历史 ==========

  router.get('/price-history/:productCode', async (req, res) => {
    try {
      const result = await db.query(
        'SELECT * FROM douyin_price_history WHERE product_code = ? ORDER BY date DESC LIMIT 7',
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
        'SELECT * FROM douyin_price_history WHERE product_code = ? ORDER BY date DESC LIMIT 1',
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
        'SELECT id FROM douyin_price_history WHERE product_code = ? AND date = ?',
        [product_code, today]
      );
      if (existing.rows[0]) {
        await db.query(
          'UPDATE douyin_price_history SET price = ? WHERE product_code = ? AND date = ?',
          [price, product_code, today]
        );
      } else {
        await db.query(
          'INSERT INTO douyin_price_history (product_code, date, price) VALUES (?, ?, ?)',
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
      const result = await db.query('SELECT * FROM douyin_inbound ORDER BY created_at DESC');
      res.json(result.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/inbound', async (req, res) => {
    try {
      const { product_code, quantity, device, channel, remark, order_no, image_path, purchase_price } = req.body;
      if (!product_code || !quantity) return res.status(400).json({ error: '编码和数量为必填项' });

      await db.query(
        `INSERT INTO douyin_inbound (product_code, quantity, device, channel, remark, order_no, image_path, purchase_price) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [product_code, quantity, device || '', channel || '', remark || '', order_no || '', image_path || '', purchase_price || 0]
      );
      
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/inbound/:id', async (req, res) => {
    try {
      await db.query('DELETE FROM douyin_inbound WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 出库管理 ==========

  router.get('/outbound', async (req, res) => {
    try {
      const result = await db.query('SELECT * FROM douyin_outbound ORDER BY created_at DESC');
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
        'INSERT INTO douyin_outbound (product_code, quantity, image_path, location) VALUES (?, ?, ?, ?)',
        [product_code, quantity, image_path || '', location || '']
      );
      
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/outbound/:id', async (req, res) => {
    try {
      await db.query('DELETE FROM douyin_outbound WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 库存汇总 ==========

  router.get('/inventory', async (req, res) => {
    try {
      const inboundSummary = await db.query(
        'SELECT product_code, SUM(quantity) as total_in FROM douyin_inbound GROUP BY product_code'
      );
      const outboundSummary = await db.query(
        'SELECT product_code, SUM(quantity) as total_out FROM douyin_outbound GROUP BY product_code'
      );
      const products = await db.query('SELECT * FROM douyin_products');

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
        FROM douyin_inbound i 
        LEFT JOIN douyin_products p ON i.product_code = p.code 
        ORDER BY i.created_at DESC LIMIT 20
      `);

      const recentOutbound = await db.query(`
        SELECT o.*, p.name as product_name, p.spec as product_spec, p.unit as product_unit
        FROM douyin_outbound o 
        LEFT JOIN douyin_products p ON o.product_code = p.code 
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
      const result = await db.query('SELECT config_value FROM douyin_config WHERE config_key = ?', [req.params.key]);
      res.json({ value: result.rows[0] ? JSON.parse(result.rows[0].config_value) : [] });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/config/:key', async (req, res) => {
    try {
      const { value } = req.body;
      const existing = await db.query('SELECT id FROM douyin_config WHERE config_key = ?', [req.params.key]);
      if (existing.rows[0]) {
        await db.query('UPDATE douyin_config SET config_value = ? WHERE config_key = ?', [JSON.stringify(value), req.params.key]);
      } else {
        await db.query('INSERT INTO douyin_config (config_key, config_value) VALUES (?, ?)', [req.params.key, JSON.stringify(value)]);
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
        FROM douyin_inbound i 
        LEFT JOIN douyin_products p ON i.product_code = p.code 
        ORDER BY i.created_at DESC
      `);

      const outbound = await db.query(`
        SELECT o.*, p.name as product_name, p.spec as product_spec, p.unit as product_unit,
               '出库' as type, o.created_at as record_time
        FROM douyin_outbound o 
        LEFT JOIN douyin_products p ON o.product_code = p.code 
        ORDER BY o.created_at DESC
      `);

      res.json({ inbound: inbound.rows, outbound: outbound.rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
