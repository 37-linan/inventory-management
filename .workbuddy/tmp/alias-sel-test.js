/**
 * 自检：「已记住（别名命中）的行勾选了却导不进去」（2026-10-05 用户报）
 *
 * 现场：导入行情弹窗里 7 行全是上次导入过的商品 → 右侧 badge 全是「已记住」，
 *       用户点了「全选」再点「确认导入勾选的」，只弹「先勾选要导入的行」。
 *
 * 根因：后端 /price-import/match 对别名命中行只回 code、不回 candidates
 *       （aliasMatch 里 candidates: []），前端 _priceOptions 于是退化成
 *       `<option value="">（没有候选，从下面选）</option>` —— 下拉没有选中值；
 *       而 confirmPriceImport 的准入条件是「勾选 && sel.value 非空」，
 *       两个条件只满足一个 → 行被静默跳过 → items 为空 → 弹那句 toast。
 *
 * 断言 4 件事：
 *   ① 别名行（有 code、无 candidates）渲染出来必须带 selected 项，且不重复列出该商品
 *   ② 别名行点确认能真的进 items（导得出去）
 *   ③ 真·没候选的行（code 为空）仍然显示占位项、仍然导不进去（回归）
 *   ④ 勾了但没选商品 → toast 要说清楚「还没选具体商品」，不能只说「先勾选」
 *
 * 跑法：node .workbuddy/tmp/alias-sel-test.js
 */
const fs = require('fs');
const vm = require('vm');
const ROOT = 'F:/出入库管理系统';

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) pass++; else { fail++; console.log('  ✗ ' + l); } };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${l}  →  期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`);

function createRuntime() {
  const DOM = {};
  const TOASTS = [];
  const POSTS = [];
  const doc = {
    getElementById: id => DOM[id] || null,
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, setAttribute() {}, innerHTML: '' }),
    querySelector: () => null,
    body: { appendChild() {} }
  };
  const sb = {
    console, document: doc, setTimeout, clearTimeout, fetch,
    showModal() {}, closeModal() {}, showToast: m => TOASTS.push(m),
    API: { get: async () => [], post: async (u, b) => { POSTS.push({ u, b }); return { saved: 1, aliased: 1, failed: 0 }; } },
    ConfigManager: { getOptions: async () => [], renderOptionEditor: () => '' },
    BarcodeScanner: { startScan() {} },
  };
  sb.window = sb;
  vm.createContext(sb);
  sb.__PM = vm.runInContext(fs.readFileSync(ROOT + '/public/js/modules/products.js', 'utf8') + '\n;ProductsModule', sb);
  return { PM: sb.__PM, DOM, TOASTS, POSTS };
}

/* 线上同款商品（够用即可） */
const CATALOG = [
  { code: 'HFS470', name: '海飞丝盈润修护型', spec: '紫 670g', type: '洗护' },
  { code: 'HFS471', name: '海飞丝净爽止痒型', spec: '蓝 670g', type: '洗护' },
  { code: 'LOREAL9', name: '巴黎欧莱雅奇焕精油', spec: '100ml', type: '洗护' },
];

/* 别名命中行：后端只给 code + match_name/match_spec，candidates 为空数组 */
const aliasRow = i => ({
  idx: i, raw: '海飞丝盈润修护型 紫 670g', price: 30,
  code: 'HFS470', match_name: '海飞丝盈润修护型', match_spec: '紫 670g',
  score: 1, source: 'alias', candidates: []
});

console.log('=== ① _priceOptions：别名行必须自带 selected 项 ===');
{
  const { PM } = createRuntime();
  PM._priceAll = CATALOG;
  const html = PM._priceOptions(aliasRow(1));
  ok(/<option value="HFS470" selected>/.test(html),
    '别名行的下拉里有 value="HFS470" 且 selected（旧代码这里是空 value 的占位项）');
  ok(!/\(没有候选，从下面选\)/.test(html) || !/value=""/.test(html),
    '不再退化成「（没有候选，从下面选）」占位项');
  ok(/已记住/.test(html), '选项文案标了「已记住」');
  ok(/670g/.test(html), '选项里带规格（同款多编码时要能分辨）');
  eq(html.split('value="HFS470"').length - 1, 1,
    'HFS470 只出现一次（不能既在候选里、又在兜底全量列表里重复一次）');
  ok(/value="HFS471"/.test(html) && /value="LOREAL9"/.test(html),
    '其它商品仍然能在下拉里兜底选到');
}

console.log('=== ② _renderPriceMatch：整块渲染后依然是选中的 ===');
{
  const { PM, DOM } = createRuntime();
  PM._priceAll = CATALOG;
  PM._priceRows = [aliasRow(1), Object.assign(aliasRow(2), { idx: 2, raw: '巴黎欧莱雅奇焕精油 100ml', code: 'LOREAL9', match_spec: '100ml' })];
  DOM['price-import-result'] = { innerHTML: '' };
  PM._renderPriceMatch();
  const html = DOM['price-import-result'].innerHTML;
  ok(/id="pi-sel-1"[\s\S]*?<option value="HFS470" selected>/.test(html),
    '第 1 行渲染后的 select 第 1 个选项就是 selected 的 HFS470');
  ok(/id="pi-sel-2"[\s\S]*?<option value="LOREAL9" selected>/.test(html),
    '第 2 行同理');
  ok((html.match(/value="">（没有候选，从下面选）<\/option>/g) || []).length === 0,
    '一张别名表渲染完，一个空占位 select 都不该有');
}

console.log('=== ③ 真·没候选的行：占位照旧、仍然导不进去（回归） ===');
{
  const { PM, DOM } = createRuntime();
  PM._priceAll = CATALOG;
  const noneRow = { idx: 1, raw: '某个系统里没有的东西', price: 9, code: '', match_name: '', match_spec: '', score: 0, source: 'none', candidates: [] };
  const html = PM._priceOptions(noneRow);
  ok(/<option value="">（没有候选，从下面选）<\/option>/.test(html),
    'code 为空的行仍然显示占位项（没被误伤成 selected）');
  void DOM;
}

console.log('=== ④ confirmPriceImport：别名行导得出去；没选商品要说清楚 ===');
(async () => {
  // 4.1 别名行 + 已勾选 → 真的进 items、真的调接口
  {
    const { PM, DOM, TOASTS, POSTS } = createRuntime();
    PM._priceRows = [aliasRow(1)];
    PM.loadProducts = async () => {};
    DOM['price-import-date'] = { value: '2026-10-05' };
    DOM['price-import-result'] = { innerHTML: '' };
    DOM['pi-ck-1'] = { checked: true };
    DOM['pi-sel-1'] = { value: 'HFS470' };
    await PM.confirmPriceImport();
    eq(POSTS.length, 1, '确实调了 /price-import/commit（旧代码到不了这里）');
    eq(POSTS[0].u, '/api/main/price-import/commit', '打的是导入接口');
    eq(POSTS[0].b.items, [{ raw: '海飞丝盈润修护型 紫 670g', price: 30, code: 'HFS470' }],
      'items 里带着别名行（raw/price/code 齐全）');
    eq(POSTS[0].b.date, '2026-10-05', '生效日跟着日期框走');
    eq(TOASTS.some(t => /先勾选要导入的行/.test(t)), false, '不再误报「先勾选要导入的行」');
    eq(TOASTS.some(t => /写入 1 条行情/.test(t)), true, '提示导入成功');
    const t1 = TOASTS.find(t => /导入完成/.test(t)) || '';
    ok(/生效日 2026-10-05/.test(t1),
      '提示里写出「生效日」——不然用户会去今天那天的行情表里翻（旧文案没有，用户为此困惑过）');
    ok(/同时记住这 1 个行情名/.test(t1),
      '第二个数字说明白了「同时记住这 N 个行情名」，不再让人误读成"只对应了 1 条"');
    eq(/失败/.test(t1), false, '没失败就不提失败');
  }

  // 4.2 勾了但下拉没选 → toast 要指明「还没选具体商品」
  {
    const { PM, DOM, TOASTS, POSTS } = createRuntime();
    PM._priceRows = [{ idx: 1, raw: '别名行', price: 30, code: 'HFS470', candidates: [], source: 'alias' }];
    DOM['price-import-date'] = { value: '2026-10-05' };
    DOM['price-import-result'] = { innerHTML: '' };
    DOM['pi-ck-1'] = { checked: true };
    DOM['pi-sel-1'] = { value: '' };   // 用户没挑商品
    await PM.confirmPriceImport();
    eq(POSTS.length, 0, '没选商品就不写库');
    ok(TOASTS.some(t => /还没选具体商品/.test(t)),
      'toast 说明是「没选具体商品」，不是「没勾选」（用户才不会被绕晕）');
  }

  // 4.2b 一部分进去了、一部分没选商品 → 成功提示里要补一句「另有 N 行没导入」
  {
    const { PM, DOM, TOASTS } = createRuntime();
    PM._priceRows = [aliasRow(1), { idx: 2, raw: '没选商品的行', price: 9, code: '', candidates: [] }];
    PM.loadProducts = async () => {};
    DOM['price-import-date'] = { value: '2026-10-04' };
    DOM['price-import-result'] = { innerHTML: '' };
    DOM['pi-ck-1'] = { checked: true };
    DOM['pi-sel-1'] = { value: 'HFS470' };
    DOM['pi-ck-2'] = { checked: true };
    DOM['pi-sel-2'] = { value: '' };
    await PM.confirmPriceImport();
    const t = TOASTS.find(x => /导入完成/.test(x)) || '';
    ok(/另有 1 行没选商品，未导入/.test(t),
      '成功提示里补上「另有 1 行没选商品，未导入」（不然用户不知道有行被丢了）: ' + t);
    ok(/生效日 2026-10-04/.test(t), '生效日跟着日期框走（用户常填成表头那天）');
  }

  // 4.3 一个都没勾 → 仍然是原来那句
  {
    const { PM, DOM, TOASTS, POSTS } = createRuntime();
    PM._priceRows = [aliasRow(1)];
    DOM['price-import-date'] = { value: '2026-10-05' };
    DOM['price-import-result'] = { innerHTML: '' };
    DOM['pi-ck-1'] = { checked: false };
    DOM['pi-sel-1'] = { value: 'HFS470' };
    await PM.confirmPriceImport();
    eq(POSTS.length, 0, '没勾选就不写库');
    ok(TOASTS.some(t => /先勾选要导入的行/.test(t)), '【回归】真没勾选时提示不变');
  }

  console.log('\n----------------------------------------');
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
