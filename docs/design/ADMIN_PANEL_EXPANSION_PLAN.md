# Admin 面板扩展方案 v3：科学研究平台视角

## 背景

AISCL 是一个**科学研究性质的在线协作学习平台**。其核心工作流是：

```
Admin（研究方案设计者）
  │  设计实验模板、Agent 角色、规则集、编排策略、模型池
  │  将这些"配置工具箱"按权限分配给不同教师
  ▼
Teacher（实验操作者）
  │  从自己被授权使用的配置中，为不同班级/小组选择实验条件
  │  操作实验、监控小组、给予支持
  ▼
Student（实验参与者）
    在分配的实验条件下进行协作学习
```

当前 Admin 面板有 4 个功能 Tab + 2 个空预留目录。本文档从**研究平台**的定位出发，重新设计 Admin 面板，核心聚焦：**配置管理 + 权限分配 + 研究数据管理**。

---

## 〇、当前配置体系与权限缺口

### 已有配置维度（Admin 在 ResearchConfig 中设计）

| 配置维度 | 存储位置 | 内容 |
|---|---|---|
| **实验模板** | `research_experiment_templates` | 模板 id、label、groupCondition、aiMode、processMode、ruleSet、stageSequence、published |
| **Agent 角色** | `research_agent_roles` | 4 个角色：资料研究员、观点挑战者、反馈追问者、问题推进者 |
| **干预规则集** | `research_rule_profiles` | 2 个规则集：影子模式 / 群聊短提示，含观察窗口、命中阈值、冷却时间 |
| **编排策略** | `research_orchestration_profile` | graph 版本、路由策略、RAG 策略、检索源、群聊模型、导师模型 |
| **发布快照** | `research_release_history` | 上述四者的时间点快照，供教师绑定 |

### 教师如何使用配置（当前流程）

```
1. Admin 在 ResearchConfig 中发布 Release（快照所有配置）
2. Teacher 创建/编辑 Course 时，调用 GET /courses/experiment-templates
   → 返回所有 published=true 的模板（来自 release 或 legacy presets）
3. Teacher 选择一个 experiment_template_key 绑定到 Course
   → resolve_template_binding() 从 release 快照或 presets 中取完整配置
   → 写入 Course.experiment_template_snapshot
4. 后续该 Course 下创建 Project 时，继承 Course 的实验配置
```

### 权限缺口（关键）

| 缺口 | 现状 | 影响 |
|---|---|---|
| **教师之间无配置隔离** | 任何教师都能看到并使用所有 published 模板 | 无法做盲法实验；无法控制不同教师使用不同方案 |
| **User 模型无权限字段** | User 只有 role、class_id、is_active/is_banned | 无法为教师分配可用的配置子集 |
| **模板获取无过滤** | `GET /courses/experiment-templates` 返回全部模板 | 教师看到不该看到的实验条件 |
| **无配置维度级别的权限** | 教师要么全有要么全无 | 无法做到"张老师只能用模板A/B + 影子规则，李老师只能用模板C/D + 群聊提示" |

---

## 一、重新定位 Admin 面板

Admin 面板应围绕三个核心职责：

```
职责 1: 研究方案设计
        → 定义基础组件（Agent角色、规则集、模型池、阶段）
        → 通过模板构建器组合基础组件 → 生成实验模板
        → 配置编排策略（路由、RAG、模型默认值）
        → 发布版本快照冻结整套方案
        → 已有 ResearchConfig + SystemConfig 覆盖，需重构为"组件库 + 构建器"模式

职责 2: 配置权限分配 ← NEW，原方案完全缺失
        → 将教师分组/打标签
        → 按教师分配各配置维度的可访问范围（多选下拉）
        → 下游 API（模板列表、模型调用）按权限过滤

职责 3: 研究数据管理
        → 存储概览（按项目/类型）
        → 数据保留策略执行
        → 项目归档/删除
        → 研究数据批量导出（供论文/分析使用）
        → 配置备份/恢复
```

**明确排除的内容（不属于 Admin 职责）：**

- 实时同步监控大盘（属于教师操作层或独立运维面板）
- 教师效能监督排名（属于教育管理/教务系统）
- 群聊热力图（属于教师监控层）
- 任何"数据大屏"性质的实时展示

---

## 二、调整后的 Tab 布局

```
AdminDashboard
├── Tab 1: 用户管理 (UserManager)           ← 已有，增强：增加教师分组/标签
├── Tab 2: 研究配置 (ResearchConfig)        ← 已有，增强：增加模型池配置
├── Tab 3: 系统配置 (SystemConfig)          ← 已有，保持
├── Tab 4: 行为数据 (BehaviorLogs)          ← 已有，保持
├── Tab 5: 配置权限 (ConfigPermissions)     ← NEW：教师-配置权限矩阵
└── Tab 6: 数据管理 (DataManagement)        ← NEW：研究数据管理
```

---

## 三、Tab 5: 配置权限 (`ConfigPermissions`) — 核心新增

### 3.1 定位

配置权限是 Admin 面板的**枢纽功能**。Admin 设计好研究方案（模板 + 规则集 + 模型池）后，在此 Tab 中将各配置维度**按教师分配**，控制每位教师能使用哪些实验模板、干预规则集、LLM 模型。

### 3.2 权限粒度设计

**维度精简原则：实验模板是组合单元。** 一个模板定义（见 ResearchConfig 中 `buildResolvedExperimentVersionSnapshot`）本身就捆绑了 `aiMode`、`processMode`、`ruleSet`、`stageSequence` 和 `enabled_scaffold_roles`。教师在 Course 创建时只选一个模板，不独立拼凑子维度，因此**限制模板 = 自动限制所有子维度**。Agent 角色、编排模式、阶段序列、过程支架模式、RAG 策略这 5 个维度都是模板的内嵌属性，无需独立做权限控制。

唯一独立于模板的维度是 **LLM 模型**（编排策略中的 `groupChatModel` / `tutorModel` 可跨模板独立指定）。

最终保留 **3 个权限维度**：

| 权限维度 | 数据来源 | UI 控件 | 说明 |
|---|---|---|---|
| **实验模板** | `research_experiment_templates` 中所有模板 | 多选下拉（checkbox 列表） | 教师只能看到/绑定被分配的模板。模板本身已捆绑 AI 模式、过程支架、规则集、阶段序列、Agent 角色 |
| **干预规则集** | `research_rule_profiles` 中所有规则集 | 多选下拉 | 教师可使用的规则集。作为模板权限的**附加约束**：如果教师有权使用模板A（引用规则集X）但无权使用规则集X，则模板解析时拒绝或降级 |
| **LLM 模型** | 系统模型池（见 4.1） | 多选下拉 | 教师可使用的 LLM 模型（群聊模型、导师模型）。独立于模板——同一模板下不同教师/班级可能使用不同模型 |

**默认行为：** 新建教师默认"全部可用"，Admin 可手动收紧。

> 以下维度**不需要**独立权限控制（已内嵌在模板中）：
> - AI 支架模式 → 模板的 `aiMode`
> - 过程支架开关 → 模板的 `processMode`
> - 阶段序列 → 模板的 `stageSequence`
> - Agent 角色 → 模板通过 `aiMode × processMode` 自动推导激活范围（`_derive_enabled_scaffold_roles`），运行时由编排引擎根据学情上下文自动选择调用哪个 Agent。Admin 只在基础组件库中维护角色注册表（定义可用角色及其能力描述），不在模板或权限中手动选择
> - 编排模式版本 → Admin 在 ResearchConfig 中统一设定，发布快照时冻结
> - RAG 策略 → 编排配置中的全局设定，非教师级选项

### 3.3 数据模型

**方案 A（推荐）：User 模型增加 `config_permissions` 字段**

```python
# backend/app/repositories/user.py 增加字段
class User(Document):
    ...
    # 新增：教师配置权限
    config_permissions: Optional[Dict] = None
    # 结构示例：
    # {
    #     "allowed_template_ids": ["exp-single-process-v1", "exp-multi-process-v1"],
    #     "allowed_rule_profile_ids": ["research-default", "research-default+group-chat-live"],
    #     "allowed_model_ids": ["gpt-4o", "MiniMax-Text-01", "deepseek-v3"],
    # }
```

**方案 B（备选）：独立 collection `teacher_config_permissions`**

适用于需要审计日志、版本历史的场景。结构与方案 A 相同，但存在独立 document 中，通过 `teacher_id` 关联。

**推荐方案 A**，因为：权限数据与用户强绑定、无需独立版本历史（通过 SystemLog 记录变更即可）。

### 3.4 后端新增 API

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/admin/config-permissions/teachers` | 获取所有教师及其当前权限配置（分页、搜索） |
| `GET` | `/admin/config-permissions/teachers/{teacher_id}` | 获取单个教师的权限详情 |
| `PUT` | `/admin/config-permissions/teachers/{teacher_id}` | 更新单个教师的权限配置 |
| `PUT` | `/admin/config-permissions/teachers/batch` | 批量分配权限（勾选多个教师 → 统一设置） |
| `GET` | `/admin/config-permissions/available-options` | 返回所有可分配选项的当前值（模板列表、规则集列表、模型列表）以填充多选下拉 |

**权限过滤：** 下游 API 需同步改造——

| 现有 API | 改造 |
|---|---|
| `GET /courses/experiment-templates` | 根据 `current_user.config_permissions.allowed_template_ids` 过滤返回的模板列表 |
| `POST/PUT /courses` 中 template 绑定 | 校验所选 template 在教师的 allowed_template_ids 中；同时校验模板引用的 ruleSet 在 allowed_rule_profile_ids 中 |
| `research_config_service.resolve_template_binding()` | 增加 `teacher_id` 参数，校验模板和规则集权限 |
| `ai.py` 中 LLM 调用 | 校验使用的 model 在教师的 allowed_model_ids 中 |

**降级策略：** 如果教师 `config_permissions` 为 `None` 或空 `{}`，视为"全部可用"（向后兼容，不破坏现有教师行为）。

### 3.5 前端组件结构

```
frontend/src/components/features/manager/configpermissions/
├── ConfigPermissions.tsx        # 主容器：教师列表 + 权限矩阵
├── TeacherPermissionRow.tsx     # 单行教师权限（展开编辑）
├── PermissionMultiSelect.tsx    # 通用多选下拉组件（用于每个权限维度）
└── BatchPermissionDialog.tsx    # 批量分配弹窗
```

### 3.6 UI 布局

```
┌──────────────────────────────────────────────────────────────┐
│  配置权限管理                                                 │
│                                                              │
│  教师            模板      规则集      模型                    │
│  ─────────────────────────────────────────────────────────── │
│  张老师          3/4      1/2        2/5                     │
│  (zhang@edu.cn)  [展开 ▼]                                   │
│  ─────────────────────────────────────────────────────────── │
│  李老师          4/4      2/2        5/5                     │
│  (li@edu.cn)     [展开 ▼]  ← 默认全部可用                    │
│  ─────────────────────────────────────────────────────────── │
│  王老师          2/4      1/2        1/5                     │
│  (wang@edu.cn)   [展开 ▼]                                   │
│                                                              │
│  ☐ 全选  [批量分配]  搜索: [________]                        │
└──────────────────────────────────────────────────────────────┘

展开张老师后：
┌──────────────────────────────────────────────────────────────┐
│  张老师 (zhang@edu.cn)                        [收起 ▲]      │
│                                                              │
│  实验模板：                                                   │
│  ┌──────────────────────────────────────┐                   │
│  │ ☑ 模板A：单AI + 过程支架              │                   │
│  │ ☑ 模板B：多智能体 + 过程支架           │                   │
│  │ ☑ 模板C：单AI + 无过程支架             │                   │
│  │ ☐ 模板D：多智能体 + 无过程支架          │                   │
│  └──────────────────────────────────────┘                   │
│                                                              │
│  干预规则集：                                                 │
│  ┌──────────────────────────────────────┐                   │
│  │ ☑ 研究默认规则集（影子模式）           │                   │
│  │ ☐ 研究默认规则集 + 群聊短提示          │                   │
│  └──────────────────────────────────────┘                   │
│                                                              │
│  LLM 模型：                                                  │
│  ☑ gpt-4o    ☑ MiniMax-Text-01    ☐ claude-3-opus          │
│  ☐ deepseek-v3   ☑ MiniMax-Text-02                         │
│                                                              │
│  ─────────────────────────────────────────                  │
│  以下能力由所选模板自动确定，无需独立配置：                      │
│  Agent 角色 / AI 模式 / 过程支架 / 阶段序列 / RAG 策略        │
│                                                              │
│  [保存]  [重置]                                              │
└──────────────────────────────────────────────────────────────┘
```

### 3.7 AdminDashboard 集成

```tsx
// TabType 增加
type TabType = 'users' | 'research' | 'system' | 'behavior' | 'permissions' | 'data'

// NAV_ITEMS 增加
{ id: 'permissions', label: '配置权限', icon: Shield, description: 'Config Permissions' }
```

---

## 四、现有 Tab 的增量增强

### 4.1 Tab 2: 研究配置 — 重构为"基础组件库 + 模板构建器"

当前 ResearchConfig 把模板和基础组件（角色、规则、编排）平铺在同一页面上，模板是手动填字符串 ID 创建的，没有从已定义的基础组件中**组合**。应重构为两层结构：

```
研究配置 Tab 内部结构:
┌────────────────────────────────────────────────────────────────┐
│  [基础组件库]  [模板构建器]  [编排策略]   ← 二级 Tab 切换        │
└────────────────────────────────────────────────────────────────┘
```

#### 4.1.1 二级 Tab A: 基础组件库 (Building Block Library)

Admin 在此定义所有可供组合的"原子组件"。这些组件本身也是 ConfigPermissions 中规则集和模型多选下拉的数据源。

| 子模块 | 状态 | 角色 | 说明 |
|---|---|---|---|
| **Agent 角色注册表** | 已有 | **注册表**（非模板输入） | 资料研究员、观点挑战者、反馈追问者、问题推进者。Admin 在此定义可用的 Agent 类型及其能力描述（focus、interventionUse、summary）。**运行时由编排引擎根据学情上下文自动选择调用哪个 Agent**，不由模板手动选择。模板只需设定 `aiMode`（single/multi），引擎自动推导哪些角色生效（见下方"角色自动推导逻辑"） |
| **干预规则集** | 已有 | 模板输入 | 影子模式、群聊短提示等。定义后在模板构建器的规则集下拉中可选 |
| **模型池** | **NEW** | 模板输入 | LLM 模型列表（id、name、provider、base_url）。定义后同时出现在：① 模板构建器的默认模型选择中；② 编排策略的 groupChatModel/tutorModel 下拉中；③ ConfigPermissions 的模型多选下拉中 |
| **阶段定义** | **NEW** | 模板输入 | 预定义可选阶段列表（orientation/planning/inquiry/argumentation/revision）。Admin 可增删阶段类型。定义后在模板构建器的阶段序列多选（可拖拽排序）中可选 |

**角色自动推导逻辑（现有代码 `_derive_enabled_scaffold_roles`）：**

| aiMode | processMode | 自动激活的 Agent 角色 |
|---|---|---|
| `single_agent` | `off` | cognitive_support（仅认知支持） |
| `single_agent` | `on` | 全部 4 个角色（认知支持 + 观点挑战 + 反馈追问 + 问题推进） |
| `multi_agent` | `off` | 全部 4 个角色 |
| `multi_agent` | `on` | 全部 4 个角色 |

运行时，编排引擎根据 `preferred_subagent`、`rule_type`、`current_stage` 等上下文，在已激活的角色中**自动选择**最合适的 Agent 进行干预。Admin 无需、也不应在模板中手动指定角色组合。

**模型池数据结构（新增 config key: `research_model_pool`）：**
```json
[
  {
    "id": "gpt-4o",
    "name": "GPT-4o",
    "provider": "openai",
    "base_url": "https://api.openai.com/v1"
  },
  {
    "id": "MiniMax-Text-01",
    "name": "MiniMax-Text-01",
    "provider": "minimax",
    "base_url": "https://api.minimaxi.chat/v1"
  }
]
```

**阶段定义数据结构（新增 config key: `research_stage_definitions`）：**
```json
[
  {"id": "orientation", "label": "问题定向", "order": 1},
  {"id": "planning", "label": "方案规划", "order": 2},
  {"id": "inquiry", "label": "探究执行", "order": 3},
  {"id": "argumentation", "label": "论证建构", "order": 4},
  {"id": "revision", "label": "修订完善", "order": 5}
]
```

#### 4.1.2 二级 Tab B: 模板构建器 (Template Builder) ← 核心新功能

Admin 从基础组件库中选择各项，**组合**成实验模板。不再是手填字符串 ID，而是通过下拉/多选引用已定义的基础组件。

**模板创建表单：**

```
┌────────────────────────────────────────────────────────────────┐
│  模板构建器                                                     │
│                                                                │
│  基础信息：                                                     │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ 模板ID: [exp-2x2-cognitive-v2____]  标签: [2×2认知支架实验] │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  实验条件组合：                                                 │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ AI支架模式:  [▼ single_agent]                             │ │
│  │              ├ single_agent                               │ │
│  │              └ multi_agent                                │ │
│  │                                                           │ │
│  │ 过程支架:    [▼ on]                                       │ │
│  │              ├ on                                         │ │
│  │              └ off                                        │ │
│  │                                                           │ │
│  │ 干预规则集:  [▼ 研究默认规则集（影子模式）]                   │ │
│  │              ├ 研究默认规则集（影子模式）                    │ │
│  │              └ 研究默认规则集 + 群聊短提示                   │ │
│  │              ← 下拉选项来自基础组件库的规则集列表              │ │
│  │                                                           │ │
│  │ 阶段序列:    拖拽排序多选                                  │ │
│  │  ☑ 问题定向  ☑ 方案规划  ☑ 探究执行  ☑ 论证建构  ☑ 修订完善 │ │
│  │  ← 选项来自基础组件库的阶段定义                              │ │
│  │                                                           │ │
│  │ 默认模型:    [▼ GPT-4o]                                   │ │
│  │              ← 选项来自基础组件库的模型池                    │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  组别条件:  [single_agent_process_on______________]             │
│  教师摘要:  [单AI条件下保留过程支架，用于基础实验组。__________] │
│                                                                │
│  预览：解析后的 experiment_version:                              │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ mode: "research"                                         │ │
│  │ ai_scaffold_mode: "single_agent"                          │ │
│  │ process_scaffold_mode: "on"                               │ │
│  │ enabled_rule_set: "research-default"                      │ │
│  │ stage_sequence: [orientation, planning, inquiry, ...]     │ │
│  │ enabled_scaffold_roles: [evidence_researcher, ...]        │ │
│  │   ↑ 根据 aiMode × processMode 自动推导，无需手动选择        │ │
│  │ graph_version: "research-graph-v2"                        │ │
│  └──────────────────────────────────────────────────────────┘ │
│                                                                │
│  注：Agent 角色由编排引擎运行时根据学情自动调度，                 │
│  模板仅通过 aiMode + processMode 决定激活范围。                  │
│                                                                │
│  [保存模板]  [取消]                                             │
└────────────────────────────────────────────────────────────────┘
```

**已有模板列表：** 模板构建器下方展示已有模板卡片，每个卡片显示其组合摘要（AI模式 × 过程支架 × 规则集），支持编辑、复制、删除、切换 published 状态。

**关键约束：**
- 规则集下拉选项必须来自基础组件库中已定义的规则集（引用完整性）
- 阶段序列的选项来自基础组件库的阶段定义
- 删除基础组件库中的某规则集/阶段时，校验是否被模板引用，给出警告
- Agent 角色**不是**模板的可选项——由 `aiMode` × `processMode` 自动推导（`_derive_enabled_scaffold_roles`），运行时编排引擎根据 `preferred_subagent / rule_type / current_stage` 自动选择调用

#### 4.1.3 二级 Tab C: 编排策略

保持现有功能（graph_version、路由策略、RAG策略等），增强点：

| 增强 | 说明 |
|---|---|
| **graph_version 改为下拉** | 从自由文本改为下拉选择（research-graph-v1 / research-graph-v2 / research-graph-v3-stage-aware） |
| **模型选择改为下拉** | groupChatModel 和 tutorModel 从自由文本改为下拉，选项来自基础组件库的模型池 |

#### 4.1.4 版本发布快照（保持现有逻辑）

"发布版本快照"按钮将基础组件库 + 模板构建器的当前状态 + 编排策略一并冻结为 Release。逻辑不变，但快照内容增加模型池和阶段定义。

### 4.2 Tab 3: 系统配置增强

| 增强 | 说明 |
|---|---|
| **新增模型池价格配置** | 在 SystemConfig 中增加 `model_pricing` key，存储各模型的 input/output 每 1K token 价格，供 AI 成本追踪使用（未来功能）。 |

### 4.3 Tab 1: 用户管理增强

| 增强 | 说明 |
|---|---|
| **教师标签/分组** | User 模型增加 `teacher_tags: List[str]` 字段。Admin 可给教师打标签（如"认知组"、"对照组"、"2024秋季"），ConfigPermissions 中可按标签批量筛选和分配权限。 |
| **教师列表过滤** | UserManager 增加按标签/tag 过滤功能 |

---

## 五、Tab 6: 数据管理 (`DataManagement`)

### 5.1 定位

数据管理聚焦**研究数据**的管理：存储、保留、清理、导出、备份。只做底层数据操作，不做数据分析（分析是教师/研究人员导出数据后在自己的工具里做）。

### 5.2 功能模块（精简）

| 模块 | 功能 | 优先级 |
|---|---|---|
| **存储概览** | 总用量、按项目排名、按文件类型分布 | 高 |
| **数据保留 & 清理** | 按 collection 预览过期记录数、手动触发清理、区分研究数据/运维数据的保留策略 | 高 |
| **项目管理** | 归档/取消归档、项目删除（软删除+延迟硬删除）、批量归档 | 中 |
| **研究数据导出** | 统一导出中心：行为日志、研究事件、群聊记录、AI对话记录、项目协作摘要、跨组对比 Excel | 高 |
| **配置备份/恢复** | SystemConfig + ResearchConfig 的 JSON 导出/导入 | 低 |

### 5.3 研究数据 vs 运维数据的保留策略

| 数据类型 | Collection | 性质 | 建议保留 |
|---|---|---|---|
| 群聊消息 | `group_chat` | 研究核心数据 | 长期保留 |
| AI 对话 | `ai_tutor_transcripts` | 研究核心数据 | 长期保留 |
| 研究事件 | `research_events` | 研究核心数据 | 长期保留 |
| 活动日志 | `activity_logs` | 研究辅助数据 | 中期保留（如 365 天） |
| 协作文档 | `documents/annotations` | 研究核心数据 | 长期保留 |
| 行为流 | `behavior_stream` | 运维数据 | 短期保留（如 90 天） |
| 心跳 | `heartbeat_stream` | 纯运维数据 | 最短保留（如 7 天） |
| 系统日志 | `system_logs` | 运维数据 | 中期保留（如 180 天） |

在 RetentionCleanup UI 中明确标注数据类型（研究数据/运维数据），研究数据默认不可一键清理。

### 5.4 后端新增 API

与 v2 方案中的数据管理 API 基本一致，去除协作特有导出即可。详见附录。

### 5.5 前端组件结构

```
frontend/src/components/features/manager/datamanagement/
├── DataManager.tsx
├── StorageOverview.tsx
├── RetentionCleanup.tsx
├── ProjectManager.tsx
├── ExportCenter.tsx
└── BackupPanel.tsx
```

---

## 六、后端新增文件清单

```
backend/app/api/v1/admin_permissions.py      # 配置权限 API（教师权限 CRUD、可用选项）
backend/app/api/v1/admin_data.py             # 数据管理 API（存储、清理、归档、导出、备份）
backend/app/services/config_permission_service.py  # 权限校验服务（供下游 API 调用）
backend/app/services/data_retention.py        # 数据保留策略执行服务
backend/app/services/storage_stats.py         # 存储统计聚合服务
```

**修改现有文件：**

| 文件 | 改动 |
|---|---|
| `backend/app/repositories/user.py` | User 增加 `config_permissions`、`teacher_tags` 字段 |
| `backend/app/api/v1/courses.py` | `get_experiment_templates` 按教师权限过滤；`create_course`/`update_course` 中校验模板权限 |
| `backend/app/services/research_config_service.py` | `resolve_template_binding()` 增加 `teacher_id` 参数，校验权限；支持新增的 model_pool 和 stage_definitions config keys |
| `backend/app/api/v1/admin.py` | 用户管理增加 tag 相关操作；SystemConfig 增加 model_pricing；新增 model_pool / stage_definitions 的 config key 读写 |
| `backend/app/main.py` | 注册 `admin_permissions`、`admin_data` 路由 |

---

## 七、前端新增/修改文件清单

```
新增：
frontend/src/components/features/manager/configpermissions/
├── ConfigPermissions.tsx
├── TeacherPermissionRow.tsx
├── PermissionMultiSelect.tsx
└── BatchPermissionDialog.tsx

frontend/src/components/features/manager/datamanagement/
├── DataManager.tsx
├── StorageOverview.tsx
├── RetentionCleanup.tsx
├── ProjectManager.tsx
├── ExportCenter.tsx
└── BackupPanel.tsx

修改：
frontend/src/pages/manager/AdminDashboard.tsx
    # TabType + NAV_ITEMS + lazy imports
frontend/src/services/api/admin.ts
    # 新增 permissions + data 相关 API 方法
frontend/src/config/api.ts
    # 新增 API endpoint 常量
frontend/src/components/features/manager/research/ResearchConfig.tsx
    # 重构为二级 Tab 结构（基础组件库 / 模板构建器 / 编排策略）+ 新增模型池和阶段定义
frontend/src/components/features/manager/usermanagement/UserManager.tsx
    # 增加教师标签编辑功能
```

---

## 八、分期实施建议

### 第一期：配置权限核心（3-4 周）← 最高优先

| 内容 |
|---|
| User 模型增加 `config_permissions`（3 维：templates / rule_profiles / models）+ `teacher_tags` 字段 |
| ConfigPermissions 完整前后端（教师列表 + 3 列权限矩阵 + 多选下拉 + 批量分配） |
| ResearchConfig 重构：基础组件库（新增模型池 + 阶段定义）+ 模板构建器（下拉组合替代手填ID） |
| `GET /courses/experiment-templates` 权限过滤（按 `allowed_template_ids` 过滤返回） |
| UserManager 增加教师标签功能 |

### 第二期：权限下游全面覆盖（2-3 周）

| 内容 | 理由 |
|---|---|
| Course 创建/更新时的模板 + 规则集权限校验 | 堵住绕过权限的入口 |
| `research_config_service` 权限感知 | 确保模板解析也过滤 |
| LLM 调用时的模型权限校验 | 控制模型使用 |

### 第三期：数据管理（2-3 周）

| 内容 | 理由 |
|---|---|
| StorageOverview + RetentionCleanup | 存储/清理是运维刚需 |
| ExportCenter（研究数据导出） | 支撑论文/分析 |
| ProjectManager（归档/删除） | 项目管理刚需 |

### 第四期：运维增强（1-2 周）

| 内容 | 理由 |
|---|---|
| 配置备份/恢复 | 低频率，放最后 |
| 定时清理 cron | 依赖 RetentionCleanup 稳定 |

---

## 九、与 LangGraph 优化提案的关系

| LangGraph 提案模块 | Admin 面板关联 |
|---|---|
| 1.1-1.5 单 Agent 优化 | 不直接关联 Admin（属于后端引擎优化） |
| 2.1-2.9 多 Agent 并行 | 对应的 Agent 角色需在 Admin 的 ResearchConfig → Agent 角色配置中维护 |
| 3.1-3.6 阶段差异化编排 | 新增的编排模式版本（如 multi_agent / graph_stage_aware）需在 ResearchConfig → 编排策略中作为 `graph_version` 选项可配置 |
| 干预规则 | ResearchConfig 的规则集管理 + ConfigPermissions 的规则集分配 |
| Checkpointer | 不直接关联 Admin 面板（属于后端引擎配置） |

**建议：** LangGraph 优化提案中的新 orchestration mode 先行落地为 `graph_version` 选项，Admin 在 ResearchConfig 中选择默认版本并在发布快照时冻结。教师通过被分配的模板间接使用不同编排版本（模板的 `buildResolvedExperimentVersionSnapshot` 中已包含 `graph_version`）。

---

## 十、关键风险

1. **权限粒度已收窄到 3 维**：模板（组合单元）+ 规则集（附加约束）+ 模型（独立维度），不会出现教师看到空列表的问题。教师端 UI 只显示被授权可用的选项；如果某维度只剩 1 个选项，自动选中且不展示选择器。

2. **向后兼容**：现有教师 `config_permissions` 为 null → 全部可用。不要在有活跃实验的系统中突然收紧权限导致教师无法操作。

3. **权限变更不追溯**：Admin 修改教师权限后，教师已绑定的 Course/Project 不受影响（快照机制），新创建/修改时才校验。

4. **教师端"实验分组"的定位**：Admin 的 ConfigPermissions 控制教师**能使用哪些配置工具**（研究方案分配层）；教师在自己的班级中**为不同班级选择不同的实验模板**来实现实验组/对照组设计（实验操作分配层）。这是两层独立的权限模型。

5. **规则集作为附加约束**：规则集权限独立于模板权限存在。如果教师有权使用模板A（ruleSet = "research-default"）但无权使用 "research-default" 规则集，则模板解析时应拒绝。建议 Admin 在 ConfigPermissions UI 中自动校验模板引用的规则集是否在教师权限中，给出交叉警告提示。

---

## 附录：数据管理 API 详细清单

（与 v2 方案基本一致，精简协作特有部分）

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/admin/data/storage/overview` | 总用量、配额、按类型分布 |
| `GET` | `/admin/data/storage/by-project` | 每项目存储详情 |
| `GET` | `/admin/data/storage/trend` | 存储增长趋势 |
| `GET` | `/admin/data/retention/preview` | 预览各 collection 过期记录数 |
| `POST` | `/admin/data/retention/cleanup` | 执行清理 |
| `GET` | `/admin/data/retention/history` | 清理操作历史 |
| `PUT` | `/admin/data/retention/schedule` | 配置自动清理 |
| `GET` | `/admin/data/projects` | 项目列表 |
| `POST` | `/admin/data/projects/{id}/archive` | 归档 |
| `POST` | `/admin/data/projects/{id}/unarchive` | 取消归档 |
| `POST` | `/admin/data/projects/batch-archive` | 批量归档 |
| `DELETE` | `/admin/data/projects/{id}` | 硬删除 |
| `POST` | `/admin/data/export` | 创建导出任务 |
| `GET` | `/admin/data/export/{task_id}/status` | 导出任务状态 |
| `GET` | `/admin/data/export/{task_id}/download` | 下载导出文件 |
| `GET` | `/admin/data/export/history` | 导出历史 |
| `GET` | `/admin/data/backup/config` | 导出 SystemConfig |
| `POST` | `/admin/data/backup/config/restore` | 恢复 SystemConfig |
| `GET` | `/admin/data/db-stats` | MongoDB 统计 |
