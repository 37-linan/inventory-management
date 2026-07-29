// API 工具模块
const API = {
  baseURL: '',

  async request(method, url, data) {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (data && method !== 'GET') {
      options.body = JSON.stringify(data);
    }
    const response = await fetch(this.baseURL + url, options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '请求失败');
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
