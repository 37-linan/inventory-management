/**
 * 复现：主产品信息表一直停在「加载中...」
 * 用**线上真实数据**跑真实的 products.js + api.js，看卡在哪一步。
 */
const fs = require('fs');
const vm = require('vm');
const ROOT = 'F:/出入库管理系统';
const LIVE = 'https://nanyishangmao.cn';

const els = {};
function mkEl(id) {
  return {
    id, innerHTML: '', textContent: '', value: '', style: {}, offsetWidth: 400,
    classList: { add() {}, remove() {}, contains: () => false },
    appendChild() {}, setAttribute() {}, removeChild() {},
  };
}
const doc = {
  getElementById: id => (els[id] = els[id] || mkEl(id)),
  querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => mkEl('new'),
  body: { appendChild() {}, removeChild() {} },
};

const calls = { get: [], toast: [], charts: [] };
const sb = {
  console, document: doc, setTimeout, clearTimeout, fetch,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  sessionStorage: { getItem: () => null, setItem() {} },
  showToast: m => calls.toast.push(String(m)),
  showModal() {}, closeModal() {},
  PriceChart: {
    async render(chartId, system, code, w, pid) { calls.charts.push(code); return '<svg/>'; },
    async renderSet(id) { return '<svg/>'; },
    showLarge() {},
  },
  ConfigManager: { getOptions: async () => [], renderOptionEditor: () => '' },
  BarcodeScanner: { startScan() {} },
};
sb.window = sb; sb.globalThis = sb;

vm.createContext(sb);
const API = vm.runInContext(fs.readFileSync(ROOT + '/public/js/modules/api.js', 'utf8') + '\n;API', sb, { filename: 'api.js' });
sb.API = API;
const PM = vm.runInContext(fs.readFileSync(ROOT + '/public/js/modules/products.js', 'utf8') + '\n;ProductsModule', sb, { filename: 'products.js' });
sb.ProductsModule = PM;
API.baseURL = LIVE;

// 记录每一次 API 请求
const realGet = API.get.bind(API);
API.get = async url => {
  const t0 = Date.now();
  try {
    const r = await realGet(url);
    calls.get.push(`${url}  ok  ${Date.now() - t0}ms  ${Array.isArray(r) ? 'array(' + r.length + ')' : typeof r}`);
    return r;
  } catch (e) {
    calls.get.push(`${url}  THROW ${e.message}`);
    throw e;
  }
};

(async () => {
  console.log('===== 开始 render(\'main\') =====');
  const t0 = Date.now();
  try {
    await PM.render('main');
    console.log('render 完成，耗时', Date.now() - t0, 'ms');
  } catch (e) {
    console.log('❗render 抛出异常：', e && e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : e);
  }
  console.log('\n----- API 调用记录 -----');
  calls.get.forEach(l => console.log('  ' + l));
  console.log('\n----- toast -----');
  calls.toast.forEach(l => console.log('  ' + l));
  const list = els['products-list-main'] ? els['products-list-main'].innerHTML : '';
  const dash = els['products-dashboard-main'] ? els['products-dashboard-main'].innerHTML : '';
  console.log('\n----- 最终状态 -----');
  console.log('products-list-main 长度 =', list.length, '| 还含「加载中」？', list.includes('加载中'));
  console.log('products-dashboard-main 长度 =', dash.length, '| 含「产品总数」？', dash.includes('产品总数'));
  console.log('行情图渲染次数 =', calls.charts.length);
})();
