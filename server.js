const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

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

// ============ 服务端条码解码API ============
let Quagga = null;
try {
  Quagga = require('quagga').default;
} catch(e) {
  console.log('[barcode] quagga 未加载（云环境可能不支持），使用前端解码');
}

app.post('/api/decode-barcode', (req, res) => {
  if (!Quagga) {
    return res.status(503).json({ error: '服务端条码解码不可用，请使用前端扫描' });
  }
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: '无图片数据' });

  const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');
  const tmpFile = path.join(uploadsDir, 'tmp_barcode_' + uuidv4() + '.jpg');
  
  try {
    fs.writeFileSync(tmpFile, buffer);
    
    Quagga.decodeSingle({
      src: tmpFile,
      numOfWorkers: 0,
      inputStream: { size: 800 },
      locate: true,
      decoder: {
        readers: ['ean_reader', 'ean_8_reader', 'code_128_reader', 'code_39_reader',
                  'codabar_reader', 'i2of5_reader', 'upc_reader', 'upc_e_reader']
      }
    }, (result) => {
      // 清理临时文件
      try { fs.unlinkSync(tmpFile); } catch(e) {}
      
      if (result && result.codeResult) {
        res.json({ success: true, code: result.codeResult.code });
      } else {
        res.json({ success: false, code: null });
      }
    });
  } catch (e) {
    try { fs.unlinkSync(tmpFile); } catch(ex) {}
    res.status(500).json({ error: e.message });
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
