# AISCL 云服务器压测说明

这组脚本用于在正式教学实验前检查服务器是否能承受多组学生同时访问。默认压测只读取数据，不发送聊天、不写文档、不调用 AI，避免污染实验数据和产生模型费用。

## 1. 前置条件

- 云服务器已经完成部署，前端和后端可以正常访问。
- 至少准备 1 个测试账号，建议使用学生账号。
- 测试账号至少加入 1 个小组项目；如果没有加入项目，需要手动提供 `PROJECT_ID`。
- 压测前先确认不要在正式上课时运行 `class` 或 `limit` 场景。

## 2. 场景设计

| 场景 | 用途 | 并发规模 | 建议使用时机 |
| --- | --- | --- | --- |
| `smoke` | 冒烟测试 | 最高 3 个虚拟用户 | 每次部署后先跑 |
| `pilot` | 小规模预测试 | 最高 30 个虚拟用户 | 预测试前 |
| `class` | 正式课堂规模 | 最高 60 个虚拟用户 | 正式实验前彩排 |
| `limit` | 上限摸底 | 最高 100 个虚拟用户 | 只在非教学时间跑 |

默认通过接口包括：登录、项目列表、项目详情、小组聊天历史、项目文档、项目 Wiki、学生仪表盘、协作快照、探究空间快照。

## 3. 推荐操作方式

优先在本地电脑运行压测，让请求从外部打到云服务器，这比在服务器内部自测更接近学生真实访问。

```bash
cd /path/to/AISCL

docker run --rm -i \
  -v "$PWD/scripts/loadtest:/scripts" \
  -e BASE_URL="http://62.234.69.204" \
  -e TEST_EMAIL="student@example.com" \
  -e TEST_PASSWORD="your-password" \
  -e SCENARIO="smoke" \
  grafana/k6 run /scripts/aiscl-k6-smoke.js
```

如果测试账号没有邮箱登录，可以改用用户名：

```bash
docker run --rm -i \
  -v "$PWD/scripts/loadtest:/scripts" \
  -e BASE_URL="http://62.234.69.204" \
  -e TEST_USERNAME="student001" \
  -e TEST_PASSWORD="your-password" \
  -e SCENARIO="smoke" \
  grafana/k6 run /scripts/aiscl-k6-smoke.js
```

如果需要指定某个小组项目：

```bash
docker run --rm -i \
  -v "$PWD/scripts/loadtest:/scripts" \
  -e BASE_URL="http://62.234.69.204" \
  -e TEST_EMAIL="student@example.com" \
  -e TEST_PASSWORD="your-password" \
  -e PROJECT_ID="replace-with-project-id" \
  -e SCENARIO="pilot" \
  grafana/k6 run /scripts/aiscl-k6-smoke.js
```

## 4. 分阶段执行顺序

先跑冒烟测试：

```bash
SCENARIO=smoke
```

如果没有明显错误，再跑预测试规模：

```bash
SCENARIO=pilot
```

正式实验前再跑课堂规模：

```bash
SCENARIO=class
```

`limit` 只用于摸服务器上限，不建议在已有真实学生数据时频繁运行。

## 5. 可选 AI 压测

默认不压 AI。只有在确认普通接口稳定后，才建议小比例测试 AI 接口。

```bash
docker run --rm -i \
  -v "$PWD/scripts/loadtest:/scripts" \
  -e BASE_URL="http://62.234.69.204" \
  -e TEST_EMAIL="student@example.com" \
  -e TEST_PASSWORD="your-password" \
  -e SCENARIO="smoke" \
  -e INCLUDE_AI="true" \
  -e AI_PROBABILITY="0.02" \
  grafana/k6 run /scripts/aiscl-k6-smoke.js
```

`AI_PROBABILITY=0.02` 表示约 2% 的循环会调用一次 AI。不要直接用高并发压 AI，否则容易触发模型平台限流或产生不必要费用。

## 6. 压测时同步观察服务器

在云服务器上打开另一个终端：

```bash
cd ~/AISCL
docker stats
```

再开一个终端看服务状态：

```bash
cd ~/AISCL
docker compose -f docker-compose.images.yml ps
docker compose -f docker-compose.images.yml logs -f backend nginx
```

重点看这些信号：

- `AISCL-backend`、`AISCL-frontend`、`AISCL-nginx` 不应反复重启。
- 后端内存不应持续上涨不回落。
- `http_req_failed` 最好低于 2%。
- `http_req_duration p(95)` 建议低于 1500ms。
- 后端日志不能出现大量 500、数据库连接失败或超时。

## 7. 结果判断

可以进入下一步教学实验的最低标准：

- `smoke` 和 `pilot` 都通过。
- `http_req_failed < 2%`。
- `p(95) < 1500ms`，如果服务器配置较低，课堂前至少应稳定低于 2500ms。
- Docker 容器没有重启。
- Mongo、Redis、Qdrant、MinIO 没有明显错误日志。

如果 `pilot` 都不稳定，优先处理服务器内存、后端日志错误、数据库连接和 Nginx 转发配置，不要直接进入正式实验。
