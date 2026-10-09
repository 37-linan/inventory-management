/**
 * 对照：拿**改动前**的四个文件跑同样的场景，确认新自检抓的就是这两个真 bug。
 * 跑法：node .workbuddy/tmp/old-diff-1009.js
 */
const fs = require('fs');
const vm = require('vm');
const OLD = 'F:/出入库管理系统/.workbuddy/tmp/old-1009';

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) pass++; else { fail++; console.log('  ✗ ' + l); } };
function mkEl(id) {
  const set = new Set();
  return {
    id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {}, offsetWidth: 400,
    classList: { add(c) { set.add(c); }, remove(c) { set.delete(c); }, contains() { return false; } },
    querySelector: () => null, querySelectorAll: () => [],
    appendChild() {}, remove() {}, focus() {}, blur() {}, addEventListener() {}
  };
}

(async () => {
  console.log('\n=== 改动前的行为（应该都是「有问题」的）===');

  // 1. 入库多图
  {
    const els = {}; const getEl = id => (els[id] = els[id] || mkEl(id));
    const POSTS = [];
    const ctx = {
      console, document: { getElementById: getEl, querySelector: () => null, querySelectorAll: () => [], createElement: () => mkEl('c'), body: mkEl('body'), addEventListener() {} },
      window: {}, navigator: { userAgent: 'Chrome' }, location: {},
      localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null },
      setTimeout: fn => { try { fn(); } catch (e) {} return 0; }, clearTimeout() {},
      API: { get: async () => [], post: async (u, b) => { POSTS.push({ u, b }); return {}; }, put: async () => ({}), patch: async () => ({}), del: async () => ({}) },
      ConfigManager: { getOptions: async () => [] }, showModal() {}, closeModal() {},
      showToast() {}, showImagePreview() {}, triggerBarcodeScan() {}, confirm: () => true
    };
    ctx.window.document = ctx.document;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(OLD + '/public/js/modules/transactions.js', 'utf8') + '\n;globalThis.__M=TransactionsModule;', ctx, {});
    const M = ctx.__M;
    getEl('inbound-code').value = 'A1'; getEl('inbound-qty').value = '2';
    getEl('inbound-order').value = 'SF1'; getEl('inbound-price').value = '1';
    M.inboundImages = ['a.jpg', 'b.jpg'];
    await M.submitInbound('main');
    ok(POSTS[0].b.image_path === 'a.jpg',
      `1. 入库拍两张 → 旧版只存第一张（实际存了 "${POSTS[0].b.image_path}"）`);
    ok(typeof M._imgCellHtml !== 'function', '2. 旧版没有多图列渲染函数（永远显示「图片查看」不标数量）');
  }

  // 2. 预览弹窗
  {
    const els = {}; const getEl = id => (els[id] = els[id] || mkEl(id));
    const ctx = {
      console, document: { getElementById: getEl, createElement: () => mkEl('c'), body: mkEl('body') },
      window: {}, navigator: { userAgent: 'Chrome' }, setTimeout: fn => fn(), clearTimeout() {},
      API: { post: async () => ({}) }, showModal() {}, closeModal() {}, showToast() {}
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(OLD + '/public/js/modules/camera.js', 'utf8') + '\n;globalThis.__P=showImagePreview;', ctx, {});
    ctx.__P('a.jpg,b.jpg');
    const html = getEl('modal-body').innerHTML;
    ok((html.match(/<img /g) || []).length === 1,
      `3. 旧版预览两张只画 1 个 <img>（实际 ${(html.match(/<img /g) || []).length} 个）`);
  }

  // 3. 产品页加载失败
  {
    const els = {}; const getEl = id => (els[id] = els[id] || mkEl(id));
    const ctx = {
      console, document: { getElementById: getEl, createElement: () => mkEl('c'), body: mkEl('body'), querySelector: () => null, querySelectorAll: () => [] },
      window: {}, navigator: { userAgent: 'Chrome' }, localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null },
      setTimeout: fn => fn(), clearTimeout() {},
      API: { get: async () => { throw new Error('网络连接失败，请检查网络后重试'); }, post: async () => ({}), put: async () => ({}), patch: async () => ({}), del: async () => ({}) },
      PriceChart: { render: async () => '' }, ConfigManager: { getOptions: async () => [] },
      BarcodeScanner: { startScan() {} }, showModal() {}, closeModal() {}, showToast() {}
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(OLD + '/public/js/modules/products.js', 'utf8') + '\n;globalThis.__M=ProductsModule;', ctx, {});
    const M = ctx.__M;
    getEl('products-list-main').innerHTML = '<div class="empty-state"><p>加载中...</p></div>';
    await M.loadProducts('main');
    const h = getEl('products-list-main').innerHTML;
    ok(h.includes('加载中') && !h.includes('重新加载'),
      '4. 旧版接口失败后列表区仍然停在「加载中...」，没有「重新加载」入口（就是用户截图那个样子）');
  }

  // 4. api.js 有没有超时
  {
    const src = fs.readFileSync(OLD + '/public/js/modules/api.js', 'utf8');
    ok(!/AbortController/.test(src), '5. 旧版 api.js 没有任何超时机制（请求卡住就永远卡住）');
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败（这几条都是「改动前的毛病」被复现出来）\n`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('脚本异常:', e); process.exit(2); });
