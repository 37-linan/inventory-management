# 出入库管理系统 · 项目记忆（铁律版）
> 字段清单 / 函数级实现 / 历史事故 / 前端细节 → 同目录 **`REFERENCE.md`**（改代码前读它）

## 概况
- 库存工作台，**只维护主系统**；Node22 + Express + pg + PM2 + 原生 JS；云路由 `routes/main-cloud.js`

## 权限（三级 · 纯前端）
- `app.js applyRoleClass()` 按 `sessionStorage.inventory_role` 给 `body` 挂 class：
  - `2312666` → `admin`（**不加任何限制 class**）｜`2312` → `viewer` 只读 + **打码**｜`666` → `limited` 只读 + 隐藏台账/看板入口
- ❗打码 = `body.perm-mask` + 元素 class `mask-sensitive`；目标 4 块：**入库/出库记录表**（那两张 `.card`）、**信息台账/成本台账**（容器 `#transactions-content-${system}`）
- ❗❗容器级打码**必须**在 `renderInboundTab`/`renderOutboundTab` 里 `classList.remove('mask-sensitive')`，否则切回登记单会把表单一起糊住
- 纯前端看门（防误操作，不防技术绕过）；自检 `tmp/perm-mask-test.js`

## 运维 & 上线
- 服务器 `211.159.186.87`，`/home/ubuntu/inventory-app/`，PM2 `inventory-app`，密钥 `C:/Users/nan/.workbuddy/tencent-key.pem`；线上 **https://nanyishangmao.cn**（`:3000` 手机扫码废）
- PG14 `inventory_db`；⚠️ 取日期一律 SQL `to_char(...)`（❌ JS `toISOString()` 差 8 小时）；❌ 禁止 rm/drop/truncate
- GitHub `37-linan/inventory-management`：`GIT_SSH_COMMAND="ssh -i C:/Users/nan/.ssh/github_workbuddy -o StrictHostKeyChecking=no -p 443"`
- **上线**：`scp` 直传（❌别让服务器 curl GitHub）→ 改 `public/` **必升 `sw.js CACHE_NAME`**（现 **v53**）；改 `routes/`/`server.js` → `pm2 restart inventory-app --update-env` → `md5sum` + `curl -w '%{http_code}'`
- **交付必须提醒用户：手机要整个关掉网页重开**
- ⚠️ 22 端口常封 → scp/ssh 套 5 次重试；**也可能长时间不通**（表现为先 `Connection refused` 再 `Connection timed out`），此时 `https://nanyishangmao.cn/` 仍 200 → 是防火墙拦**出口 IP**（`curl https://ipinfo.io/ip` 看当前 IP，家宽是动态的）→ 让用户去腾讯云轻量「防火墙」放行，或换网络；⚠️ `ssh 远端 "…$PATH…"` 的 `$PATH` 被**本地**展开 → 远端命令用**单引号**包；⚠️ 同文件多处编辑**必须串行**；⚠️ PATH 丢失先 `export PATH="/usr/bin:/bin:/c/Users/nan/.workbuddy/binaries/PortableGit/versions/1.2.0/bin:$PATH"`

## 沙箱写文件通路（见 `os error 87` 立刻切）
- `Edit`/`Write` 改**已存在文件** EPERM → `node .workbuddy/tmp/apply-patch-dir.js 原文件 补丁.txt 新文件` → `rm 目标 && install -m 644 新文件 目标` → `md5sum` + `node --check`
- 补丁 `===OLD===`/`===NEW===`/`===END===` 单独成行，每组要求原文**正好出现 1 次**；node 写项目文件同样 EPERM → 输出先落 `.workbuddy/tmp/`

## 取价 + 利润口径（全站唯一）
- `pickMarketPrice(map, code, baseDay, sameDay)` 先由 `priceDayPick(baseDay, sameDay)` 定**取价日**：① 取价日**当天**有价 → 用它 ② 否则用「<取价日最近一天」的价，**不往后找**。`/order-profit`、`/dashboard`、`/ledger` **必须共用**
- ❗❗**取价日两套口径（2026-10-02 拍板，别再混）**：
  - **普通出库** → 取价日 = 出库日**次日(D+1)**（`sameDay=false`）
  - **寄存已卖出** → 取价日 = **卖出当天**（`sameDay=true`）——「我点击哪天卖出就那天的行情，而不是卖出日的次日」
  - 共同点：取价日没录 → 价往前沿用，**但取价日不变**
- ❗**对外只有一个词：「取价日」**；❌ 绝不写「取自 09-24」（用户会当成"用了当天的价"）
- ❗**改口径必须同时改三处**：`/order-profit`（普通 + 套装两条分支）、`/dashboard`、`/ledger`
- ❗❗**同日重复录入确定性**：`loadPriceMap` 必须 `ORDER BY product_code, date, created_at, id`；两分支统一「同一天取最后录入那条」
- ❗❗**「退回更早」≡「次日沿用」，数值完全等价**（09-27 全量 29/29 零差异）→ 用户问「为什么取 24 号」，**永远是显示口径问题，别怀疑算法**
- **真 bug 判据 = 取价日当天有行却没取到**
- 成本 = 整单金额（首商品 `purchase_price`）；只算**已出库**的单；**盈利红/亏损绿**；取不到行情 → 明细「待行情」¥0，补录入口默认日期 = **取价日**

## ⚠️ 出库归属 = FIFO + 整单口径
- `main_outbound.order_no` 是快递单号，**与入库单号无关联**
- ✅ `computeOutboundAlloc(db)`：同编码入库批次按 `created_at` 升序排队、出库量**从最早批次依次扣减**；被扣 >0 才算已出库。`/order-profit` 与 `/dashboard` **必须共用**
- ❗❗**整单口径**：套装归组后**每组都出过库**才算该单「已出库」；只出几件 → `partial_out`，**本金不进总投入**、明细也不出现（事故 `SF5151504320354`）

## 寄存（发到档口还没卖）
- 货已出库但没卖 → 整单压着不计盈亏；点「已卖出」按**卖出当天**行情算；⚠️ 已卖出的单会从列表消失、事后改不了日期
- `main_hold`；状态**按单统一**（所有行都 sold 才算卖出，同单多行取最晚 `sold_date`）；`POST /hold` 同单同码**先删 holding 再插**
- 三处口径一致：`/order-profit`、`/dashboard`（holding → 计数后 `return`）、`/ledger`（「寄存中」）；⚠️ 单号走 `data-order`（❌别拼进 onclick）；⚠️ `holdNote` 定义好还要在模板里插 `${holdNote}`

## 套装
- 一个套装 = **多个不同编码**共用一个名称；同单多条记录**正常，别去重**
- ❗❗**归组键 = 商品名称**；❌❌ **绝不读 `set_name` 归组**（曾让同套拆两行、**利润算两倍**，09-24 事故）
- ❗**一整套只有一个行情价**：套数 = 组内第一个编码的数量合计 → 销售额 = **套价 × 套数，只算一次**；明细只「代表行」记销售额，其余 `set_member` 且 `sale=0`；`/inventory` 的 `set_units` = 同套各码库存**最小值**
- ❗商品信息表把同套多码合并成一行（**只影响显示**，回调走行索引 `_rowRefs[rowId]`）；❗套装行只画一个「整套」行情图，改价走 `_editMembers` **整套一起写**

## 导入行情
- ❗❗**算法只给候选，一律由人确认** → 前端**默认一条都不勾**；❗规格是强特征；颜色冲突重罚 ×0.45（只扫**尾部 4 字**）
- ❗❗**写行情必须同时写 `product_id`**，否则行情图「暂无价格数据」（**只是图的问题**，取价/利润不受影响）
- ❗`_parsePriceText` 取**行尾**价格表达式；斜杠只在**后段是颜色型号**时才拆行（`相纸 -60张/盒` 是量词，不拆）
- ❗❗**「停收」= 照录、价填 0**（10-05 拍板）：表里写「停收 / 全系列停 / 0.0」的**不再丢**，输出 `系统商品名 0`；前端解析与后端落库都已放开 0（旧逻辑把 0 当「没解析到」直接丢）；但 **0 价不参与取价** —— `pickMarketPrice` 跳过 0，视同「没录价」往前沿用，**不会把出库单销售额算成 0**
- **工作流**：用户发**行情截图** → 我读图 → **人工初筛**（只留系统里有的）→ 输出「**系统商品名 + 价格**」纯文本 → 用户自己粘到「📊 导入行情」
  - ❗自动匹配有噪声 → 初筛**必须人工过**，不能只看 `auto/likely`；同款多编码/名字对不上**必须问用户**
  - ❗❗**系统里同名多编码的商品，输出行必须带规格**（如「海飞丝净爽止痒型 蓝」有 670g / 360g 两码）
  - 生效日 = 行情表头日期（**表头没写就让用户自己填**）；拉商品 `https://nanyishangmao.cn/api/main/products`；配对 `POST /api/main/price-import/match`
  - **完整流程 + 已确认映射 → skill `.workbuddy/skills/price-sheet-import/SKILL.md`**

## 盈亏走势（近一个月 · **只标有盈亏的那几天**）
- ❗横轴 = **有盈亏的天**：`orders===0` 的日子整行丢掉再等距排布，没生意**连刻度都不出现**（「每月聚合」被用户否掉）
- `/dashboard` 出三套（**前端只用 `daily`**，另两套当降级链）：窗口 = 今天往前推一自然月、逐日补 0；❗**窗口只影响走势图**，`totals`/订单列表/设备拆分都不受影响
- ⚠️ 亏损日只要有单仍会显示（绿柱），**别按 `profit>0` 过滤**；⚠️ 聚合日期先 `to_char(...)` 再比

## 设备/下级的**上级汇总**
- **只在设备投入弹窗里**把 `1`/`2`/`3` 汇总成「李楠」一行，点开看各自明细；**其它地方（台账、明细、筛选下拉）仍按原设备名区分**
- 配置 `TransactionsModule.DEVICE_GROUPS=[{name:'李楠',devices:['1','2','3']}]`；组里一个都没出过库 → 该行不出现
- ⚠️ 合计仍按**原始设备**求和（别重复累加）；⚠️ 点击**按下标取**，别把名字拼进 onclick；「按月 · 设备投入」同样支持（月份头合计仍按原始设备求和）
- ❗**需求变更后旧断言会过时** —— 是**断言过时不是 bug**

## 入库登记单
- ⚠️ 单号组折叠态落 `localStorage`（`inbound_collapsed_{system}`）；❌别只存 DOM、别只放内存、key 别用下标
- ⚠️ 渲染拆 `_refreshInboundTable()`（拉数据）+ `_renderInboundRows()`（只画表），否则输入一次请求一次 → 卡 + 失焦
- ✅ 字段筛选可多选：`_inboundFilter={fields:[],keyword,exact}`，`fields` 空 = 全字段，**多字段是 OR**；单字段枚举型（渠道/标记/设备）给下拉，多选/全字段给文本框；**设备按完全相等匹配**（有「1」和「10」），渠道/标记 includes
- 行内编辑（数量/渠道/价格）保存后重算库存/总量/整单金额/单利润；一单多品沿用只回填**订单号 + 下单设备**，**整单金额清空**
- 设备归属 = 该单**第一个填了值**的商品（按 id 升序）；✅ **订单号填成人名 = 正常现象**

## 信息台账「盈亏总览」
- 4 指标卡 + 盈亏柱线图（**手绘 SVG 零依赖，❌别引 echarts**）；总投入卡片**不可点**，「查看明细 ›」→ `_showInvestDetail()` → 右上两个**上下相邻蓝字链接**（❌不要按钮、不要隔远）
- ⚠️ 弹窗是单例，叠弹窗必须 `#modal-overlay-2`（z-index 2100）；⚠️ 中文 HTML 断言会被**注释里同一个词**误伤

## 其它要点
- **成本台账** `main_opex`：只记**运营成本**，跟商品采购成本（整单金额）**完全两回事** → 不接进盈亏总览
- **扫码**：入口唯一 `triggerBarcodeScan(id)`；**实时优先，绝不自动退拍照**（细节见 `mobile-web-barcode-scan` skill）
- **出库信息单**：判断用 `_isTouchDevice()`（❌别用只看 `innerWidth` 的 `isMobile()`）；搜索**输入时不重绘弹窗**
- **「待次日行情」**：`出库日次日 > 今天` → `await_price`，这些单**仍计入**总投入/总收益
- **通用辅助**：`_fmtMoneySep`/`_todayLocal`(❌别用 toISOString)/`_escHtml`；表单值**一律 JS 赋值** `el.value=...`；⚠️ 标签栏窄屏会裁切，加标签先算窄屏宽度
- **图片（入库/出库）**：`image_path` 一列存**多张**，用**英文逗号**拼（单张不带逗号，老数据兼容）→ `_imagesToPath()` 存、`_imgList()`/`_imgCellHtml()` 读、`showImagePreview()` 画图册；❌**别再写 `images[0]`**（那会让拍的第二张根本没入库）
- ❗**接口失败必须看得见**：`API.request` 有 20s 超时；页面加载失败要给「失败原因 + 重新加载」界面，❌**别只弹 toast 就完事**（用户会看到永远「加载中...」却不知道为什么）
- **窄屏「文字被切」**：先怀疑**整排溢出被容器裁掉**（`.card{overflow:hidden}` + flex item `min-width:auto` 不肯缩），**解法是给容器 `overflow-x:auto` + 子项 `flex:1 0 auto`，不是换行**（`.tabs`、`.card-header .btn-group` 都照这个改）

## 无浏览器自检（`frontend-logic-check` skill）
- 前端 Node+`vm`+DOM stub 真跑模块；后端 vm 取**真实 handler** + mock `db.query` + stub `res.json`
- ❗❗**新增数据库表后旧测试会整片挂掉**（严格 mock 抛错 → 500，看着像功能坏了）→ mock 加新表兜底
- **铁律：给路由加新表后必须重跑 `tmp/` 下全部 `*test*.js`；改前端交互后同样全跑一遍**
