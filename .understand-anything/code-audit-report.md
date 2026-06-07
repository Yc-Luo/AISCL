# AISCL 系统代码审查报告

> 生成日期：2026-06-04 | 扫描文件：369 个 | Git commit: `a01f10e`

---

## 严重 (CRITICAL) — 4 项

### C1. 默认 compose 内含明文凭证

**文件**: `docker-compose.yml:59-60, 107-111`

根级 `docker-compose.yml` 硬编码了 MinIO 凭证（`minioadmin` / `minioadmin123`）以及 JWT secret key 默认值（`your-secret-key-change-in-production`, `super-secret-key-change-in-production`）。虽然注释标注了"生产环境请更改"，但开发者直接 `docker compose up` 而不配置 `.env` 时，系统将以已知默认密钥运行。其他 compose 文件（`docker-compose.server.yml`, `docker-compose.images.yml`）正确使用了 `:?` 强制变量校验。

**建议**: 默认 compose 应移除硬编码值，改为强制要求 `.env` 文件或使用 `${VAR:?error}` 语法。

---

### C2. Yjs 房间内存泄漏 — rooms 字典永不清理

**文件**: `backend/app/websocket/yjs_server.py:51, 161-185`

模块级 `rooms: Dict[str, YRoom] = {}`（第 51 行）在用户连接时添加条目（第 161-165 行），但断开时从不移除。`finally` 块（第 176-184 行）保存快照但不会从字典中 pop 房间或销毁它。长期运行后，每个历史 `room_name` 及其 `Y.YDoc`、awareness 状态和 observer 回调将持续占用内存。

**建议**: 在 `finally` 块中检查房间是否还有其他连接，若无则 pop 并调用 `room.destroy()`。

---

### C3. 模拟种子脚本含固定密码

**文件**: `backend/scripts/seed_g1_thesis_proposal_simulation.py:25, 50`

第 50 行定义 `SIM_PASSWORD = "Test123456"`，第 25 行设置默认 `MONGODB_URI`。此密码用于在脚本中创建用户账号。该脚本虽标为开发/测试用途，但固定凭证存在被误用于生产环境的风险。

**建议**: 改为从环境变量读取，或在脚本顶部添加醒目的"仅限开发环境"断言检查。

---

### C4. YRoom 无清理生命周期

**文件**: `backend/app/websocket/yjs_server.py:167, 176-185`

所有用户从 Yjs 房间断开后，`YRoom` 从未从 `rooms` 字典中移除，其内部 `YDoc` 也从未销毁。第 102 行通过 `room.ydoc.observe_update(on_update)` 注册的 observer 同样泄漏。唯一的清理时机是新 WebSocket 连接到已有房间时 — 但没有处理房间空闲后应被驱逐的逻辑。

**建议**: 添加空闲超时驱逐机制，或至少在最后一个用户断开时清理房间。

---

## 警告 (WARNING) — 14 项

### W1. analytics_service.py 使用 print() 代替 logger

**文件**: `backend/app/services/analytics_service.py:901`

`print(f"Keyword extraction error: {e}")` 使用了 `print()` 而非 `logger.error()`，与同文件中其他 catch 块（第 1058, 1212, 1362 行）不一致。`print()` 会绕过日志级别配置和格式化。

---

### W2. 分析聚合任务全部使用 print()

**文件**: `backend/app/tasks/analytics_aggregation.py:12, 16, 18, 29`

后台任务中所有输出均使用 `print()` 而非日志框架。在生产环境中，这些消息不会被集中式日志收集器捕获。

---

### W3. 认证文档字符串声称 bcrypt 但实际使用 pbkdf2_sha256

**文件**: `backend/app/api/v1/auth.py:18`

Docstring 写"Secure password hashing (bcrypt)"，但实际实现使用 `pbkdf2_sha256`（因 Python 3.13+ 兼容性切换，见 `auth_service.py:16` 注释）。文档与实际不符。

---

### W4. CORS allow_origins 与 Socket.IO 分别配置

**文件**: `backend/app/main.py:127-134` 和 `backend/app/websocket/socketio_server.py:15`

FastAPI CORSMiddleware 和 python-socketio AsyncServer 均使用 `settings.CORS_ORIGINS`。CORS 中间件还设置了 `allow_headers=["*"]`（第 132 行），非常宽松。`docker-compose.yml:114` 中 CORS_ORIGINS 包含 7 个来源，开发用合理但生产需收窄。

---

### W5. 顶层 except KeyError: pass 静默吞异常

**文件**: `backend/app/main.py:170-173`

`add_security_headers` 中间件在删除 `Server` 头时静默吞掉 `KeyError`。功能上无害，但 `pass` 无注释会在头部结构意外变化时丢失调试信息。

---

### W6. room_members 和 user_connections 字典无上限

**文件**: `backend/app/websocket/socketio_server.py:29-31`

全局 `user_connections` 和 `room_members` 字典无界增长。虽有 disconnect 清理和 `pop()` 默认值防御异步竞态，但如果 disconnect 事件丢失，仍存在泄漏路径。

---

### W7. web_scraper.py 是完整桩代码

**文件**: `backend/app/services/web_scraper.py:27, 53, 73`

三个 TODO 注释（"Implement Playwright-based scraping"、"Implement proper HTML sanitization"、"Implement Readability algorithm"）表明此服务基本为桩。`scrape_content()` 返回硬编码占位字典。**如果生产环境调用，将静默返回假数据。**

**建议**: 至少添加 guard 抛出 `NotImplementedError`，而非静默返回假数据。

---

### W8. S3 存储未实现会导致崩溃

**文件**: `backend/app/services/storage_service.py:75`

当 `STORAGE_TYPE` 不为 "minio" 时（即设为 "s3"），`self.client` 和 `self.signer_client` 设为 `None`。后续所有方法调用（第 107-284 行）将抛出 `AttributeError: 'NoneType' object has no attribute ...`，**没有任何 None 检查**。

**建议**: 添加 guard 抛出 `NotImplementedError("S3 storage not yet implemented")`。

---

### W9. intervention_service.py 自定义规则未实现

**文件**: `backend/app/services/intervention_service.py:312`

`# TODO: Evaluate custom condition` 加一个裸 `pass`，意味着自定义干预规则被静默忽略 — 不匹配任何条件且永不触发。配置了自定义规则的操作者会困惑。

---

### W10. 存储配额计算是 TODO 桩

**文件**: `backend/app/api/v1/storage.py:243`

`# TODO: Calculate current project/course storage usage` 表示关键的配额强制 API 端点尚未实现。

---

### W11. yjs_server.py 全局 rooms 字典是永久单例

**文件**: `backend/app/websocket/yjs_server.py:51`

`rooms: Dict[str, YRoom] = {}` 是模块级全局变量，跨应用生命周期持续存在。使用 `--reload` 开发时，过期状态可能残留。没有驱逐空闲房间的机制。

---

### W12. handleLocalUpdate ID 生成使用 Math.random（非确定性）

**文件**: `frontend/src/services/sync/SyncServiceYjsProvider.ts:110-111`

操作 ID 使用 `Date.now() + Math.random()`，非加密级随机且仅毫秒精度。在同毫秒内快速连续更新时有碰撞风险。同样模式存在于 `handleAwarenessUpdate`（141 行）和 `sendSyncStep`（225 行）。

---

### W13. 部分 ACK 确认导致操作丢失（数据丢失 bug）

**文件**: `frontend/src/services/sync/SyncService.ts:366-381`

当服务端 ACK 返回 `processed < operations.length` 时，第 373 行抛出错误，**但**第 377-381 行的循环已将批次内**所有**操作标记为已确认。结果是服务端未处理的操作在本地被标记为已确认、不会被重试，造成数据丢失。

此外，第 367 行的 `ack` 解构先检查 `ack.status !== 'success'` 再检查部分处理，而 `socketio_server.py:310` 的 `batch_operations` 处理器在部分操作被拒绝时**始终**返回 `status: "success"`。

**建议**: 将确认循环移到 `processed` 校验之后，仅确认实际被处理的操作。

---

### W14. OperationQueue.confirm() 在回调前删除存储

**文件**: `frontend/src/services/sync/OperationQueue.ts:268-289`

操作在从内存和存储中删除**之后**才触发 `confirmCallback`。如果回调抛出异常，操作已丢失且无法恢复。

---

## 信息 (INFO) — 9 项

### I1. React StrictMode 因 Weave.js 兼容性被禁用

**文件**: `frontend/src/main.tsx:11`

`StrictMode` 被显式注释掉并标注 TODO 等待 Weave.js 更新后重新启用。这意味着 React 双重调用检查在整个应用中失效，副作用 bug 可能被掩盖。

---

### I2. 协作快照 GET 路由使用 project_id 作为通用资源 ID

**文件**: `backend/app/api/v1/collaboration.py:49-51`

注释说明数据库中的 `project_id` 被"用作通用资源 ID"。`get_snapshot` 端点直接传递 `project_id` 给 `CollaborationSnapshot.get_latest(project_id)`，无论快照类型。文档快照和项目快照在 collaboration_snapshot 集合中共享 ID 空间，可能造成冲突。

---

### I3. socketio_server.py 批处理中的裸异常吞没

**文件**: `backend/app/websocket/socketio_server.py:306-307`

`except Exception as e: print(f"Error processing operation in batch: {e}")` 静默吞没所有异常，无结构化日志。

---

### I4. auth_service.py 文档字符串引用 RSA/ECDSA 但使用 HMAC

**文件**: `backend/app/api/v1/auth.py:17`

Docstring 写"JWT-based authentication with RSA/ECDSA signing"，但 `jose` 库实际使用 `HS256`（HMAC-SHA256，对称加密），非非对称签名。

---

### I5. 生产 compose 缺少 .env 文件指引

**文件**: `docker-compose.server.yml:69`

`env_file: ./backend/.env` 引用的文件在 `.gitignore` 中，仓库中不存在。首次使用此 compose 部署时后端将启动失败。`.env.compose.server.example` 提供了正确模板，但没有错误消息引导操作者复制。

---

### I6. operation_dispatcher.py 可能缺失

**文件**: `backend/app/websocket/socketio_server.py:282`

`socketio_server.py` 导入 `app.websocket.operation_dispatcher`，但此文件未在扫描范围内找到。若确实缺失，Socket.IO 服务将在处理操作时崩溃。

---

### I7. docker-compose.yml 以开发模式挂载后端

**文件**: `docker-compose.yml:142-144`

根级 compose 挂载 `./backend:/app` 并使用 `--reload`，这是开发模式配置。直接运行 `docker compose up`（不用生产 compose）将获得热重载行为和更慢的启动速度。

---

### I8. useAuthStore 登录在内存中保留密码

**文件**: `frontend/src/stores/authStore.ts:34`

`login` 函数接收 `password` 参数并传递给 API。虽然在标准做法内，但 API 调用完成后未显式清除闭包中的密码变量，密码字符串在垃圾回收前一直保留在闭包作用域中。

---

### I9. StudentList.tsx 含示例 CSV 密码

**文件**: `frontend/src/components/features/teacher/studentlist/StudentList.tsx:224, 257`

CSV 模板和导入请求的 `default_password` 字段中硬编码了示例凭证（`Password123!`）。虽然作为示例/默认值，但如果未被覆盖可能被用于生产。

---

## 汇总

| 严重度 | 数量 | 关键领域 |
|--------|------|----------|
| 严重   | 4    | 明文凭证、Yjs 房间内存泄漏、模拟脚本固定密码、YRoom 无清理 |
| 警告   | 14   | print() 代 logger、文档不准确、桩代码导致运行时崩溃、部分 ACK 数据丢失 |
| 信息   | 9    | StrictMode 禁用、文档小误差、默认 compose 开发模式、缺失 env 指引 |

---

## 优先修复建议

1. **C2/C4** — Yjs 房间内存泄漏：在 disconnect 时检查房间人数，最后离开时 pop + destroy
2. **W13** — 部分 ACK 数据丢失：将 confirm 循环移至 processed 校验之后，仅确认实际处理的操作
3. **C1** — 明文凭证：默认 compose 改为强制环境变量或要求 .env 文件
4. **W7/W8** — 桩代码应显式失败：添加 guard 抛出 `NotImplementedError`，而非静默返回假数据
5. **I1** — React StrictMode：跟进 Weave.js 更新后重新启用以检测副作用 bug
6. **I6** — 验证 `operation_dispatcher.py` 是否存在，若缺失则阻塞部署
