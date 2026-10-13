/**
 * 自检：韩妆套盒块「补充一条」交付（2026-10-13 深夜）
 *
 * 背景：用户发来「深圳仓库美妆」表的韩妆套盒区块截图（6 行），并确认：
 *   1. 表「Whoo水妍两件套 189」 = 系统「后 Whoo水乳两件套」（8801051242133）
 *      —— 用户已把系统里原名「后 Whoo拱辰享水 水沄护肤水乳6件套」改成现名，
 *         并把原来两条「Whoo水妍两件套」编码（8809949537477 / 8809949537514）删掉了
 *   2. 表「Whoo天率丹黑盒七件套新版 695」 ≠ 系统「后天率丹和率套盒」→ 跳过
 *
 * 校验：
 *   A. 交付文件只有 1 行、格式 = 「系统商品名 价格」、用系统名、无别名残留
 *   B. 走系统真实配对接口，必须 100% 命中唯一编码 8801051242133
 *   C. 其余 5 行的关键词一个字都不许出现在交付里（表里有、系统没有 → 必须丢弃）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const FILE = path.join(ROOT, '导入行情-补充-韩妆套盒-2026-10-12.txt');
const EXPECT_CODE = '8801051242133';
const EXPECT_NAME = '后 Whoo水乳两件套';
const EXPECT_PRICE = 189;

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✗ ' + m); } };
const eq = (a, b, m) => ok(String(a) === String(b), `${m}（期望 ${b} / 实际 ${a}）`);

// 表里那一块共 6 行，只有 1 行能录 —— 其余这些词一个都不该出现在交付里
const MUST_NOT = [
  '水妍', '美白两件套', '气韵', '欧碧泉', '水动力',
  '黑盒', '气垫套', '六件套', '天率丹黑盒',
  '695', '610', '575', '300', '451', '200', '561', '351',
];

(async () => {
  console.log('=== A. 交付文件本身 ===');
  ok(fs.existsSync(FILE), 'A.0 交付文件存在：导入行情-补充-韩妆套盒-2026-10-12.txt');
  const raw = fs.readFileSync(FILE, 'utf8');
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  eq(lines.length, 1, 'A.1 只有 1 行（整块 6 行里只有这 1 行能录）');

  const m = /^(.+?)\s+(\d+(?:\.\d+)?)$/.exec(lines[0].trim());
  ok(!!m, 'A.2 行格式 = 「商品名 价格」（解析器认得的那种）');
  const name = m ? m[1].trim() : '';
  const price = m ? parseFloat(m[2]) : NaN;
  eq(name, EXPECT_NAME, 'A.3 用的是**系统里的商品名**（不是表里的「Whoo水妍两件套」）');
  eq(price, EXPECT_PRICE, 'A.4 价格 = 189（表里「Whoo水妍两件套」那一格）');
  ok(!/\//.test(lines[0]), 'A.5 ❗名字里没有斜杠（有斜杠会被 _parsePriceText 拆成两行）');
  ok(!/\d+\.\d+/.test(lines[0].split(/\s+/).pop()), 'A.6 价格是整数 189，不会被当成型号');

  console.log('\n=== B. 丢弃的 5 行，关键词零出现 ===');
  MUST_NOT.forEach(k => ok(!raw.includes(k), `B ${k} 没出现在交付里`));

  console.log('\n=== C. 走系统真实配对接口 ===');
  let rows = null;
  try {
    const r = await fetch('https://nanyishangmao.cn/api/main/price-import/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: [{ name, price }] })
    });
    const j = await r.json();
    rows = j.rows;
  } catch (e) {
    ok(false, 'C.0 配对接口调用失败：' + e.message);
  }
  if (rows) {
    eq(rows.length, 1, 'C.1 接口回 1 条结果');
    const x = rows[0];
    eq(x.code, EXPECT_CODE, 'C.2 ❗命中唯一编码 8801051242133（后 Whoo水乳两件套）');
    eq(x.match_name, EXPECT_NAME, 'C.3 命中名字与系统一致');
    eq(x.price, EXPECT_PRICE, 'C.5 接口回显价格 = 189');
    ok(x.score >= 0.99, `C.6 匹配分 ${x.score}（用系统名应 100% 命中）`);
    // 候选里会有一个 30% 左右的干扰项（whoo红华凝香水乳七件套）——只要首选拉开差距就不会选错
    const others = (x.candidates || []).filter(c => String(c.code) !== EXPECT_CODE);
    const top = others.length ? Math.max(...others.map(c => c.score || 0)) : 0;
    ok(x.score - top >= 0.4, `C.4 首选 ${(x.score * 100).toFixed(0)}% 比第二名 ${(top * 100).toFixed(0)}% 高出 ≥40 个点，不会选错`);
  }

  console.log('----------------------------------------');
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
