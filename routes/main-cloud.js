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
    // ❗排序必须「日期升序 + 同一天按录入时间升序」：同一天可能被录入多次（改价），
    //   取价时统一取「同一天最后录入的那条」（最新的才是生效价）。否则同日多行的返回
    //   顺序由 PG 自己决定，而 pickMarketPrice 里「找次日用 find（取首条）、往前回退用
    //   遍历（取末条）」会取到不同的行 → 同一天多录一次，取价结果就不确定了。
    "SELECT product_code, to_char(date,'YYYY-MM-DD') AS d, price FROM main_price_history ORDER BY product_code ASC, date ASC, created_at ASC, id ASC"
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
// 语义说明（和用户对齐过的规则）：
//   用户规则 = 「哪天没录行情，就沿用前一天的价格」→ 某天的有效价 = 往前找最近一次录入的价。
//   出库的取价日恒为「出库日次日」(D+1)；D+1 那天没单独录，就沿用它之前最近一次录入的价。
//   所以：`date` 是「价实际来自行情表的哪一天」，而 D+1（逻辑取价日）由调用方用
//   nextDayOf(outDay) 给出 —— 明细里应当把「取价日 = D+1」作为主口径展示，
//   「沿用自哪天」只作附注，避免看着像"系统取了出库当天的价"。
// list 已按「日期升序、同日按录入时间升序」排好 → 同一天的最后一条就是最新生效价。
function pickMarketPrice(priceMap, code, outDay) {
  if (!outDay) return null;
  const list = priceMap[code] || [];
  if (list.length === 0) return null;
  const nd = nextDayOf(outDay);
  let hit = null, before = null;
  for (const x of list) {
    if (x.d === nd) hit = x;              // 次日有录 → 用次日（同日多行取最后一条）
    else if (x.d < nd) before = x;        // x.d <= outDay：往前回退，取最近一次
    else break;                           // x.d > nd：之后录的价不参与（不往后找）
  }
  if (hit) return { price: hit.p, date: nd, fromNextDay: true };
  return before ? { price: before.p, date: before.d, fromNextDay: false } : null;
}

// ============================================================================
// 套装（2026-09-23）
// ----------------------------------------------------------------------------
// 场景：一个套装由多个「不同编码」的商品组成（如 A、B 两个条码），它们在商品表里
//       各自一条记录，但属于同一套；名称/规格/单位/行情/类型相同。
//       入库时这些编码会被分别扫到，同一张单里因此出现多条记录（这是正常的，别去重）。
// 归组键：**商品名称**（2026-09-23 晚起用户不再手填套装名；2026-09-24 起一律按名称归组，
//       由 `setKeyOfProduct` 统一计算 —— ❗不再直接读 set_name 字段，那个字段只是名称的副本，
//       历史数据里可能残留手打错别字（Whoo水姸/Whoo水妍），按它归组会把同一套拆成两行、
//       利润还会算成两倍。改名称时整套一起改名：`syncSetMembersRename`）。
//       前端商品列表也按同名套装合并成一行显示。
// 口径：一整套只对应一个行情价（每个组成商品都录同一个价，系统只取一次），
//       套数 = 组内「第一个编码」的数量合计，销售额 = 套价 × 套数。
//       ❌ 不能按「每个编码各自的行情价 × 数量」相加 —— 那样一套会被算成 N 倍。
//       出库：组内有任一条出库，即视为这一套已出库（出库日取组内第一条有出库日的）。
// ============================================================================
let setColsReady = null;
function ensureSetColumns(db) {
  if (!setColsReady) {
    setColsReady = db.query("ALTER TABLE main_products ADD COLUMN IF NOT EXISTS is_set BOOLEAN NOT NULL DEFAULT FALSE")
      .then(() => db.query("ALTER TABLE main_products ADD COLUMN IF NOT EXISTS set_name VARCHAR(100) DEFAULT NULL"))
      // 归一化历史数据：set_name 只是「归组键的副本」，永远 = 商品名称。
      // ❗踩过的坑（2026-09-24）：早期让用户手填套装名，留下了错别字（Whoo水姸 / Whoo水妍 差一字），
      //   只要归组还读 set_name，同一套就会被拆成两行、利润还会算成两倍 → 这里一次性抹平
      .then(() => db.query(
        "UPDATE main_products SET set_name = btrim(coalesce(name,'')) " +
        "WHERE coalesce(set_name,'') <> btrim(coalesce(name,'')) " +
        "AND (is_set = true OR (set_name IS NOT NULL AND set_name <> ''))"
      ))
      .catch(e => { setColsReady = null; throw e; });   // 失败允许下次重试
  }
  return setColsReady;
}

// 套装归组键 = **商品名称**（用户不手填套装名，见文件顶部说明）
// ❗一律不信任 set_name 字段本身：只要标记了套装就按名称归组，
//   这样即使库里残留历史错别字，同一套也不会被拆开（利润更不会重复计）
function setKeyOfProduct(p) {
  if (!p) return '';
  const flagged = p.is_set === true || p.is_set === 'true' || p.is_set === 't' || p.is_set === 1 || p.is_set === '1';
  const nm = String(p.name || '').trim();
  const sn = String(p.set_name || '').trim();
  if (!flagged && !sn) return '';
  return nm || sn;
}

// { code: 归组键(商品名称) }，同 code 多条取最后一条（与 /order-profit 里 nameMap 口径一致）
async function loadSetNameMap(db) {
  const r = await db.query('SELECT code, name, is_set, set_name FROM main_products ORDER BY id ASC');
  const map = {};
  r.rows.forEach(x => { const k = setKeyOfProduct(x); if (k) map[x.code] = k; });
  return map;
}

// 把一张单内的入库记录按套装归组（组内按 id 升序；普通商品自成一组）
// 返回 [{ set_name, isSet, items: [...] }]
function groupItemsBySet(items, setMap) {
  const groups = [];
  const pos = {};
  (items || []).slice().sort((a, b) => a.id - b.id).forEach(it => {
    const sn = setMap[it.product_code] || '';
    if (!sn) { groups.push({ set_name: '', isSet: false, items: [it] }); return; }
    if (pos[sn] === undefined) { pos[sn] = groups.length; groups.push({ set_name: sn, isSet: true, items: [it] }); }
    else groups[pos[sn]].items.push(it);
  });
  return groups;
}

// 一个套装组的「套数」= 组内第一个编码的数量合计（同编码出现多条时相加）
function setUnitsOf(group) {
  const firstCode = group.items[0].product_code;
  return group.items
    .filter(x => x.product_code === firstCode)
    .reduce((s, x) => s + (Number(x.quantity) || 0), 0);
}

// 改了套装里任一商品的名称 → 把这一套**原来的成员一起改名**。
// 名称就是归组键，不一起改的话同一套会被拆成两组（详见文件顶部套装说明）。
// ❗name 必须跟着改：以前只改写 set_name 就够了，现在归组读的是 name
// ❗`sync_rename: false` 时不做（「加码」把某个已有编码并进来时只改它自己，
//   否则会把它原先同名的那批商品一起拖进这一套）
async function syncSetMembersRename(db, id, newName, oldHint) {
  const nm = String(newName || '').trim();
  if (!nm) return;
  const cur = await db.query('SELECT name, is_set, set_name FROM main_products WHERE id = ?', [id]);
  const row = cur.rows[0];
  if (!row) return;
  const oldKey = setKeyOfProduct(row) || String(oldHint || '').trim() || String(row.name || '').trim();
  if (!oldKey || oldKey === nm) return;
  await db.query(
    `UPDATE main_products SET name = ?, set_name = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id <> ? AND (btrim(coalesce(name,'')) = ? OR btrim(coalesce(set_name,'')) = ?)`,
    [nm, nm, id, oldKey, oldKey]
  );
}

// ============================================================================
// 成本台账（运营成本）建表 —— 幂等，首次访问 /opex 时自动建，一次
// 只记「运营支出」（投流、运费、包装、平台费…），**与商品采购成本无关**
// ============================================================================
let opexReady = null;
function ensureOpexTable(db) {
  if (!opexReady) {
    opexReady = db.query(`
      CREATE TABLE IF NOT EXISTS main_opex (
        id SERIAL PRIMARY KEY,
        cost_date DATE NOT NULL,
        item TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )`)
      .then(() => db.query('CREATE INDEX IF NOT EXISTS idx_main_opex_date ON main_opex (cost_date DESC)'))
      .catch(e => { opexReady = null; throw e; });   // 失败允许下次重试
  }
  return opexReady;
}

// ============================================================================
// 寄存（2026-09-25）：货已经出库、发到档口，但还没卖出去
// ----------------------------------------------------------------------------
// 场景：把货发给档口寄存 —— 系统里这些商品确实「已出库」，但并没有产生销售。
//      不处理的话会按「出库日」的行情价算出一笔并不存在的盈亏。
// ✅ 口径：登记为寄存的单，没卖出前**整单压着、不计入盈亏**；点「已卖出」后，
//        被寄存的商品改按**卖出日**的行情价计价（没寄存的商品仍按出库日），
//        整单重新回到盈亏统计里。
// 存法：按「单 + 商品编码」逐条存（同一单可多次登记，重复登记覆盖不累加）；
//      状态按单统一 —— 该单所有寄存行都是 sold 才算「已卖出」。
// ============================================================================
let holdReady = null;
function ensureHoldTable(db) {
  if (!holdReady) {
    holdReady = db.query(`
      CREATE TABLE IF NOT EXISTS main_hold (
        id SERIAL PRIMARY KEY,
        order_no VARCHAR(100) NOT NULL,
        inbound_id INTEGER,
        product_code VARCHAR(100) NOT NULL DEFAULT '',
        quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
        hold_date DATE NOT NULL DEFAULT CURRENT_DATE,
        status VARCHAR(10) NOT NULL DEFAULT 'holding',
        sold_date DATE DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT now()
      )`)
      .then(() => db.query('ALTER TABLE main_hold ADD COLUMN IF NOT EXISTS inbound_id INTEGER'))
      .then(() => db.query('CREATE INDEX IF NOT EXISTS idx_main_hold_order ON main_hold (order_no)'))
      .catch(e => { holdReady = null; throw e; });   // 失败允许下次重试
  }
  return holdReady;
}

// 读寄存表 → { 单号: { order_no, status:'holding'|'sold', hold_date, sold_date, rows[], codes{} } }
// codes = { 商品编码: 寄存数量 }，供利润计算判断「这个编码是不是寄存在档口了」
async function loadHoldMap(db) {
  const r = await db.query(
    `SELECT id, order_no, inbound_id, product_code, quantity,
            to_char(hold_date,'YYYY-MM-DD') AS hold_date,
            status, to_char(sold_date,'YYYY-MM-DD') AS sold_date
     FROM main_hold ORDER BY id ASC`
  );
  const map = {};
  r.rows.forEach(x => {
    const g = map[x.order_no] || (map[x.order_no] = {
      order_no: x.order_no, status: 'holding', hold_date: '', sold_date: '', rows: [], codes: {}
    });
    g.rows.push(x);
    g.codes[x.product_code] = (g.codes[x.product_code] || 0) + (Number(x.quantity) || 0);
    const hd = x.hold_date || '';
    if (hd && (!g.hold_date || hd < g.hold_date)) g.hold_date = hd;
  });
  Object.values(map).forEach(g => {
    const allSold = g.rows.length > 0 && g.rows.every(x => x.status === 'sold');
    g.status = allSold ? 'sold' : 'holding';
    const ds = allSold ? g.rows.map(x => x.sold_date || '').filter(Boolean).sort() : [];
    g.sold_date = ds.length ? ds[ds.length - 1] : '';   // 同单多行时取最晚的那天
  });
  return map;
}

module.exports = function(db) {
  const router = express.Router();

  // 套装字段（is_set / set_name）：利润、库存、台账都要读它，放在最前面保证第一次
  // 请求之前列就存在（幂等，内部只真正执行一次，之后直接放行）
  router.use(async (req, res, next) => {
    try {
      await ensureSetColumns(db);
      await ensureHoldTable(db);   // 寄存表：利润/总览/台账都要读它（幂等，只有第一次真建）
      next();
    } catch (e) { next(e); }
  });

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
      await ensureSetColumns(db);
      const { code, name, spec, unit, market_price, type, gift_of, bundle_qty, is_set, set_name } = req.body;
      if (!code || !name) return res.status(400).json({ error: '编码和名称为必填项' });

      // 套装：不再手填套装名，归组键 = 商品名称（同一套装的几个编码名称相同）
      //   → 用户在「添加物品」里选"是套装"后只需多扫几个码，不用再想名字
      const setFlag = is_set === true || is_set === 'true' || is_set === 1 || is_set === '1';
      const setName = setFlag ? String(name).trim() : '';

      // 不做重复检查，同一个编码可在不同类型和不同套餐中重复出现
      const result = await db.query(
        'INSERT INTO main_products (code, name, spec, unit, market_price, type, gift_of, bundle_qty, is_set, set_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
        [code, name, spec || '', unit || '', market_price || '', type || '', gift_of || null, parseInt(bundle_qty) || 1, setFlag, setName || null]
      );

      res.json({ success: true, id: result.rows[0].id, gift_of: gift_of || null, is_set: setFlag, set_name: setName || null });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.put('/products/:code', async (req, res) => {
    try {
      await ensureSetColumns(db);
      const { name, spec, unit, market_price, type, gift_of, bundle_qty, is_set, set_name, sync_rename } = req.body;
      const existing = await db.query('SELECT id FROM main_products WHERE code = ?', [req.params.code]);
      if (!existing.rows[0]) return res.status(404).json({ error: '产品不存在' });

      const sets = ['name=?', 'spec=?', 'unit=?', 'market_price=?', 'type=?', 'bundle_qty=?', 'updated_at=CURRENT_TIMESTAMP'];
      const params = [name, spec, unit, market_price, type, parseInt(bundle_qty) || 1];

      // gift_of：只在前端显式传了才更新
      if (gift_of !== undefined) { sets.push('gift_of=?'); params.push(gift_of || null); }

      // 套装字段：同样「传了才更新」—— 否则旧缓存的页面保存时会把套装标记抹掉
      // 归组键 = 商品名称；改了名称就把整套一起改，别让同一套被拆成两组
      if (is_set !== undefined) {
        const setFlag = is_set === true || is_set === 'true' || is_set === 1 || is_set === '1';
        const setName = setFlag ? String(name).trim() : '';
        if (setFlag && sync_rename !== false) await syncSetMembersRename(db, existing.rows[0].id, setName);
        sets.push('is_set=?'); params.push(setFlag);
        sets.push('set_name=?'); params.push(setName || null);
      }

      params.push(req.params.code);
      await db.query(`UPDATE main_products SET ${sets.join(', ')} WHERE code=?`, params);

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // 按 ID 更新产品（精确匹配，同编码不同规格用）
  router.put('/products/id/:id', async (req, res) => {
    try {
      await ensureSetColumns(db);
      const { name, spec, unit, market_price, type, bundle_qty, code, is_set, set_name, sync_rename } = req.body;
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

      const sets2 = ['code=?', 'name=?', 'spec=?', 'unit=?', 'market_price=?', 'type=?', 'bundle_qty=?', 'updated_at=CURRENT_TIMESTAMP'];
      const params2 = [newCode, name, spec, unit, market_price, type || '', parseInt(bundle_qty) || 1];
      // 套装字段「传了才更新」，避免旧页面保存时抹掉标记
      // 归组键 = 商品名称；改了名称就把整套一起改，别让同一套被拆成两组
      if (is_set !== undefined) {
        const setFlag = is_set === true || is_set === 'true' || is_set === 1 || is_set === '1';
        const setName = setFlag ? String(name).trim() : '';
        if (setFlag && sync_rename !== false) await syncSetMembersRename(db, req.params.id, setName);
        sets2.push('is_set=?'); params2.push(setFlag);
        sets2.push('set_name=?'); params2.push(setName || null);
      }
      params2.push(req.params.id);
      await db.query(`UPDATE main_products SET ${sets2.join(', ')} WHERE id=?`, params2);
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

      // 套装（2026-09-23）：一组商品的库存各自独立记，但"能组成几套"取决于最缺的那个
      // → 可成套数 = 同套装名下各编码库存的最小值；并统一把 is_set / set_name 归一化
      // ❗归组键一律取「商品名称」（setKeyOfProduct），不直接读 set_name 字段（可能残留历史错别字）
      const setCodes = {};
      inventory.forEach(p => {
        const sn = setKeyOfProduct(p);
        if (!sn) return;
        (setCodes[sn] || (setCodes[sn] = new Set())).add(p.code);
      });
      const setStock = {};
      Object.keys(setCodes).forEach(sn => {
        let min = Infinity;
        setCodes[sn].forEach(c => {
          const sum = inventory
            .filter(x => x.code === c && setKeyOfProduct(x) === sn)
            .reduce((s, x) => s + (Number(x.stock) || 0), 0);
          min = Math.min(min, sum);
        });
        setStock[sn] = isFinite(min) ? min : 0;
      });
      inventory.forEach(p => {
        const sn = setKeyOfProduct(p);
        p.set_name = sn || null;
        p.is_set = !!sn;
        p.set_units = sn ? (setStock[sn] || 0) : 0;   // 这套还能组成几套
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

  // ========== 成本台账（运营成本 · 手工记账）==========
  // 说明：这里是「记账本」，只记运营支出，和商品采购成本（入库单金额）是两回事。
  //       金额允许为负（用于退款/冲抵），前端按月分组、逐行显示。

  router.get('/opex', async (req, res) => {
    try {
      await ensureOpexTable(db);
      const r = await db.query(
        `SELECT id, to_char(cost_date,'YYYY-MM-DD') AS cost_date, item, category, amount, note,
                to_char(created_at,'YYYY-MM-DD HH24:MI') AS created_at
         FROM main_opex
         ORDER BY cost_date DESC, id DESC`
      );
      res.json(r.rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/opex', async (req, res) => {
    try {
      await ensureOpexTable(db);
      const { cost_date, item, amount, category, note } = req.body;
      const d = String(cost_date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
      const it = String(item || '').trim();
      if (!it) return res.status(400).json({ error: '请填写项目/摘要' });
      const amt = parseFloat(amount);
      if (isNaN(amt)) return res.status(400).json({ error: '请填写金额' });

      const r = await db.query(
        `INSERT INTO main_opex (cost_date, item, category, amount, note) VALUES (?, ?, ?, ?, ?) RETURNING id`,
        [d, it, String(category || '').trim(), amt, String(note || '').trim()]
      );
      res.json({ success: true, id: r.rows[0].id });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.patch('/opex/:id', async (req, res) => {
    try {
      await ensureOpexTable(db);
      const { cost_date, item, amount, category, note } = req.body;
      const sets = [];
      const params = [];

      if (cost_date !== undefined) {
        const d = String(cost_date).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: '日期格式应为 YYYY-MM-DD' });
        sets.push('cost_date = ?'); params.push(d);
      }
      if (item !== undefined) {
        const it = String(item).trim();
        if (!it) return res.status(400).json({ error: '请填写项目/摘要' });
        sets.push('item = ?'); params.push(it);
      }
      if (amount !== undefined) {
        const amt = parseFloat(amount);
        if (isNaN(amt)) return res.status(400).json({ error: '金额不合法' });
        sets.push('amount = ?'); params.push(amt);
      }
      if (category !== undefined) { sets.push('category = ?'); params.push(String(category).trim()); }
      if (note !== undefined) { sets.push('note = ?'); params.push(String(note).trim()); }

      if (sets.length === 0) return res.status(400).json({ error: '没有需要修改的内容' });

      params.push(req.params.id);
      await db.query(`UPDATE main_opex SET ${sets.join(', ')} WHERE id = ?`, params);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.delete('/opex/:id', async (req, res) => {
    try {
      await ensureOpexTable(db);
      await db.query('DELETE FROM main_opex WHERE id = ?', [req.params.id]);
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
      if (!orderNo) return res.json({ profit: 0, sale_price: 0, cost_price: 0, has_out: false, any_out: false, partial_out: false, has_market: false, completed: false, pending_items: 0, total_items: 0, detail: [] });

      const orderInRes = await db.query(
        'SELECT * FROM main_inbound WHERE order_no = ? ORDER BY id ASC',
        [orderNo]
      );
      const orderItems = orderInRes.rows;
      if (orderItems.length === 0) return res.json({ profit: 0, sale_price: 0, cost_price: 0, has_out: false, any_out: false, partial_out: false, has_market: false, completed: false, pending_items: 0, total_items: 0, detail: [] });

      // 成本 = 整单金额（首个商品填的），始终显示
      const totalCost = Number(orderItems[0].purchase_price) || 0;

      // 出库归属（FIFO）+ 行情表 + 商品名，一次性取出，避免在循环里 N 次查库
      const alloc = await computeOutboundAlloc(db);
      const priceMap = await loadPriceMap(db);
      const today = await todayOf(db);
      const nameRes = await db.query('SELECT code, name FROM main_products ORDER BY id ASC');
      const nameMap = {};
      nameRes.rows.forEach(r => { nameMap[r.code] = r.name; });   // 后者覆盖前者 = 取最新一条

      // 寄存（2026-09-25）：这单登记了「发到档口」→ 没卖出前整单压着不算；
      // 已卖出 → 被寄存的商品改按「卖出日」的行情计价（其它商品仍按出库日）
      const holdMap = await loadHoldMap(db);
      const hm = holdMap[orderNo] || null;
      const holdCodes = hm ? hm.codes : {};
      const holdSoldDay = (hm && hm.status === 'sold') ? (hm.sold_date || '') : '';
      const isHolding = !!(hm && hm.status === 'holding');
      // 某个编码该用哪一天取行情：已卖出且它寄存在档口 → 卖出日；否则出库日
      const priceDayOf = (code, outDay) => (holdSoldDay && holdCodes[code]) ? holdSoldDay : outDay;

      let totalSale = 0;
      let anyShipped = false;  // 本单是否有商品出库过（含只出了一部分的情况）
      let allShipped = true;   // 本单每一件商品是否都出过库 —— 只有整单都出库才算「已出库」
      let pendingItems = 0;    // 还没出过库的商品数（有几件一件都没出）
      let allOut = true;       // 本单是否全部出完（每件都出满，仅用于展示）
      const detail = [];

      // 按套装归组：同一单里同「套装名」的多个编码合成一套，只算一次套价（详见文件顶部套装说明）
      const setMap = await loadSetNameMap(db);
      const groups = groupItemsBySet(orderItems, setMap);

      for (const g of groups) {
        // 组内每条入库记录的真实出库情况（FIFO）
        const rows = g.items.map(it => {
          const a = alloc[it.id] || { out_qty: 0, out_date: '' };
          const inQty = Number(it.quantity) || 0;
          const outQty = Number(a.out_qty) || 0;
          if (outQty < inQty) allOut = false;
          return { it, code: it.product_code, inQty, outQty, outDate: a.out_date || '' };
        });
        // 出库日：取组内第一条有出库日的记录（套装成套出库，各条一般同一天）
        const anyOut = rows.find(x => x.outDate);
        const groupOutDate = anyOut ? anyOut.outDate : '';

        // 这一组（普通商品=这一条；套装=整套里任一条）是否出过库
        const groupShipped = rows.some(x => x.outQty > 0);
        if (groupShipped) anyShipped = true;
        else { allShipped = false; pendingItems++; }

        if (!g.isSet) {
          // ---- 普通商品：一条记录算一次（原口径不变）----
          const x = rows[0];
          const row = {
            code: x.code, name: nameMap[x.code] || x.code,
            in_qty: x.inQty, out_qty: x.outQty,
            out_date: x.outDate,
            next_day: x.outDate ? nextDayOf(x.outDate) : '',   // 字面次日（出库日+1）
            price_date: '',                                     // 行情价实际取自哪一天
            next_day_price: 0,
            sale: 0,
            is_set: false, set_name: '', set_member: false, set_units: 0,
            // 出库日次日还没到（今天才出库）→ 现在用的价只是暂计，
            // 明天录了次日价会自动改用次日价重算，前端提示「待次日行情」
            await_price: false
          };
          const priceDay = priceDayOf(x.code, x.outDate);   // 基准日：寄存已卖出 → 卖出日；否则出库日
          row.base_day = priceDay;                          // 基准日（出库日 / 卖出日）
          row.next_day = priceDay ? nextDayOf(priceDay) : '';
          row.price_day = row.next_day;                     // ❗取价日 = 基准日次日（与 /ledger 的 price_day 同义，别写成基准日）
          row.await_price = !!(x.outQty > 0 && row.next_day && row.next_day > today);

          if (x.outQty > 0) {
            const mp = pickMarketPrice(priceMap, x.code, priceDay);
            const salePrice = mp ? mp.price : 0;
            if (mp) row.price_date = mp.date;
            row.next_day_price = salePrice;
            // 销售额 = 行情价 × 本单该商品的全部数量
            row.sale = Number((salePrice * x.inQty).toFixed(2));
            totalSale += salePrice * x.inQty;
          }
          detail.push(row);
          continue;
        }

        // ---- 套装：组内任一条出库 → 这一套视为已出库；整套只算一次价 ----
        const setOut = rows.some(x => x.outQty > 0);
        const units = setUnitsOf(g);                       // 套数 = 组内第一个编码的数量合计
        const setDay = priceDayOf(g.items[0].product_code, groupOutDate);   // 寄存已卖出 → 按卖出日取价
        const mp = (setOut && setDay)
          ? pickMarketPrice(priceMap, g.items[0].product_code, setDay)
          : null;
        const salePrice = mp ? mp.price : 0;
        const awaitFlag = !!(setOut && setDay && nextDayOf(setDay) > today);
        if (setOut) {
          totalSale += salePrice * units;                  // ✅ 一套只算一次（不再按每个编码各算一遍）
        }
        rows.forEach((x, i) => {
          detail.push({
            code: x.code, name: nameMap[x.code] || x.code,
            in_qty: x.inQty, out_qty: x.outQty,
            out_date: i === 0 ? (x.outDate || groupOutDate) : x.outDate,
            next_day: setDay ? nextDayOf(setDay) : '',
            base_day: setDay,
            price_day: setDay ? nextDayOf(setDay) : '',
            price_date: mp ? mp.date : '',
            next_day_price: salePrice,
            // 销售额只记在「代表行」（组内第一条）上，其余组成商品不再单独计价
            sale: (i === 0 && setOut) ? Number((salePrice * units).toFixed(2)) : 0,
            is_set: true, set_name: g.set_name, set_member: i > 0, set_units: units,
            await_price: i === 0 ? awaitFlag : false   // 等待行情按套计一次
          });
        });
      }

      const awaitRows = detail.filter(r => r.await_price);

      res.json({
        sale_price: Number(totalSale.toFixed(2)),
        cost_price: Number(totalCost.toFixed(2)),
        profit: Number((totalSale - totalCost).toFixed(2)),
        has_out: allShipped && !isHolding,          // 整单都出了库、且没在档口寄存 → 才计入盈亏
        holding: isHolding,                         // 发到档口寄存中（还没卖）→ 整单压着不算
        hold_sold: holdSoldDay,                     // 已卖出时：寄存部分按这一天的行情计价
        hold_codes: Object.keys(holdCodes),         // 寄存在档口的商品编码
        any_out: anyShipped,                        // 有任意一件出过库（可能只是部分出库）
        partial_out: anyShipped && !allShipped,     // 部分出库：出了几件、还有没出的
        pending_items: pendingItems,                // 还没出过库的商品数
        total_items: groups.length,                 // 本单商品组数（一个套装算一组）
        has_market: allShipped && !isHolding && totalSale > 0,
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

  // 口径（2026-09-14 定稿，2026-09-25 修订第 1 条）：
  //   1. 只统计「整单已出库」的单号 —— ❗每一件商品都出过库才算（2026-09-25 起）。
  //      一单里只出了其中几件 → 整单仍算「未出库」，本金不进总投入。否则会出现
  //      「只出了配件盒、却按整单相机成本扣 579」这种假亏损。剩下几件出库后自动进榜。
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
      const setMap = await loadSetNameMap(db);   // 套装归组用（同一套装的多个编码只算一次价）
      const holdMap = await loadHoldMap(db);     // 寄存：发到档口、还没卖的单，整单压着不算

      const pad = n => String(n).padStart(2, '0');

      // 按单号聚合
      const orders = {};
      inRes.rows.forEach(r => {
        const key = r.order_no || '（无单号）';
        (orders[key] || (orders[key] = [])).push(r);
      });

      let invest = 0, revenue = 0, pendingInvest = 0, pendingCount = 0, outCount = 0, awaitCount = 0, awaitRevenue = 0;
      let partialCount = 0, partialInvest = 0;   // 其中「部分出库」的单：出了几件、还有没出的
      let holdCount = 0, holdInvest = 0;         // 其中「档口寄存」的单：货已出库、但还没卖
      const weekMap = {};
      const monthMap = {};
      const dayMap = {};     // 逐日（「近一个月」按天走势用）
      const devMap = {};
      const orderList = [];

      Object.keys(orders).forEach(orderNo => {
        const items = orders[orderNo];
        const cost = Number(items[0].purchase_price) || 0;   // 整单金额：取首商品

        // 寄存（2026-09-25）：这单登记了「发到档口」→ 没卖出前整单压着不算；
        // 已卖出 → 被寄存的商品按「卖出日」的行情计价，整单再回到统计里
        const hm = holdMap[orderNo] || null;
        if (hm && hm.status === 'holding') {
          holdCount++; holdInvest += cost;
          return;
        }
        const holdSoldDay = (hm && hm.status === 'sold') ? (hm.sold_date || '') : '';
        const holdCodes = hm ? hm.codes : {};
        // 下单设备/下级：单内一般一致，取本单首个填了值的商品
        const devItem = items.find(x => String(x.device || '').trim() !== '');
        const device = devItem ? String(devItem.device).trim() : '';
        let sale = 0, lastDay = '', awaitFlag = false;

        // 按套装归组：同「套装名」的多个编码合成一套，只算一次套价（详见文件顶部套装说明）
        const setGroups = groupItemsBySet(items, setMap);

        // 每一组（普通商品=这一条；套装=整套）是否出过库
        const groupShipped = setGroups.map(g => g.items.some(it => (Number((alloc[it.id] || {}).out_qty) || 0) > 0));
        const anyShipped = groupShipped.some(Boolean);
        const allShipped = groupShipped.every(Boolean);   // 每一件都出过库 → 整单才算「已出库」

        // ❗2026-09-25 口径：没全部出库 → 这单仍算「未出库」，本金不进总投入
        if (!allShipped) {
          pendingInvest += cost;
          pendingCount++;
          if (anyShipped) { partialCount++; partialInvest += cost; }
          return;
        }

        setGroups.forEach(g => {
          const outInfo = g.items.map(it => ({ it, a: alloc[it.id] }));
          const hit = outInfo.find(x => x.a && x.a.out_qty > 0);
          if (!hit) return;   // 整单已出库时不该发生，保险起见
          // 计价用的日期：寄存在档口且已卖出 → 卖出日；否则出库日
          const code0 = g.items[0].product_code;
          const priceDay = (holdSoldDay && holdCodes[code0]) ? holdSoldDay : hit.a.out_date;
          if (priceDay > lastDay) lastDay = priceDay;
          // 计价日的次日还没到（今天才出库 / 今天才卖）→ 收益只是暂计，明天录价后自动重算
          if (priceDay && nextDayOf(priceDay) > today) awaitFlag = true;

          if (g.isSet) {
            // 套装：套数 = 组内第一个编码的数量合计，行情取第一个编码的价 → 一套只算一次
            const units = setUnitsOf(g);
            const mp = pickMarketPrice(priceMap, code0, priceDay);
            if (mp) sale += mp.price * units;
          } else {
            const it = g.items[0];
            const mp = pickMarketPrice(priceMap, it.product_code, priceDay);
            if (mp) sale += mp.price * (Number(it.quantity) || 0);
          }
        });

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

        // 归到自然月（按出库日期所属月份）
        const mk = String(lastDay || '1970-01').slice(0, 7);
        const m = monthMap[mk] || (monthMap[mk] = { month_start: mk, profit: 0, revenue: 0, cost: 0, orders: 0 });
        m.profit += profit; m.revenue += sale; m.cost += cost; m.orders++;

        // 归到具体某天（用于「近一个月」按天走势：哪天有单就标在哪天）
        const dk = String(lastDay || '').slice(0, 10);
        if (dk) {
          const dd = dayMap[dk] || (dayMap[dk] = { date: dk, profit: 0, revenue: 0, cost: 0, orders: 0 });
          dd.profit += profit; dd.revenue += sale; dd.cost += cost; dd.orders++;
        }
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

      // 自然月汇总（累计值口径与 weekly 一致：按月份升序累加）
      let macc = 0;
      const monthly = Object.keys(monthMap).sort().map(k => {
        const m = monthMap[k];
        macc = Number((macc + m.profit).toFixed(2));
        return {
          month_start: m.month_start,
          profit: Number(m.profit.toFixed(2)),
          revenue: Number(m.revenue.toFixed(2)),
          cost: Number(m.cost.toFixed(2)),
          orders: m.orders,
          cumulative: macc
        };
      });

      // 「近一个月」逐日：本地今天往前推一个自然月 → 今天，缺数据的日子补 0（横轴连续）
      const tD = new Date(today + 'T00:00:00');
      const sD = new Date(tD.getTime());
      sD.setMonth(sD.getMonth() - 1);
      if (sD.getDate() !== tD.getDate()) sD.setDate(0);   // 例如 3-31 往前一个月 → 2 月最后一天
      const dailyStart = `${sD.getFullYear()}-${pad(sD.getMonth() + 1)}-${pad(sD.getDate())}`;
      const daily = [];
      let dacc = 0;
      for (const cur = new Date(sD.getTime()); ; cur.setDate(cur.getDate() + 1)) {
        const key = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`;
        const rec = dayMap[key];
        const dp = rec ? Number(rec.profit.toFixed(2)) : 0;
        dacc = Number((dacc + dp).toFixed(2));
        daily.push({
          date: key,
          profit: dp,
          revenue: rec ? Number(rec.revenue.toFixed(2)) : 0,
          cost: rec ? Number(rec.cost.toFixed(2)) : 0,
          orders: rec ? rec.orders : 0,
          cumulative: dacc
        });
        if (key >= today) break;
      }

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
          // 其中「部分出库」的单：一单里只出了一部分商品，整单出库后才计入上面的统计
          partial_count: partialCount,
          partial_invest: Number(partialInvest.toFixed(2)),
          // 其中「档口寄存」的单：货已经出库但还没卖 —— 等点了「已卖出」才按卖出日行情计入
          hold_count: holdCount,
          hold_invest: Number(holdInvest.toFixed(2)),
          // 其中「今天出库、出库次日行情还没到」的单：收益只是暂计，明天录价后自动重算
          await_count: awaitCount,
          await_revenue: Number(awaitRevenue.toFixed(2))
        },
        weekly,
        monthly,
        daily,
        daily_start: dailyStart,
        daily_end: today,
        by_device: byDevice,
        orders: orderList
      });
    } catch (e) {
      console.error('[dashboard] 错误:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ========== 寄存（发到档口 · 还没卖） ==========

  // 登记寄存前的弹窗数据：这单里「已经出过库」的商品（寄存的前提是货已经发出去）
  router.get('/hold/order-items', async (req, res) => {
    try {
      const orderNo = String(req.query.orderNo || '').trim();
      if (!orderNo) return res.status(400).json({ error: '请先填单号' });
      const inRes = await db.query('SELECT * FROM main_inbound WHERE order_no = ? ORDER BY id ASC', [orderNo]);
      if (inRes.rows.length === 0) return res.json({ found: false, order_no: orderNo, items: [], cost: 0, device: '' });

      const alloc = await computeOutboundAlloc(db);
      const setMap = await loadSetNameMap(db);
      const prRes = await db.query('SELECT code, name, spec FROM main_products ORDER BY id ASC');
      const nameMap = {}, specMap = {};
      prRes.rows.forEach(r => { nameMap[r.code] = r.name; specMap[r.code] = r.spec; });

      const holdMap = await loadHoldMap(db);
      const hm = holdMap[orderNo] || null;
      const held = (hm && hm.status === 'holding') ? hm.codes : {};

      // 按套装归组（套装成套寄存），组内只保留「出过库」的编码
      const groups = groupItemsBySet(inRes.rows, setMap);
      const items = [];
      groups.forEach(g => {
        const members = g.items.map(it => {
          const a = alloc[it.id] || { out_qty: 0, out_date: '' };
          return {
            inbound_id: it.id,
            product_code: it.product_code,
            out_qty: Number(a.out_qty) || 0,
            out_date: a.out_date || '',
            hold_qty: Number(held[it.product_code]) || 0
          };
        }).filter(m => m.out_qty > 0);          // 没出库的不能登记寄存
        if (members.length === 0) return;
        const first = g.items[0];
        const totalOut = members.reduce((s, m) => s + m.out_qty, 0);
        const totalHeld = members.reduce((s, m) => s + m.hold_qty, 0);
        items.push({
          product_code: first.product_code,
          is_set: g.isSet,
          set_name: g.set_name || '',
          name: nameMap[first.product_code] || first.product_code,
          spec: specMap[first.product_code] || '',
          codes: members.map(m => m.product_code),
          out_qty: totalOut,
          out_date: (members.find(m => m.out_date) || {}).out_date || '',
          hold_qty: totalHeld,
          can_hold: Math.max(0, totalOut - totalHeld),   // 还能登记几件（已登记的会扣掉）
          members
        });
      });

      res.json({
        found: true,
        order_no: orderNo,
        cost: Number(inRes.rows[0].purchase_price) || 0,
        device: (inRes.rows.find(x => String(x.device || '').trim()) || {}).device || '',
        holding: !!(hm && hm.status === 'holding'),
        sold: !!(hm && hm.status === 'sold'),
        items
      });
    } catch (e) {
      console.error('[hold/order-items] 错误:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // 登记寄存：body = { order_no, items: [{ inbound_id, product_code, quantity }] }
  // 同一单同一编码重复登记 → 覆盖上一次（不会累加）
  router.post('/hold', async (req, res) => {
    try {
      const b = req.body || {};
      const orderNo = String(b.order_no || '').trim();
      const items = Array.isArray(b.items) ? b.items : [];
      if (!orderNo) return res.status(400).json({ error: '缺少单号' });
      if (items.length === 0) return res.status(400).json({ error: '请至少选择一个商品' });
      let n = 0;
      for (const it of items) {
        const code = String((it && it.product_code) || '').trim();
        if (!code) continue;
        await db.query("DELETE FROM main_hold WHERE order_no = ? AND product_code = ? AND status = 'holding'", [orderNo, code]);
        await db.query(
          "INSERT INTO main_hold (order_no, inbound_id, product_code, quantity, hold_date, status) VALUES (?, ?, ?, ?, CURRENT_DATE, 'holding')",
          [orderNo, Number(it.inbound_id) || null, code, Number(it.quantity) || 0]
        );
        n++;
      }
      res.json({ success: true, order_no: orderNo, count: n });
    } catch (e) {
      console.error('[hold POST] 错误:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // 点「已卖出」：body = { order_no, sold_date }（sold_date 不合法就用今天）
  router.post('/hold/sell', async (req, res) => {
    try {
      const b = req.body || {};
      const orderNo = String(b.order_no || '').trim();
      if (!orderNo) return res.status(400).json({ error: '缺少单号' });
      let soldDate = String(b.sold_date || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(soldDate)) soldDate = await todayOf(db);
      await db.query("UPDATE main_hold SET status = 'sold', sold_date = ? WHERE order_no = ?", [soldDate, orderNo]);
      res.json({ success: true, order_no: orderNo, sold_date: soldDate });
    } catch (e) {
      console.error('[hold/sell] 错误:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // 取消寄存：DELETE /hold?orderNo=xxx —— 删掉这单的寄存记录，回到按出库日计价
  router.delete('/hold', async (req, res) => {
    try {
      const orderNo = String(req.query.orderNo || '').trim();
      if (!orderNo) return res.status(400).json({ error: '缺少单号' });
      await db.query('DELETE FROM main_hold WHERE order_no = ?', [orderNo]);
      res.json({ success: true, order_no: orderNo });
    } catch (e) {
      console.error('[hold DELETE] 错误:', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // 寄存列表：holding = 寄存中（板块主体）；sold = 已卖出（按约定从板块移出，仍返回备用）
  router.get('/hold', async (req, res) => {
    try {
      const holdMap = await loadHoldMap(db);
      if (Object.keys(holdMap).length === 0) return res.json({ success: true, holding: [], sold: [] });

      const inRes = await db.query(
        "SELECT id, order_no, product_code, quantity, purchase_price, COALESCE(NULLIF(device,''),'') AS device FROM main_inbound ORDER BY id ASC"
      );
      const prRes = await db.query('SELECT code, name, spec FROM main_products ORDER BY id ASC');
      const nameMap = {}, specMap = {};
      prRes.rows.forEach(r => { nameMap[r.code] = r.name; specMap[r.code] = r.spec; });
      const alloc = await computeOutboundAlloc(db);

      const inByOrder = {};
      inRes.rows.forEach(r => {
        const k = r.order_no || '（无单号）';
        (inByOrder[k] || (inByOrder[k] = [])).push(r);
      });

      const groups = Object.values(holdMap).map(g => {
        const inItems = inByOrder[g.order_no] || [];
        const cost = inItems.length ? Number(inItems[0].purchase_price) || 0 : 0;
        const devItem = inItems.find(x => String(x.device || '').trim() !== '');
        const rows = g.rows.map(h => {
          const it = inItems.find(x => x.product_code === h.product_code) || null;
          const a = it ? (alloc[it.id] || {}) : {};
          return {
            product_code: h.product_code,
            name: nameMap[h.product_code] || h.product_code,
            spec: specMap[h.product_code] || '',
            quantity: Number(h.quantity) || 0,
            out_qty: Number(a.out_qty) || 0,
            out_date: a.out_date || ''
          };
        });
        return {
          order_no: g.order_no,
          status: g.status,                 // holding | sold
          hold_date: g.hold_date,
          sold_date: g.sold_date,
          device: devItem ? String(devItem.device).trim() : '',
          cost,
          item_count: rows.length,
          quantity: rows.reduce((s, r) => s + r.quantity, 0),
          rows
        };
      }).sort((a, b) => (a.hold_date === b.hold_date
        ? (String(a.order_no) < String(b.order_no) ? 1 : -1)
        : (a.hold_date < b.hold_date ? 1 : -1)));

      res.json({
        success: true,
        holding: groups.filter(g => g.status === 'holding'),
        sold: groups.filter(g => g.status === 'sold')
      });
    } catch (e) {
      console.error('[hold GET] 错误:', e.message);
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
      // ⚠️ 套装（2026-09-23）：同一天出的同一套装，只在「代表条目」上记一次 套价 × 套数，
      //    其余组成商品标 set_member 且销售额记 0 —— 否则一套会被算成 N 倍
      const priceMap = await loadPriceMap(db);
      const setMap = await loadSetNameMap(db);
      // 寄存：发到档口、还没卖的商品，出库台账里先不认销售额（还没产生销售）
      const holdMap = await loadHoldMap(db);
      const holdStatusOfCode = {};
      Object.values(holdMap).forEach(g => {
        Object.keys(g.codes).forEach(c => { holdStatusOfCode[c] = g.status; });
      });

      const setKeyOf = ob => (setMap[ob.product_code] || '') + '||' + (ob.out_day || '');
      const setLeaderId = {};   // 组 key → 代表条目 id（取最小 id，与入库代表口径一致）
      const setUnits = {};      // 组 key → 套数（代表编码在这批里的出库数量合计）
      outbound.rows.forEach(ob => {
        ob.set_name = setMap[ob.product_code] || '';
        ob.is_set = !!ob.set_name;
        ob.set_member = false;
        ob.hold_status = holdStatusOfCode[ob.product_code] || '';   // holding = 发到档口寄存、还没卖
        if (!ob.is_set || !ob.out_day) return;
        const k = setKeyOf(ob);
        if (setLeaderId[k] === undefined || ob.id < setLeaderId[k]) setLeaderId[k] = ob.id;
      });
      Object.keys(setLeaderId).forEach(k => {
        const leader = outbound.rows.find(x => x.id === setLeaderId[k]);
        if (!leader) return;
        setUnits[k] = outbound.rows
          .filter(x => x.is_set && setKeyOf(x) === k && x.product_code === leader.product_code)
          .reduce((s, x) => s + (Number(x.quantity) || 0), 0);
      });

      for (const ob of outbound.rows) {
        const outDate = ob.out_day || '';
        const totalCost = Number(costByOutId[ob.id] || 0);
        ob.cost_price = Number(totalCost.toFixed(2));   // 整单成本（FIFO 具体成本）

        if (!outDate) {
          ob.sale_price = 0;
          ob.profit = 0;
          ob.price_date = '';
          ob.price_day = '';
          continue;
        }

        // 套装里的非代表组成商品：销售额已并入代表条目，这里不重复计价
        if (ob.is_set && setLeaderId[setKeyOf(ob)] !== ob.id) {
          ob.set_member = true;
          ob.set_units = setUnits[setKeyOf(ob)] || 0;
          ob.sale_price = 0;
          ob.profit = 0;              // 组成商品不单独看盈亏，免得被显示成"亏损"
          ob.price_date = '';
          ob.price_day = '';
          continue;
        }

        const mp = pickMarketPrice(priceMap, ob.product_code, outDate);
        const salePrice = mp ? mp.price : 0;
        // 套装代表条目：销售额 = 套价 × 套数；普通商品：行情价 × 出库数量
        const units = ob.is_set
          ? (setUnits[setKeyOf(ob)] || Number(ob.quantity) || 0)
          : (Number(ob.quantity) || 0);
        const totalSale = salePrice * units;
        ob.sale_price = Number(totalSale.toFixed(2));   // 整单销售额
        ob.profit = Number((totalSale - totalCost).toFixed(2));
        ob.price_date = mp ? mp.date : '';              // 价实际来自行情表的哪一天（沿用时有可能是更早的天）
        ob.price_day = nextDayOf(outDate);              // 逻辑取价日 = 出库次日（对外口径按这个显示）
        if (ob.is_set) ob.set_units = units;
      }

      res.json({ inbound: inbound.rows, outbound: outbound.rows });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
};
