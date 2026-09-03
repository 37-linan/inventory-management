# 出入库管理系统 - 项目记忆

## 项目概况
出入库库存管理工作台，支持主系统（屈臣氏+抖音刷券）和抖音刷券系统。

## 部署信息
- **腾讯云服务器**: 211.159.186.87 | 用户: ubuntu
- **SSH 秘钥**: `C:/Users/nan/.workbuddy/tencent-key.pem`（原 /tmp/tencent_rsa 已被系统清理，勿再用）
- **访问地址**: http://211.159.186.87:3000
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

## 部署流程（改代码）
1. 本地改代码 → 推 GitHub
2. `ssh -i /tmp/tencent_rsa ubuntu@211.159.186.87`
3. `curl -fsSL https://raw.githubusercontent.com/.../path/file.js -o /home/ubuntu/inventory-app/path/file.js`
4. `pm2 restart inventory-app`
5. ❌ 禁止: rm/drop/truncate 数据库

## 技术栈
- Node.js 22.23.2 (server.js)
- PostgreSQL 14
- PM2 进程管理 + 开机自启
- 前端: 原生JS (products.js, api.js, config.js)
- 云路由: routes/main-cloud.js (异步)
