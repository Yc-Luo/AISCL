# AISCL 教师端 — 用户体验优化方案

## 背景

本文档基于对教师端 10 个功能页面的逐文件代码审查，给出 UX 优化建议。每条建议注明当前问题、目标效果、涉及文件与预估改动量。建议按优先级分 P0–P2 三档实施。

---

## P0: 核心操作页体验修复

### 1. 小组监控 — 左侧列表选中态不明显

- **当前**：选中行用 `ring-2 ring-indigo-500`，在密集列表中不够显眼。
- **目标**：选中行左侧加 3px 色条 + 背景加深，视觉权重明确。
- **文件**：`frontend/src/components/features/teacher/projectmonitor/ProjectMonitor.tsx`
- **改动量**：小（CSS class 3-4 行）

### 2. 小组监控 — 学生求助信息密度不足

- **当前**：求助卡片展示 `学生名 + 求助类型 + 内容 + 时间`，缺少阶段/页面上下文。
- **目标**：利用已有字段 `stageId` 和 `pageSource`，在卡片中展示：

```
李同学 · 写作困难 · 论证建构阶段 · 来自协作文档页
"我不知道怎么组织论点..."
3 分钟前
```

- **文件**：同上
- **改动量**：小（`HelpRequest` 已携带 stageId/pageSource，仅需渲染层面展示）

### 3. 全局 — 错误状态反馈缺失

- **当前**：多数页面的 API 错误仅 `console.error`，教师看不到任何反馈。
- **目标**：统一错误处理：
  - API 调用失败 → toast 通知（右上角浮现，3 秒消失）
  - 列表/数据加载失败 → 空状态页 + "重试" 按钮
- **文件**：新建 `frontend/src/components/ui/Toast.tsx` + 各页面 catch 块
- **改动量**：中（全局替换 catch 逻辑 + toast 基础设施）

### 4. 全局 — Loading 态统一为骨架屏

- **当前**：所有页面初次加载为居中 spinner + "加载中..."，教师看不到内容结构。
- **目标**：核心页面（概览、监控、仪表盘）首次加载使用骨架屏：
  - 概览：4 张统计卡片骨架 + 列表骨架
  - 监控：左侧列表骨架 + 右侧面板骨架
  - 仪表盘：图表骨架
- **文件**：新建 `frontend/src/components/ui/Skeleton.tsx` + 对应页面
- **改动量**：中（创建骨架组件 + 3 个页面各加 ~30 行）

---

## P1: 认知负荷降低

### 5. 概览 — "实时"标签改为数据时间戳

- **当前**：4 张统计卡片右上角均有 "实时" badge，但数据来自一次性 fetch，不轮询。
- **目标**：显示最后一次 fetch 时间，如 `更新于 14:32`。
- **文件**：`frontend/src/components/features/teacher/overview/DashboardOverview.tsx`
- **改动量**：小（`useState` 加一个时间戳，badge 内容替换）

### 6. 小组监控 — 教师支持发送反馈改为 toast

- **当前**：发送支持后的 `supportFeedback` 文字插入按钮下方，切换小组时丢失。
- **目标**：发送成功/失败用 toast 通知，支持历史区域立即可见新记录。
- **文件**：同上（依赖 P0 第 3 项的 Toast 基础设施）
- **改动量**：小（替换 `setSupportFeedback` → `toast.show()`）

### 7. 班级管理 — 邀请码复制反馈增强

- **当前**：复制成功后图标从 `Copy` 变为 `Check` 持续 2 秒，变化不易察觉。
- **目标**：复制后弹出 tooltip "已复制到剪贴板"。
- **文件**：`frontend/src/components/features/teacher/classmanagement/ClassManagement.tsx`
- **改动量**：小（在 `handleCopyCode` 中加 tooltip 状态 + JSX）

### 8. 班级管理 — 创建/编辑弹窗五段式模板改为折叠 Accordion

- **当前**：对话框包含 5 个大 textarea，弹窗 `max-h-[90vh]`，13 寸本上需大量滚动。
- **目标**：5 个 section 折叠为 accordion，每个只显示标题 + 已填字数/未填状态：

```
▼ 任务背景（已填写，120 字）
▶ 核心问题（未填写）
▶ 协作要求（已填写，85 字）
▶ 提交成果（未填写）
▶ 评价要点（已填写，60 字）
```

点击展开后显示 textarea。新建班级时第一个默认展开。

- **文件**：同上 + 新建 `frontend/src/components/ui/Accordion.tsx`
- **改动量**：中（创建 Accordion 组件 + 重构创建/编辑弹窗中的模板编辑区）

### 9. 任务发布 — 表单分步引导

- **当前**：发布表单一次性暴露 5 个 textarea + 标题 + 截止时间 + 逾期选项。
- **目标**：分两步：
  - 第 1 步：标题 + 截止时间 + 班级选择
  - 第 2 步：5 个 textarea（复用 Accordion 折叠模式）
- **文件**：`frontend/src/components/features/teacher/taskrelease/CourseTaskRelease.tsx`
- **改动量**：中（表单拆分为两步 wizard + 复用 Accordion）

### 10. 小组仪表盘 — 实验版本管理 UI 分组折叠

- **当前**：实验配置区平铺 10+ 个控件，视觉密度极高。
- **目标**：三组可折叠：
  - **实验条件**（默认展开）：AI支架模式 / 过程支架开关 / 广播开关
  - **阶段控制**（默认展开）：当前阶段 + 推进/回退按钮 + 阶段序列
  - **高级选项**（默认折叠）：规则集 / 导出配置 / 支架层 / 支架角色 / 组别条件
- **文件**：`frontend/src/components/features/teacher/studentanalytics/ProjectDashboard.tsx`
- **改动量**：中（用 Accordion 组件包裹，不改变逻辑）

---

## P2: 锦上添花

### 11. 侧边栏 — 增加分组标题

- **当前**：10 个导航项用一条分割线分两组，语义不清。
- **目标**：按任务类型分三组，加 `<p>` 标题：

```
教学运营
  概览 / 班级管理 / 学生列表
—————————————
实验操作
  小组管理 / 小组监控 / 小组仪表盘
—————————————
内容与评审
  课程资源 / 任务发布 / 作业与任务评审
```

折叠时分组标题自动隐藏。

- **文件**：`frontend/src/pages/teacher/TeacherDashboard.tsx`
- **改动量**：小

### 12. 侧边栏 — 默认宽度固定为 260px

- **当前**：`w-[30%] max-w-sm` 在 1440px 屏幕上约 430px，大量空白。
- **目标**：`w-[260px]`，collapsed 保持 `w-20`。
- **文件**：同上
- **改动量**：1 行 CSS

### 13. 概览 — "小组最近更新"整行可点击

- **当前**：行内有 "查看" 按钮跳转到小组监控，点击名称无反应。
- **目标**：整行可点击，跳转到对应小组的监控页。
- **文件**：`frontend/src/components/features/teacher/overview/DashboardOverview.tsx`
- **改动量**：小（加 `onClick` + `cursor-pointer`）

### 14. 概览 — 教学备忘卡片增加快捷操作

- **当前**："X 个班级未配置项目说明，Y 个班级未创建小组" 仅文字展示。
- **目标**：每行加 "去配置" 按钮，跳转到班级管理/小组管理。
- **文件**：同上
- **改动量**：小（加 Button + navigate）

### 15. 小组监控 — 15 秒轮询增加视觉反馈

- **当前**：求助列表 15 秒静默轮询，教师不知道何时刷新。
- **目标**：求助区域标题旁加 "上次刷新：14:32:15" 小字或脉冲指示点。
- **文件**：`ProjectMonitor.tsx`
- **改动量**：小（加 `lastPollTime` 状态 + `<span>`）

### 16. 小组监控 — 状态标签增加 tooltip 解释

- **当前**：Badge 显示 "运行平稳""需要关注"，教师不知道判定逻辑。
- **目标**：Hover 时显示 tooltip：

```
需要关注 ⓘ
→ 4C 综合评分低于 60，或该小组尚无消息记录

近期低活跃 ⓘ
→ 超过 48 小时无新消息或文档更新
```

- **文件**：同上
- **改动量**：小（加 `title` 属性或新建 Tooltip 组件）

### 17. 学生管理 — 批量导入进度反馈去技术化

- **当前**：批量导入日志用黑底绿字终端风格，显示 `第 3 行 [zhangsan] 导入成功`。
- **目标**：
  - 进度条 + "正在导入 5/20 名学生"
  - 完成后摘要卡片："成功导入 18 人，跳过 2 人（已在班级中）"
  - 失败项折叠在 "查看详情" 中
- **文件**：`frontend/src/components/features/teacher/studentlist/StudentList.tsx`
- **改动量**：中（替换终端日志区域 UI）

### 18. 学生管理 — 侧边栏"成长档案"数据丰富化

- **当前**：右侧 400px 滑出面板只显示姓名、邮箱、小组列表和进度条。
- **目标**：增加：
  - 4C 各维度评分（从 analytics API 获取）
  - 最近活跃时间
  - 已完成/未完成任务数
- **文件**：同上
- **改动量**：中（新增 API 调用 + UI 展示）

### 19. 任务发布 — 发布记录 Badge 堆叠改为迷你摘要

- **当前**：每条发布记录 4-5 个 Badge 展示状态/同步数/文档数/提交数，视觉噪音大。
- **目标**：改为两行文本摘要：

```
已同步 8 个小组任务 · 已提交 5/8
正常提交 4 · 逾期提交 1 · 自动提交 0
```

- **文件**：`CourseTaskRelease.tsx`
- **改动量**：小（替换 4 个 Badge 为结构化文本行）

### 20. 小组仪表盘 — 4C 柱状图加参考基准

- **当前**：4C 柱状图只有本组数值，教师无法判断水平。
- **目标**：在图表上加一条班级/全局均值水平虚线，tooltip 显示差值。
- **文件**：`ProjectDashboard.tsx`
- **改动量**：中（需后端提供班级均值接口或在前端聚合计算）

### 21. 小组仪表盘 — 导出功能统一入口

- **当前**：导出分散在行为流表上方和实验配置区。
- **目标**：页面顶部加一个 "导出" 下拉按钮（Dropdown），集中所有导出选项（仪表盘 CSV/JSON、研究事件 CSV/JSON、群聊记录等）。
- **文件**：同上
- **改动量**：中（新建 Dropdown 组件 + 整合导出逻辑）

### 22. 全局 — 键盘快捷键

- **当前**：纯鼠标操作，无障碍键盘支持。
- **目标**：
  - `Ctrl/Cmd + K` → 全局快捷搜索弹窗（可搜索小组/学生/班级）
  - `Esc` → 关闭弹窗/侧边栏
- **文件**：新建 `frontend/src/components/ui/GlobalSearch.tsx` + `TeacherDashboard.tsx` 中监听
- **改动量**：中（新建组件 + 事件监听）

---

## 依赖关系

```
P0:
  Toast 组件 ──→ P0-3 错误处理
   │            └─→ P1-6 支持反馈改为 toast
   │
  Skeleton 组件 → P0-4 骨架屏
   │
  P1-5, P1-6, P1-7 相互独立，可并行

P1:
  Accordion 组件 ──→ P1-8 班级管理折叠
                   ├─→ P1-9 任务发布折叠
                   └─→ P1-10 仪表盘折叠

P2:
  全部独立，无依赖
```

---

## 新建组件清单

| 组件 | 路径 | 用途 |
|------|------|------|
| `Toast` | `frontend/src/components/ui/Toast.tsx` | 全局 toast 通知（右上角浮现，自动消失） |
| `Skeleton` | `frontend/src/components/ui/Skeleton.tsx` | 骨架屏占位组件 |
| `Accordion` | `frontend/src/components/ui/Accordion.tsx` | 可折叠区域（标题 + 展开/折叠 + 字数摘要） |
| `Tooltip` | `frontend/src/components/ui/Tooltip.tsx` | Hover 解释气泡 |
| `GlobalSearch` | `frontend/src/components/ui/GlobalSearch.tsx` | Ctrl+K 全局搜索弹窗 |

---

## 修改的现有文件

| 文件 | 涉及建议编号 |
|------|-------------|
| `frontend/src/pages/teacher/TeacherDashboard.tsx` | 11, 12, 22 |
| `frontend/src/components/features/teacher/overview/DashboardOverview.tsx` | 5, 13, 14 |
| `frontend/src/components/features/teacher/projectmonitor/ProjectMonitor.tsx` | 1, 2, 6, 15, 16 |
| `frontend/src/components/features/teacher/classmanagement/ClassManagement.tsx` | 7, 8 |
| `frontend/src/components/features/teacher/studentlist/StudentList.tsx` | 17, 18 |
| `frontend/src/components/features/teacher/taskrelease/CourseTaskRelease.tsx` | 9, 19 |
| `frontend/src/components/features/teacher/studentanalytics/ProjectDashboard.tsx` | 10, 20, 21 |
| `frontend/src/components/features/teacher/assignmentreview/AssignmentReview.tsx` | — (P0-3 错误处理) |
| `frontend/src/components/features/teacher/courseresource/CourseResource.tsx` | — (P0-3 错误处理) |
| 其余页面 catch 块 | P0-3 统一错误处理 |

---

## 实施分期

### 第一期（1 周）— P0 全部

- Toast 组件 + 全局错误处理
- Skeleton 组件 + 三个核心页骨架屏
- 小组监控选中态 + 求助信息增强

### 第二期（1.5 周）— P1 全部

- Accordion 组件
- 班级管理/任务发布/仪表盘折叠重构
- 概览时间戳 + 支持反馈 toast + 邀请码 tooltip

### 第三期（1.5 周）— P2 按影响面选取

- 侧边栏分组 + 宽度
- 仪表盘 4C 基准线 + 导出统一
- 批量导入 UI + 学生档案丰富
- 键盘快捷键 + tooltip

---

## 风险排查与阻塞项

以下是在逐行对照实际代码后标记的问题。每个问题标注严重程度：**阻塞**（不解决无法开工）、**风险**（需额外设计/后端配合）、**注意**（实现时需留意）。

### 阻塞项

#### B1. P2-20 4C 基准线缺少后端 API

- **严重程度**：阻塞（P2 但依赖后端）
- **现状**：`analyticsService.getDashboardData(projectId)` 返回单个项目的 4C 数据和活动拆解，没有任何跨组聚合接口。`ProjectMonitor` 中已用 `getProjectMetrics` 在前端逐个计算每个小组的 `fourC` 和 `averageScore`，但未持久化或聚合。
- **影响**：要在 4C 柱状图上画"班级均值"参考线，要么后端新增 `GET /analytics/course/{courseId}/averages` 返回各维度均值，要么前端拉取该班所有项目的 dashboard 数据后自己算均值。后者在 20 个小组 × 逐个 API 调用场景下不可接受。
- **建议**：列入 P2 前置条件，由后端提供一个轻量聚合 endpoint。

#### B2. P2-18 学生 4C 数据需要 N+1 API 调用

- **严重程度**：风险（可做但有性能隐患）
- **现状**：`analyticsService.getDashboardData(projectId, userId)` 支持 `userId` 参数，理论上可获取单个学生在某项目中的 4C 数据。但 `handleViewStudent` 当前通过 `projectService.getProjects()` 全局拉取后前端过滤学生所在小组——未调用 analytics API。
- **影响**：学生在 N 个小组中 → 需要 N 次 `getDashboardData(projectId, studentUserId)` 调用。可 `Promise.all` 并行，但 5+ 个项目时首字节延迟显著。
- **建议**：两种方案：① 后端新增 `GET /students/{studentId}/analytics-summary` 聚合接口；② 前端用 `Promise.allSettled` 并行请求，骨架屏下展示 loading 状态。

### 风险项

#### R1. Toast 组件的放置层级

- **严重程度**：风险
- **问题**：Toast 如果渲染在 `TeacherDashboard`（用 `Outlet` 包裹子路由）内部，则：
  - 页面级 toast 正常（概览、监控等在同一 Outlet 下）
  - 如果从小组列表点击 "查看" 跳转到 `/project/:id`（可能不在 TeacherDashboard 的 Outlet 范围内），toast 会随 TeacherDashboard 卸载而丢失
- **建议**：Toast 容器应放在 App 根级（`App.tsx` 或 `main.tsx`），用 React Portal 渲染到 `document.body`，通过 context 或 zustand store 全局触发。当前项目已使用 zustand（`authStore`），可复用模式。

#### R2. P1-8/9/10 Accordion 内受控组件行为

- **严重程度**：注意
- **问题**：`ClassManagement` 的创建/编辑弹窗中，`taskTemplate` 通过 `useState` 管理，各 textarea 绑定 `value={taskTemplate.xxx}`。如果将 textarea 在折叠时**卸载**（条件渲染），React 会丢失 DOM 节点但 state 保留；重新展开时 textarea 重新挂载并从 state 恢复值。这是安全行为。
- **验证**：已确认 `updateTaskTemplate` 通过 `setTaskTemplate(prev => ({ ...prev, [key]: value }))` 更新，不依赖 DOM 事件对象。折叠/展开不丢失数据。
- **建议**：Accordion 实现时用 `{open && <textarea>}` 条件渲染即可，不需要 `display:none` 隐藏。

#### R3. P2-13 整行可点击的事件冒泡

- **严重程度**：注意（已知方案）
- **问题**：`DashboardOverview` 中"小组最近更新"每行有 "查看" 按钮（`onClick` 跳转），如果给整行加 `onClick`，点按钮会触发两次导航。
- **解决方案**：按钮上 `onClick={(e) => { e.stopPropagation(); navigate(...) }}`。代码库中 `StudentList.tsx` 第 445 行已有相同模式，直接复用。

#### R4. ProjectMonitor 固定高度布局在小屏下的表现

- **严重程度**：注意（方案未覆盖）
- **问题**：`ProjectMonitor` 顶部 div 有 `lg:h-[calc(100vh-2rem)] lg:min-h-[720px] lg:overflow-hidden`，在 1366×768 及更小屏幕上，左侧小组列表 + 右侧面板的双栏布局会被压缩到无法操作。
- **建议**：P0-1 改动时顺便验证：当前 `lg:` 前缀意味着小屏降级为自然流式布局，应确认降级后左侧列表和右侧面板是否上下堆叠且均可滚动。

### Bug 修正

#### Bug1. P0-1 当前方案描述与实际代码不符

- **描述**：方案文档写当前选中用 `ring-2 ring-indigo-500`，但实际代码（`ProjectMonitor.tsx` 第 597–600 行）为：

```tsx
className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
  selected
    ? 'border-indigo-200 bg-indigo-50 shadow-sm'
    : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50'
}`}
```

- **影响**：无功能影响，但执行时不要去找 `ring-2` 改，而是在现有 `selected` 分支中追加 `border-l-4 border-l-indigo-600` 并调整 `rounded-xl` 为 `rounded-r-xl rounded-l-none`，或改用 `box-shadow: inset 3px 0 0 #4f46e5` 避免边框冲突。

#### Bug2. P1-9 任务发布分步后提交按钮的验证范围

- **问题**：`handleSubmit` 当前校验 `!form.title.trim()` 和 `!selectedCourseId`。分两步后第 2 步的 5 个 textarea 全部可选（空字符串合法），因此从第 1 步直接提交也能成功创建发布记录。这符合业务逻辑（允许只填标题发布），但需确认产品期望。
- **建议**：如果要求至少填一个 textarea，在第 2 步的 "发布" 按钮上加校验。

#### Bug3. 班级管理弹窗中 form state 共享问题

- **问题**：`ClassManagement` 的创建和编辑弹窗共用同一个 `taskTemplate` state。当前 `resetForm()` 将其重置为 `DEFAULT_TASK_TEMPLATE_SECTIONS`，`openEdit(course)` 通过 `parseTaskTemplate` 覆盖。两者不会同时打开，因此不冲突。但如果在 Accordion 实现中，创建弹窗关闭后未重置展开/折叠状态，下次打开编辑弹窗时可能看到错误的折叠状态。
- **建议**：Accordion 的 `openIndices` 状态在 `resetForm()` 和 `openEdit()` 中明确重置（新建时第一个展开，编辑时全部折叠或按已填内容展开）。

### 依赖汇总

| 建议编号 | 依赖项 | 类型 | 负责方 |
|---------|--------|------|--------|
| P2-20 | 后端新增班级/全局均值 API | 后端 API | Backend |
| P2-18 | 可选：后端新增学生聚合 API（否则前端 N+1） | 后端 API（可选） | Backend 或 Frontend |
| P0-3/P1-6 | Toast 组件 + zustand store | 前端基础设施 | Frontend |
| P1-8/9/10 | Accordion 组件 | 前端基础设施 | Frontend |
| P2-21 | Dropdown 组件 | 前端基础设施 | Frontend |
| P2-22 | GlobalSearch 组件 + 全局键盘监听 | 前端基础设施 | Frontend |

### 实施建议调整

原分期中 P2-20（4C 基准线）和 P2-18（学生档案丰富）应标记为 **依赖后端接口**，先与后端确认排期后再排入前端迭代。其余 20 条无阻塞，可按原分期执行。
