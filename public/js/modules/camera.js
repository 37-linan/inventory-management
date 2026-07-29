// 相机拍照模块（支持桌面getUserMedia + 手机input capture双模式）
const CameraCapture = {
  stream: null,

  // 打开相机
  async openCamera(callback) {
    // 先显示弹窗
    showModal('拍照');
    const container = document.getElementById('modal-body');
    window._cameraCallback = callback;
    window._cameraResolved = false;

    // 检测是否移动端（手机/平板）
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    
    // 移动端直接走拍照模式（跳过getUserMedia，因为它会在HTTP下卡死）
    if (isMobile) {
      this._openMobileCamera(container, callback);
      return;
    }

    // 桌面端：尝试getUserMedia，加3秒超时
    try {
      const timeout = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('camera_timeout')), 3000)
      );
      this.stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
        }),
        timeout
      ]);

      container.innerHTML = `
        <div class="camera-container">
          <video id="capture-video" autoplay playsinline></video>
          <canvas id="capture-canvas"></canvas>
          <div style="display:flex;gap:8px;margin-top:10px;justify-content:center;">
            <button class="btn btn-primary btn-lg" id="capture-btn">拍照</button>
            <button class="btn btn-danger" onclick="CameraCapture.closeCamera();closeModal()">取消</button>
          </div>
          <div id="capture-preview" style="margin-top:10px;text-align:center;display:none;">
            <img id="capture-result" style="max-width:100%;max-height:200px;border-radius:8px;" />
            <div style="display:flex;gap:8px;margin-top:8px;justify-content:center;">
              <button class="btn btn-success" onclick="CameraCapture.confirm()">确认使用</button>
              <button class="btn btn-secondary" onclick="CameraCapture.retake()">重新拍照</button>
            </div>
          </div>
        </div>
      `;
      const video = document.getElementById('capture-video');
      video.srcObject = this.stream;
      document.getElementById('capture-btn').onclick = () => this.capture();
      return;
    } catch (e) {
      // getUserMedia 失败 → 改用手机 input capture 模式
      console.log('getUserMedia failed, using input capture fallback:', e.message);
      this._openMobileCamera(container, callback);
    }
  },

  // 手机拍照模式（用label+input原生方式，兼容所有手机浏览器）
  _openMobileCamera(container, callback) {
    container.innerHTML = `
      <div style="text-align:center;padding:20px;">
        <p style="color:var(--text-secondary);margin-bottom:16px;">点击下方按钮打开相机</p>
        <!-- label标签直接触发file input，无需JS click，兼容所有浏览器 -->
        <label style="display:inline-block;padding:12px 32px;background:var(--primary);color:#fff;border-radius:8px;font-size:16px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);">
          📷 打开相机拍照
          <input type="file" accept="image/*" capture="environment" 
                 onchange="CameraCapture.onMobilePhotoSelected(event)" 
                 style="display:none;" />
        </label>
        <div id="mobile-capture-preview" style="margin-top:16px;display:none;">
          <img id="mobile-capture-result" style="max-width:100%;max-height:250px;border-radius:8px;border:1px solid var(--border);" />
          <div style="display:flex;gap:8px;margin-top:10px;justify-content:center;">
            <button class="btn btn-success" onclick="CameraCapture.confirmMobile()">确认使用</button>
            <button class="btn btn-secondary" onclick="CameraCapture._resetMobileCamera(this)">重新拍照</button>
          </div>
        </div>
        <div style="margin-top:12px;">
          <button class="btn btn-secondary" onclick="closeModal()">取消</button>
        </div>
      </div>
    `;
  },

  // 手机拍照完成回调（inline onchange触发）
  onMobilePhotoSelected(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUrl = evt.target.result;
      document.getElementById('mobile-capture-result').src = dataUrl;
      document.getElementById('mobile-capture-preview').style.display = 'block';
      // 隐藏按钮行（拍照完成后隐藏"打开相机"按钮所在的那一行）
      const label = document.querySelector('#modal-body label');
      if (label) label.style.display = 'none';
      window._capturedImage = dataUrl;
    };
    reader.readAsDataURL(file);
  },

  // 重新拍照：刷新容器内容（生成新的file input，解决部分手机第二次拍照失效问题）
  _resetMobileCamera(btn) {
    const container = document.getElementById('modal-body');
    this._openMobileCamera(container, window._cameraCallback);
  },

  capture() {
    const video = document.getElementById('capture-video');
    const canvas = document.getElementById('capture-canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    document.getElementById('capture-result').src = dataUrl;
    document.getElementById('capture-preview').style.display = 'block';
    document.getElementById('capture-video').style.display = 'none';
    document.getElementById('capture-btn').style.display = 'none';
    window._capturedImage = dataUrl;
  },

  retake() {
    document.getElementById('capture-video').style.display = 'block';
    document.getElementById('capture-preview').style.display = 'none';
    document.getElementById('capture-btn').style.display = 'inline-flex';
    window._capturedImage = null;
  },

  async confirm() {
    if (window._capturedImage && window._cameraCallback) {
      document.getElementById('modal-body').innerHTML = '<div style="text-align:center;padding:20px;"><p>上传中...</p></div>';
      try {
        const path = await API.uploadImage(window._capturedImage);
        this.closeCamera();
        closeModal();
        window._cameraCallback(path);
      } catch (e) {
        showToast('上传失败: ' + e.message);
      }
    }
  },

  async confirmMobile() {
    if (window._capturedImage && window._cameraCallback) {
      document.getElementById('modal-body').innerHTML = '<div style="text-align:center;padding:20px;"><p>上传中...</p></div>';
      try {
        const path = await API.uploadImage(window._capturedImage);
        closeModal();
        window._cameraCallback(path);
      } catch (e) {
        showToast('上传失败: ' + e.message);
      }
    }
  },

  closeCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }
};

// 照片预览弹窗
function showImagePreview(path) {
  showModal('图片预览');
  document.getElementById('modal-body').innerHTML = `
    <div style="text-align:center;">
      <img src="${path}" style="max-width:100%;max-height:70vh;border-radius:8px;" />
    </div>
  `;
}
