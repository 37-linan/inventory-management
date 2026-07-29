const express = require('express');

module.exports = function(db) {
  const router = express.Router();

  // ========== 产品信息管理 ==========

  router.get('/products', (req, res) => {
    try {
      const products = db.prepare('SELECT * FROM main_products ORDER BY type, code').all();
      res.json(products);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/products/:code', (req, res) => {
    try {
      const product = db.prepare('SELECT * FROM main_products WHERE code = ?').get(req.params.code);
      if (!product) return res.status(404).json({ error: '产品不存在' });
      res.json(product);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/products', (req, res) => {
    try {
      const { code, name, spec, unit, market_price, type } = req.body;
      if (!code || !name) return res.status(400).json({ error: '编码和名称为必填项' });
      
      const existing = db.prepare('SELECT id FROM main_products WHERE code = ?').get(code);
      if (existing) return res.status(400).json({ error: '该产品编号已存在' });

      const stmt = db.prepare('INSERT INTO main_products (code, name, spec, unit, market_price, type) VALUES (?, ?, ?, ?, ?, ?)');
      const result = stmt.run(code, name, spec || '', unit || '', market_price || '', type || '');
      
      res.json({ success: true, id: Number(result.lastInsertRowid) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/products/:code', (req, res) => {
    try {
      const { name, spec, unit, market_price, type } = req.body;
      const existing = db.prepare('SELECT id FROM main_products WHERE code = ?').get(req.params.code);
      if (!existing) return res.status(404).json({ error: '产品不存在' });

      db.prepare(`UPDATE main_products SET name=?, spec=?, unit=?, market_price=?, type=?, updated_at=datetime('now','localtime') WHERE code=?`)
        .run(name, spec, unit, market_price, type, req.params.code);
      
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/products/:code', (req, res) => {
    try {
      db.prepare('DELETE FROM main_products WHERE code = ?').run(req.params.code);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 价格历史 ==========

  router.get('/price-history/:productCode', (req, res) => {
    try {
      const records = db.prepare(`
        SELECT * FROM main_price_history 
        WHERE product_code = ? 
        ORDER BY date DESC 
        LIMIT 7
      `).all(req.params.productCode);
      res.json(records);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/price-history/:productCode/latest', (req, res) => {
    try {
      const record = db.prepare(`
        SELECT * FROM main_price_history 
        WHERE product_code = ? 
        ORDER BY date DESC 
        LIMIT 1
      `).get(req.params.productCode);
      res.json(record || { price: 0 });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/price-history', (req, res) => {
    try {
      const { product_code, price } = req.body;
      const today = new Date().toISOString().slice(0, 10);
      
      const existing = db.prepare('SELECT id FROM main_price_history WHERE product_code = ? AND date = ?').get(product_code, today);
      if (existing) {
        db.prepare('UPDATE main_price_history SET price = ? WHERE product_code = ? AND date = ?').run(price, product_code, today);
      } else {
        db.prepare('INSERT INTO main_price_history (product_code, date, price) VALUES (?, ?, ?)').run(product_code, today, price);
      }
      
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 入库管理 ==========

  router.get('/inbound', (req, res) => {
    try {
      const records = db.prepare('SELECT * FROM main_inbound ORDER BY created_at DESC').all();
      res.json(records);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/inbound', (req, res) => {
    try {
      const { product_code, quantity, device, channel, remark, order_no, image_path, purchase_price } = req.body;
      if (!product_code || !quantity) return res.status(400).json({ error: '编码和数量为必填项' });

      const stmt = db.prepare(`
        INSERT INTO main_inbound (product_code, quantity, device, channel, remark, order_no, image_path, purchase_price) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(product_code, quantity, device || '', channel || '', remark || '', order_no || '', image_path || '', purchase_price || 0);
      
      res.json({ success: true, id: Number(result.lastInsertRowid) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/inbound/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM main_inbound WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 出库管理 ==========

  router.get('/outbound', (req, res) => {
    try {
      const records = db.prepare('SELECT * FROM main_outbound ORDER BY created_at DESC').all();
      res.json(records);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/outbound', (req, res) => {
    try {
      const { product_code, quantity, image_path, location } = req.body;
      if (!product_code || !quantity) return res.status(400).json({ error: '编码和数量为必填项' });

      const stmt = db.prepare(`
        INSERT INTO main_outbound (product_code, quantity, image_path, location) 
        VALUES (?, ?, ?, ?)
      `);
      stmt.run(product_code, quantity, image_path || '', location || '');
      
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/outbound/:id', (req, res) => {
    try {
      db.prepare('DELETE FROM main_outbound WHERE id = ?').run(req.params.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 行颜色标记 ==========
  router.patch('/inbound/:id/color', (req, res) => {
    try {
      const { color } = req.body;
      db.prepare('UPDATE main_inbound SET row_color = ? WHERE id = ?').run(color || '', req.params.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.patch('/outbound/:id/color', (req, res) => {
    try {
      const { color } = req.body;
      db.prepare('UPDATE main_outbound SET row_color = ? WHERE id = ?').run(color || '', req.params.id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 库存汇总 ==========

  router.get('/inventory', (req, res) => {
    try {
      const inboundSummary = db.prepare(`
        SELECT product_code, SUM(quantity) as total_in 
        FROM main_inbound 
        GROUP BY product_code
      `).all();

      const outboundSummary = db.prepare(`
        SELECT product_code, SUM(quantity) as total_out 
        FROM main_outbound 
        GROUP BY product_code
      `).all();

      const products = db.prepare('SELECT * FROM main_products').all();

      const inventory = products.map(p => {
        const inbound = inboundSummary.find(i => i.product_code === p.code);
        const outbound = outboundSummary.find(o => o.product_code === p.code);
        const totalIn = inbound ? inbound.total_in : 0;
        const totalOut = outbound ? outbound.total_out : 0;
        return {
          ...p,
          total_in: totalIn,
          total_out: totalOut,
          stock: totalIn - totalOut
        };
      });

      const recentInbound = db.prepare(`
        SELECT i.*, p.name as product_name, p.spec as product_spec, p.unit as product_unit
        FROM main_inbound i 
        LEFT JOIN main_products p ON i.product_code = p.code 
        ORDER BY i.created_at DESC 
        LIMIT 20
      `).all();

      const recentOutbound = db.prepare(`
        SELECT o.*, p.name as product_name, p.spec as product_spec, p.unit as product_unit
        FROM main_outbound o 
        LEFT JOIN main_products p ON o.product_code = p.code 
        ORDER BY o.created_at DESC 
        LIMIT 20
      `).all();

      res.json({ inventory, recentInbound, recentOutbound });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 配置管理 ==========

  router.get('/config/:key', (req, res) => {
    try {
      const cfg = db.prepare('SELECT config_value FROM main_config WHERE config_key = ?').get(req.params.key);
      res.json({ value: cfg ? JSON.parse(cfg.config_value) : [] });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/config/:key', (req, res) => {
    try {
      const { value } = req.body;
      const existing = db.prepare('SELECT id FROM main_config WHERE config_key = ?').get(req.params.key);
      if (existing) {
        db.prepare('UPDATE main_config SET config_value = ? WHERE config_key = ?').run(JSON.stringify(value), req.params.key);
      } else {
        db.prepare('INSERT INTO main_config (config_key, config_value) VALUES (?, ?)').run(req.params.key, JSON.stringify(value));
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 台账 ==========

  router.get('/ledger', (req, res) => {
    try {
      const inbound = db.prepare(`
        SELECT i.*, p.name as product_name, p.spec as product_spec, p.unit as product_unit,
               '入库' as type, i.created_at as record_time
        FROM main_inbound i 
        LEFT JOIN main_products p ON i.product_code = p.code 
        ORDER BY i.created_at DESC
      `).all();

      const outbound = db.prepare(`
        SELECT o.*, p.name as product_name, p.spec as product_spec, p.unit as product_unit,
               '出库' as type, o.created_at as record_time
        FROM main_outbound o 
        LEFT JOIN main_products p ON o.product_code = p.code 
        ORDER BY o.created_at DESC
      `).all();

      // 为每条出库记录计算利润
      // 利润 = 出库日期后一天的价格历史 - 最近一次入库的购买价格
      for (const ob of outbound) {
        const outDate = ob.created_at ? ob.created_at.slice(0, 10) : '';
        if (outDate) {
          const d = new Date(outDate + 'T00:00:00');
          d.setDate(d.getDate() + 1);
          const nextDay = d.toISOString().slice(0, 10);

          // 查出库后一天的价格
          const priceRec = db.prepare(`
            SELECT price FROM main_price_history 
            WHERE product_code = ? AND date = ?
          `).get(ob.product_code, nextDay);

          // 查该商品出库前最近一次入库的购买价格
          const inboundRec = db.prepare(`
            SELECT purchase_price FROM main_inbound 
            WHERE product_code = ? AND created_at <= ?
            ORDER BY created_at DESC LIMIT 1
          `).get(ob.product_code, ob.created_at);

          const salePrice = priceRec ? priceRec.price : 0;
          const costPrice = inboundRec ? (inboundRec.purchase_price || 0) : 0;
          ob.sale_price = salePrice;
          ob.cost_price = costPrice;
          ob.profit = salePrice - costPrice;
        } else {
          ob.sale_price = 0;
          ob.cost_price = 0;
          ob.profit = 0;
        }
      }

      res.json({ inbound, outbound });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
