/**
 * 验证「10.6 深圳仓库美妆 / 实拍数码 / 拍立得酒水行情表 → 可导入文字」
 * 真加载 products.js 跑 _parsePriceText，再调线上 /price-import/match 核对首选编码
 */
const fs = require('fs');
const vm = require('vm');
const ROOT = 'F:/出入库管理系统';
const TXT = ROOT + '/导入行情-美妆数码拍立得-2026-10-06.txt';

const TEXT = fs.readFileSync(TXT, 'utf8');

// [系统商品名(应解析出的 name), 价格, 期望编码]
const EXPECT = [
  ['珂润面霜 40g', 80.5, '4901301410443'],
  ['菌菇水 200ml', 86, '100176424631'],
  ['芭比布朗清润卸妆油 200ml', 187, '716170292502'],
  ['hermes尼罗河花园淡香水 30ml', 173, '3346131101375'],
  ['CPB肌肤之钥洗面奶湿润型 125ml', 156, '729238171640'],
  ['科颜氏第三代高保湿面霜 125ml', 193, '3605975028799'],
  ['skii体验四件套', 398, '4979006119282N'],
  ['海蓝之谜精粹水 150ml', 572, '747930121695'],
  ['天气丹25新版八件套', 579, '8809949513211'],
  ['娇兰蜂姿水 150ml', 216, '3346470615557'],
  ['范思哲同名男士淡香水 50ml', 200, '8011003995950'],
  ['兰蔻净澈焕肤洁面乳 125ml', 146, '4935421707626'],
  ['IPSA/茵芙莎流金岁月美肤水流金水 300ml', 126, '4931449300368'],
  ['Whoo水妍两件套 150ml+110ml', 186, ['8809949537477', '8809949537514']], // 同名同规格重复两条
  ['资生堂百优精纯乳霜 50ml', 173, '0729238103207'],
  ['小米手环11NFC版 银色', 328, '6939093005309'],
  ['Redml watch6 蓝色', 500, '6932554452650'],
  ['小爱音箱play增强版 黑色', 95, '6934177735172'],
  ['小米小爱音箱pro 黑色', 205, '6932554486853'],
  ['米家声波电动牙刷T302 蓝色', 95, '6941812701423'],
  ['米家声波扫振电动牙刷pro 紫色', 111, '6941812753422'],
  ['米家口袋照片打印机pro', 435, '6932554438593'],
  ['华为freebuds se 3 金色', 108, '6942103140082'],
  ['Redmi Buds 8 青春版 黑色', 101, '6932554471873'],
  ['米家电动剃须刀S500 黑色', 98, '6934177714184'],
  ['吉列极光剃须刀1刀架2刀头1底座', 114, '6900068000520'],
  ['理肤泉b5修护套装', 18, '6932313157086'],
  ['苏菲超熟睡安心裤L码 5条', 7.7, '6934660550305'],
  ['苏菲超熟睡安心裤卫生巾xl码 5片', 8.7, '6934660550206'],
  ['潘婷护发素紫 180ml', 16, '4902430694902'],
  ['拍立得相机mini13 香芋紫', 605, '4547410564624'],
  ['拍立得双白盒装国行 20张', 117, '4547410217872'],
  ['拍立得双白盒装国际版 20张', 117, '4547410173833'],
  ['拍立得单白盒装 10张', 59, '4547410217865'],
  ['拍立得单白盒装日版 10张', 59, '4547410377224'],
  ['拍立得白边锡纸装 10张', 57, '386679998756'],
  ['拍立得mini13配件盒 漂浮时刻', 20, '6977665613262'],
  ['奔富389 750ml', 330, '9310297052226'],
  ['奔富407 750ml', 500, '9310297018185'],
];

function createRuntime() {
  const els = {};
  const doc = {
    getElementById: id => els[id] || null,
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, contains: () => false }, appendChild() {}, setAttribute() {}, innerHTML: '' }),
    querySelector: () => null,
    body: { appendChild() {} }
  };
  const sb = {
    console, document: doc, setTimeout, clearTimeout, fetch,
    showModal() {}, closeModal() {}, showToast() {},
    API: { get: async () => [], post: async () => ({}) },
    ConfigManager: { getOptions: async () => [], renderOptionEditor: () => '' },
    BarcodeScanner: { startScan() {} },
  };
  sb.window = sb;
  vm.createContext(sb);
  const code = fs.readFileSync(ROOT + '/public/js/modules/products.js', 'utf8');
  sb.__PM = vm.runInContext(code + '\n;ProductsModule', sb);
  return sb;
}

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + l); } };

(async () => {
  const sb = createRuntime();
  const rows = sb.__PM._parsePriceText(TEXT);

  console.log('=== 1. 解析（行数/名称/价格）===');
  ok(rows.length === EXPECT.length, `解析出 ${EXPECT.length} 行（实际 ${rows.length}）`);
  if (rows.length !== EXPECT.length) {
    console.log('  实际行：'); rows.forEach((r, i) => console.log('   ', i + 1, JSON.stringify(r)));
  }
  for (let i = 0; i < Math.min(rows.length, EXPECT.length); i++) {
    const [nm, pr] = EXPECT[i];
    ok(rows[i] && rows[i].name === nm, `第${i + 1}行名称「${nm}」（实际「${rows[i] && rows[i].name}」）`);
    ok(rows[i] && rows[i].price === pr, `第${i + 1}行价格 ${pr}（实际 ${rows[i] && rows[i].price}）`);
  }

  console.log('=== 2. 线上配对（首选编码）===');
  const res = await fetch('https://nanyishangmao.cn/api/main/price-import/match', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows }),
  });
  const j = await res.json();
  const list = j.rows || [];
  ok(list.length === rows.length, '接口返回条数与解析一致');
  let mismatch = 0;
  EXPECT.forEach(([nm, pr, code], i) => {
    const r = list[i] || {};
    const good = Array.isArray(code) ? code.includes(r.code) : r.code === code;
    if (!good) { mismatch++; }
    ok(good, `「${nm}」→ ${Array.isArray(code) ? code.join('/') : code}（实际 ${r.code || '无'} / ${r.match_name || '-'} / ${r.source} / ${r.score}）`);
  });

  console.log('=== 3. 逐条实况 ===');
  list.forEach((r, i) => {
    console.log(
      String(i + 1).padStart(2) + ' | ' + String(r.raw).padEnd(34) +
      ' | ¥' + String(r.price).padEnd(6) +
      ' | ' + String(r.source).padEnd(9) + ' | ' + (r.match_name || '无') +
      (r.match_spec ? '(' + r.match_spec + ')' : '') +
      ' | ' + (r.score != null ? (r.score * 100).toFixed(0) + '%' : '-') + ' | ' + (r.code || '')
    );
  });

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败；编码错配 ' + mismatch + ' 条');
  process.exit(fail ? 1 : 0);
})();
