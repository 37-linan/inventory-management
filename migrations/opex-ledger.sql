-- ============================================================================
-- 成本台账（运营成本）表 —— main_opex
-- 手工记账本：只记运营支出（投流 / 运费 / 包装 / 平台费 / 工具订阅…），
-- **与商品采购成本（main_inbound.purchase_price 整单金额）是两回事，不要混算**。
--
-- 说明：应用侧 `routes/main-cloud.js` 的 `ensureOpexTable(db)` 会在首次访问
--       /api/main/opex 时自动执行等价建表语句（幂等），所以本文件主要作
--       存档 / 手工重建用（例如换库、灾难恢复）。
-- 执行：PGPASSWORD=inventory123 psql -h 127.0.0.1 -U inventory -d inventory_db -f opex-ledger.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS main_opex (
  id         SERIAL PRIMARY KEY,
  cost_date  DATE           NOT NULL,               -- 发生日期（不是录入时间）
  item       TEXT           NOT NULL,               -- 项目 / 摘要
  category   TEXT           NOT NULL DEFAULT '',    -- 类别（推广/运费/包装/工具…）可空
  amount     NUMERIC(12,2)  NOT NULL DEFAULT 0,     -- 金额，允许为负（退款 / 冲抵）
  note       TEXT           NOT NULL DEFAULT '',    -- 备注
  created_at TIMESTAMP      NOT NULL DEFAULT now()  -- 录入时间
);

CREATE INDEX IF NOT EXISTS idx_main_opex_date ON main_opex (cost_date DESC);

-- 校验
-- SELECT count(*) AS 笔数, sum(amount) AS 累计 FROM main_opex;
-- SELECT to_char(cost_date,'YYYY-MM') AS 月份, count(*) AS 笔数, sum(amount) AS 小计
--   FROM main_opex GROUP BY 1 ORDER BY 1 DESC;
