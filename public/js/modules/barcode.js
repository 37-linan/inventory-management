// 条码扫描模块（使用Quagga纯JS解码，兼容所有手机）
const BarcodeScanner = {
  stream: null,
  isScanning: false,
  callback: null,

  // 从图片中解码条码（直接传dataURL给Quagga，支持所有浏览器）
  async decodeFromImage(imageSrc) {
    return new Promise((resolve) => {
      if (typeof Quagga === 'undefined') {
        console.warn('Quagga not loaded');
        resolve(null);
        return;
      }

      console.log('Quagga decoding start...');

      Quagga.decodeSingle({
        src: imageSrc,  // 直接传 dataURL，Quagga自行加载
        numOfWorkers: 0,
        inputStream: {
          size: 800  // 限制最大尺寸加快处理
        },
        locate: true,
        decoder: {
          readers: [
            'ean_reader', 'ean_8_reader', 'code_128_reader', 'code_39_reader',
            'codabar_reader', 'i2of5_reader', 'upc_reader', 'upc_e_reader'
          ]
        }
      }, (result) => {
        if (result && result.codeResult) {
          console.log('Quagga decoded:', result.codeResult.code);
          resolve(result.codeResult.code);
        } else {
          console.log('Quagga no result');
          resolve(null);
        }
      });
    });
  },

  async startScan(container, callback) {
    this.callback = callback;
    if (this.isScanning) return;

    // 显示准备界面
    container.innerHTML = `
      <div style="text-align:center;padding:24px;">
        <p style="color:var(--text-secondary);margin-bottom:16px;">正在启动相机...</p>
        <div style="width:48px;height:48px;border:3px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:bspin 0.8s linear infinite;margin:0 auto;"></div>
      </div>
      <style>@keyframes bspin{to{transform:rotate(360deg)}}</style>
    `;

    // 检测是否移动端
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isMobile) {
      // 移动端直接走拍照扫码（跳过getUserMedia，HTTP下会卡死）
      this._startPhotoScan(container);
      return;
    }

    // 桌面端：尝试用getUserMedia打开相机，加3秒超时
    try {
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('camera_timeout')), 3000)
      );
      this.stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
        }),
        timeout
      ]);

      // 相机打开成功 → 实时视频检测
      this._startVideoScan(container);
    } catch (e) {
      // 相机打不开（iOS/HTTP环境）→ 拍照扫描
      this._startPhotoScan(container);
    }
  },

  // 模式1：实时视频检测（getUserMedia可用时）
  _startVideoScan(container) {
    container.innerHTML = `
      <div style="position:relative;overflow:hidden;border-radius:8px;background:#000;">
        <video id="scanner-video" autoplay playsinline muted style="width:100%;display:block;"></video>
        <div style="position:absolute;top:0;left:0;right:0;bottom:0;border:2px solid rgba(26,115,232,0.6);pointer-events:none;border-radius:8px;">
          <div style="position:absolute;left:10%;right:10%;height:2px;background:#1a73e8;animation:bscanline 2s linear infinite;box-shadow:0 0 8px rgba(26,115,232,0.6);"></div>
        </div>
      </div>
      <div style="text-align:center;padding:10px;background:#fff;border-radius:0 0 8px 8px;">
        <span style="color:var(--text-secondary);font-size:13px;">对准条码，自动识别...</span>
        <button class="btn btn-sm btn-secondary" style="margin-left:8px;" onclick="BarcodeScanner._showManualInput(document.getElementById('scanner-placeholder')||document.getElementById('modal-body'))">手动输入</button>
        <button class="btn btn-sm btn-danger" style="margin-left:4px;" onclick="BarcodeScanner.closeAndCleanup()">取消</button>
      </div>
      <style>@keyframes bscanline{0%{top:10%}50%{top:90%}100%{top:10%}}</style>
    `;

    const video = document.getElementById('scanner-video');
    video.srcObject = this.stream;
    this.isScanning = true;

    // 使用原生BarcodeDetector检测（更快）
    if ('BarcodeDetector' in window) {
      this._detectWithBarcodeDetector(video);
    } else {
      // 使用Quagga进行视频检测
      this._detectWithQuagga(video);
    }
  },

  async _detectWithBarcodeDetector(video) {
    const detector = new BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code', 'itf', 'codabar']
    });
    const loop = async () => {
      if (!this.isScanning) return;
      try {
        const barcodes = await detector.detect(video);
        if (barcodes.length > 0) {
          this.stopScan();
          if (this.callback) this.callback(barcodes[0].rawValue);
          return;
        }
      } catch (e) {}
      setTimeout(loop, 200);
    };
    loop();
  },

  async _detectWithQuagga(video) {
    if (typeof Quagga === 'undefined') {
      this._showManualInput(
        document.getElementById('scanner-placeholder') || document.getElementById('modal-body')
      );
      return;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 640;
    canvas.height = 480;

    const loop = async () => {
      if (!this.isScanning) return;
      try {
        ctx.drawImage(video, 0, 0, 640, 480);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);

        Quagga.decodeSingle({
          src: dataUrl,
          numOfWorkers: 0,
          inputStream: { size: 800 },
          locate: true,
          decoder: {
            readers: ['ean_reader', 'ean_8_reader', 'code_128_reader', 'code_39_reader',
                      'codabar_reader', 'i2of5_reader', 'upc_reader', 'upc_e_reader']
          }
        }, (result) => {
          if (!this.isScanning) return;
          if (result && result.codeResult) {
            this.stopScan();
            if (this.callback) this.callback(result.codeResult.code);
            return;
          }
          setTimeout(loop, 300);
        });
      } catch (e) {
        setTimeout(loop, 300);
      }
    };
    loop();
  },

  // 模式2：拍照扫描（所有手机通用，不依赖getUserMedia）
  _startPhotoScan(container) {
    container.innerHTML = `
      <div style="text-align:center;padding:20px;">
        <div style="font-size:48px;margin-bottom:12px;">📷</div>
        <p style="color:var(--text-secondary);margin-bottom:16px;">点击下方按钮扫码</p>
        <button class="btn btn-primary btn-lg" id="photo-scan-btn" style="font-size:16px;padding:12px 32px;">打开相机扫码</button>
        <div id="photo-scan-status" style="margin-top:12px;min-height:24px;"></div>

        <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--border);">
          <p style="color:var(--text-secondary);margin-bottom:8px;font-size:13px;">或手动输入条码编号</p>
          <div style="display:flex;gap:8px;max-width:320px;margin:0 auto;">
            <input type="text" id="manual-barcode-input" placeholder="输入条码编号..." style="flex:1;padding:10px;border:1px solid var(--border);border-radius:6px;font-size:16px;" />
            <button class="btn btn-primary" onclick="BarcodeScanner.manualSubmit()">确认</button>
          </div>
        </div>
        <button class="btn btn-secondary" style="margin-top:16px;" onclick="closeModal()">取消</button>
      </div>
    `;

    // 创建隐藏的文件输入
    let fileInput = document.getElementById('hidden-barcode-input');
    if (!fileInput) {
      fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.id = 'hidden-barcode-input';
      fileInput.accept = 'image/*';
      fileInput.capture = 'environment';
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);

      fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const statusEl = document.getElementById('photo-scan-status');
        statusEl.innerHTML = '正在识别条码...';

        const reader = new FileReader();
        reader.onload = async (evt) => {
          const rawDataUrl = evt.target.result;

          // 压缩图片到最大800px宽，加快Quagga处理速度
          const dataUrl = await this._resizeImage(rawDataUrl, 800);

          // 1. 先试试原生BarcodeDetector
          if ('BarcodeDetector' in window) {
            try {
              const img = new Image();
              img.src = dataUrl;
              await img.decode();
              const detector = new BarcodeDetector({
                formats: ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code', 'itf', 'codabar']
              });
              const barcodes = await detector.detect(img);
              if (barcodes.length > 0) {
                if (this.callback) this.callback(barcodes[0].rawValue);
                return;
              }
            } catch (e) {}
          }

          // 2. 用Quagga解码（支持所有浏览器）
          statusEl.innerHTML = '正在识别条码...';
          const code = await this.decodeFromImage(dataUrl);
          if (code) {
            if (this.callback) this.callback(code);
            return;
          }

          // 3. 都失败了 - 尝试调高灵敏度再试一次
          statusEl.innerHTML = '正在尝试二次识别...';
          const code2 = await this._decodeWithHighSensitivity(dataUrl);
          if (code2) {
            if (this.callback) this.callback(code2);
            return;
          }

          // 3. 服务端解码（最后兜底）
          statusEl.innerHTML = '正在服务端识别...';
          try {
            const serverResult = await API.post('/api/decode-barcode', { image: dataUrl });
            if (serverResult.success && serverResult.code) {
              if (this.callback) this.callback(serverResult.code);
              return;
            }
          } catch (e) {}

          statusEl.innerHTML = '<span style="color:var(--danger);">未识别到条码，请手动输入</span>';
        };
        reader.readAsDataURL(file);
      });
    }

    document.getElementById('photo-scan-btn').onclick = () => {
      fileInput.value = '';
      fileInput.click();
    };
  },

  // ===== 手动输入 =====

  _showManualInput(container) {
    container.innerHTML = `
      <div style="text-align:center;padding:20px;">
        <p style="margin-bottom:12px;font-size:15px;">输入条码编号</p>
        <div style="display:flex;gap:8px;max-width:320px;margin:0 auto;">
          <input type="text" id="manual-barcode-input" placeholder="输入条码编号..." style="flex:1;padding:10px;border:1px solid var(--border);border-radius:6px;font-size:16px;" autofocus />
          <button class="btn btn-primary" onclick="BarcodeScanner.manualSubmit()">确认</button>
        </div>
        <button class="btn btn-secondary" style="margin-top:12px;" onclick="closeModal()">取消</button>
      </div>
    `;
    setTimeout(() => document.getElementById('manual-barcode-input')?.focus(), 100);
  },

  manualSubmit() {
    const input = document.getElementById('manual-barcode-input');
    if (!input || !input.value.trim()) return;
    const code = input.value.trim();
    this.stopScan();
    if (this.callback) this.callback(code);
  },

  // ===== 辅助方法 =====

  // 压缩图片到指定最大宽度
  _resizeImage(dataUrl, maxWidth) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > maxWidth) {
          h = h * (maxWidth / w);
          w = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  },

  // 高灵敏度二次解码
  _decodeWithHighSensitivity(imageSrc) {
    return new Promise((resolve) => {
      if (typeof Quagga === 'undefined') { resolve(null); return; }
      Quagga.decodeSingle({
        src: imageSrc,
        numOfWorkers: 0,
        inputStream: { size: 800 },
        locate: true,
        decoder: {
          readers: ['ean_reader', 'ean_8_reader', 'code_128_reader', 'code_39_reader',
                    'codabar_reader', 'i2of5_reader', 'upc_reader', 'upc_e_reader'],
          multiple: false
        }
      }, (result) => {
        if (result && result.codeResult) {
          resolve(result.codeResult.code);
        } else {
          resolve(null);
        }
      });
    });
  },

  // ===== 清理 =====

  stopScan() {
    this.isScanning = false;
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  },

  closeAndCleanup() {
    this.stopScan();
    closeModal();
  }
};

// ===== 扫码弹窗 =====

function showBarcodeInput(title, callback) {
  const body = document.getElementById('modal-body');
  body.innerHTML = `
    <div style="text-align:center;padding:16px;">
      <p style="margin-bottom:16px;color:var(--text-secondary);">${title || '物品编码录入'}</p>
      <div style="display:flex;gap:8px;max-width:320px;margin:0 auto;">
        <input type="text" id="barcode-modal-input" placeholder="输入编码..." style="flex:1;padding:10px 14px;border:1px solid var(--border);border-radius:8px;font-size:16px;" autofocus />
        <button class="btn btn-primary" onclick="confirmBarcodeInput()">确认</button>
      </div>
      <button class="btn btn-secondary" style="margin-top:12px;" onclick="openBarcodeScanner()">📷 扫码</button>
    </div>
  `;
  window._barcodeCallback = callback;
  showModal(title || '物品编码录入');
  setTimeout(() => document.getElementById('barcode-modal-input')?.focus(), 100);
}

function confirmBarcodeInput() {
  const input = document.getElementById('barcode-modal-input');
  const code = input.value.trim();
  if (!code) { showToast('请输入编码'); return; }
  closeModal();
  if (window._barcodeCallback) window._barcodeCallback(code);
}

function openBarcodeScanner() {
  const container = document.getElementById('modal-body');
  if (!container) return;
  container.innerHTML = '<div id="scanner-placeholder" style="min-height:200px;"></div>';
  BarcodeScanner.startScan(document.getElementById('scanner-placeholder'), (code) => {
    // 扫码成功 → 送回编码，由调用方处理UI
    if (window._barcodeCallback) window._barcodeCallback(code);
  });
}
