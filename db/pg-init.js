/**
 * PostgreSQL 数据库初始化
 * 创建所有必要的表
 */

const mainSchema = `
  -- 产品信息表
  CREATE TABLE IF NOT EXISTS main_products (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    spec TEXT DEFAULT '',
    unit VARCHAR(50) DEFAULT '',
    market_price TEXT DEFAULT '',
    type VARCHAR(100) DEFAULT '',
    gift_of VARCHAR(100) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- 价格历史记录
  CREATE TABLE IF NOT EXISTS main_price_history (
    id SERIAL PRIMARY KEY,
    product_code VARCHAR(100) NOT NULL,
    date DATE NOT NULL,
    price DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_code, date)
  );

  -- 入库记录
  CREATE TABLE IF NOT EXISTS main_inbound (
    id SERIAL PRIMARY KEY,
    product_code VARCHAR(100) NOT NULL,
    quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
    device VARCHAR(100) DEFAULT '',
    channel VARCHAR(100) DEFAULT '',
    remark TEXT DEFAULT '',
    order_no VARCHAR(200) DEFAULT '',
    image_path TEXT DEFAULT '',
    purchase_price DECIMAL(10,2) DEFAULT 0,
    row_color VARCHAR(20) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- 出库记录
  CREATE TABLE IF NOT EXISTS main_outbound (
    id SERIAL PRIMARY KEY,
    product_code VARCHAR(100) NOT NULL,
    quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
    image_path TEXT DEFAULT '',
    location VARCHAR(200) DEFAULT '',
    row_color VARCHAR(20) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- 配置表
  CREATE TABLE IF NOT EXISTS main_config (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value TEXT DEFAULT ''
  );

  -- 初始化默认配置
  INSERT INTO main_config (config_key, config_value) 
  SELECT 'product_types', '["电子设备","办公用品","耗材","其他"]'
  WHERE NOT EXISTS (SELECT 1 FROM main_config WHERE config_key = 'product_types');

  INSERT INTO main_config (config_key, config_value) 
  SELECT 'channel_options', '["淘宝","京东","拼多多","抖音","线下采购"]'
  WHERE NOT EXISTS (SELECT 1 FROM main_config WHERE config_key = 'channel_options');
`;

const douyinSchema = `
  -- 产品信息表
  CREATE TABLE IF NOT EXISTS douyin_products (
    id SERIAL PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(200) NOT NULL,
    spec TEXT DEFAULT '',
    unit VARCHAR(50) DEFAULT '',
    market_price TEXT DEFAULT '',
    type VARCHAR(100) DEFAULT '',
    gift_of VARCHAR(100) DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- 价格历史
  CREATE TABLE IF NOT EXISTS douyin_price_history (
    id SERIAL PRIMARY KEY,
    product_code VARCHAR(100) NOT NULL,
    date DATE NOT NULL,
    price DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_code, date)
  );

  -- 入库记录
  CREATE TABLE IF NOT EXISTS douyin_inbound (
    id SERIAL PRIMARY KEY,
    product_code VARCHAR(100) NOT NULL,
    quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
    device VARCHAR(100) DEFAULT '',
    channel VARCHAR(100) DEFAULT '',
    remark TEXT DEFAULT '',
    order_no VARCHAR(200) DEFAULT '',
    image_path TEXT DEFAULT '',
    purchase_price DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- 出库记录
  CREATE TABLE IF NOT EXISTS douyin_outbound (
    id SERIAL PRIMARY KEY,
    product_code VARCHAR(100) NOT NULL,
    quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
    image_path TEXT DEFAULT '',
    location VARCHAR(200) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  -- 配置表
  CREATE TABLE IF NOT EXISTS douyin_config (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(100) UNIQUE NOT NULL,
    config_value TEXT DEFAULT ''
  );

  -- 初始化默认配置
  INSERT INTO douyin_config (config_key, config_value) 
  SELECT 'product_types', '["抖音券","优惠券","代金券","其他"]'
  WHERE NOT EXISTS (SELECT 1 FROM douyin_config WHERE config_key = 'product_types');

  INSERT INTO douyin_config (config_key, config_value) 
  SELECT 'channel_options', '["抖音直播","抖音小店","抖音橱窗","线下"]'
  WHERE NOT EXISTS (SELECT 1 FROM douyin_config WHERE config_key = 'channel_options');
`;

const migrationSQL = `
  -- 添加 gift_of 字段（兼容已有数据库）
  ALTER TABLE main_products ADD COLUMN IF NOT EXISTS gift_of VARCHAR(100) DEFAULT NULL;
  ALTER TABLE douyin_products ADD COLUMN IF NOT EXISTS gift_of VARCHAR(100) DEFAULT NULL;
`;

async function initPgDatabase(pgDb) {
  // 执行主系统表创建
  await pgDb.query(mainSchema);
  console.log('[pg-init] 主系统表结构已创建');

  // 执行抖音系统表创建
  await pgDb.query(douyinSchema);
  console.log('[pg-init] 抖音系统表结构已创建');

  // 执行迁移（已有数据库加字段）
  try {
    await pgDb.query(migrationSQL);
    console.log('[pg-init] 迁移已执行（gift_of 字段）');
  } catch(e) {
    console.log('[pg-init] 迁移跳过:', e.message);
  }
}

module.exports = { initPgDatabase };
