# AISCL 部署指南

## 概述

本指南提供完整的AISCL系统部署说明，包括开发环境、生产环境配置和优化建议。

## 系统架构

```
┌─────────────────┐    ┌─────────────────┐
│   Nginx (80)    │────│  Frontend (3000)│
│                 │    │   React SPA     │
└─────────────────┘    └─────────────────┘
          │                       │
          └───────────────────────┼─────────────────────┐
                                  │                     │
                    ┌─────────────────┐   ┌─────────────────┐
                    │ Backend (8000)  │───│   MongoDB (27017)│
                    │ FastAPI + Uvicorn│   │                 │
                    └─────────────────┘   └─────────────────┘
                              │
                    ┌─────────────────┐   ┌─────────────────┐
                    │   Redis (6379)  │   │  MinIO (9000)   │
                    │                 │   │                 │
                    └─────────────────┘   └─────────────────┘
```

## 快速开始

### 开发环境

1. **克隆项目**
   ```bash
   git clone <repository-url>
   cd AISCL_main
   ```

2. **启动服务**
   ```bash
   docker-compose up -d
   ```

3. **验证服务**
   ```bash
   # 检查服务健康状态
   curl http://localhost/health

   # 查看服务日志
   docker-compose logs -f
   ```

### 生产环境

1. **设置环境变量**
   ```bash
   cp .env.example .env
   # 编辑 .env 文件，设置生产环境变量
   ```

2. **构建和部署**
   ```bash
   # 构建镜像
   docker-compose build

   # 启动服务
   docker-compose up -d

   # 运行数据库索引设置
   docker-compose exec backend python setup_indexes.py
   ```

## 配置说明

### 环境变量

创建 `.env` 文件：

```env
# 应用配置
APP_ENV=production
DEBUG=false
LOG_LEVEL=INFO

# 数据库
MONGODB_URI=mongodb://admin:admin123@mongodb:27017/AISCL
MONGODB_MAX_POOL_SIZE=10

# Redis
REDIS_URL=redis://redis:6379/0

# JWT
JWT_SECRET_KEY=your-256-bit-secret-key-here
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=1440  # 24小时

# MinIO
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
MINIO_BUCKET_NAME=AISCL-files

# 安全
SECRET_KEY=your-32-character-secret-key

# 文件上传
MAX_FILE_SIZE=52428800  # 50MB
MAX_PROJECT_STORAGE=5368709120  # 5GB

# 项目限制
MAX_PROJECT_MEMBERS=5
```

### 安全配置

#### JWT密钥生成
```bash
# 生成256位密钥
openssl rand -hex 32

# 生成RSA密钥对（推荐用于生产）
openssl genrsa -out jwt-private.pem 2048
openssl rsa -in jwt-private.pem -pubout -out jwt-public.pem
```

#### HTTPS配置
```bash
# 获取SSL证书 (Let's Encrypt)
certbot certonly --webroot -w /var/www/html -d yourdomain.com

# 或使用自签名证书（仅开发环境）
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes
```

## 优化配置

### 数据库优化

1. **索引创建**
   ```bash
   docker-compose exec backend python setup_indexes.py
   ```

2. **连接池配置**
   ```env
   MONGODB_MAX_POOL_SIZE=20
   MONGODB_MIN_POOL_SIZE=5
   ```

3. **TTL索引**（自动清理过期数据）
   - 活动日志：保留365天
   - 刷新令牌：保留30天

### 缓存优化

1. **Redis配置**
   ```env
   REDIS_URL=redis://redis:6379/0
   ```

2. **缓存策略**
   - 用户数据：5分钟TTL
   - 项目数据：3分钟TTL
   - 权限数据：1分钟TTL

### 性能监控

1. **Prometheus指标**
   ```
   http://localhost:8000/metrics
   ```

2. **健康检查**
   ```bash
   # 应用健康检查
   curl http://localhost/health

   # 数据库连接检查
   docker-compose exec mongodb mongosh --eval "db.runCommand('ping')"

   # Redis连接检查
   docker-compose exec redis redis-cli ping
   ```

## 备份策略

### 数据库备份
```bash
# MongoDB备份
docker-compose exec mongodb mongodump --db AISCL --out /backup/$(date +%Y%m%d_%H%M%S)

# 自动备份脚本
0 2 * * * docker-compose exec mongodb mongodump --db AISCL --out /backup/$(date +\%Y\%m\%d)
```

### 文件备份
```bash
# MinIO数据备份
docker-compose exec minio mc mirror /data/AISCL-files /backup/minio/$(date +%Y%m%d)

# Redis数据备份
docker-compose exec redis redis-cli --rdb /backup/redis.rdb
```

## 监控和日志

### 日志配置
```env
LOG_LEVEL=INFO
```

### 监控端点
- 应用指标: `GET /metrics`
- 健康检查: `GET /health`
- API文档: `GET /docs` (Swagger UI)

### 日志收集
```bash
# 查看应用日志
docker-compose logs -f backend

# 查看所有服务日志
docker-compose logs -f

# 日志轮转配置
logrotate -f /etc/logrotate.d/docker
```

## 故障排除

### 常见问题

1. **服务启动失败**
   ```bash
   # 检查服务状态
   docker-compose ps

   # 查看详细日志
   docker-compose logs <service_name>

   # 重启服务
   docker-compose restart <service_name>
   ```

2. **数据库连接问题**
   ```bash
   # 测试数据库连接
   docker-compose exec backend python -c "
   from app.db.mongodb import mongodb
   import asyncio
   asyncio.run(mongodb.connect())
   print('Database connection successful')
   "
   ```

3. **内存不足**
   ```bash
   # 检查容器资源使用
   docker stats

   # 调整资源限制
   docker-compose up -d --scale backend=2
   ```

### 性能调优

1. **应用性能**
   ```env
   # 增加工作进程数
   WORKERS=4

   # 调整连接池
   MAX_CONNECTIONS=100
   ```

2. **数据库性能**
   ```javascript
   // MongoDB索引优化
   db.users.createIndex({email: 1})
   db.projects.createIndex({owner_id: 1, created_at: -1})
   ```

3. **缓存性能**
   ```env
   # 增加Redis内存
   REDIS_MAXMEMORY=512mb
   REDIS_MAXMEMORY_POLICY=allkeys-lru
   ```

## 安全加固

### 生产环境安全配置

1. **网络安全**
   ```bash
   # 防火墙配置
   ufw allow 80
   ufw allow 443
   ufw --force enable
   ```

2. **SSL/TLS配置**
   ```nginx
   # nginx SSL配置
   ssl_protocols TLSv1.2 TLSv1.3;
   ssl_ciphers HIGH:!aNULL:!MD5;
   ssl_prefer_server_ciphers on;
   ```

3. **安全头**
   - Content-Security-Policy
   - X-Frame-Options: DENY
   - X-Content-Type-Options: nosniff
   - Strict-Transport-Security

### 访问控制

1. **API限流**
   - 全局限流: 100 requests/minute
   - WebSocket限流: 50 connections/minute

2. **用户认证**
   - JWT令牌验证
   - 密码复杂度要求
   - 账户锁定机制

## 更新部署

### 滚动更新
```bash
# 构建新镜像
docker-compose build backend

# 滚动更新
docker-compose up -d --no-deps backend

# 验证更新
curl http://localhost/health
```

### 蓝绿部署
```bash
# 创建新版本
docker tag AISCL-backend:latest AISCL-backend:v2

# 启动新版本
docker-compose -f docker-compose.v2.yml up -d

# 切换流量
# 更新nginx配置指向新版本

# 停止旧版本
docker-compose down
```

## 扩展配置

### 水平扩展
```bash
# 扩展后端服务
docker-compose up -d --scale backend=3

# 负载均衡配置
upstream backend {
    server backend:8000;
    server backend:8001;
    server backend:8002;
}
```

### 垂直扩展
```yaml
# docker-compose.yml
services:
  backend:
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '2.0'
        reservations:
          memory: 1G
          cpus: '1.0'
```

## 灾难恢复

### 数据恢复
```bash
# MongoDB恢复
docker-compose exec mongodb mongorestore /backup/20240101_020000/AISCL

# Redis恢复
docker-compose exec redis redis-cli --rdb /backup/redis.rdb
```

### 服务恢复
```bash
# 完全重启所有服务
docker-compose down
docker-compose up -d

# 逐步恢复
docker-compose up -d mongodb redis minio
docker-compose up -d backend
docker-compose up -d frontend nginx
```

---

## 总结

本部署指南提供了从开发到生产的完整配置说明。关键点：

- ✅ 使用Docker容器化确保环境一致性
- ✅ 多阶段构建优化镜像大小
- ✅ 完善的安全配置和监控
- ✅ 数据库索引和缓存优化
- ✅ 自动化备份和恢复策略

生产环境部署前，请务必：
1. 生成强密码的JWT密钥
2. 配置HTTPS证书
3. 设置适当的资源限制
4. 配置监控和告警
5. 定期备份数据

