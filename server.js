const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

// ============ 加载 .env 文件（云部署需要）============
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split(/\r?\n/).forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const idx = line.indexOf('=');
    if (idx > 0) {
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  });
  console.log('[env] 已加载 .env 文件');
}

const app = express();
const PORT = process.env.PORT || 3000;
const LOG_DIR = path.join(__dirname, 'logs');

// ============ 智能数据库选择 ============
// 如果设置了 DATABASE_URL 环境变量，使用 PostgreSQL（云部署）
// 否则使用本地 SQLite（本地运行）
const USE_PG = !!process.env.DATABASE_URL;

let mainDb, douyinDb;

if (USE_PG) {
  const { PgDatabase } = require('./db/pg-pool');
  const { initPgDatabase } = require('./db/pg-init');
  
  const pgDb = new PgDatabase(process.env.DATABASE_URL);
  
  // 先初始化表结构
  initPgDatabase(pgDb).then(() => {
    log('PostgreSQL 数据库初始化完成');
  }).catch(err => {
    log(`PostgreSQL 初始化失败: ${err.message}`, 'FATAL');
  });
  
  mainDb = pgDb;
  douyinDb = pgDb; // 共用同一个 PostgreSQL 连接池（通过表名前缀区分）
} else {
  const { initMainDatabase, initDouyinDatabase } = require('./db/init');
  mainDb = initMainDatabase();
  douyinDb = initDouyinDatabase();
}

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// 简易日志函数：同时写控制台和文件
function log(msg, level = 'INFO') {
  const time = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const line = `[${time}] [${level}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(path.join(LOG_DIR, 'server.log'), line + '\n');
  } catch(e) {}
}

// ============ 全局崩溃保护 ============
// 防止未捕获的异常导致服务器崩溃
process.on('uncaughtException', (err) => {
  log(`未捕获异常: ${err.message}\n${err.stack}`, 'FATAL');
  // 不退出进程，让服务器继续运行
});

process.on('unhandledRejection', (reason) => {
  log(`未处理Promise拒绝: ${reason}`, 'FATAL');
  // 不退出进程
});

// ============ 获取本机局域网IP ============
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '无法获取IP';
}

// 中间件
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 全局响应头：所有 API 响应统一 UTF-8 编码（防止中文乱码）
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    } else if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
    }
  }
}));

// 确保uploads目录存在
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// 静态文件服务
app.use('/uploads', express.static(uploadsDir));

// 配置文件上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dateDir = new Date().toISOString().slice(0, 10);
    const dir = path.join(uploadsDir, dateDir);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({ 
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// ============ 中间件：注入数据库到请求 ============
app.use((req, res, next) => {
  req.mainDb = mainDb;
  req.douyinDb = douyinDb;
  next();
});

// ============ 通用API ============

// 图片上传
app.post('/api/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '未上传文件' });
  const filePath = '/uploads/' + new Date().toISOString().slice(0, 10) + '/' + req.file.filename;
  res.json({ path: filePath, url: filePath });
});

// 图片上传（base64方式-移动端相机）
app.post('/api/upload-base64', (req, res) => {
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: '无图片数据' });
  
  const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');
  const dateDir = new Date().toISOString().slice(0, 10);
  const dir = path.join(uploadsDir, dateDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  
  const filename = uuidv4() + '.jpg';
  fs.writeFileSync(path.join(dir, filename), buffer);
  
  res.json({ path: '/uploads/' + dateDir + '/' + filename, url: '/uploads/' + dateDir + '/' + filename });
});

// ============ 服务端条码解码API（ZXing 高识别率）===========
let ZXingLib = null, Jimp = null;
try {
  ZXingLib = require('@zxing/library');
  Jimp = require('jimp').Jimp || require('jimp');  // 兼容 Jimp v1+ 命名导出
} catch(e) {
  console.log('[barcode] zxing/jimp 未加载，使用前端解码');
}

// ============ OCR 兜底：识别图片中的数字串（多模式投票提高准确率）===========
const { execFile } = require('child_process');
const util = require('util');
const execFileP = util.promisify(execFile);
const TesseractPath = require('child_process').execSync('which tesseract').toString().trim();

// Otsu 自适应阈值（把图片二值化，数字清晰、去噪）
function otsuThreshold(data, width, height) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    hist[data[i]]++;  // R 通道即灰度值
  }
  const total = width * height;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, maxVar = -1, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; threshold = t; }
  }
  return threshold;
}

// 从 OCR 文本中提取数字串：OCR 常把长数字拆成多段（空格分隔），先合并再提取
function extractDigitRuns(text) {
  const raw = String(text);
  // 合并被空格/换行拆开的连续数字段（每段至少2位才合并，避免把无关数字拼一起）
  const merged = raw.replace(/(\d{2,})\s+(\d{2,})/g, '$1$2');
  // 再提取 >=6 位的连续数字
  const matches = merged.match(/\d{6,}/g);
  return matches || [];
}

// 多模式 OCR + 投票：同一图用多种 PSM 识别，数字串投票取最优
async function ocrWithVoting(imageBuffer, tmpPrefix) {
  const img = await Jimp.read(imageBuffer);
  // 放大 2 倍（小图数字太密识别差）
  if (img.bitmap.width < 1200) img.scale(2);

  const results = [];

  // 变体1：原图（灰度）
  const v1 = await img.clone().greyscale();
  // 变体2：二值化（Otsu）
  const grey = img.clone().greyscale();
  const th = otsuThreshold(grey.bitmap.data, grey.bitmap.width, grey.bitmap.height);
  const { data } = grey.bitmap;
  for (let i = 0; i < data.length; i += 4) {
    const v = data[i] < th ? 0 : 255;
    data[i] = data[i + 1] = data[i + 2] = v;
  }
  const v2 = grey;
  // 变体3：反色二值化
  const v3 = v2.clone().invert();

  const variants = [v1, v2, v3];

  for (let vi = 0; vi < variants.length; vi++) {
    const tmpFile = path.join(uploadsDir, tmpPrefix + '_' + Date.now() + '_' + vi + '.png');
    try {
      await variants[vi].write(tmpFile);
      // 两个 psm：6=整块文本，13=单行
      for (const psm of [6, 13]) {
        try {
          const { stdout } = await execFileP(TesseractPath, [
            tmpFile, '-', '-l', 'eng', '--psm', String(psm),
            '-c', 'tessedit_char_whitelist=0123456789'
          ]);
          results.push(String(stdout));
        } catch (e) {}
      }
    } catch (e) {}
    finally { try { fs.unlinkSync(tmpFile); } catch(e) {} }
  }

  // 投票：优先运单号长度(18-20位)，其次选最长的
  const countMap = new Map();
  for (const r of results) {
    for (const run of extractDigitRuns(r)) {
      countMap.set(run, (countMap.get(run) || 0) + 1);
    }
  }
  let best = null, bestScore = -1;
  // 优先找 15~22 位候选（运单/条码号典型长度），长度越接近19位越好，其次看出现次数
  const preferred = [...countMap.keys()].filter(run => run.length >= 15 && run.length <= 22);
  if (preferred.length > 0) {
    for (const run of preferred) {
      const lengthScore = run.length === 19 ? 100 : (run.length >= 17 && run.length <= 21 ? 50 : 0);
      const score = lengthScore + countMap.get(run);
      if (score > bestScore || (score === bestScore && run.length > (best ? best.length : 0))) {
        best = run; bestScore = score;
      }
    }
  }
  if (!best) {
    for (const [run, cnt] of countMap) {
      if (!best || run.length > best.length || (run.length === best.length && cnt > bestScore)) {
        best = run; bestScore = cnt;
      }
    }
  }
  return best;
}

app.post('/api/ocr-text', async (req, res) => {
  if (!ZXingLib || !Jimp) return res.status(503).json({ error: 'OCR 依赖未加载' });
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: '无图片数据' });

  const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

  try {
    const best = await ocrWithVoting(buffer, 'tmp_ocr_');
    res.json({ success: !!best, text: best || '' });
  } catch (e) {
    console.error('[ocr-text] 错误:', e.message);
    res.json({ success: false, text: null });
  }
});

app.post('/api/decode-barcode', async (req, res) => {
  if (!ZXingLib || !Jimp) {
    return res.status(503).json({ error: '服务端条码解码不可用，请使用前端扫描' });
  }
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: '无图片数据' });

  const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

  // ZXing 强力识别配置：TRY_HARDER + 反色 + 多格式
  const hints = new Map();
  hints.set(ZXingLib.DecodeHintType.TRY_HARDER, true);
  hints.set(ZXingLib.DecodeHintType.ALSO_INVERTED, true);
  hints.set(ZXingLib.DecodeHintType.POSSIBLE_FORMATS, [
    ZXingLib.BarcodeFormat.CODE_128, ZXingLib.BarcodeFormat.CODE_39, ZXingLib.BarcodeFormat.CODE_93,
    ZXingLib.BarcodeFormat.EAN_13, ZXingLib.BarcodeFormat.EAN_8,
    ZXingLib.BarcodeFormat.UPC_A, ZXingLib.BarcodeFormat.UPC_E,
    ZXingLib.BarcodeFormat.ITF, ZXingLib.BarcodeFormat.QR_CODE,
    ZXingLib.BarcodeFormat.DATA_MATRIX, ZXingLib.BarcodeFormat.CODABAR
  ]);

  const tryDecode = (img) => {
    const { width, height, data } = img.bitmap;
    const source = new ZXingLib.RGBLuminanceSource(new Uint8ClampedArray(data), width, height);
    const reader = new ZXingLib.MultiFormatReader();
    reader.setHints(hints);
    return reader.decode(new ZXingLib.BinaryBitmap(new ZXingLib.HybridBinarizer(source)));
  };

  try {
    const original = await Jimp.read(buffer);
    const originalWidth = original.bitmap.width;

    // 多尺度 + 多增强 候选列表
    const candidates = [];
    try { candidates.push({ img: original, name: '原图' }); } catch(e) {}
    if (originalWidth < 1400) {
      try {
        const big = await original.clone().scale(1.5);
        candidates.push({ img: big, name: '放大1.5x' });
      } catch(e) {}
      try {
        const big2 = await original.clone().scale(2);
        candidates.push({ img: big2, name: '放大2x' });
      } catch(e) {}
    }
    if (originalWidth > 900) {
      try {
        // scale(factor) 兼容 v1，用比例缩放代替 Jimp.AUTO
        const small = await original.clone().scale(800 / originalWidth);
        candidates.push({ img: small, name: '缩小800' });
      } catch(e) {}
    }

    // 每个候选：尝试多种增强（每个都是新实例）
    for (const c of candidates) {
      const variants = [];
      try { variants.push({ img: await c.img.clone().greyscale().normalize(), name: c.name + '-均衡' }); } catch(e) {}
      try { variants.push({ img: await c.img.clone().greyscale().contrast(0.7), name: c.name + '-对比' }); } catch(e) {}
      try { variants.push({ img: await c.img.clone().greyscale(), name: c.name + '-灰度' }); } catch(e) {}

      for (const v of variants) {
        try {
          const result = tryDecode(v.img);
          if (result && result.getText) {
            return res.json({ success: true, code: result.getText(), scale: v.name });
          }
        } catch (e) { /* 该组合失败，尝试下一个 */ }
      }
    }

    res.json({ success: false, code: null });
  } catch (e) {
    res.json({ success: false, code: null });
  }
});

// ============ 路由加载 ============
// 根据数据库类型选择路由：Cloud 版（PostgreSQL/异步）或 Local 版（SQLite/同步）
let mainRoutes, douyinRoutes;

if (USE_PG) {
  mainRoutes = require('./routes/main-cloud')(mainDb);
  douyinRoutes = require('./routes/douyin-cloud')(douyinDb);
} else {
  mainRoutes = require('./routes/main')(mainDb);
  douyinRoutes = require('./routes/douyin')(douyinDb);
}

app.use('/api/main', mainRoutes);
app.use('/api/douyin', douyinRoutes);

// ============ 健康检查接口（放路由前，避免被通配路由拦截）============
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString(), uptime: process.uptime() });
});

// ============ 前端入口 ============
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 启动服务器
if (require.main === module) {
  const localIP = getLocalIP();
  const dbMode = USE_PG ? 'PostgreSQL ☁️ 云模式' : 'SQLite 💻 本地模式';
  app.listen(PORT, '0.0.0.0', () => {
    log('========================================');
    log('  出入库库存管理工作台 已启动');
    log(`  数据库: ${dbMode}`);
    log(`  电脑端: http://localhost:${PORT}`);
    if (!USE_PG) {
      log(`  手机端: http://${localIP}:${PORT}`);
      log(`  主机名: http://${os.hostname()}:${PORT} (部分手机可能不支持)`);
      log('========================================');
      log('提示: 使用 start.bat 启动服务；使用 stop.bat 停止服务');
      log('      如手机无法连接，请检查电脑防火墙端口3000是否开放');
    } else {
      log('========================================');
      log('云模式已启动，可通过公网地址访问');
    }
  });
}

module.exports = app;
