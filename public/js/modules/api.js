// API 工具模块
const API = {
  baseURL: '',

  // ❗带超时：以前没有超时，请求一旦卡住（网络断了/服务没响应），
  //   页面就永远停在「加载中...」，用户看不到任何提示、也没有出路。
  async request(method, url, data, timeoutMs = 20000) {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (data && method !== 'GET') {
      options.body = JSON.stringify(data);
    }
    const canAbort = typeof AbortController !== 'undefined';
    const ctrl = canAbort ? new AbortController() : null;
    if (ctrl) options.signal = ctrl.signal;
    const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, timeoutMs);

    let response;
    try {
      response = await fetch(this.baseURL + url, options);
    } catch (e) {
      clearTimeout(timer);
      const name = (e && e.name) || '';
      if (name === 'AbortError' || name === 'TimeoutError') {
        throw new Error(`请求超时：${timeoutMs / 1000} 秒没有响应，请检查网络后重试`);
      }
      throw new Error('网络连接失败，请检查网络后重试');
    }

    let result;
    try {
      result = await response.json();
    } catch (e) {
      clearTimeout(timer);
      // 服务器返回的不是 JSON（比如网关的报错页）——说清楚，别只丢一句“请求失败”
      throw new Error(`服务器返回异常内容（HTTP ${response.status}），请稍后重试`);
    }
    clearTimeout(timer);

    if (!response.ok) throw new Error((result && result.error) || `请求失败（HTTP ${response.status}）`);
    return result;
  },

  get(url) { return this.request('GET', url); },
  post(url, data) { return this.request('POST', url, data); },
  put(url, data) { return this.request('PUT', url, data); },
  patch(url, data) { return this.request('PATCH', url, data); },
  del(url) { return this.request('DELETE', url); },

  // 上传图片（文件或base64）
  async uploadImage(base64Data) {
    const response = await fetch(this.baseURL + '/api/upload-base64', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Data })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '上传失败');
    return result.path;
  }
};

// Toast提示
function showToast(msg, duration = 2500) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
}
