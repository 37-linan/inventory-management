/**
 * 从 SQLite 导出数据，生成可直接在 PostgreSQL 中执行的 SQL 语句
 * 运行: node db/export-data.js
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_DIR = __dirname;

function exportTable(db, table, columns) {
  try {
    const rows = db.prepare(`SELECT ${columns} FROM ${table}`).all();
    if (rows.length === 0) return { table, rows: [], sql: `-- ${table}: 无数据` };
    
    const colNames = columns.split(',').map(c => c.trim().split(' ')[0].trim());
    const values = rows.map(row => {
      const vals = colNames.map(c => {
        const v = row[c];
        if (v === null || v === undefined) return 'NULL';
        if (typeof v === 'number') return v;
        // 转义单引号
        return "'" + String(v).replace(/'/g, "''") + "'";
      });
      return `(${vals.join(', ')})`;
    });

    return {
      table,
      rows,
      sql: `INSERT INTO ${table} (${colNames.join(', ')}) VALUES\n  ${values.join(',\n  ')};\n`
    };
  } catch (e) {
    return { table, rows: [], sql: `-- ${table}: ${e.message}` };
  }
}

console.log('========================================');
console.log('  数据导出工具 - SQLite → PostgreSQL');
console.log('========================================\n');

// 导出主系统数据
const mainDb = new DatabaseSync(path.join(DB_DIR, 'main.db'));
console.log('=== 主系统 ===\n');

const mainTables = [
  { name: 'main_products', cols: 'code, name, spec, unit, market_price, type' },
  { name: 'main_price_history', cols: 'product_code, date, price' },
  { name: 'main_inbound', cols: 'product_code, quantity, device, channel, remark, order_no, image_path, purchase_price' },
  { name: 'main_outbound', cols: 'product_code, quantity, image_path, location, row_color' },
  { name: 'main_config', cols: 'config_key, config_value' },
];

let mainSQL = '';
for (const t of mainTables) {
  const result = exportTable(mainDb, t.name, t.cols);
  console.log(`  ${t.name}: ${result.rows.length} 条`);
  if (result.rows.length > 0) mainSQL += result.sql + '\n';
}

// 导出抖音系统数据
const douyinDb = new DatabaseSync(path.join(DB_DIR, 'douyin.db'));
console.log('\n=== 抖音系统 ===\n');

const douyinTables = [
  { name: 'douyin_products', cols: 'code, name, spec, unit, market_price, type' },
  { name: 'douyin_price_history', cols: 'product_code, date, price' },
  { name: 'douyin_inbound', cols: 'product_code, quantity, device, channel, remark, order_no, image_path, purchase_price' },
  { name: 'douyin_outbound', cols: 'product_code, quantity, image_path, location' },
  { name: 'douyin_config', cols: 'config_key, config_value' },
];

let douyinSQL = '';
for (const t of douyinTables) {
  const result = exportTable(douyinDb, t.name, t.cols);
  console.log(`  ${t.name}: ${result.rows.length} 条`);
  if (result.rows.length > 0) douyinSQL += result.sql + '\n';
}

// 写入 SQL 文件
const outputDir = path.join(DB_DIR, '..', 'migrations');
if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

const fullSQL = `-- 出入库管理系统 - 数据迁移 SQL
-- 生成时间: ${new Date().toISOString()}
-- 说明: 在 PostgreSQL 中先建表，再执行此脚本

BEGIN;

${mainSQL}
${douyinSQL}

COMMIT;
`;

const outPath = path.join(outputDir, 'seed-data.sql');
fs.writeFileSync(outPath, fullSQL, 'utf-8');
console.log(`\n✅ 迁移 SQL 已写入: ${outPath}`);

// 同时生成一个 JSON 备份
const jsonData = {};
for (const t of [...mainTables, ...douyinTables]) {
  try {
    const db = t.name.startsWith('main_') ? mainDb : douyinDb;
    const cols = t.cols.split(',').map(c => c.trim().split(' ')[0].trim());
    jsonData[t.name] = db.prepare(`SELECT ${t.cols} FROM ${t.name}`).all();
  } catch(e) {}
}

const jsonPath = path.join(outputDir, 'data-backup.json');
fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2), 'utf-8');
console.log(`✅ JSON 备份已写入: ${jsonPath}`);
