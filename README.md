# AISCL 协作学习系统

AISCL 是面向教学实验开发的 AI 支持协作学习系统。系统以班级、小组项目和开放性任务为组织单元，整合协作文档、深度探究空间、项目 Wiki、资源库、小组聊天、AI 导师、多智能体支架、学习仪表盘和研究数据导出，用于支持学生在人智协同环境中开展协作探究、论证建构与过程反思。

AISCL 的含义是 AI-supported Collaborative Learning，命名来源于 CSCL。当前仓库是系统的可部署版本，README 以运行、部署和实验准备为主，不作为论文正文。

## 1. 当前能力

### 学生端

- 项目工作台：以小组项目为入口，集成文档、深度探究、资源库、项目 Wiki、浏览器、AI 导师和学习仪表盘。
- 协作文档：基于 TipTap，支持富文本编辑、表格、图片、下划线、评论、保存和项目说明文档导入。
- 深度探究空间：支持主张、证据、反论点、反驳等论证节点，支持将探究节点沉淀到项目 Wiki。
- 项目 Wiki：支持查看、搜索、手动创建，文档选区、资源和探究节点均可加入 Wiki。
- 小组聊天：支持同伴消息、AI 角色提及、AI 增量流式回复和本轮编排摘要。
- AI 导师：支持个人化对话，显示本轮主要视角、处理摘要和最终回答。
- 资源库：支持文件上传、下载、查看，并可将资源加入 Wiki。

### 教师端

- 班级管理：支持班级创建、邀请码、学生管理和项目组织。
- 小组管理：项目对应班级内小组，教师可创建小组并配置项目说明。
- 项目说明：支持结构化任务说明，包括任务背景、核心问题、协作要求、提交成果和评价要点，并传递到学生端文档。
- 实验控制：按班级或项目应用实验模板，配置多智能体支架、协作过程支架、阶段序列与导出方案。
- 数据导出：支持研究健康检查、研究事件、组阶段特征、LSA/HMM 序列、群聊转录和 AI 导师转录导出。

### 管理员端

- 用户管理：创建和管理管理员、教师、学生账号。
- 系统配置：设置存储、成员数、文件大小等运行参数。
- 对话模型配置：通过 `llm_*` 配置 AI 导师、小组群聊和多智能体回复使用的 LLM。
- 向量模型配置：通过 `embedding_*` 配置项目 Wiki、资源库和 RAG 语义检索使用的 Embedding 模型。
- 研究配置：维护实验模板、四类智能体角色、规则集、多智能体编排和发布快照。

### AI 与支架

系统当前统一使用四类研究型 AI 角色：

- 资料研究员：提供资料线索、出处支持、概念解释和背景知识。
- 观点挑战者：提出反例、替代解释、逻辑质疑和观点比较。
- 反馈追问者：追问证据、评价标准、修订依据和表达清晰度。
- 问题推进者：澄清任务目标、推进阶段转换、拆解下一步行动。

多智能体编排先进行 graph 路由和子代理选择，再决定是否进行角色感知 RAG 检索。AI 回答会尽量显示主要视角、选择依据、编排摘要和引用来源。

## 2. 技术栈

### 前端

- React 18
- TypeScript
- Vite 5
- Tailwind CSS
- TipTap 3
- React Flow
- Yjs
- Socket.IO Client
- Zustand
- Recharts

### 后端

- Python 3.12
- FastAPI
- Uvicorn
- Beanie + Motor
- MongoDB 7
- Redis 7
- MinIO
- Qdrant
- LangChain / LangGraph
- OpenAI-compatible LLM API
- MiniMax Embedding API

### 部署

- Docker Compose
- Nginx
- MongoDB volume
- Redis volume
- MinIO volume
- Qdrant volume

## 3. 目录结构

```text
AISCL_main-0110/
├── backend/                         # FastAPI 后端
├── frontend/                        # React 前端
├── nginx/                           # Nginx 反向代理配置
├── shared/                          # 共享资源
├── Docs/                            # 实验准备、系统改造和测试记录
├── docker-compose.yml               # 本地开发/测试编排
├── docker-compose.experiment.yml    # 本地实验试跑编排
├── docker-compose.server.yml        # 服务器部署编排
├── .env.compose.server.example      # 服务器 compose 变量模板
├── package.json
└── README.md
```

## 4. 本地运行

推荐使用 Docker Compose，避免本地 Python 和 Node 依赖差异。

```bash
docker compose -f docker-compose.experiment.yml up -d --build
```

默认访问地址：

- 系统入口：`http://localhost:8888`
- 前端容器：`http://localhost:3000`
- 后端 API：`http://localhost:8000`
- MinIO Console：`http://localhost:9001`
- Qdrant：`http://localhost:6333`

健康检查：

```bash
curl http://localhost:8888/health
curl http://localhost:8000/health
docker compose -f docker-compose.experiment.yml ps
```

停止服务：

```bash
docker compose -f docker-compose.experiment.yml down
```

注意：不要随意加 `-v`，否则会删除 MongoDB、MinIO、Redis 和 Qdrant 数据卷。

## 5. 服务器部署

### 5.1 准备服务器

服务器建议配置：

- Ubuntu 22.04 或 24.04
- 2 核 CPU 以上
- 4 GB 内存以上，建议 8 GB
- 40 GB 磁盘以上
- 已安装 Docker 与 Docker Compose Plugin
- 防火墙开放 `80`，如启用 HTTPS 还需开放 `443`

### 5.2 拉取代码

```bash
git clone git@github.com:Yc-Luo/AISCL.git
cd AISCL
```

如果服务器没有配置 SSH key，也可以使用 HTTPS 地址。

### 5.3 配置环境变量

复制服务器模板：

```bash
cp .env.compose.server.example .env
cp backend/.env.server.example backend/.env
```

至少需要修改：

```env
# .env
AISCL_HTTP_PORT=80
PIP_INDEX_URL=https://pypi.org/simple
MINIO_ROOT_USER=replace-minio-root-user
MINIO_ROOT_PASSWORD=replace-minio-root-password
```

```env
# backend/.env
SECRET_KEY=replace-with-at-least-32-characters
JWT_SECRET_KEY=replace-with-at-least-32-characters
MINIO_ACCESS_KEY=replace-minio-root-user
MINIO_SECRET_KEY=replace-minio-root-password
MINIO_PUBLIC_ENDPOINT=your-domain-or-ip
CORS_ORIGINS=["http://your-domain-or-ip","https://your-domain"]
```

`MINIO_ROOT_USER` 必须与 `backend/.env` 中的 `MINIO_ACCESS_KEY` 一致，`MINIO_ROOT_PASSWORD` 必须与 `MINIO_SECRET_KEY` 一致。

`MINIO_PUBLIC_ENDPOINT` 用于生成浏览器可访问的文件上传/下载签名链接。通过 `nginx` 部署时填写公网域名或 IP 本身即可，例如 `62.234.69.204`；不要填写 `http://`、`https://`、`:9000` 或 `/aiscl-files`。如果使用非 80 端口访问系统，例如 `8888`，则填写 `62.234.69.204:8888`。

如果服务器构建后端时出现 `No matching distribution found`、`Could not find a version` 等 Python 依赖解析问题，通常是 pip 源访问不稳定或镜像未同步。可以在根目录 `.env` 中改用国内镜像：

```env
PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
```

或：

```env
PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple
```

### 5.4 启动服务

```bash
docker compose -f docker-compose.server.yml up -d --build
```

查看状态：

```bash
docker compose -f docker-compose.server.yml ps
docker compose -f docker-compose.server.yml logs -f backend
```

访问：

- `http://服务器公网IP`
- 或绑定域名后的 `http://your-domain`

### 5.5 更新部署

```bash
git pull
docker compose -f docker-compose.server.yml build backend frontend
docker compose -f docker-compose.server.yml up -d backend frontend nginx
```

如修改了基础设施配置，再执行：

```bash
docker compose -f docker-compose.server.yml up -d
```

## 6. 模型配置

系统将模型拆成两类，建议分别配置。

### 6.1 对话模型

管理员端路径：

```text
管理员端 -> 系统配置 -> 对话模型服务
```

对应配置键：

- `llm_provider`
- `llm_key`
- `llm_base_url`
- `llm_model`
- `user_custom_models`

用途：

- AI 导师
- 小组聊天中的 AI 回复
- 多智能体 graph 编排
- 需要生成自然语言回答的功能

MiniMax OpenAI 兼容接口示例：

```env
llm_provider=openai_compatible
llm_base_url=https://api.minimaxi.com/v1
llm_model=MiniMax-M2.7
llm_key=你的对话模型 API Key
```

### 6.2 Embedding 模型

管理员端路径：

```text
管理员端 -> 系统配置 -> 向量模型服务
```

对应配置键：

- `embedding_provider`
- `embedding_key`
- `embedding_base_url`
- `embedding_model`
- `embedding_type`
- `embedding_group_id`

用途：

- 项目 Wiki 语义检索
- 资源库向量化
- RAG 检索增强
- AI 回答引用来源

MiniMax Embedding 示例：

```env
embedding_provider=minimax
embedding_base_url=https://api.minimax.chat/v1/embeddings
embedding_model=embo-01
embedding_type=db
embedding_key=你的 Embedding API Key
embedding_group_id=
```

后端读取顺序：

1. 优先读取管理员端数据库中的 `embedding_*` 配置。
2. 如果管理员端未配置，则读取 `backend/.env` 中的 `MINIMAX_*` 配置。
3. 如果 `MINIMAX_API_KEY` 为空，会回退到 `OPENAI_API_KEY`，但正式实验建议单独配置 `embedding_key`。

## 7. RAG 与项目 Wiki

当前实现采用“项目 Wiki + 外部 Embedding + Qdrant”的轻量方案，不在服务器内安装本地大模型或本地向量模型。

已实现：

- `wiki_items` 数据模型
- Wiki 创建、更新、列表、搜索 API
- 学生端“项目 Wiki”页
- 文档选区加入 Wiki
- 资源加入 Wiki
- 探究节点加入 Wiki
- 教师项目说明自动沉淀为任务说明类 Wiki 条目
- RAG 检索事件记录：`rag/retrieval_requested`、`rag/citation_attached`
- Wiki 事件记录：`wiki_item_created`、`wiki_item_updated`、`wiki_item_quoted`

RAG 检索顺序会结合：

- Qdrant 向量检索
- Wiki 关键词检索
- 文档上下文
- 近期聊天上下文

如果 Embedding API 未配置，系统仍可使用 Wiki 关键词检索，但语义检索能力会下降。

## 8. 研究数据导出

教师端项目仪表盘已支持研究数据导出。主要接口包括：

- `GET /api/v1/analytics/projects/{project_id}/research-health`
- `GET /api/v1/analytics/projects/{project_id}/research-events`
- `GET /api/v1/analytics/projects/{project_id}/group-stage-features`
- `GET /api/v1/analytics/projects/{project_id}/lsa-ready`
- `GET /api/v1/analytics/projects/{project_id}/group-chat-transcripts`
- `GET /api/v1/analytics/projects/{project_id}/ai-tutor-transcripts`

数据用途：

- `group-stage-features`：用于小组阶段特征矩阵和 K-means。
- `lsa-ready`：用于 LSA、HMM 等序列分析准备。
- `research-events`：用于完整行为事件留档。
- `group-chat-transcripts`：用于小组聊天内容分析。
- `ai-tutor-transcripts`：用于个人 AI 导师对话内容分析。

研究事件域包括：

- `dialogue`
- `scaffold`
- `inquiry_structure`
- `shared_record`
- `stage_transition`
- `wiki`
- `rag`

## 9. 正式实验前检查

上线前至少完成以下检查：

- 管理员账号可登录。
- 教师账号可创建班级。
- 学生账号可进入班级和小组项目。
- 教师可创建项目说明并同步到学生端文档。
- 学生端文档可编辑、保存、插入表格和图片。
- 小组内两个学生之间聊天消息可同步。
- 小组聊天中 `@资料研究员`、`@观点挑战者`、`@反馈追问者`、`@问题推进者` 可触发对应 AI。
- AI 导师可流式回答，并显示主要视角和处理摘要。
- 项目 Wiki 可创建、搜索、从文档/资源/探究节点加入。
- 资源上传、下载和查看可用。
- `research-health`、`group-stage-features`、`lsa-ready` 可正常导出。
- 服务器重启后 MongoDB、MinIO、Qdrant 数据不丢失。

详细操作可参考：

- `Docs/正式账号人工彩排_10分钟操作版.md`
- `Docs/服务器部署检查清单_当前版.md`
- `Docs/实验数据导出与留档流程_当前版.md`

## 10. 安全与数据注意事项

- 不要提交 `backend/.env`、根目录 `.env`、数据库 dump、MinIO 文件和 Docker volume。
- GitHub 仓库应只保存代码、模板和说明文件，不保存测试数据。
- 当前注册接口仍允许提交角色字段，受控实验环境可用；公网部署前建议限制注册入口，或仅由管理员创建教师和学生账号。
- API Key 应放在 `backend/.env` 或管理员端系统配置中，不要写入 README、截图或论文附录。
- 真实实验前建议清理本地测试数据，或使用全新的服务器数据卷。

## 11. 常用命令

本地实验编排：

```bash
docker compose -f docker-compose.experiment.yml up -d --build
docker compose -f docker-compose.experiment.yml ps
docker compose -f docker-compose.experiment.yml logs -f backend
```

服务器编排：

```bash
docker compose -f docker-compose.server.yml up -d --build
docker compose -f docker-compose.server.yml ps
docker compose -f docker-compose.server.yml logs -f backend
```

只重建应用层：

```bash
docker compose -f docker-compose.server.yml build backend frontend
docker compose -f docker-compose.server.yml up -d backend frontend nginx
```

健康检查：

```bash
curl http://localhost:8888/health
curl http://localhost:8000/health
```

## 12. 当前边界

- 系统是教学实验原型，不是通用商业 SaaS。
- 移动端可访问，但主要交互仍面向电脑浏览器。
- RAG 依赖外部 Embedding API 和 Qdrant；未配置 Embedding 时会退化为 Wiki 与关键词检索。
- 学习分析仪表盘默认不主动调用 LLM，避免实验期间产生额外费用和延迟；如确需 LLM 生成分析建议，可设置 `ANALYTICS_LLM_ENABLED=true`。
- 公网正式部署建议补充 HTTPS、域名、访问控制、备份策略和日志轮转。
