/**
 * 自检：2026-10-09 两个用户反馈
 * ---------------------------------------------------------------------------
 * ① 入库/出库拍了两张图，点「图片查看」只能看见一张
 *    → 根因：submitInbound / submitOutbound 只取 `images[0]`，第二张根本没入库；
 *      预览弹窗也只画一张。现在多张以英文逗号存在 image_path 里，弹窗画图册。
 * ② 主产品信息表停在「加载中...」
 *    → 根因：loadProducts 一失败只弹 2.5 秒 toast，页面永远停在初始的「加载中...」，
 *      而且 API 没有超时，请求卡住就再也不回来。现在：接口加超时 + 失败给明确界面和「重新加载」，
 *      仪表盘改到列表之后渲染（它要再拉一次库存接口，慢/失败不该拖住列表）。
 *
 * 跑法：node .workbuddy/tmp/image-multi-test.js
 */
const fs = require('fs');
const vm = require('vm');
const ROOT = 'F:/出入库管理系统';

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) pass++; else { fail++; console.log('  ✗ ' + l); } };
const eq = (a, b, l) => ok(JSON.stringify(a) === JSON.stringify(b),
  `${l}  →  期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`);

/* ============================================================
   通用运行时
   ============================================================ */
function mkEl(id) {
  const set = new Set();
  return {
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, offsetWidth: 400,
    classList: { add(c) { set.add(c); }, remove(c) { set.delete(c); }, contains(c) { return set.has(c); }, toggle() {} },
    querySelector: () => null, querySelectorAll: () => [],
    appendChild() {}, remove() {}, focus() {}, blur() {}, addEventListener() {}
  };
}

/* ============================================================
   一、多图：存库 + 记录表显示
   ============================================================ */
const TOASTS = [];
const POSTS = [];
function createTxRuntime() {
  const els = {};
  const getEl = id => (els[id] = els[id] || mkEl(id));
  const ctx = {
    console,
    document: { getElementById: getEl, querySelector: () => null, querySelectorAll: () => [], createElement: () => mkEl('c'), body: mkEl('body'), addEventListener() {} },
    window: { innerWidth: 1400, matchMedia: () => ({ matches: false }), addEventListener() {} },
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36' },
    location: { origin: 'https://nanyishangmao.cn' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    setTimeout: fn => { try { fn(); } catch (e) {} return 0; },
    clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
    API: {
      get: async url => (/\/products$/.test(url) ? [{ code: 'A1', name: '例子A', spec: '100g' }] : []),
      post: async (url, body) => { POSTS.push({ url, body }); return { success: true }; },
      put: async () => ({}), patch: async () => ({ success: true }), del: async () => ({})
    },
    ConfigManager: { getOptions: async () => [], renderOptionEditor: () => '' },
    showModal() {}, closeModal() {}, showModal2() {}, closeModal2() {},
    showToast: m => TOASTS.push(String(m)), showImagePreview() {}, triggerBarcodeScan() {},
    isMobile: () => false, confirm: () => true, alert() {}
  };
  ctx.window.document = ctx.document;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ROOT + '/public/js/modules/transactions.js', 'utf8') + '\n;globalThis.__M = TransactionsModule;', ctx, { filename: 'transactions.js' });
  return { M: ctx.__M, els, getEl };
}

/* ============================================================
   二、预览弹窗（camera.js）
   ============================================================ */
function createCamRuntime() {
  const els = {};
  const getEl = id => (els[id] = els[id] || mkEl(id));
  const ctx = {
    console,
    document: { getElementById: getEl, createElement: () => mkEl('c'), body: mkEl('body') },
    window: {}, navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0)' },
    setTimeout: fn => { try { fn(); } catch (e) {} return 0; }, clearTimeout() {},
    API: { post: async () => ({}) },
    showModal(t) { getEl('modal-body')._title = t; }, closeModal() {},
    showToast: m => TOASTS.push(String(m))
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ROOT + '/public/js/modules/camera.js', 'utf8') + '\n;globalThis.__P = showImagePreview;', ctx, { filename: 'camera.js' });
  return { show: ctx.__P, getEl };
}

/* ============================================================
   三、products.js 加载失败出口
   ============================================================ */
function createProdRuntime(getImpl) {
  const els = {};
  const getEl = id => (els[id] = els[id] || mkEl(id));
  const ctx = {
    console,
    document: {
      getElementById: getEl, createElement: () => mkEl('c'), body: mkEl('body'),
      querySelector: () => null, querySelectorAll: () => []
    },
    window: {}, navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0)' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    setTimeout: fn => { try { fn(); } catch (e) {} return 0; }, clearTimeout() {},
    API: { get: getImpl, post: async () => ({}), put: async () => ({}), patch: async () => ({}), del: async () => ({}) },
    PriceChart: { render: async () => '<svg/>', renderSet: async () => '<svg/>', showLarge() {} },
    ConfigManager: { getOptions: async () => [], renderOptionEditor: () => '' },
    BarcodeScanner: { startScan() {} },
    showModal() {}, closeModal() {},
    showToast: m => TOASTS.push(String(m))
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ROOT + '/public/js/modules/products.js', 'utf8') + '\n;globalThis.__M = ProductsModule;', ctx, { filename: 'products.js' });
  return { M: ctx.__M, getEl };
}

/* ============================================================
   四、api.js 超时 / 错误
   ============================================================ */
function createApiRuntime(fetchImpl) {
  const ctx = {
    console, setTimeout, clearTimeout, AbortController, fetch: fetchImpl,
    Error, JSON, String, Number, Object, Array, Promise
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ROOT + '/public/js/modules/api.js', 'utf8') + '\n;globalThis.__API = API;', ctx, { filename: 'api.js' });
  return ctx.__API;
}

(async () => {
  /* ---------- A. 多图存库 ---------- */
  console.log('\n=== A. 拍多张 → 全部入库 ===');
  {
    const { M, getEl } = createTxRuntime();
    getEl('inbound-code').value = 'A1';
    getEl('inbound-qty').value = '2';
    getEl('inbound-device').value = '1';
    getEl('inbound-channel').value = '淘宝';
    getEl('inbound-order').value = 'SF001';
    getEl('inbound-price').value = '100';
    getEl('inbound-remark').value = '';
    M.inboundImages = ['/uploads/2026-10-09/a.jpg', '/uploads/2026-10-09/b.jpg'];
    POSTS.length = 0;
    await M.submitInbound('main');
    const body = POSTS[0] && POSTS[0].body;
    eq(body && body.image_path, '/uploads/2026-10-09/a.jpg,/uploads/2026-10-09/b.jpg',
      'A.1 两张图都写进 image_path（逗号分隔）');
    eq(M.inboundImages.length, 0, 'A.2 提交后表单里的图片数组清空');

    // 单张：不带逗号（跟老数据格式一致）
    const r2 = createTxRuntime();
    r2.getEl('inbound-code').value = 'A1';
    r2.getEl('inbound-qty').value = '1';
    r2.getEl('inbound-order').value = 'SF002';
    r2.M.inboundImages = ['/uploads/2026-10-09/only.jpg'];
    POSTS.length = 0;
    await r2.M.submitInbound('main');
    eq(POSTS[0].body.image_path, '/uploads/2026-10-09/only.jpg', 'A.3 只有一张时不带逗号（老格式兼容）');

    // 没拍：空串
    const r3 = createTxRuntime();
    r3.getEl('inbound-code').value = 'A1';
    r3.getEl('inbound-qty').value = '1';
    r3.getEl('inbound-order').value = 'SF003';
    POSTS.length = 0;
    await r3.M.submitInbound('main');
    eq(POSTS[0].body.image_path, '', 'A.4 没拍图 → 空串');

    // 出库同上
    const r4 = createTxRuntime();
    r4.getEl('outbound-code').value = 'A1';
    r4.getEl('outbound-qty').value = '1';
    r4.getEl('outbound-location').value = '';
    r4.getEl('outbound-order-no').value = '';
    r4.M.outboundImages = ['/uploads/x1.jpg', '/uploads/x2.jpg', '/uploads/x3.jpg'];
    POSTS.length = 0;
    await r4.M.submitOutbound('main');
    eq(POSTS[0].body.image_path, '/uploads/x1.jpg,/uploads/x2.jpg,/uploads/x3.jpg',
      'A.5 出库三张图也都写进去');
  }

  /* ---------- B. 记录表「图片」列 ---------- */
  console.log('\n=== B. 记录表图片列 ===');
  {
    const { M } = createTxRuntime();
    eq(M._imgCellHtml(''), '-', 'B.1 没图显示 -');
    eq(M._imgCellHtml(null), '-', 'B.2 null 也不炸');
    const one = M._imgCellHtml('/uploads/a.jpg');
    ok(one.includes('图片查看') && !one.includes('图片查看('), 'B.3 一张只显示「图片查看」');
    ok(one.includes("showImagePreview('/uploads/a.jpg')"), 'B.4 一张的 onclick 传原路径');
    const two = M._imgCellHtml('/uploads/a.jpg,/uploads/b.jpg');
    ok(two.includes('图片查看(2)'), 'B.5 两张显示「图片查看(2)」');
    ok(two.includes("showImagePreview('/uploads/a.jpg,/uploads/b.jpg')"), 'B.6 两张整串传给预览弹窗');
    eq(M._imgList('a.jpg, b.jpg ,').length, 2, 'B.7 逗号两侧空格、尾部空项都能容错');
    eq(M._imagesToPath([]), '', 'B.8 空数组 → 空串');
  }

  /* ---------- C. 预览弹窗（多图图册） ---------- */
  console.log('\n=== C. 图片预览弹窗 ===');
  {
    const c1 = createCamRuntime();
    c1.show('/uploads/a.jpg,/uploads/b.jpg');
    const body = c1.getEl('modal-body').innerHTML;
    eq((body.match(/<img /g) || []).length, 2, 'C.1 两张图 → 弹窗里 2 个 <img>');
    ok(body.includes('第 1 / 2 张') && body.includes('第 2 / 2 张'), 'C.2 标出「第 N / 共 2 张」');
    eq(c1.getEl('modal-body')._title, '图片预览（共 2 张）', 'C.3 标题写明总共几张');
    eq((body.match(/saveImageAs\(/g) || []).length, 2, 'C.4 每张一个「保存图片」按钮（保存出来不重名）');
    ok(/第1张_/.test(body) && /第2张_/.test(body), 'C.5 多张保存的文件名带序号');

    const c2 = createCamRuntime();
    c2.show('/uploads/a.jpg');
    const b2 = c2.getEl('modal-body').innerHTML;
    eq((b2.match(/<img /g) || []).length, 1, 'C.6 一张 → 1 个 <img>');
    eq(c2.getEl('modal-body')._title, '图片预览', 'C.7 一张时标题不加数量');

    const c3 = createCamRuntime();
    TOASTS.length = 0;
    c3.show('');
    eq((c3.getEl('modal-body').innerHTML.match(/<img /g) || []).length, 0, 'C.8 空路径不画图');
    ok(TOASTS.some(t => t.includes('没有可查看的图片')), 'C.9 空路径给提示而不是白屏');
  }

  /* ---------- D. 主产品信息表：失败有出口 ---------- */
  console.log('\n=== D. 产品页加载失败 ===');
  {
    // D1 接口抛错
    const d1 = createProdRuntime(async url => { throw new Error('网络连接失败，请检查网络后重试'); });
    await d1.M.loadProducts('main');
    const h1 = d1.getEl('products-list-main').innerHTML;
    ok(h1.includes('产品数据加载失败'), 'D.1 失败时列表区出现「产品数据加载失败」');
    ok(h1.includes('网络连接失败'), 'D.2 把失败原因写出来（不是只有一瞬间的 toast）');
    ok(h1.includes('重新加载') && h1.includes("loadProducts('main')"), 'D.3 给「🔄 重新加载」按钮');
    ok(!h1.includes('加载中'), 'D.4 不再永远停在「加载中...」');

    // D2 接口返回非数组（网关报错页之类）
    const d2 = createProdRuntime(async url => (/\/products$/.test(url) ? { error: 'boom' } : []));
    await d2.M.loadProducts('main');
    const h2 = d2.getEl('products-list-main').innerHTML;
    ok(h2.includes('产品数据加载失败'), 'D.5 返回非数组也走失败界面（不会假装“暂无产品”）');
    ok(!h2.includes('暂无产品信息'), 'D.6 不会谎报「暂无产品」');

    // D3 正常路径：列表先渲染，仪表盘后渲染
    let listAtDashTime = null;
    const d3 = createProdRuntime(async url => (/\/products$/.test(url)
      ? [{ id: 1, code: 'A1', name: '例子A', spec: '100g', unit: '个', type: '屈臣氏', market_price: '浮动价格' }]
      : []));
    d3.M._renderDashboard = async () => { listAtDashTime = d3.getEl('products-list-main').innerHTML; };
    await d3.M.loadProducts('main');
    ok(!!listAtDashTime && listAtDashTime.includes('例子A'),
      'D.7 仪表盘渲染时列表已经画好了（库存接口慢/失败不再拖住整张表）');
    ok(d3.getEl('products-list-main').innerHTML.includes('例子A'), 'D.8 正常路径列表照旧渲染');
  }

  /* ---------- E. api.js 超时与错误 ------------- */
  console.log('\n=== E. 请求超时 / 网络错误 ===');
  {
    // E1 永不返回 → 超时（默认 20s 太久，显式传 150ms）
    const api1 = createApiRuntime((url, opt) => new Promise((_, rej) => {
      opt.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); });
    }));
    let msg1 = '';
    try { await api1.get('/api/main/products', undefined, 150); } catch (e) { msg1 = e.message; }
    ok(msg1.includes('请求超时'), 'E.1 请求卡住 → 明确报「请求超时」（不再无限转圈）');

    // E2 网络断
    const api2 = createApiRuntime(async () => { const e = new TypeError('Failed to fetch'); throw e; });
    let msg2 = '';
    try { await api2.get('/api/main/products'); } catch (e) { msg2 = e.message; }
    ok(msg2.includes('网络连接失败'), 'E.2 连不上 → 报「网络连接失败」');

    // E3 返回非 JSON
    const api3 = createApiRuntime(async () => ({ ok: true, status: 502, json: async () => { throw new Error('not json'); } }));
    let msg3 = '';
    try { await api3.get('/api/main/products'); } catch (e) { msg3 = e.message; }
    ok(msg3.includes('服务器返回异常内容'), 'E.3 返回 HTML/报错页 → 报「服务器返回异常内容」');

    // E4 后端业务错误原样透出
    const api4 = createApiRuntime(async () => ({ ok: false, status: 500, json: async () => ({ error: '数据库炸了' }) }));
    let msg4 = '';
    try { await api4.get('/api/main/products'); } catch (e) { msg4 = e.message; }
    eq(msg4, '数据库炸了', 'E.4 后端给的错误信息照旧原样透出');

    // E5 正常
    const api5 = createApiRuntime(async () => ({ ok: true, status: 200, json: async () => [{ id: 1 }] }));
    const r5 = await api5.get('/api/main/products');
    eq(r5, [{ id: 1 }], 'E.5 正常请求照旧返回数据');
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('脚本异常:', e); process.exit(2); });
