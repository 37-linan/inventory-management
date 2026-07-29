#!/bin/bash
set -e

echo "========================================="
echo "  出入库库存管理系统 - 云服务器部署脚本"
echo "========================================="
echo ""

# 1. 更新系统
echo "[1/6] 更新系统..."
apt update -qq && apt upgrade -y -qq

# 2. 安装 Node.js 22
echo "[2/6] 安装 Node.js 22..."
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
echo "  Node.js $(node -v)"
echo "  npm v$(npm -v)"

# 3. 安装 PostgreSQL
echo "[3/6] 安装 PostgreSQL..."
apt install -y postgresql postgresql-contrib
systemctl start postgresql
systemctl enable postgresql

# 创建数据库和用户
su - postgres -c "psql -c \"CREATE USER inventory WITH PASSWORD 'inventory123';\" 2>/dev/null || true"
su - postgres -c "psql -c \"CREATE DATABASE inventory_db OWNER inventory;\" 2>/dev/null || true"
su - postgres -c "psql -c \"GRANT ALL PRIVILEGES ON DATABASE inventory_db TO inventory;\" 2>/dev/null || true"

DATABASE_URL="postgresql://inventory:inventory123@localhost:5432/inventory_db"
echo "  数据库已创建"

# 4. 下载代码
echo "[4/6] 下载项目代码..."
cd /opt
rm -rf inventory-app 2>/dev/null || true
git clone https://github.com/37-linan/inventory-management.git inventory-app
cd inventory-app

# 5. 安装依赖并配置
echo "[5/6] 安装依赖..."
npm install

# 写入环境变量
cat > /opt/inventory-app/.env << EOF
DATABASE_URL=$DATABASE_URL
PORT=3000
EOF

# 6. 配置防火墙和自启
echo "[6/6] 配置防火墙和服务自启..."

# 放行 3000 端口
ufw allow 3000/tcp 2>/dev/null || true
# 腾讯云安全组也需要放行，但这个需要在网页控制台操作

# 用 PM2 管理进程
npm install -g pm2
pm2 start server.js --name "inventory-app"
pm2 save
pm2 startup systemd -u root --hp /root 2>/dev/null || true

echo ""
echo "========================================="
echo "  ✅ 部署完成！"
echo "========================================="
echo ""
echo "  访问地址: http://211.159.186.87:3000"
echo ""
echo "  注意：需要在腾讯云防火墙放行 3000 端口"
echo "  操作：控制台 → 服务器 → 防火墙 → 添加规则"
echo "        来源: 0.0.0.0/0  协议: TCP  端口: 3000"
echo "========================================="
