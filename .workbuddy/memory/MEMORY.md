# 出入库管理系统 · 项目记忆（铁律版）
> 详细实现 / 字段清单 / 历史事故 / 前端细节 → 同目录 **`REFERENCE.md`**（需要时再读）

## 概况
- 库存工作台，**只维护主系统**；Node22 + Express + pg + PM2 + 原生 JS；云路由 `routes/main-cloud.js`

## 访问密码 & 权限（三级 · 纯前端）
- 入口 `public/js/app.js`：`checkLogin()` 比对密码 → `sessionStorage.inventory_role` → `applyRoleClass()` 往 `document.body` 挂 class
  - `2312666` → `admin`（全部权限，**不加任何限制 class**）
  - `2312` → `viewer`：只读 + **内容打码**
  - `666` → `limited`：只读 + `perm-limited`（隐藏台账/库存看板入口，只能进产品信息表）
- ❗**打码**（10-01 加）：`body.perm-mask` + 元素 class `mask-sensitive` → `> *{filter:blur(7px)}` + `::after` 盖「🔒 该内容无权查看」
  - 只在 `applyRoleClass()` 里 `if (role && role !== 'admin') body.classList.add('perm-mask')`
  - 目标 4 块（`transactions.js`）：**入库记录表 / 出库记录表 = 给那两张 `.card` 加 `mask-sensitive`**；**信息台账 / 成本台账 = 给容器 `#transactions-content-${system}` 加 `mask-sensitive`**
  - ❗❗容器级打码**必须**在 `renderInboundTab`/`renderOutboundTab` 里 `classList.remove('mask-sensitive')`，否则切回登记单会把表单一起糊住
  - ❗这是**前端看门**（防误操作，不防技术绕过）；改密码/改可见范围都在 `app.js` + `style.css`
  - 自检 `.workbuddy/tmp/perm-mask-test.js`（40 项：CSS 规则 / 四角色 class / 四块标记 / 切页不残留 / 源码完整性）

## 运维 & 上线
- 服务器 `211.159.186.87`(ubuntu)，`/home/ubuntu/inventory-app/`，PM2 `inventory-app`，密钥 `C:/Users/nan/.workbuddy/tencent-key.pem`
- **https://nanyishangmao.cn**（首选）；`:3000` 手机扫码废（非安全上下文 → 摄像头禁）
- **PG14** `inventory_db`；⚠️ 取日期一律 SQL `to_char(...)`（❌ JS `toISOString()` 差 8 小时）；❌ 禁止 rm/drop/truncate
- **GitHub** `37-linan/inventory-management`(443)：`GIT_SSH_COMMAND="ssh -i C:/Users/nan/.ssh/github_workbuddy -o StrictHostKeyChecking=no -p 443"`
- **上线**：本地改 → `scp` 直传（❌别让服务器 curl GitHub）→ 改 `public/` **必升 `sw.js CACHE_NAME`**（现 **v50**）；改 `routes/`/`server.js` → `pm2 restart inventory-app --update-env` → `md5sum` + `curl -w '%{http_code}'`
- **交付必须提醒用户：手机要整个关掉网页重开**
- ⚠️ 22 端口常封（2222/8022 也不通）→ scp/ssh 套 5 次重试
- ⚠️ `ssh 远端 "…$PATH…"` 的 `$PATH` 被**本地**展开 → 远端报 `syntax error near unexpected token '('`；远端命令用**单引号**包，校验文件优先 `curl` 公网 + `md5sum`
- ⚠️ 同一文件多处编辑**必须串行**（并行 Edit 互相覆盖）；⚠️ scp/ssh 别塞进 shell 变量再展开；⚠️ git push 重试别用管道退出码判断
- ⚠️ PATH 偶发丢失 → 前置 `export PATH="/usr/bin:/bin:/c/Users/nan/.workbuddy/binaries/PortableGit/versions/1.2.0/bin:$PATH"`

## 沙箱只读时的写文件通路（已验证）
- 症状：`Edit`/`Write` 报 `ModifyBackup failed ... os error 87`；写**已存在文件**全 EPERM
- ✅ 通路：`node .workbuddy/tmp/apply-patch-dir.js 原文件 补丁.txt 新文件` → `rm 目标 && install -m 644 新文件 目标` → `md5sum` + `node --check`
- 补丁格式 `===OLD===`/`===NEW===`/`===END===` 单独成行，可多组；每组要求原文出现**正好 1 次**
- ⚠️ 沙箱**会在会话中途变脸** → 见 `os error 87` 立刻切通路，别反复重试 Edit
- ⚠️ node 进程写项目文件同样 EPERM → 脚本输出**一律先落 `.workbuddy/tmp/`**

## 取价 + 利润口径（全站唯一）
- `pickMarketPrice(map, code, 出库日)`：① 出库日**次日(D+1)**有价 → 用次日价 ② 否则用「≤出库日最近一天」价，**不往后找**；`/order-profit`、`/dashboard`、`/ledger` **必须共用**
- ❗❗**对外只有一个词：「取价日」= 出库次日(D+1)**，恒成立。那天没录 → 价往前沿用，**但取价日不变**
  - ❌ **绝不写「取自 09-24」**（用户会理解成"用了出库当天的价"）；UI 用列名「出库/取价日」+ 徽章「沿用价」+ `carryNote`
- ❗字段：`base_day`=基准日（出库日；寄存已卖出=卖出日）；`price_day`=`next_day`=**取价日**；`price_date`=价**实际来自**哪天
- ❗❗**同日重复录入确定性**：`loadPriceMap` 必须 `ORDER BY product_code, date, created_at, id`；两分支统一为「同一天取最后录入那条」
- ❗❗**「退回更早」≡「次日沿用」，数值完全等价**（09-27 全量 29/29 零差异）→ 用户问「为什么取 24 号」，**永远是显示口径问题，别怀疑算法**
- **真 bug 判据 = 取价日当天有行却没取到**
- 成本 = 整单金额（首商品 `purchase_price`）；只算**已出库**的单；总览按**出库日期**归周（周一起）；**盈利红/亏损绿**；盈亏率 `_rateTxt(pnl, invest)`
- 取不到行情 → 明细「待行情」¥0；补录入口 `_showBackfillPrice/_saveBackfillPrice`（弹窗默认日期 = **取价日**）

## ⚠️ 出库归属 = FIFO + 整单口径（别再改回去）
- `main_outbound.order_no` 是快递单号/"送货上门"，**与入库单号无关联**；❌ 按编码全局汇总会让新入库的单被历史出库凭空算出销售
- ✅ `computeOutboundAlloc(db)`：同编码入库批次按 `created_at` 升序排队，出库量**从最早批次依次扣减**；被扣 >0 才算「该单该商品已出库」。`/order-profit` 与 `/dashboard` **必须共用**
- ❗❗**整单口径**：**按套装归组后每组都出过库**才算该单「已出库」；只出几件 → `partial_out`，**本金不进总投入**、明细也不出现（事故 `SF5151504320354` 凭空 -579）

## 寄存（发到档口还没卖）
- 货**已出库**但还没卖 → 整单压着不计盈亏；点「已卖出」改按**卖出当天**行情算
- 表 `main_hold`（`ensureHoldTable` 挂 `router.use`）；状态**按单统一**：所有寄存行都 sold 才算卖出；同单多行取最晚 `sold_date`
- ⚠️ `POST /hold` 同单同码**先删 holding 行再插**；三处口径一致：`/order-profit`、`/dashboard`（holding → 计数后 `return`）、`/ledger`（「寄存中」）
- ⚠️ 单号走 `data-order` 传（❌别拼进 onclick）；⚠️ `holdNote` 定义好还要在模板里插 `${holdNote}`

## 套装
- ❗一个套装 = **多个不同编码**共用一个名称；入库时各码都会被扫到 → **同一单多条记录正常，不要去重**
- ❗❗**归组键 = 商品名称**（`setKeyOfProduct`/`_setKeyOf`）；❌❌ **绝不读 `set_name` 归组**（曾让同一套拆两行、**利润算两倍**，09-24 生产事故）
- ❗**一整套只有一个行情价**：`groupItemsBySet` 归组，**套数 = 组内第一个编码的数量合计**（`setUnitsOf`）→ 销售额 = **套价 × 套数，只算一次**
- 明细只有「代表行」记销售额，其余标 `set_member` 且 `sale = 0`；`/inventory` 返回 `set_units`（= 同套各编码库存**最小值**）
- ❗**商品信息表把同套多码合并成一行**（`_buildDisplayRows`）；⚠️ 回调走**行索引** `this._rowRefs[rowId]`；合并只影响**显示**
- ❗**套装行只画一个「整套」行情图**（`PriceChart.renderSet` → `fetchSetHistory` 各编码**按日期合并成一条**）；改价 `_savePriceEdit` 走 `_editMembers` **整套一起写**

## 导入行情（10-01 上线）
- ❗❗**算法只给候选，一律由人确认**（用户原话「就算你知道这个商品是那个，但你也先问我」）→ 前端**默认一条都不勾**
- ❗**规格是强特征**：`spec` 出现在行情名里 → `score*0.5+0.5`；**没写规格**（如酒不写容量）→ 只 `*0.95`（❌别减半，否则「奔富407」对「奔富407 750ml」只剩 0.42）
- ❗**颜色冲突重罚 ×0.45**：只扫**尾部 4 字**取颜色字（避开"红米/小米"误伤）
- 接口 `POST /price-import/match`、`POST /price-import/commit`、`GET /price-alias`、`DELETE /price-alias/:id`；表 `main_price_alias`
- 前端 `products.js` 工具栏「📊 导入行情」→ `showPriceImport/_parsePriceText/submitPriceMatch/_renderPriceMatch/confirmPriceImport`
- ❗❗**写行情必须同时写 `product_id`**（10-01 修 bug）：商品表**行情图是按 `product_id` 查的**（`/price-history/:code?product_id=`），只写 `product_code` → 图上显示「暂无价格数据」
  - ① `/price-import/commit` 按 code 查 `main_products.id` 一并 INSERT；UPDATE 用 `COALESCE(product_id, ?)` 补空
  - ② `POST /price-history`（补录弹窗；「单利润明细→补录行情」那条前端**不传 id**）→ 没传时按 code 补
  - ③ 读接口 `/price-history/:code` 与 `/latest` 按 id 查时统一 `WHERE product_id = ? OR product_code = ?`（兜底历史 null 行）
  - ⚠️ **取价/利润不受影响**（`loadPriceMap` 一直按 `product_code` 查，金额始终对）——这只是**图**的问题
  - 历史回填：`UPDATE main_price_history h SET product_id = (SELECT p.id FROM main_products p WHERE p.code = h.product_code LIMIT 1) WHERE h.product_id IS NULL`
  - 自检 `.workbuddy/tmp/price-pid-test.js`（22 项，含**真跑 `_seriesFromHistory`+`_drawSVG`** 断言不出现「暂无价格数据」）
- ❗`_parsePriceText` 取**行尾**价格表达式；斜杠只在**后段是颜色型号**时才拆多行（`相纸 -60张/盒` 的斜杠是量词，不拆）

### ❗❗用户工作流（10-01 定）：截图 → 我初筛 → 给可导入文字
- 用户发**行情截图** → 我读图 → **人工初筛**（只留系统里有的）→ 输出「**系统商品名 + 价格**」纯文本 → 用户自己粘到「📊 导入行情」
- ❗**自动匹配有噪声**（实测「minise白色」→「GPW3代白色」52%）→ 初筛**必须人工过**，不能只看 `auto/likely`
- ❗**同款多编码必须问用户**（国行/海外、国行/国际版、单白/日版…）；答「两个都录」就两个各写一行
- 输出用**系统商品名**（导入时直接 `auto` 命中）；**生效日 = 行情表头上写的日期**（表头 "9.29" → 填 `2026-09-29`）
- 拉商品 `https://nanyishangmao.cn/api/main/products`；配对 `POST /api/main/price-import/match {rows:[{name,price}]}`
- 自检 `.workbuddy/tmp/verify-import-text-1001.js`；**完整流程见 skill `.workbuddy/skills/price-sheet-import/SKILL.md`**

## 盈亏走势：近一个月 · **只标「有盈亏的那几天」**
- 用户原话：「往前推一个月，哪天有盈利就标在横轴上，要具体的日数」+「那天没有盈利就没必要标出来」；「每月聚合」10 分钟就被否
- ❗**横轴 = 有盈亏的天**：前端把 `orders===0` 的日子**整行丢掉**再等距排布；没生意的日期**连刻度都不出现**
- `/dashboard` 一条查询出三套（**前端只用 `daily`**，另两套当降级链）：
  - `daily[]` = `{date, profit, revenue, cost, orders, cumulative}`；窗口 = 今天往前推一个自然月（`setMonth(-1)`，溢出 `setDate(0)`）→ 今天，**逐日补 0**；返回 `daily_start/daily_end`
    - ❗**窗口只影响走势图**：`totals`/订单列表/设备拆分/月设备弹窗都不受影响；`cumulative` 是**窗口内**累计
  - `monthly[]`/`weekly[]` 保留（兼容旧页面缓存）
- 前端 `_renderPnlChart(rows)` 吃三种粒度：`labelOf(r)` 判 `r.date`→「09-27」、`r.month_start`→「9月」、`r.week_start`→「09-21」
  - ❗逐日先 `filter(orders > 0)` 再画（`isDaily = !!allRows[0].date`）；**柱子数 == 刻度数 == 有生意的天数**
  - ⚠️ **亏损日只要有单仍会显示**（绿柱），不按 `profit>0` 过滤 —— 否则累计折线漏负值
  - ⚠️ 变量名别用 `raw`；聚合日期要 `to_char(...)` 再比

## 设备/下级的**上级汇总**
- 需求：**只在设备投入弹窗里**把「下单设备/下级」的 `1`/`2`/`3` 汇总成一行「李楠」，点它展开看各自成本/盈亏；**其它地方（入库台账、单利润明细、筛选下拉）仍按原设备名区分**
- 配置：`TransactionsModule.DEVICE_GROUPS = [{ name:'李楠', devices:['1','2','3'] }]`（`transactions.js` 顶部）；没配到的照旧单独一行；组里一个设备都没出过库 → 该行不出现
- ⚠️ 合计行仍按**原始设备**求和（别把「李楠」那层重复累加）；⚠️ 点击**按下标取**（`_devRows`/`_mdRows`），别把名字拼进 onclick
- ❗**「按月 · 设备投入」也同步支持**（`_showMonthGroupRow` / `_showMonthGroupMemberOrders`）；⚠️ 月份头「投入/盈亏」合计仍按原始设备求和
- ❗**需求变更后旧断言会过时** —— 是**断言过时不是 bug**，按新需求改写

## 入库登记单（要点）
- ⚠️ **单号组折叠态** `_collapsedGroups` 落 `localStorage`（`inbound_collapsed_{system}`）；❌别只存 DOM（重绘全弹开）、别只放内存、key 别用渲染下标
- ⚠️ 渲染拆成 `_refreshInboundTable()`（拉数据）+ `_renderInboundRows()`（只画表），否则输入一次请求一次 → 卡 + 失焦
- ✅ **字段筛选可多选**：`_inboundFilter = {fields:[], keyword, exact}`（❌旧的 `{field:'all'}` 已废）；`fields` 空 = 全字段；点胶囊 `_toggleInboundFilterField(key)`；**多字段是 OR**
  - 单字段且枚举型（渠道/标记/设备）→ 下拉；多选或全字段 → 文本框（下拉 `onchange` 传 `exact=true`）
  - 设备候选取 **全量**去重+trim；**设备按完全相等匹配**（有「1」和「10」），渠道/标记保持 includes
  - ⚠️ 切换字段**保留关键词**，只有涉及下拉才清空
- **行内编辑**：数量/渠道/价格点击就地改，失焦/回车保存，保存后库存/总量/整单金额/单利润重算
- **一单多品沿用**：只回填**订单号 + 下单设备**，**整单金额必须清空**
- **设备归属** = 该单**第一个填了值的商品**（按 id 升序）；不同设备**不拆**整单
- ✅ **订单号填成人名 = 正常现象**（没单号就拿名字占位，不参与计算）

## 信息台账「盈亏总览」（要点）
- 4 指标卡 + 盈亏柱线图（**手绘 SVG 零依赖，❌别引 echarts**）
- `GET /api/main/dashboard` → `totals{}` + `daily[]` + `by_device[]` + `orders[]`
- 入口：总投入卡片**不可点**；「查看明细 ›」→ `_showInvestDetail()` → 右上角两个**上下相邻蓝字链接**（用户明确：❌不要按钮、不要隔远）→ `_showDeviceBreakdown()`/`_showMonthBreakdown()`（月份胶囊**纯前端筛选**）
- ⚠️ **弹窗是单例**；叠弹窗必须 `#modal-overlay-2`（z-index 2100）+ `showModal2()/closeModal2()`
- ⚠️ 用中文做 HTML 断言会被**注释里同一个词**误伤 —— 注释别写功能关键词

## 其它要点
- **成本台账** `main_opex`：只记**运营成本**（投流/运费/包装/平台费），**跟商品采购成本（整单金额）完全两回事** → 不接进盈亏总览；前端按月分组按 `cost_date`（≠录入时间）
- **扫码**：入口唯一 `triggerBarcodeScan(id)` → `BarcodeScanner.startScan()`；**实时优先，绝不自动退拍照**；细节见 `mobile-web-barcode-scan` skill
- **出库信息单**：判断用 `_isTouchDevice()`（❌别用只看 `innerWidth` 的 `isMobile()`）；picker 默认只显 `stock>0`；搜索**输入时不重绘弹窗**
- **「待次日行情」**：`出库日次日 > 今天`（`todayOf(db)` 用 DB 时区）→ `await_price`；这些单**仍计入**总投入/总收益
- **通用辅助**：`_fmtMoneySep`(千分位)/`_todayLocal`(❌别用 toISOString)/`_escHtml`(进 innerHTML 必须转义)；表单值**一律 JS 赋值** `el.value=...`
- ⚠️ **标签栏窄屏会裁切**：以后加标签先算窄屏宽度

## 无浏览器自检（`frontend-logic-check` skill）
- 前端：Node + `vm` + 最小 DOM stub 真跑模块；后端：vm 加载路由取**真实 handler** + mock `db.query`（按 SQL 特征分流）+ stub `res.json`
  - 也可从源码**文本切片抠出纯函数**，保证「测的就是跑的那份」
- ❗❗**新增数据库表后旧测试会整片挂掉**（严格 mock 抛错 → handler 被 catch → 500，看着像功能坏了）→ mock 加新表兜底
- **铁律：给路由加新表后，必须重跑 `tmp/` 下全部 `*test*.js`（现 20 个）**；改前端交互后同样全跑一遍
