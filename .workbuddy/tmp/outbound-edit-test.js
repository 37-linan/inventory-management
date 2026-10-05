/**
 * 自检：「出库记录表」行内编辑 数量 / 地点 / 订单号（2026-10-05 用户要求）
 *
 * 背景：入库表早就能点一下就地改（数量/渠道/价格），出库表只能删了重填。
 *       用户要求把出库表的这 3 列也做成可点击修改。
 *
 * 覆盖：
 *   A. 后端 PATCH /outbound/:id —— 三个字段各自能改、非法值挡掉、路由顺序对
 *      ❗路由顺序很关键：'/outbound/:id' 必须排在 '/outbound/batch-order' 之后，
 *        否则 Express 会把 'batch-order' 当成 id，批量补录订单号直接坏掉。
 *   B. 出库记录表渲染 —— 三格可点、空值显示「未填」、行缓存建立
 *   C. 行内编辑交互 —— 数字框/文本框、提交、值没变不提交、ESC 取消、0 与负数挡掉
 *
 * 跑法：node .workbuddy/tmp/outbound-edit-test.js
 */
const fs = require('fs');
const vm = require('vm');
const ROOT = 'F:/出入库管理系统';
const MC = fs.readFileSync(ROOT + '/routes/main-cloud.js', 'utf8');
const TR_SRC = ROOT + '/public/js/modules/transactions.js';

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) pass++; else { fail++; console.log('  ✗ ' + l); } };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${l}  →  期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`);

/* ============================================================
   A. 后端 PATCH /outbound/:id
   ============================================================ */
function makeRouter() {
  const stack = [];
  const R = {
    stack,
    use(fn) { stack.push({ __use: true, fn }); return R; },
    _add(m, p, h) { stack.push({ route: { path: p, methods: { [m]: true }, stack: [{ handle: h }] } }); return R; },
    get(p, h) { return R._add('get', p, h); },
    post(p, h) { return R._add('post', p, h); },
    put(p, h) { return R._add('put', p, h); },
    patch(p, h) { return R._add('patch', p, h); },
    delete(p, h) { return R._add('delete', p, h); }
  };
  return R;
}

const WRITES = [];
function makeQuery() {
  return async (sqlRaw, params = []) => {
    const sql = String(sqlRaw).replace(/\s+/g, ' ').trim();
    if (/^(CREATE TABLE|CREATE INDEX|ALTER TABLE)/i.test(sql)) return { rows: [] };
    if (/^UPDATE main_outbound SET/i.test(sql)) { WRITES.push({ sql, params }); return { rows: [] }; }
    return { rows: [] };
  };
}

const sandbox = {
  require: id => { if (id === 'express') return { Router: makeRouter }; throw new Error('unexpected require ' + id); },
  module: { exports: {} }, exports: {}, console,
  setTimeout, clearTimeout, Buffer, process, Date, Math, JSON, Number, String, Object, Array, RegExp, isNaN, parseFloat, parseInt
};
sandbox.global = sandbox;
vm.createContext(sandbox);
vm.runInContext(MC, sandbox, { filename: 'main-cloud.js' });
const router = sandbox.module.exports({ query: makeQuery() });
const H = (m, p) => {
  const l = router.stack.find(x => x.route && x.route.path === p && x.route.methods[m]);
  if (!l) throw new Error('找不到路由 ' + m + ' ' + p);
  return l.route.stack[0].handle;
};
const mkRes = () => ({ _status: 200, _json: null, status(c) { this._status = c; return this; }, json(o) { this._json = o; return this; } });

(async () => {
  console.log('=== A. 后端 PATCH /outbound/:id ===');

  const t = /router\.patch\('\/outbound\/:id'/.test(MC);
  ok(t, 'A.0 注册了 PATCH /outbound/:id');

  // 路由顺序：先 batch-order，后 :id
  const iBatch = router.stack.findIndex(x => x.route && x.route.path === '/outbound/batch-order' && x.route.methods.patch);
  const iId = router.stack.findIndex(x => x.route && x.route.path === '/outbound/:id' && x.route.methods.patch);
  ok(iBatch >= 0 && iId >= 0 && iBatch < iId,
    `A.1 '/outbound/batch-order' 注册在 '/outbound/:id' 之前（否则批量补录会被当成 id 吃掉）: batch=${iBatch}, id=${iId}`);

  // 再按 Express 的匹配规则真跑一遍：PATCH /outbound/batch-order 必须落到 batch-order 那条，
  // 而不是被 '/outbound/:id' 当成交互编辑（id='batch-order'）——这才是这个顺序的真正意义。
  {
    const toRe = p => new RegExp('^' + p.replace(/:[^/]+/g, '[^/]+') + '/?$');
    const hit = router.stack.find(x => x.route && x.route.methods.patch && toRe(x.route.path).test('/outbound/batch-order'));
    eq(hit && hit.route.path, '/outbound/batch-order',
      'A.1b 模拟 PATCH /outbound/batch-order → 命中批量补录那条，没被 :id 抢走');
    const hit2 = router.stack.find(x => x.route && x.route.methods.patch && toRe(x.route.path).test('/outbound/123'));
    eq(hit2 && hit2.route.path, '/outbound/:id', 'A.1c 模拟 PATCH /outbound/123 → 命中交互编辑那条');
  }

  const P = H('patch', '/outbound/:id');

  // 单独改数量
  WRITES.length = 0;
  let res = mkRes();
  await P({ params: { id: '12' }, body: { quantity: 4 } }, res);
  eq(res._status, 200, 'A.2 改数量返回 200');
  eq(WRITES[0] && WRITES[0].sql, 'UPDATE main_outbound SET quantity = ? WHERE id = ?', 'A.3 只更新 quantity 一列');
  eq(WRITES[0] && WRITES[0].params, [4, '12'], 'A.4 参数 = [新数量, id]');

  // 单独改地点
  WRITES.length = 0; res = mkRes();
  await P({ params: { id: '7' }, body: { location: '深圳龙啊龙' } }, res);
  eq(res._status, 200, 'A.5 改地点返回 200');
  eq(WRITES[0] && WRITES[0].sql, 'UPDATE main_outbound SET location = ? WHERE id = ?', 'A.6 只更新 location 一列');
  eq(WRITES[0] && WRITES[0].params, ['深圳龙啊龙', '7'], 'A.7 参数 = [新地点, id]');

  // 单独改订单号
  WRITES.length = 0; res = mkRes();
  await P({ params: { id: '9' }, body: { order_no: 'SF123456' } }, res);
  eq(res._status, 200, 'A.8 改订单号返回 200');
  eq(WRITES[0] && WRITES[0].params, ['SF123456', '9'], 'A.9 参数 = [新单号, id]');

  // 三个一起（前端理论上一次只改一个，接口允许一起改）
  WRITES.length = 0; res = mkRes();
  await P({ params: { id: '3' }, body: { quantity: 2, location: '深圳嘉文', order_no: '' } }, res);
  eq(res._status, 200, 'A.10 多字段同时改返回 200');
  eq(WRITES[0] && WRITES[0].sql, 'UPDATE main_outbound SET quantity = ?, location = ?, order_no = ? WHERE id = ?',
    'A.11 三个 SET 都在');
  eq(WRITES[0] && WRITES[0].params, [2, '深圳嘉文', '', '3'],
    'A.12 ❗order_no 允许改成空串（填错了要能清掉），不是「没传」');

  // 非法值
  for (const bad of [0, -3, 'abc', null, '']) {
    WRITES.length = 0; res = mkRes();
    await P({ params: { id: '5' }, body: { quantity: bad } }, res);
    eq(res._status, 400, `A.13 数量 ${JSON.stringify(bad)} → 400 挡掉`);
    eq(WRITES.length, 0, `A.14 数量 ${JSON.stringify(bad)} → 不写库`);
  }

  // 空 body
  WRITES.length = 0; res = mkRes();
  await P({ params: { id: '5' }, body: {} }, res);
  eq(res._status, 400, 'A.15 什么都没传 → 400');

  /* ============================================================
     B/C. 前端
     ============================================================ */
  function mkEl(id) {
    const set = new Set();
    return {
      id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
      classList: { add(c) { set.add(c); }, remove(c) { set.delete(c); }, contains(c) { return set.has(c); }, toggle() {} },
      querySelector() { return null; }, querySelectorAll() { return []; },
      appendChild() {}, remove() {}, focus() {}, blur() {}, addEventListener() {}
    };
  }

  // 单元格：querySelector('input') 会按 innerHTML 里的 value 属性造一个假输入框
  function mkCell() {
    const handlers = {};
    const cell = {
      innerHTML: '', dataset: {}, _handlers: handlers, _input: null,
      querySelector(sel) {
        if (sel !== 'input') return null;
        const vm2 = /<input[^>]*\bvalue="([^"]*)"/.exec(cell.innerHTML);
        const tp = /<input[^>]*\btype="([^"]*)"/.exec(cell.innerHTML);
        const input = {
          value: vm2 ? vm2[1] : '',
          type: tp ? tp[1] : 'text',
          focus() {}, select() {}, blur() {},
          addEventListener(ev, fn) { handlers[ev] = fn; }
        };
        cell._input = input;
        return input;
      }
    };
    return cell;
  }

  const TOASTS = [];
  const PATCHES = [];
  const OUT_ROWS = [
    { id: 11, product_code: 'A1', quantity: 24, location: '深圳嘉文', order_no: '', row_color: '', created_at: '2026-10-05 03:44:00' },
    { id: 12, product_code: 'A2', quantity: 8, location: '', order_no: '', row_color: '', created_at: '2026-10-05 03:45:00' },
    { id: 13, product_code: 'A3', quantity: 1, location: '深圳龙啊龙', order_no: 'SF999', row_color: '', created_at: '2026-10-05 03:46:00' }
  ];
  const PRODS = [
    { code: 'A1', name: '例子A', spec: '100g' },
    { code: 'A2', name: '例子B', spec: '200g' },
    { code: 'A3', name: '例子C', spec: '300g' }
  ];

  function createTrRuntime() {
    const els = {};
    const getEl = id => (els[id] = els[id] || mkEl(id));
    const ctx = {
      console,
      document: { getElementById: getEl, querySelector: () => null, querySelectorAll: () => [], createElement: () => mkEl('c'), body: mkEl('body'), addEventListener() {} },
      window: { innerWidth: 1400, matchMedia: () => ({ matches: false }), addEventListener() {} },
      navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36' },
      location: { origin: 'https://nanyishangmao.cn' },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      sessionStorage: { getItem: () => null, setItem() {} },
      setTimeout: fn => { try { fn(); } catch (e) {} return 0; },
      clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
      API: {
        get: async url => {
          if (/\/outbound$/.test(url)) return OUT_ROWS.map(r => ({ ...r }));
          if (/\/products$/.test(url)) return PRODS.map(p => ({ ...p }));
          return [];
        },
        post: async () => ({}), put: async () => ({}),
        patch: async (url, body) => { PATCHES.push({ url, body }); return { success: true }; },
        del: async () => ({})
      },
      ConfigManager: { getOptions: async () => [], renderOptionEditor: () => '' },
      showModal() {}, closeModal() {}, showModal2() {}, closeModal2() {},
      showToast: m => TOASTS.push(m), showImagePreview() {}, triggerBarcodeScan() {},
      isMobile: () => false, confirm: () => true, alert: () => {}
    };
    ctx.window.document = ctx.document;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(TR_SRC, 'utf8') + '\n;globalThis.__M = TransactionsModule;', ctx, { filename: 'transactions.js' });
    return { M: ctx.__M, els, getEl };
  }

  console.log('\n=== B. 出库记录表：三格可点 ===');
  {
    const { M, els, getEl } = createTrRuntime();
    const tbody = getEl('outbound-table-body');
    await M._refreshOutboundTable('main');
    const html = tbody.innerHTML;

    ok(/_editOutboundCell\('main','quantity',11,this\)/.test(html), 'B.1 数量格可点（onclick 指向 _editOutboundCell/quantity）');
    ok(/_editOutboundCell\('main','location',11,this\)/.test(html), 'B.2 地点格可点');
    ok(/_editOutboundCell\('main','order_no',11,this\)/.test(html), 'B.3 订单号格可点');
    ok(/title="点击修改数量"/.test(html) && /title="点击修改地点"/.test(html) && /title="点击修改订单号"/.test(html),
      'B.4 三格都有 title 提示（不然没人知道能点）');
    ok((html.match(/未填/g) || []).length >= 2, 'B.5 空的地点/订单号显示「未填」');
    ok(/SF999/.test(html), 'B.6 已填的订单号正常显示');
    eq(Object.keys(M._outboundRowCache || {}).sort(), ['11', '12', '13'], 'B.7 行缓存按 id 建立（编辑时要取原值）');
    ok(/共 3 条记录/.test(els['outbound-count-label'].textContent), 'B.8 条数标签正常');
    ok(!/未填<\/td>\s*<td>-<\/td>/.test(html), 'B.9 空值不再显示成 -');
  }

  console.log('\n=== C. 行内编辑交互 ===');
  {
    const { M } = createTrRuntime();
    await M._refreshOutboundTable('main');   // 建缓存
    M._refreshOutboundTable = async () => { M.__refreshed = (M.__refreshed || 0) + 1; };
    M.currentTab = 'outbound';

    // C1 数量：数字框，给的是正数（表格里 -24 只是显示约定）
    const c1 = mkCell();
    M._editOutboundCell('main', 'quantity', 11, c1);
    eq(c1._input.type, 'number', 'C.1 数量用数字输入框');
    eq(c1._input.value, '24', 'C.2 ❗编辑器给正数 24（表格显示的 -24 是显示约定，库里存正数）');
    ok(/type="number"/.test(c1.innerHTML), 'C.3 渲染出 input[type=number]');
    ok(c1.dataset.editing === '1', 'C.4 进入编辑态打标记（防重复点击）');

    // 0 → 挡掉
    TOASTS.length = 0; PATCHES.length = 0;
    c1._input.value = '0';
    await c1._handlers.blur();
    eq(PATCHES.length, 0, 'C.5 数量填 0 → 不发请求');
    ok(TOASTS.some(x => /数量必须大于 0/.test(x)), 'C.6 数量填 0 → 提示「数量必须大于 0」');
    ok(!c1.dataset.editing, 'C.7 挡掉后退出编辑态');

    // 值没变 → 不发请求
    const c2 = mkCell();
    M._editOutboundCell('main', 'quantity', 11, c2);
    TOASTS.length = 0; PATCHES.length = 0;
    c2._input.value = '24';
    await c2._handlers.blur();
    eq(PATCHES.length, 0, 'C.8 数量没改（24→24）→ 不发请求');

    // 真改：24 → 4
    const c3 = mkCell();
    M._editOutboundCell('main', 'quantity', 11, c3);
    TOASTS.length = 0; PATCHES.length = 0;
    c3._input.value = '4';
    await c3._handlers.blur();
    eq(PATCHES.length, 1, 'C.9 改成 4 → 发出 1 个请求');
    eq(PATCHES[0].url, '/api/main/outbound/11', 'C.10 打在 PATCH /api/main/outbound/11');
    eq(PATCHES[0].body, { quantity: 4 }, 'C.11 body 只带 quantity');
    ok(TOASTS.some(x => /已修改/.test(x)), 'C.12 提示「已修改」');
    ok(M.__refreshed >= 1, 'C.13 保存后整表重刷（库存/已出库归属/利润要跟着重算）');

    // C14 地点：文本框 + 候选（已有地点）
    const c4 = mkCell();
    M._editOutboundCell('main', 'location', 11, c4);
    eq(c4._input.type, 'text', 'C.14 地点用文本框');
    eq(c4._input.value, '深圳嘉文', 'C.15 预填当前地点');
    ok(/<datalist id="obl-11">/.test(c4.innerHTML), 'C.16 地点带 datalist 候选');
    ok(/深圳龙啊龙/.test(c4.innerHTML), 'C.17 候选里有已用过的「深圳龙啊龙」');
    ok(/深圳嘉文/.test(c4.innerHTML) && /深圳龙啊龙/.test(c4.innerHTML) && (c4.innerHTML.match(/<option/g) || []).length === 2,
      'C.18 候选去重（3 行里只有 2 个不重复地点）');
    TOASTS.length = 0; PATCHES.length = 0;
    c4._input.value = '深圳龙啊龙';
    await c4._handlers.blur();
    eq(PATCHES[0] && PATCHES[0].body, { location: '深圳龙啊龙' }, 'C.19 改地点 → body 只带 location');

    // C20 地点清空（填错了要能清）
    const c5 = mkCell();
    M._editOutboundCell('main', 'location', 11, c5);
    TOASTS.length = 0; PATCHES.length = 0;
    c5._input.value = '';
    await c5._handlers.blur();
    eq(PATCHES[0] && PATCHES[0].body, { location: '' }, 'C.20 地点清空 → 提交空串（能清掉）');

    // C21 订单号
    const c6 = mkCell();
    M._editOutboundCell('main', 'order_no', 12, c6);
    eq(c6._input.type, 'text', 'C.21 订单号用文本框');
    eq(c6._input.value, '', 'C.22 未填的单号预填空');
    TOASTS.length = 0; PATCHES.length = 0;
    c6._input.value = 'SF5151504320354';
    await c6._handlers.blur();
    eq(PATCHES[0] && PATCHES[0].url, '/api/main/outbound/12', 'C.23 打在对应 id 上');
    eq(PATCHES[0] && PATCHES[0].body, { order_no: 'SF5151504320354' }, 'C.24 改订单号 → body 只带 order_no');
    ok(!/<datalist/.test(c6.innerHTML), 'C.25 订单号不给候选（快递单号基本唯一，给了是噪音）');

    // C26 ESC 取消
    const c7 = mkCell();
    c7.innerHTML = '<span>📦 SF999</span>';   // 模拟表格里已经渲染好的单元格
    const before = c7.innerHTML;
    M._editOutboundCell('main', 'order_no', 13, c7);
    TOASTS.length = 0; PATCHES.length = 0;
    c7._input.value = '不应该保存';
    c7._handlers.keydown({ key: 'Escape', preventDefault() {} });
    await c7._handlers.blur();
    eq(PATCHES.length, 0, 'C.26 ESC 取消 → 不发请求');
    eq(c7.innerHTML, before, 'C.27 ESC 取消 → 单元格还原成改动前的样子');
    ok(!c7.dataset.editing, 'C.28 ESC 取消 → 退出编辑态');

    // C29 数据已刷新
    const c8 = mkCell();
    TOASTS.length = 0;
    await M._editOutboundCell('main', 'order_no', 999, c8);
    ok(TOASTS.some(x => /数据已刷新/.test(x)), 'C.29 行已不在缓存里 → 提示刷新后重点');

    // C30 正在编辑时再点
    const c9 = mkCell();
    c9.dataset.editing = '1';
    const htmlBefore = c9.innerHTML;
    await M._editOutboundCell('main', 'quantity', 11, c9);
    eq(c9.innerHTML, htmlBefore, 'C.30 已在编辑态 → 重复点击不重置编辑器');
  }

  console.log('\n----------------------------------------');
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
