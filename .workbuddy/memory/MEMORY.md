# 出入库管理系统 - 项目记忆

## 概况
- 库存工作台，**只维护主系统（屈臣氏/电商单品）**；抖音刷券已下线
  （`routes/douyin-cloud.js` 保留但未同步口径）
- 栈：Node 22 + Express + pg + PM2 + 原生 JS 前端（无框架）；云路由 `routes/main-cloud.js`

## 部署与运维
- 服务器 `211.159.186.87`(ubuntu)；代码 `/home/ubuntu/inventory-app/`；PM2 `inventory-app`；
  密钥 `C:/Users/nan/.workbuddy/tencent-key.pem`
- **https://nanyishangmao.cn**（首选）；`:3000` 只能桌面调试（手机非安全上下文 → 摄像头被禁 → 扫码废）
- **PostgreSQL 14**：`inventory_db` / `inventory` / `inventory123`；时区 `Asia/Shanghai`；
  `created_at` = `timestamp without time zone`（存本地时间）
  - ⚠️ 取日期一律 SQL `to_char(...)`，❌ 别用 JS `toISOString()`（差 8 小时）
  - 排查 `PGPASSWORD=inventory123 psql -h 127.0.0.1 -U inventory -d inventory_db -c "..."`；❌ 禁止 rm/drop/truncate
- **GitHub** `37-linan/inventory-management`（443）：
  `GIT_SSH_COMMAND="ssh -i C:/Users/nan/.ssh/github_workbuddy -o StrictHostKeyChecking=no -p 443" git push origin main`
- 备案 粤ICP备2026122814号-1 / 粤公网安备 44140302000277号（李楠）；**SSL 2026-11-23 到期**需续
- ⚠️ 环境 PATH 偶发丢失（`git`/`md5sum`/`ls` not found）→ 命令前加
  `export PATH="/usr/bin:/bin:/c/Users/nan/.workbuddy/binaries/PortableGit/versions/1.2.0/bin:$PATH"`

## 上线流程
1. 本地改 → 推 GitHub → **scp 直传**覆盖（别让服务器 curl GitHub，raw 常超时）
2. 改 `public/` → **必升 `sw.js` 的 `CACHE_NAME`**（现 **v42**），否则 precache 不更新
3. 改 `server.js` / `routes/` 才 `pm2 restart inventory-app`
4. 验证：`md5sum` 比对 + `curl -s -o /dev/null -w '%{http_code}' https://nanyishangmao.cn/`
5. **交付时必须提醒用户：手机要整个关掉网页重开**
6. ❗**22 端口时不时全封**（2222/8022 也不通，80/443 正常）→ scp/ssh 套 5 次重试，等一会儿常自恢复
7. ⚠️ **同一文件的多处编辑必须串行**：并行两次 Edit 会互相覆盖（2026-09-19 踩过）→ 改完 `grep -n` 复核
8. ⚠️ `scp`/`ssh` **别塞进 shell 变量**再展开（报 `sandbox-center ... decisionRecord missing`）→ 直接写完整命令 + 绝对路径
9. ⚠️ git push 重试**别用管道退出码判断**（`git push | tail -3 && break` 里的退出码是 tail 的 0，第一次失败也会 break）
   → `out=$(git push 2>&1)` 再 grep 输出内容决定是否 break

## 取价 + 利润口径（全站唯一，只能改这一处）
- `routes/main-cloud.js` 顶部 `loadPriceMap()` + `pickMarketPrice(priceMap, code, 出库日)`：
  ① 出库日**次日(D+1)**有价用次日价；② 否则用「出库日当天/之前最近一天」价，**不往后找**
- **必须共用**：`/order-profit`(单利润)、`/dashboard`(盈亏总览)、`/ledger`(出库台账)
- ❗「次日」要 `main_price_history` **真有那一行**才生效（不会自动补"明天"）；
  `chart.js _fillMissingPrices` 的「23:30 沿用」只**画图补线、不落库**
- 成本 = 整单金额（首商品 `purchase_price`）；只算**已出库**的单；总览按**出库日期**归周（周一起）；
  **盈利红 / 亏损绿**；盈亏率统一 `_rateTxt(pnl, invest)`
- 取不到行情 → 明细标「待行情」→ ¥0。修法：补一条行情（日期填**出库日或次日**都行），
  入口：单利润明细弹窗「补录/改行情」`_showBackfillPrice/_saveBackfillPrice`

## 套装（2026-09-23 上线，09-24 修归组键）
- ❗**场景**：一个套装 = **多个不同编码**的商品（一个商品的多个条码），**共用一个名称**；
  规格/单位/行情/类型相同。入库时各编码都会被扫到 → **同一单出现多条记录是正常的，不要去重**
- ❗❗**归组键 = 商品名称**（前后端统一，`setKeyOfProduct` / `ProductsModule._setKeyOf`）：
  **用户不填套装名**！在「添加物品」选"是套装"后只需**多扫几个码**（扫完自动加入）
  - ❌❌ **绝不读 `set_name` 字段来归组**：它只是名称的副本（历史数据里残留过手打错别字
    Whoo水姸/Whoo水妍 → 同一套被拆两行、**利润被算两倍**，2026-09-24 生产事故）
  - `ensureSetColumns` 建列后顺手跑一次 `UPDATE ... set_name = btrim(name)` **归一化历史数据**
  - POST/PUT **无视前端传来的 set_name**，一律取 `name`；`is_set=false` → set_name 置空退出该套
  - 改名 → `syncSetMembersRename(db,id,新名)` **name + set_name 一起改**，否则同一套被拆两组
    （**只改 set_name 不够了**——归组读的是 name）
  - ⚠️「＋加码」并入**已存在**编码时：**把它的名称改成该套的名称**（不然合不到一行）+
    带 `sync_rename:false`（否则会把它原先同名的那批商品一起拖进来）
- ❗**一整套只有一个行情价**（每个组成商品都录同一个价）：`groupItemsBySet` 归组，
  **套数 = 组内第一个编码的数量合计**（`setUnitsOf`）→ 销售额 = **套价 × 套数，只算一次**
  （❌ 不能按每个编码各算一遍，那样一套会被算成 N 倍）；组内任一条出库即算该套已出库
- 明细里只有「代表行」（组内第一条）记销售额，其余标 `set_member` 且 `sale = 0`（前端标「并入套装」）
- `/inventory` 返回 `set_units`（可成套数 = 同一套各编码库存的**最小值**）
- ❗**商品信息表把同一套的多个编码合并成一行**（`ProductsModule._buildDisplayRows`）：
  编码列竖排多个可点（点哪个编哪个），名称只写一次 + 徽章「套装 · N 个编码」，
  规格/单位/类型取**并集去重**（`_uniqList`，不同则 `A / B` 都列出）
  操作列：「编辑（第一个编码）/ **＋ 加码** / 删除套装 / 💰 套装价」（套装价一次写该套所有编码行情）
  - ⚠️ 按钮回调走**行索引** `this._rowRefs[rowId]`（改完 `loadProducts` 会重登记）——
    别把名称/编码拼进 onclick（中文+引号会炸）
  - ⚠️ 拖拽排序行用 `data-pids`（逗号分隔多个 id），收集顺序时两个属性都要读
  - ⚠️ 合并只影响**显示**，入库/出库/利润仍按编码各存各的
- ❗**套装行只显示一个「整套」行情图**（2026-09-24）：容器 `chart-{system}-set-{rowId}`，
  标「整套」；**成员编码不再各画一个**（用户只填一套价，没必要分开展示）
  - 图表渲染循环先按 `_rowRefs` 收集成员 id 跳过单品循环，再单独跑整套图
  - `PriceChart.renderSet(canvasId, members)` → `fetchSetHistory` 把各编码行情**按日期合并成一条**
    （同一天取第一个非空；单个编码取失败不影响整行）
  - 点整套图 `ProductsModule.showSetChart(system,rowId)` → `PriceChart.showLargeSet`（放大看整套）；
    弹窗里改某天价 `_savePriceEdit` 走 `_editMembers` **整套一起写**（单品路径不变，只写自己）
  - `chart.js` 抽了 `_fmtLocalDate/_seriesFromHistory/_buildLargeSvg/_largeHtml` 供单品与整套共用
- 自检：`set-bundle-test.js`(23，含错别字场景)、`frontend-set-test.js`(35)、
  `product-set-row-test.js`(48)、`set-name-auto-test.js`(20)、`set-chart-single-test.js`(39)、
  `real-data-row-check.js`（拉**线上真实数据**跑 `_buildDisplayRows`+渲染，验归行与行情图数量，最有说服力）

## ⚠️ 出库归属 = FIFO（2026-09-14 修复，别再改回去）
- `main_outbound.order_no` 是快递单号/"送货上门"，**与入库单号无关联**；
  ❌ 按编码全局汇总会让新入库的单被历史出库凭空算出销售
- ✅ `computeOutboundAlloc(db)`：同编码入库批次按 `created_at` 升序排队，出库量**从最早批次依次扣减**；
  被扣 >0 才算「本单该商品已出库」，`out_date` = 最后消耗它的出库日。`/order-profit` 与 `/dashboard` **必须共用**
- ❗❗**整单口径（2026-09-25 修，别再改回去）**：「某一组出过库」≠「整单已出库」。**按套装归组后，
  每一组都出过库才算该单「已出库」**；只出了其中几件的单 → `partial_out`，**本金不进总投入**、
  明细列表里也不出现（事故：`SF5151504320354` 相机没出、配件盒已出 → 被当成整单出库，
  成本按整机 ¥579 记 → 凭空一笔 -579 假亏损）。响应新增
  `any_out / partial_out / pending_items / total_items`、`totals.partial_count / partial_invest`

## 寄存（发到档口 · 还没卖）2026-09-25
- 场景：货**已经出库**发到档口，但实际还没卖 → 这一单先**整单压着不计盈亏**；等点「已卖出」，
  按**卖出当天**的行情价算利润（没寄存的商品仍按出库日）。卖出后从板块移出（不做历史区）
- 表 `main_hold`：order_no / inbound_id / product_code / quantity / hold_date /
  status('holding'|'sold') / sold_date / created_at
  - `ensureHoldTable(db)` 幂等建表（挂 `router.use`）；`loadHoldMap(db)` → `{单号:{status,hold_date,sold_date,codes{}}}`
  - 状态**按单统一**：该单所有寄存行都是 sold 才算卖出；同单多行取最晚的 `sold_date`
- 接口：`GET /hold`、`GET /hold/order-items?orderNo=`（**只列该单已出库**的商品）、`POST /hold`、
  `POST /hold/sell {order_no, sold_date}`、`DELETE /hold?orderNo=`
  - ⚠️ `POST /hold` 同单同码**先删 holding 行再插**（重复登记不累加）
- 口径 **三处必须一致**：`/order-profit`（`holding/hold_sold/hold_codes`，取价日 = 卖出日）、
  `/dashboard`（holding → 计数后 `return` 不进统计；sold 单取价日与**归月**都用 sold_date）、
  `/ledger`（寄存中的编码销售列显示「寄存中」）
- 前端在**信息台账页内**（不是独立标签页），与入库台账/出库台账并列：
  `_renderHoldSection / _loadHoldList / _openHoldPicker / _submitHold / _holdSell / _cancelHold`
  - ⚠️ 单号走 `data-order` 属性传给 onclick，❌ 别把单号拼进 onclick 字符串
  - ⚠️ 盈亏总览的 `holdNote` 变量定义好了还要**记得在模板里插 `${holdNote}`**（前端自检抓到过）
- 自检：`hold-test.js`(53) / `hold-ui-test.js`(55) / `hold-live-test.js`(**线上真实数据** 30 项，
  跑完能完全恢复线上数据)

## 盈亏走势：月视图（2026-09-27 取代「每周盈亏走势」）
- `/dashboard` 一条查询同时出两套：`weekly`（**保留**，兼容没刷新的旧页面）与 **`monthly`（前端在用）**
  - `monthly[]` = `{ month_start:'2026-09', profit, revenue, cost, orders, cumulative }`
  - 归月 = `String(出库日).slice(0,7)`（自然月）；`cumulative` 按月份升序累加
  - ❗同源校验：各月之和 = 各周之和 = `totals.profit`
- 前端 `_renderPnlChart(rows)` 参数**改名 rows**，月/周数据都能画：
  `labelOf(r)` → 有 `month_start` 显示「9月」，否则用 `week_start` 显示「09-21」
  - 数据源 `dash.monthly || dash.weekly || []`（旧后端也能降级跑）
  - 文案：标题「每月盈亏走势」/ 图例「柱：当月盈亏」/ 副标题「按出库日期归月」
- 自检 `chart-month-test.js`(30)：同月多单合并成一条、跨月累计延续、最后一个月累计 = `totals.profit`、
  周图仍可用、空数据显示空态；线上真实数据渲染 10 项校验

## 「待次日行情」（2026-09-15）
- 今天录行情 + 今天出库 → D+1 价不存在，只能先用最近价，会出现像"最终结果"的小亏损
- 判定 `出库日次日 > 今天`（`todayOf(db)` 用 DB 时区）→ `await_price`；前端 4 处标注；
  这些单**仍计入**总投入/总收益

## 扫码（2026-09-14 定稿；细节见 mobile-web-barcode-scan skill）
- 入口唯一：`products.js triggerBarcodeScan(id)` → `barcode.js BarcodeScanner.startScan()`
- **实时优先，绝不自动退拍照**；失败 → `_showCameraError()` 写真实原因 + 三按钮（重开实时/拍照/手动）
- 三档逐级放宽，单档 25s 超时；`NotAllowedError`/`SecurityError` 立即跳出
- ❗超时后流才返回必须 `getTracks().forEach(t=>t.stop())`，否则摄像头被占（踩过）
- iPhone 必须显式 `video.play()`；先查 `_supportsEan13()`（iPhone Safari 只支持二维码），否则走 Quagga 逐帧
- ❌ 零 OCR：`/api/ocr-text` 已删
- 排查顺序：`md5sum` 比对 → URL 是否 HTTPS → 最后才是代码

## 出库信息单：电脑「选商品」/ 手机「扫码」（2026-09-16）
- 电脑「选择商品」→ 弹窗列**有库存**商品；**手机仍是扫码**；`renderOutboundTab()` 二选一；
  订单号那行的扫码按钮两端都保留
- 判断用 `_isTouchDevice()`（❌别用 `isMobile()`，那个只看 `innerWidth<=768`）
- picker：按 code 合并（库存相加）降序、默认只显 `stock>0`；搜索**输入时不重绘弹窗**（否则失焦）；
  超库存只提示**不拦截**
- 提交：回填 `#outbound-code`/`#outbound-qty` → 调**原有** `submitOutbound()`（地点/订单号/图片一并带上）

## 信息台账「盈亏总览」
- 顶部 4 指标卡 + 每周盈亏柱线图（**手绘 SVG，零依赖，❌别引 echarts**）
- `GET /api/main/dashboard` → `totals{...}` + `weekly[]` + `by_device[]` + `orders[]`；
  ⚠️ 后端聚合日期要 `to_char(...)` 出字符串再比，不能 `String(pgDate)`
- **入口**：总投入卡片**不可点**；备注行右侧「查看明细 ›」→ 弹窗① `_showInvestDetail()`
  （# / 单号 / 下单设备 / 本金 / 收益 / 盈亏 / **盈亏率** / 出库日期 + 合计）
  - ①右上角两个上下相邻蓝字链接（用户明确：**不要**按钮、不要隔远）：
    ②`_showDeviceBreakdown()` 按设备；③`_showMonthBreakdown()` 按月（月份胶囊**纯前端筛选**，**不重开弹窗**）
  - **聚合全在前端**（`_dashOrders` 按 `out_date.slice(0,7)` + `device` 累加），**后端零改动**
- ⚠️ **本项目弹窗是单例**；叠弹窗必须用 `#modal-overlay-2`（z-index 2100）+ `showModal2()/closeModal2()`
- ⚠️ 用中文文字做 HTML 断言会被**注释里的同一个词**误伤 —— 注释别写功能关键词

## 入库登记单
- ⚠️ **单号组折叠状态** `_collapsedGroups`（key = **订单号**，无单号用 `（无单号）`）：
  - ❌ 别只存 DOM（`icon.textContent` + 行 `style.display`）：设颜色/行内编辑/删除都整块重绘 → 全弹开（09-18 修）
  - ❌ 也别只放内存：关掉网页重开就全忘（09-19 修）→ 落 `localStorage`（key `inbound_collapsed_{system}`），
    `render()` 读回、`_toggleGroupRows()` 写回，读写套 try/catch 兜无痕模式
  - ❌ key 不能用渲染下标 `g0/g1`（随排序/筛选变）；明细行 style 要**合并**颜色变量与 `display:none`
- **行内编辑**：数量/渠道/价格点击就地改，失焦或回车保存，保存后库存/总量/整单金额/单利润重算
- **筛选**：⚠️ 渲染必须拆成 `_refreshInboundTable()`(拉数据) + `_renderInboundRows()`(只画表)，
  否则每输入一次都请求接口 → 卡 + 失焦
  - 设备候选取 `_inboundAllRecords` **全量**去重+trim（❌别取筛选后的）；
    **设备按完全相等匹配**（有「1」和「10」），渠道/标记**保持 includes**
- **一单多品沿用**：`continueInbound()` 里 `form.reset()` 后只回填 **订单号 + 下单设备**；
  **整单金额必须保持清空**；「清空」`resetInboundForm()` 仍是全清
- **设备归属**：一单的设备 = 该单**第一个填了值的商品**（按 id 升序）；不同设备**不拆**整单，
  各条记录各自存 device
- ⚠️ 设备名写法已统一（`林浩东`/`林h东` 合并，2026-09-18，备份表 `main_inbound_dev_bak_20260918`）；
  防复发靠 `<datalist id="device-options-{system}">` 只提示不限制
- ✅ **订单号填成人名 = 正常现象，别再问**（没快递单号就拿名字占位，单号不参与计算）

## 成本台账（运营成本记账本，2026-09-18 上线）
- 台账第 4 个标签页，**只有主系统有**
- ❗**只记运营成本**（投流/运费/包装/平台费/工具订阅…），**跟商品采购成本（整单金额）完全两回事**
  → 不接进盈亏总览，不复用 `purchase_price`
- 表 `main_opex`：cost_date / item / category / amount(**允许负数**=退款冲抵) / note / created_at；
  `ensureOpexTable(db)` **首次访问 /opex 自动建表**（幂等可重试）
- 接口 `GET/POST /opex`、`PATCH/DELETE /opex/:id`；前端按月分组（按 `cost_date`，**不是录入时间**）+ 底部合计
- 「文档一行一行」= 全局 `table` + `.opex-doc`（只留极浅 1px 下分隔线、无竖线）；负数标绿
- 通用辅助（**以后复用**）：`_fmtMoneySep`(千分位) / `_fmtMonth`(2026-09→2026年9月) /
  `_todayLocal`(本地今天，❌别用 toISOString) / `_escHtml`(进 innerHTML 必须转义)
- 表单值**一律 JS 赋值**（`el.value=...`），❌别拼进 HTML 属性
- ⚠️ **标签栏窄屏会裁切**：`.tabs` 已加 `overflow-x:auto` + 隐藏滚动条、`.tab { flex:0 0 auto }`；
  **以后往标签栏加标签先算窄屏宽度**

## 无浏览器自检（frontend-logic-check skill）
- 前端：Node + `vm` + 最小 DOM stub 真跑模块；后端：vm 加载路由文件 → 从
  `router.stack.find(l => l.route.path === '/xxx').route.stack[0].handle` 取**真实 handler**
  + mock `db.query`（按 SQL 特征分流）+ stub `res.json` → 不启服务就能验证完整业务逻辑，
  还能**一次验证多处口径一致**（套装那次就靠它确认单利润/总览/台账三处相同）
- 脚本放 `.workbuddy/tmp/`（不入 git）；模板、坑与断言技巧都在 skill 里，动手前先读它
- ❗❗**新增数据库表后，旧测试的严格 mock 会整片挂掉**：mock 里 `throw new Error('未 mock 的 SQL')`，
  遇到新表的查询就抛错 → handler 被 catch → 返回 500，测试看起来像功能坏了。
  本次 `partial-ship-test` / `set-bundle-test` 就因为 09-25 的 `main_hold` 失效（当时没重跑才发现）
  → 修法：严格 mock 里加 `if (/main_hold/i.test(s)) return { rows: [] };` + `CREATE/ALTER TABLE` 兜底
  → **铁律：给路由加新表后，必须重跑 `tmp/` 下全部 `*test*.js`（现在 11 个，共 359 项）**
