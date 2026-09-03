-- 套餐管理功能 - 数据库迁移
-- 执行: 在 Railway 的 Shell 中运行
-- psql $DATABASE_URL -f migrations/add-gift-of.sql

-- 给产品表增加 gift_of 字段
-- NULL = 独立商品 或 套餐主品
-- 非NULL = 赠品，值为主品编码
ALTER TABLE main_products ADD COLUMN IF NOT EXISTS gift_of VARCHAR(100) DEFAULT NULL;

-- 更新默认产品类型（如未自定义过）
UPDATE main_config 
SET config_value = '["抖音刷券","屈臣氏"]' 
WHERE config_key = 'product_types' AND config_value = '["电子设备","办公用品","耗材","其他"]';

-- 抖音系统同理（如需）
ALTER TABLE douyin_products ADD COLUMN IF NOT EXISTS gift_of VARCHAR(100) DEFAULT NULL;
