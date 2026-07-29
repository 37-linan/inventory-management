-- 出入库管理系统 - 数据迁移 SQL
-- 生成时间: 2026-07-28T09:11:14.591Z
-- 说明: 在 PostgreSQL 中先建表，再执行此脚本

BEGIN;

INSERT INTO main_price_history (product_code, date, price) VALUES
  ('6901234567890', '2026-07-27', 80),
  ('6978094703470', '2026-07-27', 52),
  ('100176424631', '2026-07-27', 50),
  ('6903148338735', '2026-07-27', 50);

INSERT INTO main_config (config_key, config_value) VALUES
  ('product_types', '["屈臣氏","数码","配件","酒类","欧美美妆"]'),
  ('channel_options', '["淘宝","京东","拼多多","抖音","线下采购"]');


INSERT INTO douyin_config (config_key, config_value) VALUES
  ('product_types', '["抖音券","优惠券","代金券","其他"]'),
  ('channel_options', '["抖音直播","抖音小店","抖音橱窗","线下"]');



COMMIT;
