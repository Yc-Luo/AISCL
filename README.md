# AISCL 人智协同学习系统

AISCL 是一个面向项目式与探究式学习场景的人智协同学习原型系统。系统将协作文档、深度探究画布、AI 对话支持、学习仪表盘、行为跟踪与规则干预整合到同一工作空间中，用于支持学习者围绕共同任务持续开展资料整理、论证建构、过程反思与协作调节。

本仓库当前代码已经实现了一个可运行的协同学习平台，但其 README 长期未随实现同步更新。本文档仅描述**代码中已经可以确认的功能、技术栈与运行方式**，并补充与论文第五、六章相关的研究适配说明。

## 1. 当前系统定位

系统当前并不是单一的“AI 问答工具”或“协作文档编辑器”，而是由以下几类能力共同组成：

- 协作工作台：以项目为单位组织文档、探究空间、资源、浏览器、AI 区域和学习仪表盘。
- 深度探究空间：支持主张、证据、反论点、反驳等节点化论证建构，并提供 AI 辩难与聚类辅助。
- AI 学习支持：同时提供自由对话型 AI 助手与对话式 AI 导师，支持总结、知识图谱、优化建议、恶魔代言人和聚类分析等情境化动作。
- 过程记录与分析：记录行为流、活动日志、心跳数据、探究快照和 AI 会话，可聚合为项目仪表盘。
- 规则化干预：后端已具备基于沉默、关键词、情绪词等条件触发 AI 干预的规则机制。

## 2. 已实现的核心模块

### 2.1 前端功能模块

前端采用 React + TypeScript + Vite，主要模块如下：

- 项目工作台：`frontend/src/pages/student/ProjectWorkspace.tsx`
  - 集成文档、探究空间、资源库、网页标注、AI、学习仪表盘、通知与设置。
- 协作文档：`frontend/src/components/features/student/document/*`
  - 基于 TipTap 的富文本协作编辑、评论、远程光标等。
- 深度探究空间：`frontend/src/modules/inquiry/*`
  - 采用 React Flow 组织论证节点与边；
  - 支持灵感墙与论证画布双视图；
  - 支持 AI 辩难（`devil_advocate`）与智能聚类（`inquiry_clustering`）。
- AI 交互：
  - `AIAssistant.tsx`：悬浮式情境助手，支持总结、知识图谱、优化建议等动作；
  - `AITutor.tsx`：项目内对话式 AI 导师，支持多轮会话、历史会话和材料导入。
- 学习仪表盘：`LearningDashboard.tsx`
  - 展示 4C 能力雷达图、活动趋势、知识图谱、互动网络与学习建议。
- 行为跟踪：
  - `TrackingService.ts`
  - `useBehaviorTracking.ts`
  - `useActivityTracking.ts`

### 2.2 后端服务模块

后端采用 FastAPI，服务入口为 `backend/app/main.py`。已接入的 API 路由包括：

- 认证与用户：`auth`、`users`
- 项目与任务：`projects`、`courses`、`tasks`、`calendar`
- 文档与评论：`documents`、`comments`
- 协作与聊天：`collaboration`、`chat`
- AI 能力：`ai`
- 深度探究：`inquiry`
- 行为分析：`analytics`
- 网页标注：`web_annotations`
- 管理后台：`admin`
- 存储：`storage`

### 2.3 实时协作与状态同步

系统当前实现了两类实时机制：

- Socket.IO：用于聊天、房间加入/离开、通知类消息；
- Y.js WebSocket：用于协作文档与探究空间的共享状态同步。

统一同步由 `frontend/src/services/sync/SyncService.ts` 负责，包含：

- 连接管理；
- 房间订阅；
- 操作队列；
- 本地缓存与多标签页协调。

### 2.4 数据记录与分析基础

当前系统已经具备两类关键数据记录能力：

- `activity_logs`
  - 面向业务事件；
  - 记录编辑、创建、评论、上传、更新等高价值动作；
  - 通过 `ActivityService` 进行节流写入。
- `behavior_stream` 与 `heartbeat_stream`
  - 面向高频行为流；
  - 支持页面进入/离开、可见性切换、滚动、鼠标活动、标签切换等行为记录；
  - 由 `/analytics/behavior/batch` 与 `/analytics/heartbeat` 接口接收。

此外，探究空间快照保存在 `inquiry_snapshots`，AI 干预规则保存在 `ai_intervention_rules`。

### 2.5 已实现的 AI 能力

当前 AI 层主要提供三类能力：

- 对话能力：`/api/v1/ai/chat` 与 `chat_stream`
- 情境动作：`/api/v1/ai/action`
  - `summarize`
  - `knowledge_graph`
  - `optimize`
  - `devil_advocate`
  - `inquiry_clustering`
- 规则干预：`InterventionService`
  - 当前已实现的触发类型为 `silence`、`emotion`、`keyword`、`custom`

后端同时接入了：

- `langchain`
- `langgraph`
- `langchain-openai`
- `openai`
- `sentence-transformers`

并提供基于 `rag_service` 与 `agent_service` 的扩展入口。

## 3. 技术栈

### 前端

- React 18
- TypeScript
- Vite 5
- Tailwind CSS 3
- TipTap 3
- React Flow
- Excalidraw
- Yjs
- Socket.IO Client
- Zustand
- Recharts

### 后端

- Python 3.12
- FastAPI
- Uvicorn
- Beanie + Motor + MongoDB
- Redis
- MinIO
- Python Socket.IO
- Ypy WebSocket
- LangChain / LangGraph / OpenAI

### 基础设施

- Docker Compose
- Nginx
- MongoDB 7
- Redis 7
- MinIO

## 4. 运行方式

### 4.1 推荐方式：Docker Compose

在仓库根目录执行：

```bash
docker-compose up -d --build
```

默认端口：

- 前端容器：`http://localhost:3000`
- 后端 API：`http://localhost:8000`
- Nginx 统一入口：`http://localhost:8888`
- MinIO API：`http://localhost:9000`
- MinIO Console：`http://localhost:9001`

容器编排已包含：

- `mongodb`
- `redis`
- `minio`
- `backend`
- `frontend`
- `nginx`

### 4.2 本地开发方式

#### 前端

根目录脚本使用 `pnpm`：

```bash
pnpm install
pnpm dev:frontend
```

或在 `frontend/` 目录执行：

```bash
pnpm install
pnpm dev
```

Vite 本地开发端口默认为：

- `http://localhost:5173`

#### 后端

在 `backend/` 目录执行：

```bash
poetry install
poetry run uvicorn app.main:app --reload
```

### 4.3 必要环境变量

后端配置由 `backend/app/core/config.py` 管理。至少需要关注：

```env
SECRET_KEY=replace-with-32-char-secret
JWT_SECRET_KEY=replace-with-32-char-secret
MONGODB_URI=mongodb://localhost:27017/AISCL
MONGODB_DB_NAME=AISCL
REDIS_URL=redis://localhost:6379/0
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
MINIO_BUCKET_NAME=AISCL-files
LLM_PROVIDER=deepseek
OPENAI_API_KEY=
DEEPSEEK_API_KEY=
OPENAI_MODEL=gpt-4o
DEEPSEEK_MODEL=deepseek-chat
```

前端环境变量主要包括：

```env
VITE_API_BASE_URL=
VITE_WS_URL=
VITE_SOCKETIO_URL=
```

如果通过 Nginx 统一访问，前端可保持空的 `apiBaseUrl`，由反向代理处理。

## 5. 与论文第五、六章的关系

当前系统已经具备第五章可直接写入的几个实现基础：

- 统一工作台能够承载任务组织、探究建构、AI 支持和仪表盘反馈；
- 深度探究空间已经实现主张、证据、反论点、反驳等节点化组织；
- AI 助手与 AI 导师已经提供情境化支持入口；
- 行为流、活动日志、探究快照和 AI 会话已形成基本可追踪的数据链；
- 规则化干预已经具备后端模型和执行入口。

这意味着它可以作为第五章“支架原型系统”的现实基础，而不是从零开始的概念设计。

## 6. 面向当前研究仍需补强的部分

如果系统要严格对齐论文第五、六章，当前还需要补强四类能力。

### 6.1 显式化双层支架逻辑

当前 AI 支持更接近“通用助手 + 通用导师 + 两类探究动作”，尚未显式落实为论文中的双层支架体系：

- 多智能体支架
- 协作过程支架

需要进一步把支架角色、支架触发、支架输出和支架渐退逻辑显式建模。

### 6.2 扩展干预触发规则

当前 `ai_intervention_rules` 主要支持：

- 沉默触发
- 关键词触发
- 情绪词触发

若要服务论文中的批判性思维支架，还需要增加更贴近教学过程的触发条件，例如：

- 证据缺失
- 反驳缺失
- 修订停滞
- 观点单一化
- 责任外移

### 6.3 补充结构化过程编码

当前系统已经能记录行为流和活动日志，但要支持第六章预设的：

- `K-means`
- `LSA`
- `HMM`
- `ONA`

还需要更细的结构化记录字段，例如：

- 小组编号与阶段编号
- 发言主体类型与角色类型
- 发言序列号与回复对象
- 支架触发来源与触发时间
- 证据引用标记与来源类型
- 反驳、修订、责任回顾等关键过程编码

### 6.4 增强可导出分析单元

为了服务论文中的过程分析，系统应能够稳定导出：

- 小组—阶段聚合特征矩阵（用于 `K-means`）
- 显性行为序列（用于 `LSA`）
- 状态观测序列（用于 `HMM`）
- 有序联结矩阵（用于 `ONA`）

当前底层数据链已有基础，但导出单元和编码标准还需要按研究方案进一步固定。

## 7. 目录结构

```text
AISCL_main-0110/
├── backend/                # FastAPI 后端
├── frontend/               # React + TypeScript 前端
├── nginx/                  # 反向代理配置
├── shared/                 # 共享资源
├── docker-compose.yml      # 容器编排
├── DEPLOYMENT_GUIDE.md     # 部署说明
└── README.md               # 当前文档
```

## 8. 当前文档的使用边界

本 README 的目标是：

- 准确描述代码中已能确认的实现；
- 为第五章撰写与系统调整提供统一事实基线；
- 减少旧 README 中“功能泛化、技术栈滞后、启动方式不一致”的问题。

它不承担论文正文写作功能。论文中的系统表述应以教育设计与研究逻辑为中心，而不是直接照搬本 README 的技术说明。
