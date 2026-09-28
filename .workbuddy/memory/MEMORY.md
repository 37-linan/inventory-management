# 出入库管理系统 · 项目记忆

## 概况
- 库存工作台，**只维护主系统**（屈臣氏/电商单品）；抖音刷券已下线（`routes/douyin-cloud.js` 保留但未同步口径）
- 栈：Node 22 + Express + pg + PM2 + 原生 JS 前端（无框架）；云路由 `routes/main-cloud.js`

## 运维 & 上线
- 服务器 `211.159.186.87`(ubuntu)；代码 `/home/ubuntu/inventory-app/`；PM2 `inventory-app`；密钥 `C:/Users/nan/.workbuddy/tencent-key.pem`
- **https://nanyishangmao.cn**（首选）；`:3000` 只能桌面调试（手机非安全上下文 → 摄像头被禁 → 扫码废）
- **PostgreSQL 14** `inventory_db`/`inventory`/`inventory123`，时区 `Asia/Shanghai`；`created_at` 是 `timestamp without time zone`（本地时间）
  - ⚠️ 取日期一律 SQL `to_char(...)`，❌ 别用 JS `toISOString()`（差 8 小时）
  - 排查 `PGPASSWORD=inventory123 psql -h 127.0.0.1 -U inventory -d inventory_db -c "..."`；❌ 禁止 rm/drop/truncate
- **GitHub** `37-linan/inventory-management`(443)：`GIT_SSH_COMMAND="ssh -i C:/Users/nan/.ssh/github_workbuddy -o StrictHostKeyChecking=no -p 443" git push origin main`
- 备案 粤ICP备2026122814号-1 / 粤公网安备 44140302000277号（李楠）；**SSL 2026-11-23 到期**需续
- ⚠️ PATH 偶发丢失（git/md5sum not found）→ 命令前加 `export PATH="/usr/bin:/bin:/c/Users/nan/.workbuddy/binaries/PortableGit/versions/1.2.0/bin:$PATH"`
- ⚠️ `ssh 远端 "export PATH=...$PATH; ..."` 里的 `$PATH` 会被**本地** shell 展开，把 Windows PATH（含 `/c/Program Files (x86)/...`）塞进远端命令 → 远端报 `syntax error near unexpected token '('`。
  远端命令要用**单引号**包，或干脆别用 ssh 校验：直接 `curl` 公网文件对 `md5sum`（更省事，已验证够用）
- 上线：本地改 → 推 GitHub → **scp 直传**覆盖（别让服务器 curl GitHub，raw 常超时）→ 改 `public/` **必升 `sw.js` CACHE_NAME**（现 **v48**）；改 `server.js`/`routes/` 才 `pm2 restart inventory-app` → `md5sum` 比对 + `curl -w '%{http_code}'`
- **交付时必须提醒用户：手机要整个关掉网页重开**
- ❗22 端口时不时全封（2222/8022 也不通，80/443 正常）→ scp/ssh 套 5 次重试
- ⚠️ 同一文件多处编辑**必须串行**（并行两次 Edit 互相覆盖，09-19 踩过）；改完 `grep -n` 复核
- ⚠️ `scp`/`ssh` 别塞进 shell 变量再展开（报 `decisionRecord missing`）→ 直接写完整命令 + 绝对路径
- ⚠️ git push 重试别用管道退出码判断 → `out=$(git push 2>&1)` 再 grep 输出决定 break
- ⚠️ **沙箱只读会连「文件工具」一起锁**：`Edit`/`Write` 报 `ModifyBackup failed ... os error 87`，`cp`/`cat >`/`writeFileSync` 写**已存在文件**全 EPERM。
  **通路（已验证）**：新内容用 `node .workbuddy/tmp/apply-patch-dir.js 原文件 补丁.txt 新文件` 生成 → `rm 目标 && install -m 644 新文件 目标`（「删 + 新建」被允许，**只有覆盖已存在文件被拦**）→ `md5sum` + `node --check` 复核。
  ⚠️ 沙箱可能**在会话中途变脸** → 见 `os error 87` 立刻切这条通路，别反复重试 Edit。node 进程写项目文件同样 EPERM → 脚本输出**一律先落 `.workbuddy/tmp/`**

## 取价 + 利润口径（全站唯一）
- `routes/main-cloud.js` 顶部 `loadPriceMap()` + `pickMarketPrice(priceMap, code, 出库日)`：① 出库日**次日(D+1)**有价用次日价 ② 否则用「<= 出库日 最近一天」价，**不往后找**
- **必须共用**：`/order-profit`、`/dashboard`、`/ledger`
- ❗「次日」要 `main_price_history` **真有那一行**才生效；`chart.js _fillMissingPrices` 的「23:30 沿用」只**画图补线、不落库**
- ❗❗**「退回更早」=「次日沿用」，数值上完全等价**（09-27 全量验证 29/29 行 0 差异）。用户问「为什么取 24 号」时——**金额不会错，永远是显示口径问题**，别怀疑算法
- ❗❗**同日重复录入的确定性**（09-27 修）：`loadPriceMap` 必须 `ORDER BY product_code, date, created_at, id`；`pickMarketPrice` 两分支统一为「同一天取最后录入那条」（原来找次日 `find()` 取首条、往前回退遍历取末条，语义不一致）。
  排查 `... GROUP BY 1,2 HAVING COUNT(*)>1`（现 2 组，都在 07-30，无出入库记录、未影响金额）
- ❗❗**对外口径只有一个词：「取价日」**（09-27 定稿）：**取价日 = 出库次日（D+1）**，恒成立。那天没单独录 → 价往前沿用，**但取价日不变**
  - UI：列名「出库/取价日」；行情列 `¥130.00` + `取价日 09-25`，附注 `（取价日当天没单独录，沿用 09-24 的价）`；徽章「沿用价」；底部「沿用说明」块 `carryNote`
  - ❌ **绝不再写「取自 09-24」「次日 09-25 没录」** —— 用户会以为用了"出库当天的价"（09-27 专门质疑过）
- ❗**字段语义**（两接口一致）：`base_day`=基准日（出库日；寄存已卖出则是卖出日）；`price_day`=`next_day`=**取价日**；`price_date`=价**实际来自**行情表哪天
- ❗补录弹窗默认日期 = **取价日**（`bf-price-date`）；旧提示「填出库日即可」是误解源
- 数据缺口：`08-27`/`09-07` 全库 0 条行情，`09-18` 5 条、`09-25` 8 条（用户隔几天批量录一次）→ 这些日期出货的单必然沿用
- 判据：**真 bug = 取价日当天有行却没取到**（只有这个才是算法问题）
- 成本 = 整单金额（首商品 `purchase_price`）；只算**已出库**的单；总览按**出库日期**归周（周一起）；**盈利红/亏损绿**；盈亏率统一 `_rateTxt(pnl, invest)`
- 取不到行情 → 明细「待行情」→ ¥0；修法：补一条行情（日期填出库日或次日都行），入口 单利润明细弹窗「补录/改行情」`_showBackfillPrice/_saveBackfillPrice`

## ⚠️ 出库归属 = FIFO + 整单口径（别再改回去）
- `main_outbound.order_no` 是快递单号/"送货上门"，**与入库单号无关联**；❌ 按编码全局汇总会让新入库的单被历史出库凭空算出销售
- ✅ `computeOutboundAlloc(db)`：同编码入库批次按 `created_at` 升序排队，出库量**从最早批次依次扣减**；被扣 >0 才算「本单该商品已出库」，`out_date` = 最后消耗它的出库日。`/order-profit` 与 `/dashboard` **必须共用**
- ❗❗**整单口径（09-25 修）**：**按套装归组后每一组都出过库**才算该单「已出库」；只出几件 → `partial_out`，**本金不进总投入**、明细也不出现（事故 `SF5151504320354`：相机没出、配件盒已出 → 凭空 -579 假亏损）。响应含 `any_out/partial_out/pending_items/total_items`、`totals.partial_count/partial_invest`

## 寄存（发到档口还没卖）09-25
- 货**已出库**但还没卖 → 整单先压着不计盈亏；点「已卖出」后按**卖出当天**行情算利润（没寄存的仍按出库日）；卖出后移出板块
- 表 `main_hold`：order_no/inbound_id/product_code/quantity/hold_date/status('holding'|'sold')/sold_date/created_at
  - `ensureHoldTable(db)` 幂等建表（挂 `router.use`）；`loadHoldMap(db)` → `{单号:{status,hold_date,sold_date,codes{}}}`
  - 状态**按单统一**：所有寄存行都 sold 才算卖出；同单多行取最晚 `sold_date`
- 接口 `GET /hold`、`GET /hold/order-items?orderNo=`（只列该单**已出库**的商品）、`POST /hold`、`POST /hold/sell {order_no, sold_date}`、`DELETE /hold?orderNo=`
  - ⚠️ `POST /hold` 同单同码**先删 holding 行再插**
- 口径三处一致：`/order-profit`（`holding/hold_sold/hold_codes`，取价日=卖出日）、`/dashboard`（holding → 计数后 `return`；sold 单取价日与**归月**都用 sold_date）、`/ledger`（显示「寄存中」）
- 前端在**信息台账页内**与入库/出库台账并列：`_renderHoldSection/_loadHoldList/_openHoldPicker/_submitHold/_holdSell/_cancelHold`
  - ⚠️ 单号走 `data-order` 传给 onclick，❌ 别拼进 onclick 字符串
  - ⚠️ `holdNote` 定义好还要**记得在模板里插 `${holdNote}`**
- 自检 `hold-test.js`(53) / `hold-ui-test.js`(55) / `hold-live-test.js`（**线上真实数据** 30 项，跑完完全恢复线上数据）

## 套装（09-23 上线，09-24 修归组键）
- ❗一个套装 = **多个不同编码**的商品（一个商品的多个条码）共用一个名称；规格/单位/行情/类型相同。入库时各码都会被扫到 → **同一单多条记录正常，不要去重**
- ❗❗**归组键 = 商品名称**（`setKeyOfProduct` / `ProductsModule._setKeyOf`）：**用户不填套装名**，在「添加物品」选"是套装"后多扫几个码即可
  - ❌❌ **绝不读 `set_name` 归组**（它只是名称副本；历史残留 Whoo水姸/Whoo水妍 → 同一套拆两行、**利润算两倍**，09-24 生产事故）
  - `ensureSetColumns` 建列后 `UPDATE ... set_name = btrim(name)` 归一化；POST/PUT **无视前端 set_name** 一律取 `name`；`is_set=false` → set_name 置空退出该套
  - 改名 → `syncSetMembersRename(db,id,新名)` **name + set_name 一起改**
  - ⚠️「＋加码」并入**已存在**编码：**把它的名称改成该套名称** + 带 `sync_rename:false`
- ❗**一整套只有一个行情价**：`groupItemsBySet` 归组，**套数 = 组内第一个编码的数量合计**（`setUnitsOf`）→ 销售额 = **套价 × 套数，只算一次**（❌ 不能按编码各算一遍）；组内任一条出库即算该套已出库
- 明细只有「代表行」记销售额，其余标 `set_member` 且 `sale = 0`（前端「并入套装」）；`/inventory` 返回 `set_units`（= 同套各编码库存**最小值**）
- ❗**商品信息表把同套多码合并成一行**（`ProductsModule._buildDisplayRows`）：编码列竖排可点、名称只写一次 + 徽章「套装 · N 个编码」，规格/单位/类型取**并集去重**（`_uniqList`）
  - 操作列「编辑（第一个编码）/＋加码/删除套装/💰套装价」；⚠️ 回调走**行索引** `this._rowRefs[rowId]`（别把名称拼进 onclick）
  - ⚠️ 拖拽行用 `data-pids`（逗号分隔），收集顺序时两个属性都要读；合并只影响**显示**
- ❗**套装行只画一个「整套」行情图**：容器 `chart-{system}-set-{rowId}`；`PriceChart.renderSet(canvasId, members)` → `fetchSetHistory` 各编码**按日期合并成一条**；点图 `showSetChart` → `showLargeSet`，弹窗改价 `_savePriceEdit` 走 `_editMembers` **整套一起写**
  - `chart.js` 抽了 `_fmtLocalDate/_seriesFromHistory/_buildLargeSvg/_largeHtml` 供单品与整套共用
- 自检 `set-bundle-test.js`(23) / `frontend-set-test.js`(35) / `product-set-row-test.js`(48) / `set-name-auto-test.js`(20) / `set-chart-single-test.js`(39) / `real-data-row-check.js`（拉**线上真实数据**跑渲染，最有说服力）

## 盈亏走势：近一个月 · **只标「有盈亏的那几天」**（09-27 定稿）
- 需求原话：「往前推一个月，哪天有盈利就标在横轴上，要具体的日数」+「那天没有盈利就没必要标出来」
  → **滚动近一个月 + 横轴只有真有生意的日期**（不是一月一根柱、也不是连续 32 天轴）；「每月聚合」做过，用户 10 分钟就否了
- ❗**横轴 = 有盈亏的天**：前端把 `orders===0` 的日子**整行丢掉**再等距排布；没生意的日期**连刻度都不出现**
- `/dashboard` 一条查询出三套（**前端只用 `daily`**，另两套当降级链）：
  - `daily[]` = `{date:'2026-09-27', profit, revenue, cost, orders, cumulative}`；窗口 = 今天往前推一个自然月（`setMonth(-1)`，溢出用 `setDate(0)`）→ 今天，**逐日补 0**；返回 `daily_start/daily_end`
    - ❗**窗口只影响走势图**：`totals`/订单列表/设备拆分/月设备弹窗都不受窗口影响
    - `cumulative` 是**窗口内**累计（折线终点 ≠ `totals.profit`）
  - `monthly[]`/`weekly[]` 保留（兼容没刷新的旧页面缓存）
- 前端 `_renderPnlChart(rows)` 一个函数吃三种粒度：`labelOf(r)` 自动判 `r.date`→「09-27」、`r.month_start`→「9月」、`r.week_start`→「09-21」；数据源 `dash.daily || dash.monthly || dash.weekly || []`
  - ❗逐日视图先 `filter(orders > 0)` 再画（`isDaily = !!allRows[0].date`）；**柱子数 == 刻度数 == 有生意的天数**
  - 刻度抽稀 `labelStep = isDaily ? max(1, ceil(26/slot)) : ceil(n/12)`；⚠️ 变量名别用 `raw`（函数内已有 `const raw = (mx-mn)/4`）
  - ⚠️ **亏损日只要有单仍会显示**（绿柱），不按 `profit>0` 过滤 —— 否则累计折线漏负值
  - 每根柱带 `<title>09-24：+¥82.50（5 单）</title>`；一天生意都没有 → 空态「最近一个月还没有出库记录」
  - 标题「近一个月盈亏走势」+ 右侧「08-27 ~ 09-27 · 按天」；副标题「只统计已出库的单 · 近一个月里有盈亏的日子」
- 自检 `chart-daily-test.js`(43)。⚠️ 断言别假设「每天都有标签」：标签数 = 有生意的天数，抽稀后更少

## 设备/下级的**上级汇总**（09-28 新增）
- 需求：把入库时填的「下单设备/下级」里的 `1`/`2`/`3`，在**设备投入弹窗里**汇总成一行「李楠」，点它展开看 1/2/3 各自的成本/盈亏；**其它地方（台账、明细、按月拆分、筛选下拉）仍按原设备名区分**（用户明确要求）
- 配置：`TransactionsModule.DEVICE_GROUPS = [{ name:'李楠', devices:['1','2','3'] }]`（`public/js/modules/transactions.js` 顶部 `ROW_COLORS` 之后）
  - 可配多个上级、可改名；没配到的设备照旧单独一行；组里一个设备都没出过库 → 该行不出现
- 实现：`_showDeviceBreakdown` 按 `DEVICE_GROUPS` 聚出组行（`this._devGroupRows`）+ 未归组设备行，统一按投入降序存 `this._devRows`（**点击按下标取，不把名字拼进 onclick**）
  - 组行：名字 + 徽章 `1 · 2 · 3` + 操作列「展开 ›」；设备行仍是「明细 ›」
  - `_showDeviceGroup(idx)` → 二级弹窗（标题「李楠 · 上级汇总」）列成员 5 项指标 + 合计
  - `_showGroupMemberOrders(gIdx,mIdx)` / `_showDeviceOrders(idx)` → `_showDeviceOrdersByName(dev, fromGroupIdx)`；`fromGroupIdx` 有值时「返回」回到上级那层，否则回顶层列表
  - ⚠️ 合计行仍按**原始设备**求和（别把李楠那层重复累加）；`_showMonthBreakdown` 完全不动
- ❗**「按月 · 设备投入」也同步支持**（09-29 用户追加："按月的也给我更新一下"）：每个月份分组内同样按 `DEVICE_GROUPS` 汇总出「李楠」一行（带徽章、排该月第一），点它 → `_showMonthGroupRow(idx)` 弹「2026-09 · 李楠 · 上级汇总」（该月成员 5 项指标 + 合计）；成员点开 → `_showMonthGroupMemberOrders(gIdx,mIdx)` → `_showMonthDeviceOrdersByName(month, dev, fromGroupIdx)`
  - ⚠️ 月份头上的「投入 / 盈亏」合计仍按**原始设备**求和（别把李楠重复累加）；`_mdRows` 现在存渲染行（含 `isGroup/name/members`），`_showMonthDeviceOrders(idx)` 对组行安全返回
  - ⚠️ 该月只有部分设备出过库 → 徽章只列真实存在的那几个（如 2026-08 只有 1、2 卖了 → 徽章 `1 · 2`）
  - 仍然**不动**的地方：入库台账、单利润明细、筛选下拉、`_showDeviceBreakdown` 的明细列
- 自检 `device-group-test.js`(57) + `device-group-live-test.js`(29，**线上真实数据**，与用户截图逐项核对)
  - ❗**需求变更后旧断言会过时**：给按月弹窗加汇总后，`device-group-test` 第 6 节「按月里没有李楠」那 4 条 + `device-group-live-test` 3.4 会失败 —— 是**断言过时不是 bug**，按新需求改写（已改成「也汇总出李楠」）
- `device-group-month-test.js`(**45**，**线上真实数据**，逐月核对：组行金额 = 该月 1+2+3 之和、月份头合计未被重复累加、月份胶囊筛选、组内钻取只看该月该设备的单、月度汇总之和 == 不筛月份时的汇总)

## 「待次日行情」09-15
- 今天录行情 + 今天出库 → D+1 价不存在，先用最近价会像"最终结果"的小亏损
- 判定 `出库日次日 > 今天`（`todayOf(db)` 用 DB 时区）→ `await_price`；前端 4 处标注；这些单**仍计入**总投入/总收益

## 扫码（09-14 定稿；细节见 mobile-web-barcode-scan skill）
- 入口唯一：`products.js triggerBarcodeScan(id)` → `barcode.js BarcodeScanner.startScan()`
- **实时优先，绝不自动退拍照**；失败 → `_showCameraError()` 写真实原因 + 三按钮（重开实时/拍照/手动）
- 三档逐级放宽，单档 25s；`NotAllowedError`/`SecurityError` 立即跳出
- ❗超时后流才返回必须 `getTracks().forEach(t=>t.stop())`，否则摄像头被占
- iPhone 必须显式 `video.play()`；先查 `_supportsEan13()`（iPhone Safari 只支持二维码），否则 Quagga 逐帧
- ❌ 零 OCR（`/api/ocr-text` 已删）；排查顺序 `md5sum` → URL 是否 HTTPS → 最后才是代码

## 出库信息单：电脑「选商品」/ 手机「扫码」09-16
- 电脑「选择商品」→ 列**有库存**商品；手机仍扫码；`renderOutboundTab()` 二选一；订单号行的扫码按钮两端保留
- 判断用 `_isTouchDevice()`（❌别用 `isMobile()`，那个只看 `innerWidth<=768`）
- picker：按 code 合并（库存相加）降序、默认只显 `stock>0`；搜索**输入时不重绘弹窗**；超库存只提示不拦截
- 提交：回填 `#outbound-code`/`#outbound-qty` → 调**原有** `submitOutbound()`

## 信息台账「盈亏总览」
- 顶部 4 指标卡 + 盈亏柱线图（**手绘 SVG 零依赖，❌别引 echarts**）
- `GET /api/main/dashboard` → `totals{}` + `weekly[]`/`monthly[]`/`daily[]` + `by_device[]` + `orders[]`；⚠️ 后端聚合日期要 `to_char(...)` 再比，不能 `String(pgDate)`
- 入口：总投入卡片**不可点**；备注行右侧「查看明细 ›」→ ①`_showInvestDetail()`（#/单号/设备/本金/收益/盈亏/盈亏率/出库日期 + 合计）
  - ①右上角两个**上下相邻蓝字链接**（用户明确：**不要**按钮、不要隔远）：②`_showDeviceBreakdown()` ③`_showMonthBreakdown()`（月份胶囊**纯前端筛选**，不重开弹窗）
- ⚠️ **弹窗是单例**；叠弹窗必须 `#modal-overlay-2`（z-index 2100）+ `showModal2()/closeModal2()`
- ⚠️ 用中文做 HTML 断言会被**注释里同一个词**误伤 —— 注释别写功能关键词

## 入库登记单
- ⚠️ **单号组折叠态** `_collapsedGroups`（key = 订单号，无单号用「（无单号）」）：❌ 别只存 DOM（重绘全弹开），❌ 也别只放内存（关页面就忘）→ 落 `localStorage`（`inbound_collapsed_{system}`），`render()` 读回、`_toggleGroupRows()` 写回，套 try/catch
  - ❌ key 别用渲染下标 `g0/g1`；明细行 style 要**合并**颜色与 `display:none`
- **行内编辑**：数量/渠道/价格点击就地改，失焦/回车保存，保存后库存/总量/整单金额/单利润重算
- **筛选**：⚠️ 渲染拆成 `_refreshInboundTable()`（拉数据）+ `_renderInboundRows()`（只画表），否则每输入一次都请求 → 卡 + 失焦
  - 设备候选取 `_inboundAllRecords` **全量**去重+trim；**设备按完全相等匹配**（有「1」和「10」），渠道/标记保持 includes
- **一单多品沿用**：`continueInbound()` 里 `form.reset()` 后只回填**订单号 + 下单设备**；**整单金额必须清空**
- **设备归属**：一单的设备 = 该单**第一个填了值的商品**（按 id 升序）；不同设备**不拆**整单
- ⚠️ 设备名已统一（`林浩东`/`林h东` 合并，09-18，备份表 `main_inbound_dev_bak_20260918`）；防复发靠 `<datalist>` 只提示不限制
- ✅ **订单号填成人名 = 正常现象**（没快递单号就拿名字占位，单号不参与计算）

## 成本台账（运营成本记账本，09-18 上线）
- 台账第 4 个标签页，**只有主系统有**
- ❗**只记运营成本**（投流/运费/包装/平台费…），**跟商品采购成本（整单金额）完全两回事** → 不接进盈亏总览
- 表 `main_opex`：cost_date/item/category/amount(**允许负数**=退款冲抵)/note/created_at；`ensureOpexTable(db)` 首次访问 `/opex` 自动建表
- 接口 `GET/POST /opex`、`PATCH/DELETE /opex/:id`；前端按月分组（按 `cost_date`，**不是录入时间**）+ 底部合计
- 「文档风」= 全局 `table` + `.opex-doc`（极浅 1px 下分隔线、无竖线）；负数标绿
- 通用辅助（**以后复用**）：`_fmtMoneySep`(千分位)/`_fmtMonth`/`_todayLocal`(❌别用 toISOString)/`_escHtml`(进 innerHTML 必须转义)
- 表单值**一律 JS 赋值**（`el.value=...`），❌别拼进 HTML 属性
- ⚠️ **标签栏窄屏会裁切**：`.tabs` 有 `overflow-x:auto` + `.tab{flex:0 0 auto}`；**以后加标签先算窄屏宽度**

## 无浏览器自检（frontend-logic-check skill）
- 前端：Node + `vm` + 最小 DOM stub 真跑模块；后端：vm 加载路由 → 从 `router.stack.find(l => l.route.path === '/xxx').route.stack[0].handle` 取**真实 handler** + mock `db.query`（按 SQL 特征分流）+ stub `res.json` → 不启服务验证完整逻辑，还能**一次验证多处口径一致**
- 脚本放 `.workbuddy/tmp/`（不入 git）；要写回项目文件时走上面的「先落 tmp 再 rm+install」通路
- ❗❗**新增数据库表后旧测试会整片挂掉**（严格 mock 里 `throw new Error('未 mock 的 SQL')` → handler 被 catch → 500，看着像功能坏了）。`partial-ship-test`/`set-bundle-test` 就因 09-25 的 `main_hold` 失效
  → 修法：严格 mock 加 `if (/main_hold/i.test(s)) return { rows: [] };` + `CREATE/ALTER TABLE` 兜底
  → **铁律：给路由加新表后，必须重跑 `tmp/` 下全部 `*test*.js`（现 16 个）**；
  改前端交互后同样要全跑一遍（16 个脚本一条 `for` 循环跑完约十秒，比手点快且不漏）
