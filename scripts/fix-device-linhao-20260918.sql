-- 统一「下单设备/下级」写法：林h东 → 林浩东（2026-09-18）
-- 全程一次性事务；先备份 device 列，出问题可按备份表还原

\echo '=== [0] 哪些表有 device 列 ==='
SELECT table_name, column_name FROM information_schema.columns
WHERE column_name = 'device' ORDER BY table_name;

\echo ''
\echo '=== [1] 备份（改之前）==='
CREATE TABLE IF NOT EXISTS main_inbound_dev_bak_20260918 AS
  SELECT id, order_no, product_code, quantity, device, created_at FROM main_inbound;
SELECT count(*) AS 备份行数 FROM main_inbound_dev_bak_20260918;

\echo ''
\echo '=== [2] 库里所有含「林」的设备写法（诊断变体）==='
SELECT '[' || device || ']' AS device_raw, count(*) AS 条数
FROM main_inbound WHERE device LIKE '%林%' GROUP BY device ORDER BY 2 DESC;

\echo ''
\echo '=== [3] 即将被改的行（TRIM 后等于「林h东」）==='
SELECT id, order_no, product_code, quantity,
       '[' || device || ']' AS 改前, to_char(created_at,'YYYY-MM-DD HH24:MI') AS 登记时间
FROM main_inbound WHERE TRIM(device) = '林h东' ORDER BY id;

BEGIN;

UPDATE main_inbound SET device = '林浩东' WHERE TRIM(device) = '林h东';

\echo ''
\echo '=== [4] 更新后校验（受影响行数应等于上表条数）==='
SELECT count(*) AS 现在还是林h东的条数 FROM main_inbound WHERE TRIM(device) = '林h东';
SELECT '[' || device || ']' AS device_raw, count(*) AS 条数
FROM main_inbound WHERE device LIKE '%林%' GROUP BY device ORDER BY 2 DESC;

COMMIT;

\echo ''
\echo '=== [5] 明细对照（备份 vs 现在）==='
SELECT b.id, b.order_no, '[' || b.device || ']' AS 改前, '[' || m.device || ']' AS 改后
FROM main_inbound_dev_bak_20260918 b JOIN main_inbound m ON m.id = b.id
WHERE b.device IS DISTINCT FROM m.device ORDER BY b.id;
