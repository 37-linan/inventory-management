/**
 * PostgreSQL 连接池
 * 云部署使用 DATABASE_URL 环境变量连接数据库
 * 本地测试可在 .env 中设置或使用默认值
 */
const { Pool } = require('pg');

// 把 SQLite 的 ? 占位符转为 PostgreSQL 的 $1, $2, $3...
function prepareSql(sql) {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

class PgDatabase {
  constructor(connectionString) {
    this.pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      // 强制使用 UTF-8 编码，防止中文乱码（Railway 默认可能是 SQL_ASCII）
      client_encoding: 'UTF8',
      // 连接池设置
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // 监听连接错误
    this.pool.on('error', (err) => {
      console.error('[PgDatabase] 连接池错误:', err.message);
    });

    // 连接时再次强制设置编码
    this.pool.on('connect', (client) => {
      client.query("SET client_encoding TO 'UTF8'", (err) => {
        if (err) console.error('[PgDatabase] 设置编码失败:', err.message);
      });
    });
  }

  /**
   * 执行查询，自动将 ? 占位符转为 $1, $2
   * @param {string} sql - SQL 语句（可使用 ? 占位符）
   * @param {Array|*} params - 参数数组或单个参数
   * @returns {Promise<{rows: Array, rowCount: number}>}
   */
  async query(sql, params = []) {
    if (!Array.isArray(params)) params = [params];
    const convertedSql = prepareSql(sql);
    try {
      return await this.pool.query(convertedSql, params);
    } catch (err) {
      console.error(`[PgDatabase] 查询错误: ${err.message}\nSQL: ${convertedSql}\nParams:`, params);
      throw err;
    }
  }

  /**
   * 关闭连接池
   */
  async close() {
    await this.pool.end();
  }

  /**
   * 测试连接是否正常
   */
  async healthCheck() {
    try {
      await this.pool.query('SELECT 1 as ok');
      return true;
    } catch (e) {
      return false;
    }
  }
}

module.exports = { PgDatabase, prepareSql };
