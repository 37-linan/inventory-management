/**
 * 验证「屈臣氏嘉文行情表 → 可导入文字」
 * 直接读交付用的 txt，真加载 products.js 跑 _parsePriceText，再调线上 /price-import/match 核对首选编码
 */
const fs = require('fs');
const vm = require('vm');
const ROOT = 'F:/出入库管理系统';
const TXT = ROOT + '/导入行情-屈臣氏嘉文国美-2026-10-05.txt';

const TEXT = fs.readFileSync(TXT, 'utf8');

// [系统商品名(应解析出的 name), 价格, 期望编码]
const EXPECT = [
  ['吉列极光剃须刀1刀架2刀头1底座', 114, '6900068000520'],
  ['吉列剃须刀适用刀片（4刀头）', 105, '6900068000681'],
  ['潘婷护发素紫 180ml', 16.5, '4902430694902'],
  ['李施德林口喷绿单支装', 11.5, '012547339468'],
  ['李施德林口喷蓝单支装', 12.5, '012547339017'],
  ['李施德林口喷绿双支装', 23, '012547339482'],
  ['李施德林口喷蓝双支装', 26, '012547339024'],
  ['理肤泉b5修护套装', 18, '6932313157086'],
  ['芙丽芳丝洁面霜 100g', 55, '4973167070604'],
  ['欧莱雅精油润养洗发露 700ml', 23, '6955818202372'],
  ['欧莱雅复颜玻尿酸水光充盈多效修护安瓶面膜', 45, '6932313175479'],
  ['苏菲超熟睡安心裤L码 5条', 8, '6934660550305'],
  ['苏菲超熟睡安心裤卫生巾xl码 5片', 8.5, '6934660550206'],
  ['苏菲s贵族日用卫生巾25厘米 12片', 6, '6934660554174'],
  ['苏菲s贵族290mm 10片', 6, '6934660554181'],
  ['苏菲超熟睡柔棉感420mm 8片', 6, '6934660516745'],
  ['贝德玛舒缓多效洁肤液 500ml', 47, '3701129808719'],
  ['她研社240mm 8片', 5.5, '6974354668404'],
  ['她研社290mm 6片', 5.5, '6974354668503'],
  ['理肤泉温泉水喷雾300ml+50ml', 58, '6942125267262'],
  ['颐莲补水喷雾2.0 300ml', 20, '6923129533911'],
  ['颐莲补水喷雾1.0 300ml', 19, '6923129517782'],
  ['颐莲 100ml', 9, '6923129517799'],
  ['乐而雅日用22.5cm 10片', 3.5, '6908594414019'],
  ['乐而雅日用25cm 16片', 7, '6908594427033'],
  ['乐而雅35cm 8片', 4.5, '6908594419021'],
  ['乐而雅夜用30cm 8片', 3.5, '6908594417027'],
  ['护舒宝液体卫生巾240mm 10片', 13, '6903148222508'],
  ['护舒宝液体卫生巾270mm 10片', 14, '6903148222539'],
  ['淘淘氧棉240mm 10片', 6, '6921284451033'],
  ['淘淘氧棉日夜组合 10片', 6, '6921284451019'],
  ['淘淘氧棉410mm 6片', 6, '6921284451187'],
  ['淘淘氧棉290mm 8片', 5.5, '6921284451729'],
  ['适乐肤泡沫洁面洗面奶 236ml', 36, '6923700992373'],
  ['舒适达专业修复牙膏 100克', 21, '6970128541034'],
  ['舒适达专业修复美白牙膏 100克', 21, '6970128541133'],
  ['舒适达美白配方 180g', 19, '6970128544158'],
  ['舒适达多效护理 180g', 19, '6970128544356'],
  ['珂润面霜 40g', 81, '4901301410443'],
  ['珂润保湿乳液 120ml', 80, '4901301408518'],
  ['当妮留香珠自由之森 200g', 20, '6903148262993'],
  ['依泉白', 17, '3661434004421'],
  ['依泉蓝', 17, '3661434004452'],
  ['LaboLabo毛孔洁面乳 120g', 36, '4524734500804'],
  ['LaboLabo毛孔沁润化妆水 100ml', 31, '4524734500583'],
  ['沙宣清盈顺柔护发洗发水 750g', 34, '6920177954613'],
  ['沙宣修护水养护发洗发水 750g', 34, '6920177954453'],
  ['欧乐b D100电动牙刷活力亮洁型', 76, '6903148264348'],
  ['芭妮兰净柔卸妆膏 100ml', 47, '8809759908092'],
  ['芬浓透润美容发膜 230g', 24, '4550516493583'],
  ['韩束男士三合一精华露两支装 80ml*2', 50, '6975223079512'],
  ['拍立得双白盒装国行 20张', 116, '4547410217872'],
  ['拍立得双白盒装国际版 20张', 116, '4547410173833'],
  ['拍立得单白盒装 10张', 58.5, '4547410217865'],
  ['拍立得单白盒装日版 10张', 58.5, '4547410377224'],
  ['拍立得白边锡纸装 10张', 57, '386679998756'],
  ['巴黎欧莱雅臻萃4.0墨羽黛棕', 40, '6923700941890'],
  ['巴黎欧莱雅臻萃染发霜4.35雾桐茶棕', 40, '6923700941913'],
  ['巴黎欧莱雅臻萃5.73云杉冷茶', 40, '6941594581763'],
  ['巴黎欧莱雅奇焕精油（适合多种发质） 100ml', 32, '6941594582593'],
  ['巴黎欧莱雅奇焕精油（烫染发质） 100ml', 32, '6941594582623'],
  ['巴黎欧莱雅奇焕精油（干枯沙发） 100ml', 32, '6941594582654'],
  ['海飞丝盈润修护型 紫 670g', 30, '6903148338308'],
  ['海飞丝净爽止痒型 蓝 670g', 30, '6903148351840'],
  ['海飞丝控油蓬松型 670g', 30, '6903148338735'],
  ['海飞丝净爽止痒型 蓝 360g', 18, '6903148351833'],
  ['美宝莲150ml*2+40ml*4', 37, '6936515976285'],
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
    const good = r.code === code;
    if (!good) { mismatch++; }
    ok(good, `「${nm}」→ ${code}（实际 ${r.code || '无'} / ${r.match_name || '-'} / ${r.source} / ${r.score}）`);
  });

  console.log('=== 3. 逐条实况 ===');
  list.forEach((r, i) => {
    console.log(
      String(i + 1).padStart(2) + ' | ' + String(r.raw).padEnd(30) +
      ' | ¥' + String(r.price).padEnd(6) +
      ' | ' + String(r.source).padEnd(9) + ' | ' + (r.match_name || '无') +
      (r.match_spec ? '(' + r.match_spec + ')' : '') +
      ' | ' + (r.score != null ? (r.score * 100).toFixed(0) + '%' : '-') + ' | ' + (r.code || '')
    );
  });

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败；编码错配 ' + mismatch + ' 条');
  process.exit(fail ? 1 : 0);
})();
