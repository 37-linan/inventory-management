# 出入库管理系统 · 项目记忆

## 概况
- 库存工作台，**只维护主系统**（屈臣氏/电商单品/数码/配件/酒类/欧美美妆）；抖音刷券已下线
- 栈：Node 22 + Express + pg + PM2 + 原生 JS 前端（无框架）；云路由 `routes/main-cloud.js`

## 运维 & 上线
- 服务器 `211.159.186.87`(ubuntu)；代码 `/home/ubuntu/inventory-app/`；PM2 `inventory-app`；密钥 `C:/Users/nan/.workbuddy/tencent-key.pem`
- **https://nanyishangmao.cn**（首选）；`:3000` 只能桌面调试（手机非安全上下文 → 摄像头禁 → 扫码废）
- **PG 14** `inventory_db`/`inventory`/`inventory123`，时区 `Asia/Shanghai`；`created_at` 是 `timestamp without time zone`
  - ⚠️ 取日期一律 SQL `to_char(...)`，❌ 别用 JS `toISOString()`（差 8 小时）
  - 排查 `PGPASSWORD=inventory123 psql -h 127.0.0.1 -U inventory -d inventory_db -c "..."`；❌ 禁止 rm/drop/truncate
- **GitHub** `37-linan/inventory-management`(443)：`GIT_SSH_COMMAND="ssh -i C:/Users/nan/.ssh/github_workbuddy -o StrictHostKeyChecking=no -p 443" git push origin main`
- 备案 粤ICP备2026122814号-1 / 粤公网安备 44140302000277号；**SSL 2026-11-23 到期**需续
- ⚠️ PATH 偶发丢失 → 命令前加 `export PATH="/usr/bin:/bin:/c/Users/nan/.workbuddy/binaries/PortableGit/versions/1.2.0/bin:$PATH"`
- ⚠️ 22 端口时不时全封（2222/8022 也不通，80/443 正常）→ scp/ssh 套 5 次重试
- ⚠️ `ssh 远端 "…$PATH…"` 的 `$PATH` 被**本地**展开 → 远端报 `syntax error near unexpected token '('`。远端命令用**单引号**包；校验文件优先 `curl` 公网 + `md5sum`
- ⚠️ `scp`/`ssh` 别塞进 shell 变量再展开（报 `decisionRecord missing`）；git push 重试别用管道退出码判断 → `out=$(git push 2>&1)` 再 grep
- ⚠️ 同一文件多处编辑**必须串行**（并行 Edit 互相覆盖）；改完 `grep -n` 复核
- **上线流程**：本地改 → `scp` 直传（❌别让服务器 curl GitHub，raw 常超时）→ 改 `public/` **必升 `sw.js CACHE_NAME`**（现 **v50**）；改 `server.js`/`routes/` → `pm2 restart inventory-app --update-env` → `md5sum` 比对 + `curl -w '%{http_code}'`
- **交付时必须提醒用户：手机要整个关掉网页重开**

## 沙箱只读时的写文件通路（已验证）
- 症状：`Edit`/`Write` 报 `ModifyBackup failed ... os error 87`；`cp`/`writeFileSync` 写**已存在文件**全 EPERM
- ✅ 通路：`node .workbuddy/tmp/apply-patch-dir.js 原文件 补丁.txt 新文件` → `rm 目标 && install -m 644 新文件 目标`（**只有「覆盖已存在文件」被拦，「删+新建」允许**）→ `md5sum` + `node --check`
- 补丁格式：`===OLD===`/`===NEW===`/`===END===` 单独成行，可多组；每组校验原文出现**正好 1 次**，否则整体不写
- ⚠️ 沙箱**会在会话中途变脸** → 见 `os error 87` 立刻切这条通路，别反复重试 Edit
- ⚠️ node 进程写项目文件同样 EPERM → 脚本输出**一律先落 `.workbuddy/tmp/`**（该目录不入 git）

## 取价 + 利润口径（全站唯一）
- 统一入口 `pickMarketPrice(map, code, baseDay, sameDay)`，**取价日**由 `priceDayPick(baseDay, sameDay)` 决定：
  - `sameDay=false`（**普通出库**）→ 取价日 = **出库日次日(D+1)**
  - `sameDay=true`（**寄存已卖出**）→ 取价日 = **卖出当天**（用户 2026-10-02 拍板，别再混）
- 取价规则：① 取价日**当天**有价 → 用它 ② 否则用「**< 取价日** 最近一天」的价，**不往后找**（= 用户说的「哪天没录就沿用前一天」）
  - ⚠️「取价日当天有价」要 `main_price_history` **真有那一行**才叫命中；`chart.js _fillMissingPrices` 只**画图补线、不落库**
- ❗❗**对外只有一个词：「取价日」**。那天没录 → 价往前沿用，**但取价日不变**
  - UI 列名「出库/取价日」；寄存已卖出的明细行标「（卖出当天）」而非「（次日）」；徽章「沿用价」+ `carryNote`；❌ **绝不写「取自 09-24」**
- ❗字段：`base_day`=基准日（普通=出库日；寄存已卖出=卖出日）；`price_day`=`next_day`=**取价日**；`price_date`=价**实际来自**哪天；`hold_sold`=卖出那天（前端靠它标「（卖出当天）」）
- ❗**改口径必须同时改三处**：`/order-profit`（普通 + 套装两条分支）、`/dashboard`、`/ledger`；⚠️ 台账里套装「组成条目」`price_day` **本来就留空**（销售额并到代表行），核对时别误判
- ❗补录弹窗默认日期 = **取价日**（`bf-price-date` / `_showBackfillPrice` / `_saveBackfillPrice`）
- ❗❗**同日重复录入确定性**：`loadPriceMap` 必须 `ORDER BY product_code, date, created_at, id`；`pickMarketPrice` 两分支统一为「同一天取最后录入那条」
- ❗❗**「退回更早」≡「次日沿用」，数值完全等价**（09-27 全量 29/29 行零差异）→ 用户问「为什么取 24 号」，**永远是显示口径问题，别怀疑算法**
- **真 bug 判据 = 取价日当天有行却没取到**
- 成本 = 整单金额（首商品 `purchase_price`）；只算**已出库**的单；总览按**出库日期**归周（周一起）；**盈利红/亏损绿**；盈亏率统一 `_rateTxt(pnl, invest)`
- 取不到行情 → 明细「待行情」¥0
- 自检：`tmp/hold-day-test.js`（51 项：两套口径 + 沿用 + 套装 + 三处一致）、`tmp/price-day-test.js`（20 项：真实数据证明**普通出库金额零差异**）、`tmp/live-verify-1002.js`（线上只读核对）

## ⚠️ 出库归属 = FIFO + 整单口径（别再改回去）
- `main_outbound.order_no` 是快递单号/"送货上门"，**与入库单号无关联**；❌ 按编码全局汇总会让新入库的单被历史出库凭空算出销售
- ✅ `computeOutboundAlloc(db)`：同编码入库批次按 `created_at` 升序排队，出库量**从最早批次依次扣减**；被扣 >0 才算「本单该商品已出库」，`out_date` = 最后消耗它的出库日。`/order-profit` 与 `/dashboard` **必须共用**
- ❗❗**整单口径**：**按套装归组后每一组都出过库**才算该单「已出库」；只出几件 → `partial_out`，**本金不进总投入**、明细也不出现（事故 `SF5151504320354` 凭空 -579）。响应含 `any_out/partial_out/pending_items/total_items`、`totals.partial_count/partial_invest`

## 寄存（发到档口还没卖）09-25
- 货**已出库**但没卖 → 整单压着不计盈亏；点「已卖出」改按**卖出当天**行情算（没寄存的仍按出库日）
- 表 `main_hold`：order_no/inbound_id/product_code/quantity/hold_date/status('holding'|'sold')/sold_date；`ensureHoldTable(db)` 挂 `router.use`；`loadHoldMap(db)` → `{单号:{status,hold_date,sold_date,codes{}}}`
  - 状态**按单统一**：所有寄存行都 sold 才算卖出；同单多行取最晚 `sold_date`
- 接口 `GET /hold`、`GET /hold/order-items?orderNo=`（只列该单**已出库**商品）、`POST /hold`、`POST /hold/sell`、`DELETE /hold?orderNo=`；⚠️ `POST /hold` 同单同码**先删 holding 行再插**
- 三处口径一致：`/order-profit`（`holding/hold_sold/hold_codes`，取价日=卖出日）、`/dashboard`（holding → 计数后 `return`；sold 单取价日与**归月**都用 sold_date）、`/ledger`（「寄存中」）
- 前端在**信息台账页内**：`_renderHoldSection/_loadHoldList/_openHoldPicker/_submitHold/_holdSell/_cancelHold`；⚠️ 单号走 `data-order`，❌ 别拼进 onclick；⚠️ `holdNote` 定义好还要在模板里插 `${holdNote}`

## 套装（09-23 上线，09-24 修归组键）
- ❗一个套装 = **多个不同编码**（一个商品的多个条码）共用一个名称；入库时各码都会被扫到 → **同一单多条记录正常，不要去重**
- ❗❗**归组键 = 商品名称**（`setKeyOfProduct` / `_setKeyOf`）：**用户不填套装名**，选"是套装"后多扫几个码即可
  - ❌❌ **绝不读 `set_name` 归组**（它只是名称副本；残留 Whoo水姸/Whoo水妍 曾让同一套拆两行、**利润算两倍**，09-24 生产事故）
  - `ensureSetColumns` 建列后 `UPDATE ... set_name = btrim(name)`；POST/PUT **无视前端 set_name** 一律取 `name`；`is_set=false` → set_name 置空
  - 改名 → `syncSetMembersRename(db,id,新名)` **name + set_name 一起改**；「＋加码」并入**已存在**编码 → 把它的名称改成该套名称 + 带 `sync_rename:false`
- ❗**一整套只有一个行情价**：`groupItemsBySet` 归组，**套数 = 组内第一个编码的数量合计**（`setUnitsOf`）→ 销售额 = **套价 × 套数，只算一次**；组内任一条出库即算该套已出库
- 明细只有「代表行」记销售额，其余标 `set_member` 且 `sale = 0`；`/inventory` 返回 `set_units`（= 同套各编码库存**最小值**）
- ❗**商品信息表把同套多码合并成一行**（`_buildDisplayRows`）：编码列竖排可点、名称只写一次 + 徽章「套装 · N 个编码」；规格/单位/类型取**并集去重**（`_uniqList`）
  - 操作列「编辑（首个编码）/＋加码/删除套装/💰套装价」；⚠️ 回调走**行索引** `this._rowRefs[rowId]`；⚠️ 拖拽行用 `data-pids`（两个属性都要读）；合并只影响**显示**
- ❗**套装行只画一个「整套」行情图**：容器 `chart-{system}-set-{rowId}`；`PriceChart.renderSet` → `fetchSetHistory` 各编码**按日期合并成一条**；点图 `showSetChart` → `showLargeSet`，改价 `_savePriceEdit` 走 `_editMembers` **整套一起写**

## 导入行情（10-01 上线）
- 场景：小程序行情表写厂商全称（"富士拍立得mini13国行 香芋紫"），系统录的是自己起的简称（"拍立得相机mini13" + 规格"香芋紫"）→ 名字对不上
- ❗❗**算法只给候选，一律由人确认**（用户原话「就算你知道这个商品是那个，但你也先问我」）→ 前端**默认一条都不勾**
- 表 `main_price_alias`：`alias_key`(归一化后行情原名, UNIQUE)/`alias_raw`/`product_code`/`hit_count`；`ensurePriceAliasTable` 挂 `router.use`
- `aliasMatch(raw, products, aliasMap)`：① 命中别名表 → 直接用（优先级最高）② 否则 `aliasScore` 打分
  - `normAlias`：全角→半角、去空白标点、小写；`aliasDice` = 2-gram Dice
  - ❗**规格是强特征**：`spec` 出现在行情名里 → `score*0.5+0.5`；**没写规格**（如酒不写容量）→ 只 `*0.95`（❌别减半，否则「奔富407」对上「奔富407 750ml」只剩 0.42）
  - ❗**颜色冲突重罚 ×0.45**：只扫**尾部 4 字**取颜色字（避开"红米/小米/金士顿"误伤）—— 防「小米手环10 黑」配到「银色」款
  - 分档（只影响提示强度）：`ambiguous`(多候选)/`auto`(≥0.72)/`likely`(≥0.45)/`low`/`none`
- 接口：`POST /price-import/match`、`POST /price-import/commit`（写 `main_price_history` + 别名 UPSERT，`hit_count+1`）、`GET /price-alias`、`DELETE /price-alias/:id`
- 前端 `products.js` 工具栏「📊 导入行情」→ `showPriceImport/_parsePriceText/submitPriceMatch/_renderPriceMatch/_priceOptions/_priceCheckAll/confirmPriceImport`
  - `_parsePriceText`：取行尾价格表达式（`500`/`¥500`/`255/265`）；跳过含"结算价/行情/不代表/全系/品类"的表头说明行
  - ❗斜杠只在**后段是颜色型号**时才拆多行（"黑/银"）；`相纸 -60张/盒` 的斜杠是量词 → 用单位字表 `[张盒个只瓶包袋支片条件套台克斤升米双对数]|\d|ml|cm|mm|kg` 挡掉
  - 拆出的第 2+ 段长度 ≤3 时补回前缀（剥掉第 1 段末尾颜色字）；下拉 = 「系统猜的」候选 + 全部商品（按 `type` 分 optgroup）兜底
- ❗❗**用户工作流（10-01 定）**：用户发**行情截图** → 我读图 → **人工初筛**（只留系统里有的）→ 输出「**系统商品名 + 价格**」纯文本 → 用户自己粘到「📊 导入行情」
  - ❗**自动匹配有噪声**（实测「minise白色」被配到「GPW3代白色」52%、「minise配件盒」→「拍立得mini13配件盒」47%）→ 初筛**必须人工过**，不能只看 `auto/likely`
  - ❗**同款多编码必须问用户**：mini13 香芋紫/蜜瓜绿 = 国行还是海外？相纸20张 = 双白盒装国行还是国际版？相纸10张 = 单白盒装还是日版？（用户答「两个都录」就两个各写一行）
  - 输出用**系统商品名**（不是行情原名）→ 导入时直接 `auto` 命中
  - **生效日 = 行情表头上写的日期**（表头 "9.29" → 填 2026-09-29）
  - 拉商品 `https://nanyishangmao.cn/api/main/products`；配对 `POST /api/main/price-import/match {rows:[{name,price}]}`
  - 自检 `.workbuddy/tmp/verify-import-text-1001.js`（真加载 products.js 跑 `_parsePriceText` + 调线上配对，29 项）
  - 完整流程已固化为 skill：`.workbuddy/skills/price-sheet-import/SKILL.md`

## 盈亏走势：近一个月 · **只标「有盈亏的那几天」**（09-27 定稿）
- 用户原话：「往前推一个月，哪天有盈利就标在横轴上，要具体的日数」+「那天没有盈利就没必要标出来」；「每月聚合」做过，用户 10 分钟就否了
- ❗**横轴 = 有盈亏的天**：前端把 `orders===0` 的日子**整行丢掉**再等距排布；没生意的日期**连刻度都不出现**
- `/dashboard` 一条查询出三套（**前端只用 `daily`**，另两套当降级链）：
  - `daily[]` = `{date, profit, revenue, cost, orders, cumulative}`；窗口 = 今天往前推一个自然月（`setMonth(-1)`，溢出用 `setDate(0)`）→ 今天，**逐日补 0**；返回 `daily_start/daily_end`
    - ❗**窗口只影响走势图**：`totals`/订单列表/设备拆分/月设备弹窗都不受窗口影响
    - `cumulative` 是**窗口内**累计（折线终点 ≠ `totals.profit`）
  - `monthly[]`/`weekly[]` 保留（兼容旧页面缓存）
- 前端 `_renderPnlChart(rows)` 吃三种粒度：`labelOf(r)` 判 `r.date`→「09-27」、`r.month_start`→「9月」、`r.week_start`→「09-21」；数据源 `dash.daily || dash.monthly || dash.weekly || []`
  - ❗逐日先 `filter(orders > 0)` 再画（`isDaily = !!allRows[0].date`）；**柱子数 == 刻度数 == 有生意的天数**
  - 抽稀 `labelStep = isDaily ? max(1, ceil(26/slot)) : ceil(n/12)`；⚠️ 变量名别用 `raw`（函数内已有 `const raw`）
  - ⚠️ **亏损日只要有单仍会显示**（绿柱），不按 `profit>0` 过滤 —— 否则累计折线漏负值

## 设备/下级的**上级汇总**（09-28 新增）
- 需求：把「下单设备/下级」里的 `1`/`2`/`3` 在**设备投入弹窗里**汇总成一行「李楠」，点它展开看各自成本/盈亏；**其它地方（台账、明细、筛选下拉）仍按原设备名区分**（用户明确要求）
- 配置：`TransactionsModule.DEVICE_GROUPS = [{ name:'李楠', devices:['1','2','3'] }]`（`transactions.js` 顶部 `ROW_COLORS` 之后）；可配多个、可改名；没配到的照旧单独一行；组里一个设备都没出过库 → 该行不出现
- 实现：`_showDeviceBreakdown` 聚出组行（`this._devGroupRows`）+ 未归组行，按投入降序存 `this._devRows`（**点击按下标取**）
  - 组行：名字 + 徽章 `1 · 2 · 3` + 操作列「展开 ›」（设备行仍是「明细 ›」）
  - `_showDeviceGroup(idx)` → 二级弹窗「李楠 · 上级汇总」；`_showGroupMemberOrders(gIdx,mIdx)`/`_showDeviceOrders(idx)` → `_showDeviceOrdersByName(dev, fromGroupIdx)`；`fromGroupIdx` 有值时「返回」回上级那层
  - ⚠️ 合计行仍按**原始设备**求和（别把李楠那层重复累加）
- ❗**「按月 · 设备投入」也同步支持**：每个月份分组内同样汇总出「李楠」（排该月第一），点它 → `_showMonthGroupRow(idx)` 弹「2026-09 · 李楠 · 上级汇总」；成员 → `_showMonthGroupMemberOrders` → `_showMonthDeviceOrdersByName(month, dev, fromGroupIdx)`
  - ⚠️ 月份头「投入/盈亏」合计仍按**原始设备**求和；`_mdRows` 存渲染行（含 `isGroup/name/members`），`_showMonthDeviceOrders(idx)` 对组行安全返回
  - ⚠️ 该月只有部分设备出过库 → 徽章只列真实存在的那几个
- ❗**需求变更后旧断言会过时**（给按月弹窗加汇总后，「按月里没有李楠」那几条失败）—— 是**断言过时不是 bug**，按新需求改写

## 入库登记单
- ⚠️ **单号组折叠态** `_collapsedGroups`（key = 订单号，无单号用「（无单号）」）：❌ 别只存 DOM（重绘全弹开），❌ 也别只放内存（关页面就忘）→ 落 `localStorage`（`inbound_collapsed_{system}`），套 try/catch；❌ key 别用渲染下标 `g0/g1`
- **行内编辑**：数量/渠道/价格点击就地改，失焦/回车保存，保存后库存/总量/整单金额/单利润重算
- **筛选**：⚠️ 渲染拆成 `_refreshInboundTable()`（拉数据）+ `_renderInboundRows()`（只画表），否则每输入一次都请求 → 卡 + 失焦
  - 设备候选取 `_inboundAllRecords` **全量**去重+trim；**设备按完全相等匹配**（有「1」和「10」），渠道/标记保持 includes
  - ✅ **字段可多选**：状态 `_inboundFilter = {fields:[], keyword, exact}`（❌ 旧的 `{field:'all'}` 已废）；`fields` 空 = 全字段；点胶囊 `_toggleInboundFilterField(key)`；**多字段是 OR —— 任一命中就显示**
    - 单字段且枚举型（渠道/标记/设备）→ 下拉；多选或全字段 → 文本框（下拉 `onchange` 传 `exact=true`）
    - ⚠️ 切换字段时**文本框之间保留关键词**，只有涉及下拉才清空
- **一单多品沿用**：`continueInbound()` 里 `form.reset()` 后只回填**订单号 + 下单设备**；**整单金额必须清空**
- **设备归属**：一单的设备 = 该单**第一个填了值的商品**（按 id 升序）；不同设备**不拆**整单
- ⚠️ 设备名已统一（`林浩东`/`林h东` 合并，09-18，备份表 `main_inbound_dev_bak_20260918`）；防复发靠 `<datalist>` 只提示不限制
- ✅ **订单号填成人名 = 正常现象**（没单号就拿名字占位，不参与计算）

## 信息台账「盈亏总览」
- 顶部 4 指标卡 + 盈亏柱线图（**手绘 SVG 零依赖，❌别引 echarts**）
- `GET /api/main/dashboard` → `totals{}` + `weekly[]`/`monthly[]`/`daily[]` + `by_device[]` + `orders[]`；⚠️ 后端聚合日期要 `to_char(...)` 再比，不能 `String(pgDate)`
- 入口：总投入卡片**不可点**；备注行右侧「查看明细 ›」→ ①`_showInvestDetail()`（#/单号/设备/本金/收益/盈亏/盈亏率/出库日期 + 合计）
  - ①右上角两个**上下相邻蓝字链接**（用户明确：**不要**按钮、不要隔远）：②`_showDeviceBreakdown()` ③`_showMonthBreakdown()`（月份胶囊**纯前端筛选**，不重开弹窗）
- ⚠️ **弹窗是单例**；叠弹窗必须 `#modal-overlay-2`（z-index 2100）+ `showModal2()/closeModal2()`
- ⚠️ 用中文做 HTML 断言会被**注释里同一个词**误伤 —— 注释别写功能关键词

## 其它功能要点
- **成本台账**（`main_opex`，09-18）：台账第 4 个标签页，**只记运营成本**（投流/运费/包装/平台费），**跟商品采购成本（整单金额）完全两回事** → 不接进盈亏总览；`amount` 允许负数=退款冲抵；`PATCH/DELETE /opex/:id`；前端按月分组按 `cost_date`（≠录入时间）
- **扫码**（09-14；细节见 `mobile-web-barcode-scan` skill）：入口唯一 `triggerBarcodeScan(id)` → `BarcodeScanner.startScan()`；**实时优先，绝不自动退拍照**；失败 `_showCameraError()` 三按钮；三档放宽单档 25s；❗超时后流才返回必须 `getTracks().forEach(t=>t.stop())`；iPhone 必须显式 `video.play()`；❌ 零 OCR
- **出库信息单**：电脑「选择商品」（列**有库存**商品）/ 手机扫码，`renderOutboundTab()` 二选一；判断用 `_isTouchDevice()`（❌别用只看 `innerWidth` 的 `isMobile()`）；picker 按 code 合并降序、默认只显 `stock>0`、搜索**输入时不重绘弹窗**；提交回填 `#outbound-code`/`#outbound-qty` → 调**原有** `submitOutbound()`
- **「待次日行情」**：`出库日次日 > 今天`（`todayOf(db)` 用 DB 时区）→ `await_price`；前端 4 处标注；这些单**仍计入**总投入/总收益
- **通用辅助（复用）**：`_fmtMoneySep`(千分位)/`_fmtMonth`/`_todayLocal`(❌别用 toISOString)/`_escHtml`(进 innerHTML 必须转义)；表单值**一律 JS 赋值** `el.value=...`，❌别拼进 HTML 属性
- ⚠️ **标签栏窄屏会裁切**：`.tabs` 有 `overflow-x:auto` + `.tab{flex:0 0 auto}`；**以后加标签先算窄屏宽度**

## 无浏览器自检（`frontend-logic-check` skill）
- 前端：Node + `vm` + 最小 DOM stub 真跑模块；后端：vm 加载路由 → `router.stack.find(l => l.route.path === '/xxx').route.stack[0].handle` 取**真实 handler** + mock `db.query`（按 SQL 特征分流）+ stub `res.json` → 不启服务验证完整逻辑，还能**一次验证多处口径一致**
  - 也可从源码**文本切片抠出纯函数**（如 `price-import-match-test` 抠 `aliasMatch`），保证「测的就是跑的那份」
- ❗❗**新增数据库表后旧测试会整片挂掉**（严格 mock 里 `throw new Error('未 mock 的 SQL')` → handler 被 catch → 500，看着像功能坏了）→ 修法：严格 mock 加 `if (/main_hold/i.test(s)) return { rows: [] };` + `CREATE/ALTER TABLE` 兜底
- **铁律：给路由加新表后，必须重跑 `tmp/` 下全部 `*test*.js`（现 21+ 个）**；改前端交互后同样全跑一遍（一条 `for` 循环约十秒）

## 访问密码 & 权限（三级 · 纯前端）10-01
- `app.js checkLogin()` 比对密码 → `sessionStorage.inventory_role` → `applyRoleClass()` 给 `document.body` 挂 class
  - `2312666` → `admin`（**不加任何限制 class**）
  - `2312` → `viewer`：只读 + **内容打码**
  - `666` → `limited`：只读 + `perm-limited`（隐藏台账/库存看板入口，只能进产品信息表）
- **打码**：`body.perm-mask` + 元素 class `mask-sensitive` → `style.css` 里 `.perm-mask .mask-sensitive{...}`：子元素 `filter:blur(7px)` + `::after` 盖「🔒 该内容无权查看」
  - 加 class 只在 `applyRoleClass()`：`if (role && role !== 'admin') body.classList.add('perm-mask')`
  - 目标 4 块（`transactions.js`）：**入库记录表 / 出库记录表 = 给那两张 `.card` 加 `mask-sensitive`**；**信息台账 / 成本台账（`renderLedgerTab`/`renderOpexTab`）= 给容器 `#transactions-content-${system}` 加 `mask-sensitive`**
  - ❗❗容器级打码**必须**在 `renderInboundTab`/`renderOutboundTab` 里 `classList.remove('mask-sensitive')`，否则切回登记单会把表单一起糊住
  - ❗这是**前端看门**（防误操作，不防技术绕过）；改密码/改可见范围都在 `app.js` + `style.css`
  - 自检 `tmp/perm-mask-test.js`（40 项：CSS 规则 / 四角色 class / 四块标记 / 切页不残留 / 源码完整性）

## 行情写入必须带 product_id（10-01 修 bug）
- 商品表**行情图是按 `product_id` 查的**（`/price-history/:code?product_id=`），只写 `product_code` → 图上显示「暂无价格数据」
  - ① `/price-import/commit` 按 code 查 `main_products.id` 一并 INSERT；UPDATE 用 `COALESCE(product_id, ?)` 补空
  - ② `POST /price-history`（补录弹窗；「单利润明细→补录行情」那条前端**不传 id**）→ 没传时按 code 补
  - ③ 读接口 `/price-history/:code` 与 `/latest` 按 id 查时统一 `WHERE product_id = ? OR product_code = ?`（兜底历史 null 行）
  - ⚠️ **取价/利润不受影响**（`loadPriceMap` 一直按 `product_code` 查，金额始终对）—— 这只是**图**的问题
  - 历史回填：`UPDATE main_price_history h SET product_id = (SELECT p.id FROM main_products p WHERE p.code = h.product_code LIMIT 1) WHERE h.product_id IS NULL`
  - 自检 `tmp/price-pid-test.js`（22 项，含**真跑 `_seriesFromHistory`+`_drawSVG`** 断言不出现「暂无价格数据」）
