/**
 * 「上级汇总」线上真实数据核对
 * 数据源：.workbuddy/tmp/dash-now.json（刚从 https://nanyishangmao.cn/api/main/dashboard 抓的实时快照）
 * 跑法：node .workbuddy/tmp/device-group-live-test.js
 */
const fs = require('fs');
const vm = require('vm');
const SRC = 'F:/出入库管理系统/public/js/modules/transactions.js';
const dash = JSON.parse(fs.readFileSync('F:/出入库管理系统/.workbuddy/tmp/dash-now.json', 'utf8'));

let pass = 0, fail = 0;
const ok = (v, m) => { if (v) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } };

function createRuntime() {
  const els = {};
  const mkEl = id => ({
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; } },
    querySelector() { return mkEl(id + '-child'); }, querySelectorAll() { return []; },
    appendChild() {}, remove() {}, focus() {}, blur() {}, reset() {}, addEventListener() {},
  });
  const getEl = id => (els[id] = els[id] || mkEl(id));
  const ctx = {
    console,
    document: { getElementById: getEl, querySelector: () => null, querySelectorAll: () => [], createElement: () => mkEl('c'), body: { appendChild() {} }, addEventListener() {} },
    window: { innerWidth: 1400, matchMedia: () => ({ matches: false }), addEventListener() {} },
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36' },
    location: { origin: 'https://nanyishangmao.cn' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    setTimeout: fn => { try { fn(); } catch (e) {} return 0; },
    clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    API: { get: async () => ({}), post: async () => ({}), put: async () => ({}), patch: async () => ({}), del: async () => ({}) },
    ConfigManager: { getOptions: async () => [], renderOptionEditor: () => '' },
    showModal(t) {}, closeModal() {}, showModal2(t) { ctx.__t2 = t; }, closeModal2() {},
    showToast() {}, showImagePreview() {}, triggerBarcodeScan() {},
    isMobile: () => false, confirm: () => true, alert: () => {},
  };
  ctx.window.document = ctx.document;
  ctx.window.API = ctx.API;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(SRC, 'utf8') + '\n;globalThis.__M = TransactionsModule;', ctx, { filename: 'transactions.js' });
  return { M: ctx.__M, ctx, getEl };
}

const money = v => (v < 0 ? '-¥' : '¥') + Math.abs(v).toFixed(2);
const devOf = n => dash.by_device.find(d => d.device === n);
const REAL = ['1', '3', '2', '4'];
const sum = k => REAL.reduce((s, n) => s + (devOf(n) ? devOf(n)[k] : 0), 0);

console.log('\n线上快照（' + (dash.daily_end || '?') + '）：已出库 ' + dash.orders.length + ' 单，设备共 ' + dash.by_device.length + ' 个');
dash.by_device.forEach(d => console.log('   ' + d.device.padEnd(8) + ' 投入 ' + money(d.invest) + '  收益 ' + money(d.revenue) + '  盈亏 ' + money(d.profit) + '  ' + d.orders + ' 单'));
console.log('   —— 李楠（1+2+3+4）应为：投入 ' + money(sum('invest')) + '  收益 ' + money(sum('revenue')) + '  盈亏 ' + money(sum('profit')) + '  ' + sum('orders') + ' 单\n');

console.log('=== 1. 真实数据：顶层弹窗把 1 / 3 / 2 / 4 并成「李楠」 ===');
{
  const { M, getEl } = createRuntime();
  M._dashOrders = dash.orders; M._dashByDevice = dash.by_device; M._dashTotals = dash.totals;
  M._showDeviceBreakdown();
  const html = getEl('modal-body-2').innerHTML;
  ok(M._devRows.length === 2, '1.1 顶层 2 行（李楠 + 林浩东），而不是原来的 5 行');
  ok(M._devGroupRows.length === 1, '1.2 有 1 个上级分组');
  const g = M._devGroupRows[0];
  ok(g.name === '李楠' && g.badge === '1 · 2 · 3 · 4', '1.3 分组名「李楠」，成员 = 1 · 2 · 3 · 4（按配置顺序）');
  ok(Math.abs(g.invest - sum('invest')) < 0.005, `1.4 李楠投入 = 1+3+2+4 = ${money(g.invest)}（线上 ${money(sum('invest'))}）`);
  ok(Math.abs(g.revenue - sum('revenue')) < 0.005, `1.5 李楠收益 = ${money(g.revenue)}（线上 ${money(sum('revenue'))}）`);
  ok(Math.abs(g.profit - sum('profit')) < 0.005, `1.6 李楠盈亏 = ${money(g.profit)}（线上 ${money(sum('profit'))}）`);
  ok(g.orders === sum('orders'), `1.7 李楠单数 = ${g.orders}（线上 ${sum('orders')} 单）`);
  ok(M._devRows[0].row.isGroup && M._devRows[1].row.name === '林浩东', '1.8 排序：李楠（投入最大）在上，林浩东在下');
  ok(html.includes(money(g.invest)) && html.includes(money(sum('profit'))), '1.9 页面金额与真实数据一致');
  ok(html.indexOf('李楠') < html.indexOf('林浩东'), '1.10 页面上李楠排在林浩东前面');

  // 合计不能把李楠这层重复算进去
  const allInvest = dash.by_device.reduce((s, d) => s + d.invest, 0);
  ok(Math.abs(allInvest - dash.totals.invest) < 0.02, `1.11 合计 = 全部设备之和 ${money(allInvest)}，与总投入一致（未被李楠重复累加）`);
  ok(html.includes('合计') && html.includes(money(allInvest)), '1.12 页面合计行 = ' + money(allInvest));

  // 设备 4 已经并入李楠，不能再单独占一行（2026-10-13 需求变更）
  const d4 = devOf('4');
  ok(!/font-weight:500;">4<\/td>/.test(html), '1.13 设备「4」已并进李楠，不再单独占一行');
  ok(g.members.length === REAL.length && g.members.some(m => String(m.device).trim() === '4'),
    '1.14 李楠这一层的成员里有设备 4（' + REAL.length + ' 个）');
  ok(Math.abs(g.invest - (sum('invest'))) < 0.005 && g.invest > d4.invest,
    '1.15 李楠投入含设备 4 的 ' + money(d4.invest) + '，合计 ' + money(g.invest));
}

console.log('\n=== 2. 点「李楠」→ 1 / 3 / 2 / 4 四行，各自数值与线上一致 ===');
{
  const { M, ctx, getEl } = createRuntime();
  M._dashOrders = dash.orders; M._dashByDevice = dash.by_device; M._dashTotals = dash.totals;
  M._showDeviceBreakdown();
  const gi = M._devRows.findIndex(r => r.row.isGroup);
  M._showDeviceGroup(gi);
  const html = getEl('modal-body-2').innerHTML;
  ok(ctx.__t2 === '李楠 · 上级汇总', '2.1 标题「李楠 · 上级汇总」');
  REAL.forEach(n => {
    const d = devOf(n);
    ok(html.includes(money(d.invest)) && html.includes(money(d.profit)),
      `2.${n === '1' ? 2 : n === '3' ? 3 : 4} 设备「${n}」投入 ${money(d.invest)} / 盈亏 ${money(d.profit)} 与线上一致`);
  });
  ok(html.includes('已出库 ' + sum('orders') + ' 单'), '2.5 顶部写明已出库 ' + sum('orders') + ' 单');
  ok(html.includes('1 · 2 · 3 · 4'), '2.6 顶部写明 = 1 · 2 · 3 · 4 的汇总');

  // 点「1」看它下面的单
  M._showGroupMemberOrders(gi, 0);
  const h1 = getEl('modal-body-2').innerHTML;
  const d1 = devOf('1');
  ok(ctx.__t2 === '下单设备/下级 · 1', '2.7 点设备「1」→ 标题「下单设备/下级 · 1」');
  ok(h1.includes('「1」已出库 ' + d1.orders + ' 单'), `2.8 只统计设备 1 的 ${d1.orders} 单`);
  const other = dash.orders.filter(o => o.device !== '1' && o.order_no && h1.includes(o.order_no));
  ok(other.length === 0, '2.9 不含其它设备的单号');
  ok(h1.includes('_showDeviceGroup(' + gi + ')'), '2.10 返回按钮回到「上级汇总」');
}

console.log('\n=== 3. 明细/台账仍按 1 / 2 / 3 / 4；按月弹窗已同步汇总 ===');
{
  const { M, getEl } = createRuntime();
  M._dashOrders = dash.orders; M._dashByDevice = dash.by_device; M._dashTotals = dash.totals;
  M._showInvestDetail();
  const hd = getEl('modal-body').innerHTML;
  ok(!hd.includes('李楠'), '3.1 「总投入 · 明细」里没有李楠');
  ok(hd.includes('林浩东'), '3.2 明细里设备名原样（林浩东）');
  const devCells = (hd.match(/font-size:12px;color:var\(--text-secondary\);white-space:nowrap;">([^<]+)</g) || []);
  ok(devCells.some(s => s.endsWith('>1<')) && devCells.some(s => s.endsWith('>2<')) && devCells.some(s => s.endsWith('>3<')) && devCells.some(s => s.endsWith('>4<')),
    '3.3 明细里 1 / 2 / 3 / 4 都照旧单列出现');

  M._showMonthBreakdown();
  const hm = getEl('modal-body-2').innerHTML;
  ok(hm.includes('李楠') && hm.includes('1 · 2 · 3 · 4'), '3.4 「按月 · 设备投入」里也汇总出李楠（与之同口径）');
}

console.log('\n' + '='.repeat(52));
console.log(fail === 0 ? `线上真实数据核对通过：${pass} 项` : `通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail === 0 ? 0 : 1);
