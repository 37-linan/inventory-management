// 条码扫描模块（使用Quagga纯JS解码，兼容所有手机）
const BarcodeScanner = {
  stream: null,
  isScanning: false,
  callback: null,

  // 统一处理识别结果：弹出确认框（可修改），确认后回调
  _handleResult(code) {
    this.stopScan();
    if (!code) { showToast('识别结果为空'); return; }
    showModal('确认识别结果');
    const body = document.getElementById('modal-body');
    body.innerHTML = `
      <div style="text-align:center;">
        <p style="margin-bottom:10px;color:var(--text-secondary);">识别结果如下，如有误可直接修改：</p>
        <input type="text" id="confirm-code" value="${code}" style="width:100%;padding:12px;font-size:18px;border:1px solid var(--border);border-radius:8px;text-align:center;" />
        <div style="display:flex;gap:8px;margin-top:14px;">
          <button class="btn btn-primary btn-lg" style="flex:1;" onclick="BarcodeScanner._confirmFill()">✓ 确认</button>
          <button class="btn btn-secondary btn-lg" style="flex:1;" onclick="closeModal()">取消</button>
        </div>
      </div>
    `;
    setTimeout(() => {
      const input = document.getElementById('confirm-code');
      if (input) { input.focus(); input.select(); }
    }, 100);
  },

  _confirmFill() {
    const input = document.getElementById('confirm-code');
    const code = input.value.trim();
    if (!code) { showToast('请输入编码'); return; }
    closeModal();
    this.stopScan();
    if (this.callback) this.callback(code);
  },

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
    this._container = container;
    // 强制复位：上一轮若没清干净（isScanning 卡 true / 残留 stream），后面每次扫码都会直接失败
    this.stopScan();
    this.isScanning = false;

    // 显示准备界面
    container.innerHTML = `
      <div style="text-align:center;padding:24px;">
        <p style="color:var(--text-secondary);margin-bottom:16px;">正在启动实时摄像头...</p>
        <div style="width:48px;height:48px;border:3px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:bspin 0.8s linear infinite;margin:0 auto;"></div>
        <p style="color:var(--text-secondary);font-size:12px;margin-top:14px;">若弹出「允许使用摄像头」请点允许</p>
      </div>
      <style>@keyframes bspin{to{transform:rotate(360deg)}}</style>
    `;

    // ===== 第一步：环境自检 =====
    // HTTP 页面（含用 IP:3000 访问）在手机上属于非安全上下文，navigator.mediaDevices 直接不存在，
    // 这时任何实时摄像头方案都不可能生效 —— 必须明确告诉用户，不能再静默退成拍照。
    const hasGUM = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const isSecure = window.isSecureContext === true ||
      location.protocol === 'https:' ||
      location.hostname === 'localhost' || location.hostname === '127.0.0.1';

    if (!hasGUM) {
      this._showCameraError(container, isSecure
        ? '当前浏览器不支持实时摄像头（mediaDevices 不可用）。\n建议：用系统自带浏览器（Safari / Chrome）打开本页面。'
        : `当前页面不是 HTTPS 安全连接，手机浏览器会禁止调用摄像头，所以只能拍照。\n\n当前地址：${location.origin}\n请改用 https://nanyishangmao.cn 打开本页面后再扫码。`);
      return;
    }

    // ===== 第二步：打开摄像头（三档约束逐级放宽，兼容各类 iPhone / Android）=====
    const ladder = [
      { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
      { video: { facingMode: 'environment' } },
      { video: true }
    ];
    let lastErr = null;
    for (const constraints of ladder) {
      try {
        this.stream = await this._gumWithTimeout(constraints, 25000);
        break;
      } catch (e) {
        lastErr = e;
        // 权限被拒 / 安全策略拦截：放宽约束也没用，直接跳出报错
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) break;
      }
    }

    if (!this.stream) {
      // 不再自动退拍照！把真实原因摆出来，让用户能修
      this._showCameraError(container, this._describeCameraError(lastErr));
      return;
    }

    // ===== 第三步：实时视频检测（对准条码自动识别，无需点按钮）=====
    await this._startVideoScan(container);
  },

  // 带超时的 getUserMedia：超时后若流才返回，立即关掉，避免摄像头被占住导致后续永远失败
  _gumWithTimeout(constraints, ms) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const err = new Error('摄像头启动超时');
        err.name = 'TimeoutError';
        reject(err);
      }, ms);
      navigator.mediaDevices.getUserMedia(constraints).then(
        (s) => {
          if (settled) { try { s.getTracks().forEach(t => t.stop()); } catch (_) {} return; }
          settled = true; clearTimeout(timer); resolve(s);
        },
        (e) => {
          if (settled) return;
          settled = true; clearTimeout(timer); reject(e);
        }
      );
    });
  },

  // 把浏览器的原始报错翻译成人能看懂 + 能操作的提示
  _describeCameraError(e) {
    const name = (e && e.name) || '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return '摄像头权限被拒绝。\n\n· iPhone：设置 → Safari → 相机 → 选「询问」或「允许」\n· 或在网页地址栏点「aA」→ 网站设置 → 相机 → 允许\n\n设置好后回来点下面的「重新打开」。';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return '浏览器没有找到可用的摄像头。';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return '摄像头被其他程序占用了（例如「相机」App 还开着），请关掉后点「重新打开」。';
    }
    if (name === 'TimeoutError') {
      return '摄像头启动超时。\n如果刚才弹出了「允许使用摄像头」而你没点，请先点「允许」再重试。';
    }
    return '摄像头打开失败：' + ((e && (e.message || e.name)) || '未知错误');
  },

  // 摄像头失败页：说明原因 + 重试 / 拍照 / 手动输入
  _showCameraError(container, msg) {
    this.stopScan();
    container.innerHTML = `
      <div style="text-align:center;padding:20px;">
        <div style="font-size:40px;margin-bottom:8px;">📷</div>
        <p style="color:var(--danger);font-weight:600;margin-bottom:10px;">实时摄像头打不开</p>
        <p style="color:var(--text-secondary);font-size:13px;line-height:1.7;white-space:pre-line;text-align:left;background:var(--bg-secondary,#f6f6f6);padding:10px 12px;border-radius:8px;">${msg}</p>
        <div style="margin-top:16px;display:flex;flex-direction:column;gap:8px;">
          <button class="btn btn-primary btn-lg" onclick="BarcodeScanner.retryScan()">🔄 重新打开实时摄像头</button>
          <button class="btn btn-secondary" onclick="BarcodeScanner.startPhotoMode()">📸 改用拍照识别</button>
          <button class="btn btn-secondary" onclick="BarcodeScanner._showManualInput(BarcodeScanner._container)">⌨️ 手动输入编码</button>
        </div>
        <p style="color:var(--text-secondary);font-size:11px;margin-top:14px;word-break:break-all;">${location.origin} · ${isSecureCtx() ? '安全连接' : '非安全连接'}</p>
      </div>
    `;
  },

  retryScan() {
    if (this._container) this.startScan(this._container, this.callback);
  },

  startPhotoMode() {
    if (this._container) this._startPhotoScan(this._container);
  },

  // 模式1：实时视频检测（getUserMedia可用时）
  async _startVideoScan(container) {
    container.innerHTML = `
      <div style="position:relative;overflow:hidden;border-radius:8px;background:#000;">
        <video id="scanner-video" autoplay playsinline webkit-playsinline muted style="width:100%;display:block;min-height:180px;"></video>
        <div style="position:absolute;top:0;left:0;right:0;bottom:0;border:2px solid rgba(26,115,232,0.6);pointer-events:none;border-radius:8px;">
          <div style="position:absolute;left:10%;right:10%;height:2px;background:#1a73e8;animation:bscanline 2s linear infinite;box-shadow:0 0 8px rgba(26,115,232,0.6);"></div>
        </div>
      </div>
      <div style="text-align:center;padding:10px;background:#fff;border-radius:0 0 8px 8px;">
        <span id="scan-status" style="color:var(--text-secondary);font-size:13px;">正在启动实时画面...</span>
        <button class="btn btn-sm btn-secondary" style="margin-left:8px;" onclick="BarcodeScanner._showManualInput(BarcodeScanner._container)">手动输入</button>
        <button class="btn btn-sm btn-danger" style="margin-left:4px;" onclick="BarcodeScanner.closeAndCleanup()">取消</button>
      </div>
      <style>@keyframes bscanline{0%{top:10%}50%{top:90%}100%{top:10%}}</style>
    `;

    const video = document.getElementById('scanner-video');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.muted = true;
    video.srcObject = this.stream;

    // iPhone 必须显式 play()，只给 autoplay 有时不出帧 → 画面全黑，什么也解不出来
    try { await video.play(); } catch (e) {}

    // 等真正开始出画面（readyState>=2）再解码，避免前面几帧全黑白跑
    await this._waitVideoReady(video, 8000);

    this.isScanning = true;
    const statusEl = document.getElementById('scan-status');
    if (statusEl) statusEl.textContent = '对准条码，自动识别...';

    // iPhone Safari 的 BarcodeDetector 只支持二维码，对 EAN-13 商品条码永远返回空 → 白等空转
    // 先确认原生检测器真支持商品条码，不支持就直接用 Quagga 逐帧识别（不空转，更快也更准）
    this._supportsEan13().then(ok => {
      if (!this.isScanning) return;
      if (ok) {
        this._detectWithBarcodeDetector(video);
      } else {
        this._detectWithQuagga(video);
      }
    });
  },

  // 等视频真正出画面
  _waitVideoReady(video, ms) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        if (video.readyState >= 2 && video.videoWidth > 0) return resolve(true);
        if (Date.now() - start > ms) return resolve(false);
        setTimeout(tick, 100);
      };
      tick();
    });
  },

  // 检测原生 BarcodeDetector 是否真正支持商品条码（EAN-13/EAN-8）；Safari 只支持二维码会误判
  async _supportsEan13() {
    try {
      if (!('BarcodeDetector' in window)) return false;
      if (typeof BarcodeDetector.getSupportedFormats === 'function') {
        const fmts = await BarcodeDetector.getSupportedFormats();
        return fmts.includes('ean_13') || fmts.includes('ean_8');
      }
      return true; // 老版本没有查询方法，默认交给它试
    } catch (e) {
      return false;
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
      this._showManualInput(this._container);
      return;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const loop = async () => {
      if (!this.isScanning) return;
      try {
        // 按视频真实分辨率取帧（上限 1280 宽），比固定 640×480 更容易看清细条码
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 480;
        const scale = Math.min(1, 1280 / vw);
        const w = Math.round(vw * scale) || 640;
        const h = Math.round(vh * scale) || 480;
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        ctx.drawImage(video, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);

        Quagga.decodeSingle({
          src: dataUrl,
          numOfWorkers: 0,
          inputStream: { size: 1280 },
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
          setTimeout(loop, 200);
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

          // 压缩图片到1600px（保留条码细节，条码太小时800px会丢细节）
          const dataUrl = await this._resizeImage(rawDataUrl, 1600);

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
                this._handleResult(barcodes[0].rawValue);
                return;
              }
            } catch (e) {}
          }

          // 2. 服务端 ZXing 解码（识别率最高，优先于 Quagga）
          statusEl.innerHTML = '正在识别条码...';
          try {
            const serverResult = await API.post('/api/decode-barcode', { image: dataUrl });
            if (serverResult.success && serverResult.code) {
              this._handleResult(serverResult.code);
              return;
            }
          } catch (e) {}

          // 3. 用Quagga解码（前端兜底）
          statusEl.innerHTML = '正在识别条码...';
          const code = await this.decodeFromImage(dataUrl);
          if (code) {
            this._handleResult(code);
            return;
          }

          // 4. 都失败了 - 尝试调高灵敏度再试一次
          statusEl.innerHTML = '正在尝试二次识别...';
          const code2 = await this._decodeWithHighSensitivity(dataUrl);
          if (code2) {
            this._handleResult(code2);
            return;
          }

          statusEl.innerHTML = `
            <div style="color:var(--danger);margin-bottom:10px;">未识别到条码</div>
            <button class="btn btn-primary" style="margin-right:6px;" onclick="BarcodeScanner._showCropUI('${rawDataUrl}')">✂️ 框选条码区域重试</button>
            <button class="btn btn-secondary" onclick="BarcodeScanner._showManualInput(BarcodeScanner._container)">手动输入</button>
          `;
        };
        reader.readAsDataURL(file);
      });
    }

    document.getElementById('photo-scan-btn').onclick = () => {
      fileInput.value = '';
      fileInput.click();
    };
  },

  // ===== 框选条码区域 =====
  _showCropUI(imageDataUrl) {
    showModal('✂️ 框选条码区域');
    const body = document.getElementById('modal-body');
    body.innerHTML = `
      <div style="text-align:center;">
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:10px;">用方框圈住<b>条码</b>或<b>条码下方的数字</b>，确认后识别</p>
        <div id="crop-stage" style="position:relative;display:inline-block;max-width:100%;user-select:none;touch-action:none;">
          <img id="crop-img" src="${imageDataUrl}" style="max-width:100%;display:block;" />
          <div id="crop-box" style="position:absolute;border:2px solid #1a73e8;background:rgba(26,115,232,0.12);cursor:move;box-sizing:border-box;">
            <div class="crop-handle crop-handle-rb" style="position:absolute;right:-6px;bottom:-6px;width:14px;height:14px;background:#1a73e8;border-radius:50%;cursor:nwse-resize;border:2px solid #fff;"></div>
          </div>
        </div>
        <div style="margin-top:14px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          <button class="btn btn-primary" onclick="BarcodeScanner._doCropAndDecode()">✓ 确认裁剪并识别</button>
          <button class="btn btn-secondary" onclick="BarcodeScanner.manualSubmit && BarcodeScanner._showManualInput(document.getElementById('modal-body'))">手动输入</button>
        </div>
      </div>
    `;
    this._cropImage = imageDataUrl;

    // 等图片加载完设置默认框
    const img = document.getElementById('crop-img');
    img.onload = () => {
      const box = document.getElementById('crop-box');
      // 默认框在中间偏下（条码通常在小票中下方）
      const w = img.clientWidth, h = img.clientHeight;
      const bw = Math.min(w * 0.7, 280);
      const bh = Math.min(h * 0.3, 120);
      box.style.left = ((w - bw) / 2) + 'px';
      box.style.top = ((h - bh) / 2 + h * 0.1) + 'px';
      box.style.width = bw + 'px';
      box.style.height = bh + 'px';
      this._initCropDrag();
    };
    if (img.complete) img.onload();
  },

  _initCropDrag() {
    const box = document.getElementById('crop-box');
    const stage = document.getElementById('crop-stage');
    if (!box || !stage) return;

    let dragging = false, resizing = false, startX, startY, startL, startT, startW, startH;

    const onDown = (e) => {
      const t = e.touches ? e.touches[0] : e;
      const handle = e.target.classList.contains('crop-handle');
      startX = t.clientX; startY = t.clientY;
      startL = box.offsetLeft; startT = box.offsetTop;
      startW = box.offsetWidth; startH = box.offsetHeight;
      if (handle) resizing = true; else dragging = true;
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging && !resizing) return;
      const t = e.touches ? e.touches[0] : e;
      const dx = t.clientX - startX, dy = t.clientY - startY;
      if (dragging) {
        box.style.left = (startL + dx) + 'px';
        box.style.top = (startT + dy) + 'px';
      } else if (resizing) {
        const nw = Math.max(40, startW + dx);
        const nh = Math.max(20, startH + dy);
        box.style.width = nw + 'px';
        box.style.height = nh + 'px';
      }
      e.preventDefault();
    };
    const onUp = () => { dragging = false; resizing = false; };

    box.addEventListener('mousedown', onDown);
    box.addEventListener('touchstart', onDown, { passive: false });
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
  },

  async _doCropAndDecode() {
    const img = document.getElementById('crop-img');
    const box = document.getElementById('crop-box');
    if (!img || !box) return;
    // 计算框在原图坐标（考虑图片缩放）
    const scaleX = img.naturalWidth / img.clientWidth;
    const scaleY = img.naturalHeight / img.clientHeight;
    const x = Math.max(0, Math.round(box.offsetLeft * scaleX));
    const y = Math.max(0, Math.round(box.offsetTop * scaleY));
    const w = Math.round(box.offsetWidth * scaleX);
    const h = Math.round(box.offsetHeight * scaleY);

    // 裁剪到 canvas
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, x, y, w, h, 0, 0, w, h);
    const croppedUrl = canvas.toDataURL('image/jpeg', 0.85);

    // 显示识别中
    const body = document.getElementById('modal-body');
    body.innerHTML = '<div style="text-align:center;padding:30px;"><p>正在识别条码...</p><div style="width:36px;height:36px;border:3px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:bspin 0.8s linear infinite;margin:12px auto;"></div><style>@keyframes bspin{to{transform:rotate(360deg)}}</style></div>';

    // 尝试 BarcodeDetector
    if ('BarcodeDetector' in window) {
      try {
        const cImg = new Image();
        cImg.src = croppedUrl;
        await cImg.decode();
        const detector = new BarcodeDetector({
          formats: ['ean_13','ean_8','code_128','code_39','upc_a','upc_e','qr_code','itf','codabar']
        });
        const barcodes = await detector.detect(cImg);
        if (barcodes.length > 0) {
          this.stopScan();
          closeModal();
          this._handleResult(barcodes[0].rawValue);
          return;
        }
      } catch (e) {}
    }

    // Quagga 识别
    const code = await this.decodeFromImage(croppedUrl);
    if (code) {
      this.stopScan();
      closeModal();
      this._handleResult(code);
      return;
    }

    // 还不行，让用户重新裁剪
    body.innerHTML = `
      <div style="text-align:center;padding:20px;">
        <p style="color:var(--danger);">裁剪区域内仍识别不到条码</p>
        <p style="color:var(--text-secondary);font-size:13px;margin:10px 0;">建议：把方框对准<b>条码本身</b>，尽量让条码横向占满整个框</p>
        <div style="margin-top:14px;">
          <button class="btn btn-primary" onclick="BarcodeScanner._showCropUI(BarcodeScanner._cropImage)">重新框选</button>
          <button class="btn btn-secondary" onclick="BarcodeScanner._showManualInput(BarcodeScanner._container)">手动输入</button>
        </div>
      </div>
    `;
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

// 判断当前是否为安全上下文（只有安全上下文浏览器才允许调摄像头）
function isSecureCtx() {
  return window.isSecureContext === true ||
    location.protocol === 'https:' ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1';
}

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
