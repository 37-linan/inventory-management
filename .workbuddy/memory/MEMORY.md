# 出入库管理系统 - 项目记忆

## 项目概况
出入库库存管理工作台，支持主系统（屈臣氏+抖音刷券）和抖音刷券系统。

## 部署信息
- **腾讯云服务器**: 211.159.186.87 | 用户: ubuntu
- **SSH 秘钥**: `C:/Users/nan/.workbuddy/tencent-key.pem`（原 /tmp/tencent_rsa 已被系统清理，勿再用）
- **访问地址**: https://nanyishangmao.cn （**首选**）| http://211.159.186.87:3000（仅桌面调试）
  - ⚠️ 手机上必须用 HTTPS 域名访问：HTTP 或 IP:3000 属非安全上下文，浏览器直接禁用 `navigator.mediaDevices`，扫码/拍照全部失效
- **数据库**: PostgreSQL 14 (inventory_db, 用户 inventory, 密码 inventory123)
- **进程管理**: PM2 (inventory-app)
- **代码位置**: /home/ubuntu/inventory-app/
- **GitHub**: https://github.com/37-linan/inventory-management

## 业务规则
1. **两种类型**: 抖音刷券(套餐/赠品)、屈臣氏(单品)
2. **套组数量(bundle_qty)**: 抖音刷券专用，库存 = 入库数 × 套组数量
3. **赠品(gift_of)**: 抖音刷券主品可带赠品，屈臣氏无赠品
4. **编码重复**: 同编码可在不同类型和各套餐中重复
5. **删除**: 按 code+type 双重匹配，不同类型互不影响
6. **利润**: 套餐整套卖用总价算，单品卖用采购价算
7. **入库表行内编辑**（2026-09-14）: 入库记录表的「登记数量 / 渠道 / 价格」三栏可直接点击就地修改，
   失焦或回车即保存，保存后库存/整单总数量/整单金额/单利润自动重算；不用再删整单重填
   - 接口: `PATCH /api/{main|douyin}/inbound/:id`，只更新传了的字段
   - 前端: `transactions.js _editInboundCell()` + `_getChannelOptions()`
8. **入库表筛选**（2026-09-14）: 表头「🔍 筛选」按钮 → 展开两块
   - 「筛选栏」= 关键词输入（全字段模糊匹配）；「筛选条件」= 字段胶囊，点一下把范围限定到该字段
   - 渠道/标记是枚举 → 筛选栏自动变下拉，不用手打
   - 关键实现: 渲染必须拆成 `_refreshInboundTable()`（拉数据） + `_renderInboundRows()`（只画表），
     否则每次输入都重新请求接口会卡、输入框会失焦
   - 前端: `transactions.js _inboundFilter / _renderInboundRows() / _matchInboundFilter()`
   - CSS: `style.css` 的 `.filter-*`（入库出库通用，出库表尚未接）

## 部署流程（改代码）
1. 本地改代码 → 推 GitHub
2. **直接 scp 上传（比 curl 拉 GitHub 稳，大陆网络下 GitHub raw 常超时）**：
   `scp -i C:/Users/nan/.workbuddy/tencent-key.pem -o StrictHostKeyChecking=no <本地文件> ubuntu@211.159.186.87:/home/ubuntu/inventory-app/<同名路径>`
3. 改了 `public/` 下的前端文件 → **必须升 `public/sw.js` 的 CACHE_NAME**（现为 v13）
   - SW 策略已改为：HTML 文档 + `.js/.css` 网络优先，图标/manifest 缓存优先，并加了 skipWaiting/clients.claim
   - 所以**不再需要**手工加 `index.html?` 版本号，但 CACHE_NAME 仍要升，否则 precache 列表不更新
4. 只改前端静态文件不需要重启；改了 `server.js`/`routes/` 才 `pm2 restart inventory-app`
5. 验证：`md5sum` 对比服务器与本地 + `curl -s -o /dev/null -w '%{http_code}' https://nanyishangmao.cn/`
6. ❌ 禁止: rm/drop/truncate 数据库

## 扫码规则（2026-09-14 定稿，实测准确率高）
- 全站唯一扫码入口：`products.js → triggerBarcodeScan(inputId)` → `barcode.js BarcodeScanner.startScan()`
- **实时优先，绝不自动退拍照**。`startScan` 里 getUserMedia 失败 → 调 `_showCameraError()` 把真实原因写在页面上 + 三个按钮（🔄重新打开实时 / 📸改用拍照 / ⌨️手动输入）。拍照页只能用户手点进入
- 打开摄像头三档约束逐级放宽：`{facingMode:{ideal:'environment'},1280x720}` → `{facingMode:'environment'}` → `{video:true}`，单档 25s 超时；`NotAllowedError`/`SecurityError` 立即跳出不再降级
- 超时后若流才返回，必须 `getTracks().forEach(t=>t.stop())`，否则摄像头被占住 → 之后每次扫码都只能拍照（曾踩坑）
- iPhone 必须显式 `video.play()`；只给 `autoplay` 有时不出帧 → 画面全黑 → 怎么扫都无结果
- 等 `readyState>=2 && videoWidth>0` 再开始解码；抽帧按视频真实分辨率（上限 1280 宽）而非固定 640×480
- 解码器：先 `_supportsEan13()` 检查原生 BarcodeDetector 是否真支持 EAN-13（iPhone Safari 只支持二维码，会空转），不支持则走 Quagga 逐帧（间隔 200ms，顺序执行不并发）
- ❌ 前端零 OCR：`/api/ocr-text` 已从所有路径删除（加了之后反而完全识别不出来）
- 排查顺序：先 `md5sum` 比对服务器/本地 → 再看用户访问的 URL 是不是 HTTPS → 最后才是代码

## 备案信息（2026-09 完成）
- ICP 备案号: 粤ICP备2026122814号-1 | 公安备案号: 粤公网安备 44140302000277号
- 备案主体: 李楠（个人），网站名"楠熠信息记录"
- 网站底部已挂两个备案号；SSL 证书 2026-11-23 到期需续期（腾讯云 SSL 控制台重申请亚洲诚信免费证书）

## GitHub 推送（2026-09 改 SSH 443）
- remote: ssh://git@ssh.github.com:443/37-linan/inventory-management.git
- key: C:/Users/nan/.ssh/github_workbuddy（已加入 GitHub）
- 推送: GIT_SSH_COMMAND="ssh -i C:/Users/nan/.ssh/github_workbuddy -o StrictHostKeyChecking=no -p 443" git push origin main
- 大陆网络 HTTPS/22 常不通，443 SSH 最稳

## SSH 运维
- 腾讯云 22 端口从本机常 Connection refused（网络路径问题）；换网络(手机热点)可恢复
- 服务器 SSH 挂: 腾讯云控制台 → 轻量应用服务器 → OrcaTerm 免密(TAT)登录 → sudo systemctl restart sshd

## 单利润规则（2026-08 定稿）
- 成本 = 整单金额（首商品 purchase_price）
- 售价 = 出库次日(D+1)录的价；次日没录 → 用出库日当天/之前最近价（23:30自动沿用价），不往后找
- 可随时用大图"✏️ 修改行情"改某天价格，利润自动重算（order-profit 实时计算）

## 技术栈
- Node.js 22.23.2 (server.js)
- PostgreSQL 14
- PM2 进程管理 + 开机自启
- 前端: 原生JS (products.js, api.js, config.js)
- 云路由: routes/main-cloud.js (异步)
