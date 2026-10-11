/**
 * 自检：入库登记单「📝 补填下单设备 / 下级」（2026-10-12 用户要求）
 *
 * 背景：入库时「下单设备 / 下级」是可填可不填的；当时没填的单子，
 *       事后没有任何入口补上 → 设备投入 / 盈亏拆分里就永远漏着这一单。
 *       用户要求：没填的单子给一个「补填」按钮；入库时就填了的，按钮不出现。
 *
 * 覆盖：
 *   A. 后端 PATCH /inbound/batch-device —— 批量写 device、非法值挡掉、路由顺序对
 *      ❗路由顺序很关键：'/inbound/:id' 必须排在 '/inbound/batch-device' 之后，
 *        否则 Express 会把 'batch-device' 当成 id，补填直接坏掉。
 *   B. 入库记录表渲染 —— 「整单一条都没填」才出按钮；填过的只显示 🏷️ 设备名
 *      ❗判定必须用全量记录（all），筛选状态下不能把"没填"当成"填了"
 *   C. 补填弹窗 + 提交 —— 补填范围 = 该单号的**全部**记录（不是筛选命中的那几条）
 *
 * 跑法：node .workbuddy/tmp/inbound-device-fill-test.js
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
const cnt = (hay, needle) => (String(hay).split(needle).length - 1);

/* ============================================================
   A. 后端 PATCH /inbound/batch-device
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
    if (/^UPDATE main_inbound SET device/i.test(sql)) { WRITES.push({ sql, params }); return { rows: [] }; }
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
  console.log('=== A. 后端 PATCH /inbound/batch-device ===');

  ok(/router\.patch\('\/inbound\/batch-device'/.test(MC), 'A.0 注册了 PATCH /inbound/batch-device');

  const iBatch = router.stack.findIndex(x => x.route && x.route.path === '/inbound/batch-device' && x.route.methods.patch);
  const iId = router.stack.findIndex(x => x.route && x.route.path === '/inbound/:id' && x.route.methods.patch);
  ok(iBatch >= 0 && iId >= 0 && iBatch < iId,
    `A.1 '/inbound/batch-device' 注册在 '/inbound/:id' 之前（否则会被当成 id 吃掉）: batch=${iBatch}, id=${iId}`);

  // 真按 Express 的匹配顺序跑一遍（先注册的先匹配）
  {
    const toRe = p => new RegExp('^' + p.replace(/:[^/]+/g, '[^/]+') + '/?$');
    const hit = router.stack.find(x => x.route && x.route.methods.patch && toRe(x.route.path).test('/inbound/batch-device'));
    eq(hit && hit.route.path, '/inbound/batch-device',
      'A.1b 模拟 PATCH /inbound/batch-device → 命中补填路由，没被 :id 抢走');
    const hit2 = router.stack.find(x => x.route && x.route.methods.patch && toRe(x.route.path).test('/inbound/123'));
    eq(hit2 && hit2.route.path, '/inbound/:id', 'A.1c 模拟 PATCH /inbound/123 → 仍命中行内编辑那条');
  }

  const P = H('patch', '/inbound/batch-device');

  WRITES.length = 0;
  let res = mkRes();
  await P({ body: { ids: [1, 2], device: '1' } }, res);
  eq(res._status, 200, 'A.2 补填返回 200');
  eq(WRITES[0] && WRITES[0].sql, 'UPDATE main_inbound SET device = ? WHERE id IN (?,?)', 'A.3 一条 SQL 批量写 device');
  eq(WRITES[0] && WRITES[0].params, ['1', 1, 2], 'A.4 参数 = [设备名, ...ids]');
  eq(res._json, { success: true, updated: 2 }, 'A.5 返回更新条数');

  WRITES.length = 0; res = mkRes();
  await P({ body: { ids: [9], device: '李楠' } }, res);
  eq(WRITES[0] && WRITES[0].sql, 'UPDATE main_inbound SET device = ? WHERE id IN (?)', 'A.6 单条也是同一套 SQL');
  eq(WRITES[0] && WRITES[0].params, ['李楠', 9], 'A.7 单条参数正确');

  WRITES.length = 0; res = mkRes();
  await P({ body: { ids: [4], device: '  李楠  ' } }, res);
  eq(WRITES[0] && WRITES[0].params[0], '李楠', 'A.8 设备名前后空格被去掉（避免「1」和「 1 」算两台设备）');

  // 非法输入
  for (const [label, body] of [
    ['空 ids', { ids: [], device: '1' }],
    ['ids 不是数组', { ids: '1,2', device: '1' }],
    ['没传 ids', { device: '1' }],
    ['设备名为空', { ids: [1], device: '' }],
    ['设备名全是空格', { ids: [1], device: '   ' }],
    ['没传设备名', { ids: [1] }],
    ['什么都没传', {}]
  ]) {
    WRITES.length = 0; res = mkRes();
    await P({ body }, res);
    eq(res._status, 400, `A.9 ${label} → 400 挡掉`);
    eq(WRITES.length, 0, `A.10 ${label} → 不写库`);
  }

  /* ============================================================
     B/C. 前端
     ============================================================ */
  function mkEl(id) {
    const set = new Set();
    return {
      id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
      classList: { add(c) { set.add(c); }, remove(c) { set.delete(c); }, contains(c) { return set.has(c); }, toggle() {} },
      querySelector() { return null; }, querySelectorAll() { return []; },
      appendChild() {}, remove() {}, focus() {}, blur() {}, addEventListener() {}, select() {}
    };
  }

  // 入库记录：4 个单号，覆盖「全没填 / 入库时填了 / 部分记录填了」三种情况
  const IN_ROWS = [
    // SF001：两条都没填 → 应该出「补填」按钮
    { id: 1, product_code: 'A1', quantity: 2, device: '', channel: '淘宝', order_no: 'SF001', purchase_price: 100, row_color: '', image_path: '', created_at: '2026-10-01 10:00:00' },
    { id: 2, product_code: 'A2', quantity: 1, device: '', channel: '淘宝', order_no: 'SF001', purchase_price: 0, row_color: '', image_path: '', created_at: '2026-10-01 10:01:00' },
    // SF002：入库时就填了设备 → 不出按钮，只显示 🏷️
    { id: 3, product_code: 'A3', quantity: 3, device: '1', channel: '京东', order_no: 'SF002', purchase_price: 50, row_color: '', image_path: '', created_at: '2026-10-02 09:00:00' },
    // SF003：只有 id 大的那条填了 → 整单算「填过」，不出按钮；显示的是最早那条设备
    { id: 4, product_code: 'A1', quantity: 1, device: '', channel: '滴滴', order_no: 'SF003', purchase_price: 10, row_color: '', image_path: '', created_at: '2026-10-03 08:00:00' },
    { id: 5, product_code: 'A2', quantity: 1, device: '李楠', channel: '滴滴', order_no: 'SF003', purchase_price: 0, row_color: '', image_path: '', created_at: '2026-10-03 08:01:00' },
    // SF004：没填 → 出按钮
    { id: 6, product_code: 'A3', quantity: 5, device: '', channel: '拼多多', order_no: 'SF004', purchase_price: 20, row_color: '', image_path: '', created_at: '2026-10-04 07:00:00' },
    // SF005：两条设备不同（3 和 2）→ 按 id 升序取第一条 = 3
    { id: 7, product_code: 'A1', quantity: 1, device: '3', channel: '淘宝', order_no: 'SF005', purchase_price: 5, row_color: '', image_path: '', created_at: '2026-10-05 06:00:00' },
    { id: 8, product_code: 'A2', quantity: 1, device: '2', channel: '淘宝', order_no: 'SF005', purchase_price: 0, row_color: '', image_path: '', created_at: '2026-10-05 06:01:00' }
  ];
  const PRODS = [
    { code: 'A1', name: '例子A', spec: '100g' },
    { code: 'A2', name: '例子B', spec: '200g' },
    { code: 'A3', name: '例子C', spec: '300g' }
  ];

  const PATCHES = [];
  const TOASTS = [];
  let MODAL_TITLE = null, MODAL_CLOSED = 0;

  function createTrRuntime(rows) {
    const els = {};
    const getEl = id => (els[id] = els[id] || mkEl(id));
    const ctx = {
      console,
      document: { getElementById: getEl, querySelector: () => null, querySelectorAll: () => [], createElement: () => mkEl('c'), body: mkEl('body'), addEventListener() {} },
      window: { innerWidth: 1400, matchMedia: () => ({ matches: false }), addEventListener() {} },
      navigator: { userAgent: 'Mozilla/5.0 (iPhone) Safari/604.1' },
      location: { origin: 'https://nanyishangmao.cn' },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      sessionStorage: { getItem: () => null, setItem() {} },
      setTimeout: fn => { try { fn(); } catch (e) {} return 0; },
      clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
      API: {
        get: async url => {
          if (/\/inbound$/.test(url)) return rows.map(r => ({ ...r }));
          if (/\/products$/.test(url)) return PRODS.map(p => ({ ...p }));
          return [];
        },
        post: async () => ({}), put: async () => ({}), del: async () => ({}),
        patch: async (url, body) => { PATCHES.push({ url, body }); return { success: true }; }
      },
      ConfigManager: { getOptions: async () => [], renderOptionEditor: () => '' },
      showModal: t => { MODAL_TITLE = t; }, closeModal: () => { MODAL_CLOSED++; },
      showModal2() {}, closeModal2() {},
      showToast: m => TOASTS.push(m), showImagePreview() {}, triggerBarcodeScan() {},
      isMobile: () => false, confirm: () => true, alert: () => {}
    };
    ctx.window.document = ctx.document;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(TR_SRC, 'utf8') + '\n;globalThis.__M = TransactionsModule;', ctx, { filename: 'transactions.js' });
    return { M: ctx.__M, els, getEl };
  }

  // 从渲染出来的表格里，按单号取出那一行的组头 HTML
  const groupHtml = (html, orderNo) => {
    const i = html.indexOf('📦 ' + orderNo);
    if (i < 0) return '';
    const start = html.lastIndexOf('<tr', i);
    const end = html.indexOf('</tr>', i);
    return html.slice(start, end < 0 ? html.length : end);
  };
  // 组头里的 cacheKey（'g3' 这种）——⚠️ 组是按最新时间倒序排的，别用 g0 猜某一单
  const cacheKeyOf = (html, orderNo) => {
    const g = groupHtml(html, orderNo);
    const m = /_toggleGroupRows\('inb-grp-(\d+)'/.exec(g);
    return m ? 'g' + m[1] : null;
  };

  console.log('\n=== B. 入库表组头：没填的才出「补填」按钮 ===');
  {
    const { M, els, getEl } = createTrRuntime(IN_ROWS);
    const tbody = getEl('inbound-table-body');
    await M._refreshInboundTable('main');
    const html = tbody.innerHTML;

    const g001 = groupHtml(html, 'SF001');
    const g002 = groupHtml(html, 'SF002');
    const g003 = groupHtml(html, 'SF003');
    const g004 = groupHtml(html, 'SF004');
    const g005 = groupHtml(html, 'SF005');

    ok(/补填下单设备/.test(g001), 'B.1 SF001（两条都没填）→ 组头出现「📝 补填下单设备」按钮');
    ok(/showFillDevice\('/.test(g001), 'B.2 按钮 onclick 指向 showFillDevice（按下标取，不拼单号）');
    ok(/event\.stopPropagation\(\)/.test(g001), 'B.3 ❗按钮阻止冒泡（否则点补填会顺带把这一单折叠起来）');

    ok(!/补填下单设备/.test(g002), 'B.4 ❗SF002（入库时就填了设备）→ 没有补填按钮');
    ok(/🏷️ 1|🏷️&#\d+;? ?1|🏷️/.test(g002), 'B.5 SF002 → 组头显示 🏷️ 设备名');
    ok(/🏷️[\s\S]{0,40}1/.test(g002), 'B.6 SF002 显示的是设备「1」');

    ok(!/补填下单设备/.test(g003), 'B.7 SF003（只有后加的那条填了）→ 整单算填过，不出按钮');
    ok(/🏷️/.test(g002) && !/🏷️/.test(g001), 'B.8 没填的单子不显示 🏷️（改用按钮），填过的才显示 🏷️');

    ok(/补填下单设备/.test(g004), 'B.9 SF004（没填）→ 出按钮');

    ok(!/补填下单设备/.test(g005), 'B.10 SF005（两条设备不同）→ 填过就不出按钮');

    eq(cnt(html, '补填下单设备'), 2, 'B.11 全表只有 2 个单号出按钮（SF001 / SF004），不多不少');

    // 顺序：SF001 是 id 最小的，它的设备取「李楠」？
    // SF003 的两条：id4 没填、id5 是李楠 → 按 id 升序取第一条填了值的 = 李楠
    ok(/李楠/.test(g003), 'B.12 ❗SF003 显示的设备 = 按 id 升序第一条填了值的（李楠）');

    // 全填过的场景 → 一个按钮都不该有
    const r2 = createTrRuntime(IN_ROWS.filter(r => r.device));
    await r2.M._refreshInboundTable('main');
    const html2 = r2.els['inbound-table-body'].innerHTML;
    eq(cnt(html2, '补填下单设备'), 0, 'B.13 所有单号都填过设备 → 补填按钮 0 个');
  }

  console.log('\n=== C. 筛选状态下不能误判 ===');
  {
    const { M, getEl } = createTrRuntime(IN_ROWS);
    await M._refreshInboundTable('main');
    // 筛选「例子B」→ SF001 只命中 id2 一条
    M._inboundFilter = { fields: ['name'], keyword: '例子B' };
    M._renderInboundRows();
    const html = getEl('inbound-table-body').innerHTML;
    const g001 = groupHtml(html, 'SF001');
    ok(/补填下单设备/.test(g001),
      'C.1 ❗筛选后 SF001 只剩 1 条命中，但按钮仍在（判定用的是全量记录 all，不是筛选结果）');
    eq(cnt(html, '补填下单设备'), 1, 'C.2 筛选后按钮数 = 1（SF001；SF004 的「例子C」没命中）');

    // 打开弹窗：补填范围必须是整单 2 条，不是命中的那 1 条
    const ck = cacheKeyOf(html, 'SF001');
    ok(!!ck, 'C.2b 能从组头里取到 SF001 的 cacheKey');
    M.showFillDevice(ck);
    eq(M._fillDeviceIds.slice().sort((a, b) => a - b), [1, 2],
      'C.3 ❗补填范围 = 该单号的全部记录（不是筛选命中的那 1 条），否则设备归属会对不上');
  }

  console.log('\n=== D. 补填弹窗 + 提交 ===');
  {
    const { M, getEl } = createTrRuntime(IN_ROWS);
    await M._refreshInboundTable('main');
    PATCHES.length = 0; TOASTS.length = 0; MODAL_CLOSED = 0;

    // D1 打开弹窗
    const html0 = getEl('inbound-table-body').innerHTML;
    const ck0 = cacheKeyOf(html0, 'SF001');
    M.showFillDevice(ck0);
    const body = getEl('modal-body').innerHTML;
    ok(/补填下单设备/.test(MODAL_TITLE || ''), 'D.1 弹窗标题是「📝 补填下单设备 / 下级」');
    ok(/SF001/.test(body), 'D.2 弹窗里写明是哪一单');
    ok(/2<\/strong> 条记录|这 2 条/.test(body), 'D.3 弹窗写明这单有 2 条记录');
    ok(/id="fill-device"/.test(body), 'D.4 有设备名输入框');
    ok(/<datalist id="fill-device-options">/.test(body), 'D.5 输入框挂 datalist（电脑上能自动提示）');
    ok(/_pickFillDevice\(this\)/.test(body), 'D.6 ❗给了「用过的设备」可点胶囊（手机上 datalist 用不了）');
    ok(/data-device="1"/.test(body) && /data-device="李楠"/.test(body) && /data-device="2"|data-device="3"/.test(body),
      'D.7 胶囊里是历史用过的设备名');
    eq(M._fillDeviceIds, [1, 2], 'D.8 记录了要补填的记录 id');

    // D2 点胶囊填进输入框
    const inp = getEl('fill-device');
    M._pickFillDevice({ dataset: { device: '李楠' }, classList: { add() {} }, textContent: '李楠' });
    eq(inp.value, '李楠', 'D.9 点胶囊 → 设备名填进输入框');

    // D3 空值挡掉
    inp.value = '   ';
    await M.submitFillDevice('main');
    eq(PATCHES.length, 0, 'D.10 设备名空 → 不发请求');
    ok(TOASTS.some(x => /请填写下单设备/.test(x)), 'D.11 设备名空 → 提示要填');

    // D4 真提交
    PATCHES.length = 0; TOASTS.length = 0; MODAL_CLOSED = 0;
    let REFRESHED = 0;
    M._refreshInboundTable = async () => { REFRESHED++; };
    M.currentTab = 'ledger';
    M.renderLedgerTab = async () => { REFRESHED++; };
    inp.value = '李楠';
    await M.submitFillDevice('main');
    eq(PATCHES.length, 1, 'D.12 提交 → 发出 1 个请求');
    eq(PATCHES[0].url, '/api/main/inbound/batch-device', 'D.13 打在 PATCH /api/main/inbound/batch-device');
    eq(PATCHES[0].body, { ids: [1, 2], device: '李楠' }, 'D.14 body = { ids: 整单全部记录, device }');
    ok(TOASTS.some(x => /2 条/.test(x) && /李楠/.test(x)), 'D.15 提示写清「补了哪几条、补成什么」');
    eq(M._fillDeviceIds, [], 'D.16 提交后清掉待补填 id（避免残留误写下一单）');
    ok(MODAL_CLOSED >= 1, 'D.17 提交后关弹窗');
    ok(REFRESHED >= 2, 'D.18 ❗保存后整表重刷 + 台账重算（设备投入 / 盈亏拆分跟着变）');

    // D5 设备名带特殊字符要转义
    const r3 = createTrRuntime(IN_ROWS);
    await r3.M._refreshInboundTable('main');
    const g3 = /showFillDevice\('([^']+)'\)/.exec(r3.els['inbound-table-body'].innerHTML);
    r3.M.showFillDevice(g3[1]);
    // 人为塞一个带引号的设备名进选项
    r3.M._inboundAllRecords[0].device = '';
    r3.M._inboundAllRecords[2].device = '李"楠';
    r3.M.showFillDevice(g3[1]);
    const body3 = r3.els['modal-body'].innerHTML;
    ok(/data-device="李&quot;楠"/.test(body3), 'D.19 ❗设备名里的引号被转义（否则会撑坏 HTML 属性）');
  }

  console.log('\n----------------------------------------');
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
