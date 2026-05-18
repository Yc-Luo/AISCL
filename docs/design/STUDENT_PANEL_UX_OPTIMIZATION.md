# 学生端 UX 优化方案

## 一、架构现状

学生端核心入口为 `ProjectWorkspace.tsx`（973 行，19 个 useState + 15 个 useEffect），当前为四层结构：

```
┌─────────────────────────────────────────────────┐
│  Header (logo / 通知铃铛 / 头像 / 侧栏切换按钮)    │
├────────┬───────────────────────────┬─────────────┤
│ 左栏   │ 阶段条 + 6 Tab + 内容区      │ 右栏        │
│ ┌────┐ │ ┌──┬──┬──┬──┬──┬──┐      │ ┌─────────┐ │
│ │小组 │ │ │文│深│资│Wi│AI│仪│      │ │成员│聊天 │ │
│ │任务 │ │ │档│度│源│ki│导│表│      │ │列表│群组 │ │
│ │日历 │ │ │  │探│库│  │师│盘│      │ │    │教师 │ │
│ └────┘ │ └──┴──┴──┴──┴──┴──┘      │ │    │支持 │ │
└────────┴───────────────────────────┴─────────────┘
              ┌──────┐
              │AI 助理│ (浮动可拖拽)
              └──────┘
```

**问题**：1 Header + 2 侧栏 × 3 子面板 + 6 Tab + 1 浮动 AI = **15 个独立交互区**，信息密度过高，对中学生群体认知负荷大。

---

## 二、布局简化方案（核心变更）

### 2.1 目标布局

```
折叠态                                            展开态
┌──┬────────────────────────┬──┐    ┌─────────┬──────────────────┬─────────┐
│📋│                        │🔔│    │ 碳中和..│                  │ 🔔  👤  │
│  │                        │💬│    │目标:... │                  │ 聊天|.. │
│  │      中央内容区          │  │    │ ───────│                  │         │
│3 │                        │🆘│    │●●●+    │   中央内容区      │ ...     │
│  │                        │  │    │任务看板 │                  │         │
│  │                        │👤│    │待办(3) │                  │         │
│  │                        │  │    │进行中..│                  │         │
└──┴────────────────────────┴──┘    │─────── │                  │         │
  48px                    48px     │⚙归档   │                  │         │
                                   └─────────┴──────────────────┴─────────┘
                                            ┌──────────┐
                                            │ 🤖 AI助理 │ 浮动右下角
                                            └──────────┘
```

### 2.2 Header 取消，元素重新分配

| Header 原元素 | 去向 | 说明 |
|--------------|------|------|
| AISCL logo + 协作学习系统 badge | 左栏顶部（小组名上方），小号展示 | 品牌标识保留但弱化 |
| `☰` 左栏折叠按钮 | 改为左栏边缘拖拽手柄 + 折叠态图标列 | 点击图标列展开 |
| `👥` 右栏折叠按钮 | 改为右栏边缘拖拽手柄 + 折叠态图标列 | 同上 |
| NotificationCenter 铃铛 | 右栏顶部（折叠/展开态均可见） | 通过图标列在折叠态可见 |
| 头像 → 设置入口 | 右栏顶部 | 与铃铛并排 |

### 2.3 侧栏折叠为图标列

左右侧栏折叠后不消失，而是收缩为 48–56px 图标列：

**左栏折叠态图标列**：

| 图标 | 含义 | 数字/红点 |
|------|------|-----------|
| 📋 | 任务看板 | 红色数字 = 我负责的进行中任务数 |

**右栏折叠态图标列**：

| 图标 | 含义 | 数字/红点 |
|------|------|-----------|
| 🔔 | 通知中心 | 红色数字 = 未读通知数 |
| 💬 | 群组聊天 | 红色数字 = 未读消息数（含 @提及） |
| 🆘 | 教师支持 | 橙色圆点 = 教师有新回复 |
| 👤 | 个人设置 | 无 |

**交互规则**：
- 数字用 `absolute` 定位在图标右上角，`bg-red-500 text-white rounded-full text-[9px] min-w-[16px] h-4`
- hover 图标 → tooltip 显示名称
- 点击图标 → 侧栏展开并切换到对应 Tab/面板
- 拖拽左右栏边缘 → 调整宽度（左右栏均支持，复用右栏现有拖拽逻辑）

### 2.4 左栏：2 面板整合为 1 面板

**移除**：日历 Tab（`CalendarView`）。日历事件的截止日期信息已在 Kanban 卡片中展示，且日历与任务属于两个独立数据模型却无联动，对学生协作价值极低。

**保留整合为单一面板**：

```
┌──────────────┐
│ AISCL 协作学习 │  ← logo（小号）
│ 碳中和研究小组  │  ← 可双击编辑名称（组长）
│ 目标：探究碳中..│  ← 双击编辑，收起/展开
├──────────────┤
│ ● ● ●  +     │  ← 在线成员头像堆叠（绿点=在线），末尾+号邀请
│ 张三 李四 王五 │
├──────────────┤
│ 任务看板      │  ← 主内容区
│ 待办 (3)     │
│   □ 找IPCC数据│
│ 进行中 (1)   │
│ 已完成 (2)   │
├──────────────┤
│ ⚙ 提交归档    │  ← 仅组长可见
└──────────────┘
```

**移除内容**：
- `ProjectInfo` 中"最近动态"列表 → 低价值信息，改为任务看板顶部的 "X 项待办，Y 项进行中" 摘要
- `CalendarView` 完整组件 → 移除
- `MemberList`（右栏独立 Tab）→ 合并到左栏头像

### 2.5 右栏：3 Tab 减为 2 Tab

| 原来 | 调整后 |
|------|--------|
| 成员列表 | **移除**（合并到左栏头像堆叠） |
| 群组聊天 | 保留 |
| 教师支持 | 保留 |

右栏顶部固定行（不随 Tab 切换隐藏）：

```
┌──────────────────┐
│ 🔔(2)     👤 张三 │  ← 铃铛带未读红点 + 头像→设置入口
├──────────────────┤
│ 聊天 │ 教师支持   │  ← Tab 切换
└──────────────────┘
```

### 2.6 6 个主 Tab 重命名

当前命名偏工具化/技术化，改为更符合协作学习语境：

| # | 当前名称 | 新名称 | 理由 |
|---|---------|--------|------|
| 1 | 文档 | **协作文档** | 强调多人实时协作，区别于普通编辑器 |
| 2 | 深度探究 | **论证空间** | "探究"抽象，"论证空间"更直观——学生在此构建论点-证据-反驳结构 |
| 3 | 资源库 | **小组资料** | "资源库"像图书馆，"小组资料"有归属感 |
| 4 | 项目 Wiki | **知识沉淀** | "Wiki"是技术术语，中学生不一定理解 |
| 5 | AI 导师 | **AI 对话** | 与浮动 AI 助理区隔——此 Tab 用于沉浸式深度对话 |
| 6 | 仪表盘 | **学习概览** | "仪表盘"偏工具化且与教师端重名 |

---

## 三、AI 双入口重新定位

### 3.1 区分定位

| | AI 助理 (浮动) | AI 对话 (Tab) |
|---|---|---|
| 定位 | 即时助手，看哪问哪 | 沉浸式深度对话，个人探讨 |
| 触发 | 右下角浮动气泡，始终可见 | 切换到第 5 个 Tab |
| 上下文 | 当前 Tab + 阶段 + 选中内容 | 完整对话历史 + 图片上传 + 角色推理 |
| 对话轮次 | 3–5 轮快速问答 | 不限轮次 |
| 适用场景 | "这个证据怎么用？" | "帮我全面梳理碳中和论证的各个维度" |

### 3.2 AI 助理增加上下文感知

当前 `AIAssistant` 只接收 `projectId` 和 `experimentVersion`，不知道用户当前在哪个 Tab、在看什么。需注入以下上下文（按优先级）：

| 优先级 | 上下文 | 获取方式 | 示例 |
|--------|--------|----------|------|
| P0 | 当前 Tab | `useContextStore.activeTab` | "你正在查看协作文档，需要我帮你梳理结构吗？" |
| P0 | 当前阶段 | `useContextStore.currentStage` | "当前是证据探究阶段，有什么证据想让我帮你分析？" |
| P1 | 文档选中文本 | `window.getSelection()` 或 store | "对选中的这段论点有什么疑问？" |
| P1 | 探究画布选中节点 | `useInquiryStore` selectedNode | "这个证据节点你想如何与主张关联？" |
| P2 | 聊天最近消息摘要 | 取最近 3 条非系统消息 | "小组刚才在讨论数据来源，我可以帮你搜索相关资料" |

**实现约束**：
- 只传结构化上下文元数据（Tab 名、阶段名、选中文本），**不传页面全文**
- 用户主动选中文本才算"同意分享"
- 根据上下文动态生成 3 条 suggested questions

### 3.3 双入口衔接

AI 助理对话中增加 "深入探讨 →" 按钮：

1. 将当前助理对话最近 3 轮消息转移到 AI 对话 Tab
2. 自动切换到 AI 对话 Tab
3. AI 对话预填上下文并自动发起首轮消息

---

## 四、协作核心改进（P0）

### P0-1. 探究画布缺乏实时同步

**现状**：`InquirySpace` 的 ReactFlow 画布是单用户编辑。`saveToBackend()` 存快照到后端，**不通过 Y.js 同步**。学生 A 添加节点，学生 B 完全看不到——与文档区的实时协作形成强烈对比。

**建议**：先实施乐观锁防丢失，再渐进到实时同步。

| 阶段 | 方案 | 效果 |
|------|------|------|
| 第一步 | 保存前比对 `updated_at` 版本号，远端有更新则弹出 diff 预览 | 防数据丢失 |
| 第二步 | Y.js awareness 同步节点位置 | 实时看到对方操作 |
| 第三步 | 全量 CRDT 同步（Y.Map + Y.Array） | 完全实时协作 |

**防呆**：
- "保存"按钮旁显示上次保存时间和保存者
- 每次节点增删改后 5 秒防抖自动保存
- `beforeunload` 事件阻止关闭（如果 `isDirty` 为 true）

### P0-2. 任务看板增加负责人

**现状**：`TaskKanban` 任何人都可以创建、拖动、删除任务，无负责人字段。3 人小组同时创建任务时互相不知道谁在做什么。

**建议**：
- 任务卡片增加负责人头像（创建时默认 assign 给自己，可点选切换成员）
- 看板顶部显示 "我的任务：2 项" 筛选计数
- 课程任务（`source_type === 'course_task_release'`）标注 "全组共同任务"
- 删除他人任务时二次确认 "该任务由 XXX 负责，确定删除？"

**依赖**：Task schema 新增 `assignee` 字段（后端）。

### P0-3. 成员在线状态

**现状**：`ProjectInfo.tsx` 第 126 行 `const online = false // TODO`。成员不知道谁在线。

**建议**：
- 利用 syncService WebSocket 连接 + `user_joined`/`user_left` 事件建立 `usePresenceStore`
- 成员头像右下角绿点（在线）/灰点（离线）
- 30 秒超时后再标记离线（避免短暂断网误判）
- 在线人数为 0（只有自己）时聊天区顶部显示提示

---

## 五、防呆与极端操作保护（P1）

### P1-1. 阶段切换增加防呆确认

**现状**：组长点阶段按钮 → 直接切换，无确认。误触会立即影响全组。

**建议**：
- 组长点阶段按钮 → 弹出确认对话框："确定要将小组阶段从 X 切换到 Y 吗？"
- `stageChanging` 期间禁用所有阶段按钮防止快速连点（已实现）
- 切换前通过 WebSocket 广播 "即将切换" 通知，给其他成员缓冲

### P1-2. 归档操作保护

**现状**：确认归档后 `window.location.reload()`，丢失所有未保存工作。

**建议**：
- 归档前检查是否有其他成员在线，有则提示
- 归档前自动触发探究画布保存
- `reload()` 改为 `navigate('/student/projects')`，更平滑

### P1-3. 图片上传/粘贴限制

**现状**：三处支持图片上传（AI 导师、ChatPanel、InquirySpace onPaste），均无大小与格式验证。粘贴非图片文件时静默忽略。

**建议**：
- 统一前端文件大小限制 10MB，超限 toast "图片过大，请压缩后重试"
- 非图片粘贴时提示 "仅支持粘贴图片"
- 统一上传进度条（复用 ResourceLibrary 的进度条模式）

### P1-4. 群聊 @提及高亮与通知

**现状**：`ChatPanel` 解析 `@username` 但不做视觉高亮，被 @者无任何提醒。

**建议**：
- 被 @的消息在聊天列表中高亮（左侧色条或浅黄背景）
- 聊天面板折叠/在其他 Tab 时，@提及触发 toast
- 右栏折叠态图标列上 💬 图标显示红点数字（含 @计数）

---

## 六、体验打磨（P2）

### P2-1. 全平台空状态 CTA 引导

空状态增加行动号召按钮，降低操作门槛：

| 位置 | 当前 | 改进后 |
|------|------|--------|
| Kanban 待办列空 | "暂无内容" | "+ 添加第一个任务"（聚焦输入框） |
| 资源库空 | "还没有上传任何资源" | "上传第一个文件" + 拖拽区高亮 |
| 聊天无消息 | 空白 | 欢迎引导消息 "欢迎加入小组！输入消息开始协作" |
| 学习概览 loading | "加载中..." | 骨架屏 + "正在生成学习数据..." |

### P2-2. 文档区空状态与切换

**现状**：文档加载失败仅显示错误和重试按钮，无手动创建入口。

**建议**：
- 错误状态增加 "手动创建新文档" 按钮
- 编辑器顶部增加下拉菜单列出所有文档，支持切换/新建

### P2-3. 项目列表页快速切换

**现状**：换组需回到 `/student/projects` 重新选择。

**建议**：左栏小组名旁边加下拉箭头，展开"我的小组"列表，点击直接切换。对 5+ 小组的学生尤其重要。

### P2-4. 连接状态一致性

**现状**：`ConnectionStatusBanner` 在顶部，各子组件各自处理断连。

**建议**：统一离线体验——各组件读取全局连接状态，输入框置灰 + "连接中断，恢复后将自动同步"。

---

## 七、极端操作清单汇总

| # | 场景 | 严重度 | 当前表现 | 建议 |
|---|------|--------|----------|------|
| 1 | 组长快速连点阶段按钮 | 中 | `stageChanging` 禁用按钮 | 增加确认对话框 |
| 2 | 归档时其他成员正在编辑 | 高 | 直接 reload，编辑丢失 | 检查在线成员 + 自动保存 |
| 3 | 探究画布未保存关闭浏览器 | 高 | 无提示，数据丢失 | `beforeunload` + 自动保存 |
| 4 | 粘贴 50MB 图片 | 中 | 上传超时，错误不明确 | 前端 10MB 限制 + 进度条 |
| 5 | 唯一在线成员发聊天 | 低 | 消息正常发送 | 提示"当前只有你在线" |
| 6 | 空小组（仅自己）进 workspace | 中 | 所有功能可用但无人协作 | 引导"邀请成员开始协作" |
| 7 | 教师强切阶段时学生正在编辑 | 中 | 12 秒提示 banner | 切换前缓冲 + 自动保存 |
| 8 | 任务被他人删除 | 中 | 乐观删除无通知 | 他人任务删除需二次确认 |
| 9 | 资源库误删文件 | 中 | 有确认对话框 | 好，保持 |
| 10 | 浏览器后台 30 分钟后回前台 | 低 | focus 事件触发版本轮询 | 合并多次变更为一个摘要通知 |

---

## 八、实施分期

### 第一期（2 周）— 布局简化

- 2.2 Header 消除，元素重新分配到左右栏
- 2.3 左右栏折叠为图标列 + 拖拽宽度
- 2.4 左栏整合为 1 面板（成员 + 任务 + 归档）
- 2.5 右栏减为 2 Tab（聊天 + 教师支持）
- 2.6 6 个主 Tab 重命名
- P1-1 阶段切换确认对话框

### 第二期（1.5 周）— 协作核心

- 3.2 AI 助理上下文感知
- 3.3 AI 助理 → AI 对话衔接
- P0-3 成员在线状态
- P0-2 任务负责人
- P1-3 图片上传限制
- P1-4 @提及高亮与通知

### 第三期（1 周）— 体验打磨

- P2-1 全平台空状态 CTA
- P2-2 文档区切换/新建
- P2-3 快速小组切换器
- P2-4 连接状态一致性
- P1-2 归档操作保护

### 第四期（1 周）— Bug 修复（CRITICAL + HIGH）

- CRIT-1～5 + HIGH-1～5 修复（详见附录）

### 第五期（1.5 周）— 探究画布同步

- P0-1 探究画布冲突检测 + 自动保存 + 实时同步

---

## 附录：现有 Bug 与阻塞问题清单

以下为排查 `ProjectWorkspace.tsx`、`Sidebar/RightSidebar`、6 个 Tab 组件、AI 组件、协作组件后发现的阻塞/bug。

### A.1 CRITICAL（必须修复的阻塞问题）

#### CRIT-1: ChatPanel 连接状态硬编码为 `true`，断网时用户无感知

- **文件**：`frontend/src/hooks/chat/useChatSync.ts:125`
- **现状**：`return { ... connected: true }` — 永远是 true，从未连接 SyncService 实际状态
- **影响**：WebSocket 断线时聊天输入框不置灰、不提示 "连接中断"。用户发消息无声失败（消息进入队列但永远发不出去），且无任何视觉反馈
- **修复**：改为 `useSyncStore(state => state.connectionStatus) === 'connected'`

#### CRIT-2: AIAssistant 流式请求无 AbortController，组件卸载后仍调 setState

- **文件**：`frontend/src/components/features/student/ai/AIAssistant.tsx` 约 215–270 行
- **现状**：`aiService.streamChat()` 内部使用原生 `fetch()` 无 `AbortController`。AIAssistant 折叠/卸载时，流式回调 `onChunk`、`onDone` 仍然调用 `setMessages`/`setLoading`
- **影响**：React 18 开发模式下警告，生产环境内存泄漏；快速折叠/展开 AI 助理时，旧流式响应可能覆盖新消息
- **修复**：在 `sendAssistantMessage` 中创建 `AbortController`，useEffect cleanup 中调用 `controller.abort()`

#### CRIT-3: useDocumentSync 在 documentId 变化时销毁 Y.Doc 导致后续调用使用已销毁文档

- **文件**：`frontend/src/hooks/document/useDocumentSync.ts:23 + 113-120`
- **现状**：`useState(() => new Y.Doc())` 只创建一次。cleanup 中 `ydoc.destroy()` 销毁了 Y.Doc，但下一次 effect 仍使用同一个已销毁的 ydoc
- **当前规避**：父组件通过 `key={currentDocumentId:stageRenderKey}` 强制 remount，所以暂未触发。但 hook 本身是潜伏 bug
- **修复**：从 cleanup 中移除 `ydoc.destroy()`，或使用 `useRef` + `useMemo` 在 documentId 变化时创建新 Y.Doc

#### CRIT-4: DocumentEditor 同步失败时静默降级为本地模式

- **文件**：`frontend/src/hooks/document/useDocumentSync.ts:97-99`
- **现状**：`syncService.joinRoom(roomId, 'document').catch(console.warn)` — joinRoom 失败时仅打印 warn，编辑器正常打开
- **影响**：用户正常编辑以为在协作，实际只有本地缓存——页面刷新后编辑全部丢失。数据丢失风险极高
- **修复**：失败时设置 `syncError` 状态，在编辑器顶部显示黄色 warning banner "文档协作连接中断，正在重试..."

#### CRIT-5: DocumentEditor 空字符串 documentId → Yjs 完全重建 → 可能丢失用户输入

- **文件**：`frontend/src/components/features/student/document/DocumentEditor.tsx:276-280`
- **现状**：`documentId: documentId || document?.id || ''` — 初始渲染时 `document?.id` 为 null 导致 documentId 为 `''`，useDocumentSync 跳过初始化。异步加载完成后 documentId 变为有效值，整个 Yjs Provider 和 Y.Doc 重新创建
- **影响**：中间态的本地编辑全部丢失
- **修复**：直到 documentId 有效才开始渲染 DocumentEditor，即 `{ documentId ? <DocumentEditor ... /> : <LoadingSkeleton /> }`

### A.2 HIGH（高优先级）

#### HIGH-1: InquirySync beforeunload 不保存

- **文件**：`frontend/src/modules/inquiry/hooks/useInquirySync.ts:293-295`
- **现状**：`handleBeforeUnload` 里只有 `console.log('[InquirySync] Page unloading...')` — 只打 log，不保存。代码注释："移除 sendBeacon，因为它不带 Auth Token，会返回 401"
- **影响**：浏览器关闭/刷新时探究画布未保存的数据丢失
- **修复**：`beforeunload` 中使用 `navigator.sendBeacon` + 将 token 放入请求体，或监听 `visibilitychange` 事件做 pagehide 保存

#### HIGH-2: ChatPanel fetchMembers 无 isMounted 守卫

- **文件**：`frontend/src/components/features/chat/ChatPanel.tsx` 约 88–101 行
- **现状**：`projectService.getProject()` 和 `userService.getUsers()` 异步调用，无 `AbortController` 且无 `isMounted` flag。组件卸载后仍可能 `setMembers`/`setExperimentVersion`
- **影响**：潜在的内存泄漏和控制台警告
- **修复**：添加 `AbortController` 或 `isMounted` ref

#### HIGH-3: ChatPanel Lightbox/状态在 projectId 切换时未重置

- **文件**：`frontend/src/components/features/chat/ChatPanel.tsx`
- **现状**：图片 lightbox 状态 (`selectedImage`) 在 `projectId` 变化时不重置。从一个项目的聊天打开图片 lightbox，切换到另一个项目后 lightbox 仍然显示前一个项目的图片
- **修复**：在 `projectId` 变化的 `useEffect` 中重置 `setSelectedImage(null)`

#### HIGH-4: ChatPanel 历史消息拉取与同步消息存在 TOCTOU 竞争

- **文件**：`frontend/src/components/features/chat/ChatPanel.tsx` 约 104–154 行
- **现状**：`fetchMessages` 通过 REST API 拉取历史消息后 merge 到当前 `messages`。拉取期间若新实时消息到达，`setMessages(prev => ...)` 中的函数体基于旧的闭包迭代 `currentMessages`，可能覆盖或重复消息
- **修复**：在 msgMap merge 逻辑中，对已存在的消息使用时间戳比较，而非简单的 `existing || history`

#### HIGH-5: 文档加载失败 "重新加载文档" 按钮触发全量工作区重载

- **文件**：`frontend/src/pages/student/ProjectWorkspace.tsx:893-896`
- **现状**：仅文档解析失败时，点击 "重新加载文档" 却触发了整个工作区的重新加载（重新 fetch project + experiment version + document）
- **修复**：改为 `setCurrentDocumentId(undefined)` 来重新触发 `getDocumentId` effect

### A.3 MEDIUM（中等）

| # | 位置 | 简述 | 修复 |
|---|------|------|------|
| MED-1 | `RightSidebar.tsx` | Tab 切换用条件渲染导致组件销毁重建（每次切回聊天重新拉历史/建连接） | 改为 CSS `display:none` 或保持 mounted |
| MED-2 | `ChatPanel.tsx:336` | 打字指示器 `onStopTyping` 回调中 `members.find()` 使用过期闭包，新成员加入后打字指示器可能永不消失 | 用 `useRef` 持有最新 members |
| MED-3 | `Sidebar.tsx` | `projectId` 为 undefined 时三个 Tab 按钮仍可点击但内容为空，无任何提示 | 增加空状态引导 |
| MED-4 | 多处 | `syncService.init()` 调用后不 `await` 就使用 `joinRoom`，可能导致首次连接时房间注册时序问题 | 统一 await 后再 joinRoom |
| MED-5 | `DocumentEditor.tsx:424` | `saveSnapshot` 失败静默忽略（`void documentService.saveSnapshot(...)`），用户不知道修改未持久化 | 增加错误 toast |
