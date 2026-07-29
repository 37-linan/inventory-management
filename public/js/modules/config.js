// 配置管理模块 - 类型选项、渠道选项的动态管理
const ConfigManager = {
  cache: {},

  // 获取配置
  async getOptions(system, key) {
    const cacheKey = `${system}_${key}`;
    if (this.cache[cacheKey]) return this.cache[cacheKey];
    try {
      const data = await API.get(`/api/${system}/config/${key}`);
      this.cache[cacheKey] = data.value;
      return data.value;
    } catch (e) {
      console.error('获取配置失败:', e);
      return [];
    }
  },

  // 保存配置
  async saveOptions(system, key, value) {
    try {
      await API.put(`/api/${system}/config/${key}`, { value });
      const cacheKey = `${system}_${key}`;
      this.cache[cacheKey] = value;
      return true;
    } catch (e) {
      showToast('保存配置失败: ' + e.message);
      return false;
    }
  },

  // 渲染选项编辑器（用于弹窗中管理选项）
  renderOptionEditor(system, key, title, placeholder) {
    return `
      <div class="option-editor">
        <h4 style="margin-bottom:12px;font-size:14px;">${title}</h4>
        <div class="tag-editor">
          <input type="text" id="new-option-input" placeholder="${placeholder}" />
          <button class="btn btn-sm btn-primary" onclick="ConfigManager.addOption('${system}','${key}')">添加</button>
        </div>
        <div class="option-tags" id="option-tags-${system}-${key}">
          ${this.cache[`${system}_${key}`] ? this.cache[`${system}_${key}`].map((opt, i) => 
            `<span class="opt-tag">${opt} <span class="opt-remove" onclick="ConfigManager.removeOption('${system}','${key}',${i})">&times;</span></span>`
          ).join('') : ''}
        </div>
      </div>
    `;
  },

  async addOption(system, key) {
    const input = document.getElementById('new-option-input');
    const val = input.value.trim();
    if (!val) return;
    const cacheKey = `${system}_${key}`;
    const options = this.cache[cacheKey] || [];
    if (options.includes(val)) {
      showToast('该选项已存在');
      return;
    }
    options.push(val);
    await this.saveOptions(system, key, options);
    input.value = '';
    this.refreshTags(system, key);
  },

  async removeOption(system, key, index) {
    const cacheKey = `${system}_${key}`;
    const options = this.cache[cacheKey] || [];
    options.splice(index, 1);
    await this.saveOptions(system, key, options);
    this.refreshTags(system, key);
  },

  refreshTags(system, key) {
    const container = document.getElementById(`option-tags-${system}-${key}`);
    if (!container) return;
    const cacheKey = `${system}_${key}`;
    const options = this.cache[cacheKey] || [];
    container.innerHTML = options.map((opt, i) => 
      `<span class="opt-tag">${opt} <span class="opt-remove" onclick="ConfigManager.removeOption('${system}','${key}',${i})">&times;</span></span>`
    ).join('');
  },

  // 清除缓存（当页面切换时）
  clearCache() {
    this.cache = {};
  }
};
