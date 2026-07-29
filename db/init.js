const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_DIR = __dirname;

function createDatabase(dbName) {
  const dbPath = path.join(DB_DIR, dbName);
  const db = new DatabaseSync(dbPath);
  
  // 设置journal模式
  db.exec('PRAGMA journal_mode=DELETE');
  
  return db;
}

function initMainDatabase() {
  const db = createDatabase('main.db');
  const prefix = 'main_';

  // 产品信息表
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${prefix}products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      spec TEXT DEFAULT '',
      unit TEXT DEFAULT '',
      market_price TEXT DEFAULT '',
      type TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    )
  `);

  // 价格历史记录
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${prefix}price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_code TEXT NOT NULL,
      date TEXT NOT NULL,
      price REAL DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      UNIQUE(product_code, date)
    )
  `);

  // 入库记录
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${prefix}inbound (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_code TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      device TEXT DEFAULT '',
      channel TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      order_no TEXT DEFAULT '',
      image_path TEXT DEFAULT '',
      purchase_price REAL DEFAULT 0,
      row_color TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    )
  `);
  try { db.exec(`ALTER TABLE ${prefix}inbound ADD COLUMN row_color TEXT DEFAULT ''`); } catch (e) {}

  // 出库记录
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${prefix}outbound (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_code TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      image_path TEXT DEFAULT '',
      location TEXT DEFAULT '',
      row_color TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    )
  `);
  try { db.exec(`ALTER TABLE ${prefix}outbound ADD COLUMN row_color TEXT DEFAULT ''`); } catch (e) {}

  // 配置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${prefix}config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_key TEXT UNIQUE NOT NULL,
      config_value TEXT DEFAULT ''
    )
  `);

  // 初始化默认配置
  const insertConfig = db.prepare('INSERT OR IGNORE INTO main_config (config_key, config_value) VALUES (?, ?)');
  insertConfig.run('product_types', JSON.stringify(["电子设备","办公用品","耗材","其他"]));
  insertConfig.run('channel_options', JSON.stringify(["淘宝","京东","拼多多","抖音","线下采购"]));

  return db;
}

function initDouyinDatabase() {
  const db = createDatabase('douyin.db');
  const prefix = 'douyin_';

  // 产品信息表
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${prefix}products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      spec TEXT DEFAULT '',
      unit TEXT DEFAULT '',
      market_price TEXT DEFAULT '',
      type TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      updated_at DATETIME DEFAULT (datetime('now','localtime'))
    )
  `);

  // 价格历史
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${prefix}price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_code TEXT NOT NULL,
      date TEXT NOT NULL,
      price REAL DEFAULT 0,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      UNIQUE(product_code, date)
    )
  `);

  // 入库记录
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${prefix}inbound (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_code TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      device TEXT DEFAULT '',
      channel TEXT DEFAULT '',
      remark TEXT DEFAULT '',
      image_path TEXT DEFAULT '',
      purchase_price REAL DEFAULT 0,
      order_no TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    )
  `);

  // 出库记录
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${prefix}outbound (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_code TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      image_path TEXT DEFAULT '',
      location TEXT DEFAULT '',
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    )
  `);

  // 配置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${prefix}config (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      config_key TEXT UNIQUE NOT NULL,
      config_value TEXT DEFAULT ''
    )
  `);

  const insertConfig = db.prepare('INSERT OR IGNORE INTO douyin_config (config_key, config_value) VALUES (?, ?)');
  insertConfig.run('product_types', JSON.stringify(["抖音券","优惠券","代金券","其他"]));
  insertConfig.run('channel_options', JSON.stringify(["抖音直播","抖音小店","抖音橱窗","线下"]));

  return db;
}

module.exports = { initMainDatabase, initDouyinDatabase };
