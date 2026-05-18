# LangGraph 编排优化建议

## 当前架构

```
用户消息 → agent_service.chat_stream()
              │
              ├─ 1. RAG 检索 (图外)
              ├─ 2. 确定性路由 (图外, derive_routing_decision_from_context)
              │
              └─ 3. LangGraph 图执行 (astream_events)
                    │
                    ├─ [supervisor] ── 确定性约束命中? → 跳过LLM, 直接路由
                    │                      └─ 未命中 → LLM JSON决策
                    │
                    ├─ [evidence_researcher] ──→ END
                    ├─ [viewpoint_challenger] ──→ END
                    ├─ [feedback_prompter]   ──→ END
                    └─ [problem_progressor]  ──→ END
```

调用方：HTTP API (`api/v1/ai.py`) 和 WebSocket (`chat_handler.py`)。存在独立的 `ai_service.py`，是另一条不依赖 LangGraph 的直连 LLM 路径。

---

## 一、单 Agent 优化（低风险，可直接实施）

### 1.1 扩大确定性路由覆盖范围

**问题：** Supervisor 的 LLM 调用增加首 token 延迟。当前确定性路由已覆盖 `preferred_subagent`、`rule_type`、`current_stage`，但实际场景中大部分用户消息可被关键词匹配精准命中。

**建议：** 在 `supervisor_node` 中增加一层中文关键词匹配，常见提问模式直接映射到 agent，减少 LLM 调用频率。

| 用户提问模式 | 关键词 | 直接路由到 |
|---|---|---|
| "这个有什么证据" / "来源是什么" | 证据、来源、出处、根据 | evidence_researcher |
| "有没有其他观点" / "会不会是别的" | 其他观点、反驳、别的可能 | viewpoint_challenger |
| "还要补充什么" / "怎么改进" | 补充、改进、修订、完善 | feedback_prompter |
| "下一步做什么" / "任务是什么" | 下一步、任务、阶段、怎么做 | problem_progressor |

**代价：** 极低，`_select_constrained_subagent` 函数内增加一个关键词优先级层即可。

---

### 1.2 Supervisor 错误恢复

**问题：** `supervisor_node` 的 `try/except` 在异常时返回 `next_step: "FINISH"`，用户收不到任何回复，属于静默失败。

**建议：** 异常时 fallback 到默认 Sub-Agent（如 `evidence_researcher`）生成通用回复，同时记录错误事件到 `research_event_service`。

```python
except Exception as e:
    print(f"!!! SUPERVISOR ERROR: {e}")
    fallback_agent = effective_enabled_subagents[0] if effective_enabled_subagents else subagents[0]["name"]
    state_update = {
        "next_step": fallback_agent,
        "plan": plan,
        "scratchpad": "Supervisor 异常，请根据你的角色直接回应用户。",
        "intervention_mode": "error_fallback",
        "routing_decision": { ... }
    }
```

---

### 1.3 确定性路由逻辑去重

**问题：** 确定性路由在三个位置重复实现，修改规则时需同步三处：

| 位置 | 函数 |
|---|---|
| `deep_agents_shim.py` | `derive_routing_decision_from_context()` — 图外调用 |
| `deep_agents_shim.py` `supervisor_node` 内部 | 同逻辑内联 — 图内确定性路径 |
| `agent_service.py` `chat_stream()` | 第 4 步 fallback 再次调用 |

**建议：** 删除 `supervisor_node` 内部的内联逻辑，统一调用 `derive_routing_decision_from_context()`。删除 `chat_stream()` 中的二次 fallback 调用，让图的 output state 携带路由决策。

**文件：** `backend/app/services/agents/deep_agents_shim.py`、`agent_service.py`

---

### 1.4 增加 Checkpointer 做状态持久化

**问题：**
- `config` 传了 `thread_id`，但 `workflow.compile()` 无 `checkpointer`，状态不持久化
- `plan` 跨轮丢失，Supervisor 每轮从零规划
- Sub-Agent 看不到上一轮其他 Sub-Agent 的回答

**建议：** 编译图时传入 checkpointer：

```python
from langgraph.checkpoint.sqlite import SqliteSaver

checkpointer = SqliteSaver.from_conn_string("checkpoints.db")
workflow.compile(checkpointer=checkpointer)
```

同时让调用方把完整消息历史写入 `state["messages"]`（而非仅传最后一条），`operator.add` 自动追加。

**代价：** SQLite/Postgres 依赖，checkpoint 序列化有轻微性能开销。

---

### 1.5 Sub-Agent 上下文窗口管理

**问题：** Sub-Agent 的 system prompt 中直接拼接 `rag_context`、`project_task_context`、`stage_memory_context`、`group_peer_context`、`group_ai_context`，无 token 预算控制。`ai_service.py` 有 `truncate_context()` 和 `MAX_CONTEXT_TOKENS = 8000`，但 `deep_agents_shim.py` 完全没有。

**建议：** 在 `sub_agent_node_factory` 的 `_node` 中加入 token 预算控制：

| 上下文类型 | 优先级 | token 上限 |
|---|---|---|
| RAG 检索结果 | 高 | 1500 |
| 项目任务说明 | 高 | 600 |
| 阶段滚动记忆 | 中 | 500 |
| 群组讨论记忆 | 中 | 500 |
| 群组 AI 互动记忆 | 低 | 300 |

按优先级截断，确保 system prompt + injected context ≤ 4000 token，为生成预留足够空间。

**文件：** `backend/app/services/agents/deep_agents_shim.py`

---

## 二、多 Agent 并行回复设计（中等风险，需前端配合）

### 目标

1. Supervisor 判断需激活哪几个 Sub-Agent（1～4 个）
2. 被选中的 Sub-Agent 并行生成回复
3. 所有回复输出给用户，每段标明来源角色
4. Sub-Agent 的思考过程以可折叠形式流式展示

---

### 2.1 图结构改造：Fan-out → Fan-in

**当前：**

```
supervisor → 单个 sub_agent → END
```

**改造后：**

```
                    ┌─→ [evidence_researcher] ─┐
                    ├─→ [viewpoint_challenger] ─┤
supervisor ──Send()─┼─→ [feedback_prompter]   ─┼─→ [synthesizer] → END
                    └─→ [problem_progressor]  ──┘
```

**实现：** 使用 LangGraph 的 `Send()` API 实现条件 fan-out：

```python
from langgraph.graph import END, Send

def route_to_agents(state: DeepAgentState):
    active = state.get("active_agents", [])
    instructions = state.get("agent_instructions", {})
    if not active:
        return "FINISH"
    if len(active) == 1:
        return active[0]  # 单 agent 保持确定性路由
    return [
        Send(agent, {"agent_instruction": instructions.get(agent, "")})
        for agent in active
    ]

workflow.add_conditional_edges("supervisor", route_to_agents, {
    **{sa["name"]: sa["name"] for sa in subagents},
    "FINISH": END,
})

# 所有 sub_agent 的输出边从 END 改为 synthesizer
for sa in subagents:
    workflow.add_edge(sa["name"], "synthesizer")

workflow.add_edge("synthesizer", END)
```

`Send()` 返回多个目标时，LangGraph 自动并行执行，所有分支完成后汇聚到 `synthesizer`。

**文件：** `backend/app/services/agents/deep_agents_shim.py`

---

### 2.2 Supervisor 决策改造：从单选到多选

**当前输出：**

```json
{"next_step": "evidence_researcher", "updated_plan": [...], "instruction": "..."}
```

**改造后输出：**

```json
{
  "active_agents": [
    {"name": "evidence_researcher", "instruction": "查找与'XX'相关的证据"},
    {"name": "viewpoint_challenger", "instruction": "从反方角度挑战'XX'"}
  ],
  "updated_plan": [...],
  "reasoning": "用户需要证据补充和观点对比，因此激活资料研究员和观点挑战者"
}
```

**Supervisor system prompt 增加：**

```
你可以选择激活 1 到 4 个支架角色同时回复。选择依据：
- 用户问题单一明确 → 只激活最匹配的 1 个角色
- 用户问题需要多角度分析 → 激活 2-3 个角色
- 一般不超过 3 个角色，除非问题特别复杂
- 禁止激活 4 个角色同时输出，避免信息过载
```

**确定性路由扩展：** 阶段/规则模糊时可返回 2 个候选，如证据探究阶段同时激活 `evidence_researcher` + `feedback_prompter`。

---

### 2.3 状态定义扩展

```python
class DeepAgentState(TypedDict):
    messages: Annotated[List[BaseMessage], operator.add]
    plan: List[str]
    context: Dict[str, Any]

    # 新增字段
    active_agents: List[str]                        # Supervisor 选中的 agent 列表
    agent_instructions: Dict[str, str]               # 每个 agent 的指令
    agent_outputs: Annotated[Dict[str, str], lambda a, b: {**a, **b}]  # 每个 agent 的最终输出
    agent_thinkings: Annotated[Dict[str, str], lambda a, b: {**a, **b}]  # 每个 agent 的思考过程

    next_step: str
    scratchpad: str
    intervention_mode: str
    routing_decision: Dict[str, Any]
```

**文件：** `backend/app/services/agents/state.py`、`deep_agents_shim.py`

---

### 2.4 Sub-Agent 思考过程注入

每个 Sub-Agent 的 system prompt 增加 think 指令：

```
回复时，先用 <think>...</think> 包裹你的分析思路（30-80字），然后输出正式回答。
例如：
<think>该问题涉及因果推断，需先验证证据链完整性，再检查是否有忽略的反例</think>
你的正式回答...
```

`sub_agent_node_factory` 的 `_node` 函数从 `ainvoke()` 改为 `astream()`，通过 `ThinkTagParser` 实时解析 `<think>` 标签。

---

### 2.5 ThinkTagParser 流式解析器

```python
class ThinkTagParser:
    """解析流式输出中的 <think>...</think> 标签，分离思考与回复."""

    def __init__(self, agent_name: str, agent_label: str):
        self.agent_name = agent_name
        self.agent_label = agent_label
        self.buffer = ""
        self.in_think = False
        self.think_done = False
        self.no_think_timeout = 0  # 字符计数

    def feed(self, chunk: str) -> list[dict]:
        """喂入一个 chunk，返回要 yield 的事件列表."""
        events = []
        self.buffer += chunk
        self.no_think_timeout += len(chunk)

        while True:
            if not self.in_think and not self.think_done:
                start = self.buffer.find("<think>")
                if start == -1:
                    # 超过 50 字符仍无 <think>，当作无思考模式
                    if self.no_think_timeout > 50:
                        if self.buffer.strip():
                            events.append({
                                "type": "output",
                                "agent": self.agent_name,
                                "label": self.agent_label,
                                "content": self.buffer,
                            })
                        self.buffer = ""
                        self.think_done = True
                        break
                    if len(self.buffer) < 7 and "<think>".startswith(self.buffer):
                        break  # 等更多数据
                    if self.buffer.strip():
                        events.append({
                            "type": "output",
                            "agent": self.agent_name,
                            "label": self.agent_label,
                            "content": self.buffer,
                        })
                    self.buffer = ""
                    self.think_done = True
                    break

                if start > 0:
                    pre = self.buffer[:start]
                    if pre.strip():
                        events.append({
                            "type": "output", "agent": self.agent_name,
                            "label": self.agent_label, "content": pre,
                        })

                self.buffer = self.buffer[start + 7:]  # 跳过 <think>
                self.in_think = True

            if self.in_think:
                end = self.buffer.find("</think>")
                if end == -1:
                    if self.buffer:
                        events.append({
                            "type": "thinking",
                            "agent": self.agent_name,
                            "label": self.agent_label,
                            "content": self.buffer,
                        })
                    self.buffer = ""
                    break

                if end > 0:
                    events.append({
                        "type": "thinking",
                        "agent": self.agent_name,
                        "label": self.agent_label,
                        "content": self.buffer[:end],
                    })

                self.buffer = self.buffer[end + 8:]
                self.in_think = False
                self.think_done = True

            if self.think_done:
                if self.buffer:
                    events.append({
                        "type": "output",
                        "agent": self.agent_name,
                        "label": self.agent_label,
                        "content": self.buffer,
                    })
                self.buffer = ""
                break

        return events

    def flush(self) -> list[dict]:
        """流结束时的收尾."""
        events = []
        if self.buffer.strip():
            etype = "thinking" if self.in_think else "output"
            events.append({
                "type": etype,
                "agent": self.agent_name,
                "label": self.agent_label,
                "content": self.buffer,
            })
        return events
```

**文件：** `backend/app/services/agents/think_tag_parser.py`（新建）

---

### 2.6 Synthesizer 节点

不调用 LLM，纯做格式化。将多个 agent 的输出合并：

```python
async def synthesizer_node(state: DeepAgentState):
    active = state.get("active_agents", [])
    outputs = state.get("agent_outputs", {})

    # 单 agent 直接透传，不添加 role 标签
    if len(active) == 1:
        agent_name = active[0]
        return {"messages": [AIMessage(content=outputs.get(agent_name, ""))]}

    # 多 agent → 格式化输出
    sections = []
    for agent_name in active:
        label = SUBAGENT_LABELS.get(agent_name, agent_name)
        output = outputs.get(agent_name, "")
        if output:
            sections.append(f"**【{label}】**\n\n{output}")

    final = "\n\n---\n\n".join(sections)
    return {"messages": [AIMessage(content=final)]}
```

**注意：** Thinking 内容不进入 `messages`，只通过 streaming 事件传给前端。

---

### 2.7 结构化流式协议

`agent_service.chat_stream()` 返回类型从 `AsyncGenerator[str]` 改为 `AsyncGenerator[Dict]`：

**新增事件类型：**

| 事件 `type` | 含义 | 字段 |
|---|---|---|
| `supervisor_thinking` | Supervisor 的决策推理 | `content` |
| `thinking_start` | 某个 Sub-Agent 开始思考 | `agent`, `label` |
| `thinking` | 思考内容流式 chunk | `agent`, `label`, `content` |
| `thinking_end` | 思考阶段结束 | `agent` |
| `output_start` | 某个 Sub-Agent 开始输出回复 | `agent`, `label` |
| `output` | 回复内容流式 chunk | `agent`, `label`, `content` |
| `output_end` | 某个 Sub-Agent 回复完成 | `agent` |
| `done` | 全部 agent 完成 | `final_content` |

**文件：** `backend/app/services/agents/agent_service.py`

---

### 2.8 调用方适配

#### HTTP SSE (`api/v1/ai.py`)

```python
async for event in agent_service.chat_stream(...):
    if event["type"] == "thinking":
        yield _sse_event("thinking", event)
    elif event["type"] == "output":
        yield _sse_event("delta", event["content"])
    elif event["type"] == "done":
        yield _sse_event("done", {
            "conversation_id": str(conversation.id),
            "final_content": event.get("final_content"),
        })
```

#### WebSocket (`chat_handler.py`)

```python
async for event in agent_service.chat_stream(...):
    if event["type"] in ("thinking_start", "thinking", "thinking_end"):
        await sio.emit("operation", {
            "type": "ai_thinking",
            "subtype": event["type"],
            "agent": event["agent"],
            "label": event["label"],
            "content": event.get("content"),
        }, room=room_id)
    elif event["type"] in ("output_start", "output", "output_end"):
        await sio.emit("operation", {
            "type": "ai_output",
            "subtype": event["type"],
            "agent": event["agent"],
            "label": event["label"],
            "content": event.get("content"),
        }, room=room_id)
    elif event["type"] == "done":
        await sio.emit("operation", {
            "type": "ai_done",
            "messageId": message_id,
            "final_content": event.get("final_content"),
        }, room=room_id)
```

---

### 2.9 前端展示建议

**主消息区（多 agent 回复）：**

```
┌─────────────────────────────────────────────┐
│  【资料研究员】                               │
│  根据项目中的《XX实验报告》，该结论有3条证据   │
│  支持但存在1处出处不明...                     │
│                                             │
│  ─────────────────────────────────────      │
│                                             │
│  【观点挑战者】                               │
│  如果从对照组数据看，这个解释有另一种可能：    │
│  实验组的差异可能来自...                      │
│                                             │
│  ─────────────────────────────────────      │
│  📋 收起思考过程 ▲                           │
└─────────────────────────────────────────────┘
```

**折叠的思考区（默认折叠）：**

```
┌─────────────────────────────────────────────┐
│  📋 查看思考过程                         ▼   │
│  ─────────────────────────────────────────  │
│  🔄 路由协调器：根据当前证据探究阶段和小组     │
│      讨论内容，决定激活资料研究员和观点挑战者   │
│                                             │
│  📚 资料研究员思考：需要先确认证据来源，       │
│      再补充背景知识帮助理解                   │
│                                             │
│  ⚔️ 观点挑战者思考：用户结论缺少反例比较，     │
│      应从实验设计的局限性入手                 │
└─────────────────────────────────────────────┘
```

---


---

## 三、基于协作阶段的差异化编排设计（高优先级，架构核心）

### 设计动机

当前系统对不同协作阶段使用同一种编排模式：Supervisor 选一个 Sub-Agent → 生成回复 → 结束。但不同阶段的学习需求本质不同：

- **问题建构**时，学习者需要的是任务澄清、范围界定和初步方向，不是多角度发散。
- **意义探索**时，学习者需要多视角、多立场的输入以打开思路，单一角色的回复过于狭窄。
- **解释整合**时，学习者已经有了多种观点，需要的是比较、碰撞和收敛，Agent 之间应能互相检视对方的输出。
- **应用解决**时，学习者需要从证据到判断到方案的完整推理链，Agent 应按逻辑顺序接力。

因此，编排模式应根据「协作阶段 × 学习者提问意图」动态选择。

---

### 3.1 四种编排模式

#### 模式 A：SINGLE — 单代理聚焦

**适用场景：** 问题明确、任务单一，只需一个角色介入。

```
supervisor → [选中的 agent] → END
```

**图结构：** 无需改动，当前已支持。

**示例：** "下一阶段我们要做什么？" → `problem_progressor` 单独回答。

---

#### 模式 B：PARALLEL — 多代理平行发散

**适用场景：** 需要多角度、多立场的独立观点输入，各代理互不知晓彼此输出。

```
                    ┌─→ [evidence_researcher] ─┐
                    ├─→ [viewpoint_challenger] ─┤
supervisor ──Send()─┼─→ [feedback_prompter]   ─┼─→ [synthesizer] → END
                    └─→ [problem_progressor]  ──┘
```

**关键特征：**

- 所有代理同时启动，完全异步并行
- 各代理只看到用户原始问题 + 各自 instruction，互不可见对方输出
- Synthesizer 合并输出，按角色分区展示

**示例：** "人工智能会取代老师吗？" → 四个角色同时从资料、挑战、反思、推进四个角度给出独立回答。

---

#### 模式 C：DEBATE — 多代理对话碰撞

**适用场景：** 需要代理间互相检视、挑战、补充，形成观点碰撞与收敛。

```
Round 1:
supervisor → evidence_researcher (给出初始分析)

Round 2:
evidence_researcher 的输出
         ↓
supervisor → viewpoint_challenger (针对 R1 输出提出挑战)
           → feedback_prompter (针对 R1 输出追问修订方向)

Round 3:
R1+R2 的输出
         ↓
supervisor → problem_progressor (综合所有观点给出推进建议)

最终：
synthesizer → 合并所有轮次的对话为结构化回复
```

**关键特征：**

- 分轮执行，每轮最多 2 个代理并行
- 后轮代理能看到前轮代理的完整输出，可以在 system prompt 中引用
- Supervisor 在每轮之间进行轻量决策：基于前轮输出判断下一轮需要哪些代理
- 最多 3 轮，防止对话发散

**图结构实现：** 使用 LangGraph 的多步循环 + Send：

```python
# 状态中新增辩论轮次追踪
class DeepAgentState(TypedDict):
    ...
    debate_round: int                          # 当前辩论轮次
    debate_history: List[Dict]                 # 每轮的代理输出
    debate_max_rounds: int                     # 最大轮次（通常 2-3）

# 图结构
workflow.add_node("supervisor", supervisor_node)           # 决定本轮激活谁
workflow.add_node("debate_aggregator", debate_aggregator)  # 本轮结果聚合
workflow.add_node("synthesizer", synthesizer)

# supervisor → fan-out 到本轮选中的 agents
workflow.add_conditional_edges("supervisor", fan_out_agents, routing_map)

# 所有 agent → debate_aggregator
for sa in subagents:
    workflow.add_edge(sa["name"], "debate_aggregator")

# debate_aggregator → supervisor (下一轮) 或 synthesizer (结束)
workflow.add_conditional_edges("debate_aggregator", check_debate_continue, {
    "continue": "supervisor",
    "finish": "synthesizer",
})

workflow.add_edge("synthesizer", END)
```

---

#### 模式 D：PIPELINE — 多代理串联接力

**适用场景：** 需要从证据收集 → 挑战检验 → 修订完善 → 方案输出的完整逻辑链。

```
supervisor
    │
    ├─ Step 1: evidence_researcher  收集证据与资料
    │          输出注入 state.scratchpad
    │
    ├─ Step 2: viewpoint_challenger 读取 Step 1 输出，从反面检验
    │          输出追加到 state.scratchpad
    │
    ├─ Step 3: feedback_prompter    读取前两步输出，追问证据质量和修订空间
    │          输出追加到 state.scratchpad
    │
    └─ Step 4: problem_progressor   综合前三步，给出最终方案
               输出作为最终回复
```

**关键特征：**

- 严格顺序执行：Step N 的 system prompt 中注入 Step 1..N-1 的完整输出
- 不是简单的 "A 输出 → B 输入"，而是逐步累积上下文
- 最终回复只有一个（最后一个 agent 的输出），但前端可展开看每个步骤的中间产物
- 延迟 ≈ 4 个 agent 串行时间（较长），仅用于严格的推理链场景

**图结构实现：**

```python
# 使用 LangGraph 的条件边实现串行步进
def pipeline_router(state):
    step = state.get("pipeline_step", 0)
    steps = state.get("pipeline_plan", [])
    if step >= len(steps):
        return "synthesizer"
    return steps[step]

workflow.add_node("pipeline_step_executor", pipeline_step_executor)
workflow.set_entry_point("pipeline_step_executor")

# pipeline_step_executor 执行当前步骤后，自增 step 并返回下一跳
workflow.add_conditional_edges("pipeline_step_executor", pipeline_router, {
    **{sa["name"]: sa["name"] for sa in subagents},
    "synthesizer": "synthesizer",
})
```

---

### 3.2 四阶段及其编排策略

#### 四阶段模型

```
问题建构 → 意义探索 → 解释整合 → 应用解决
  (发散)     (发散)     (收敛)     (收敛)
```

每个阶段的认知目标、学习者需求、代理协作方式均不同。

---

#### 阶段一：问题建构（Problem Construction）

| 维度 | 描述 |
|---|---|
| **认知目标** | 识别问题、界定范围、明确任务边界、提出初始疑问 |
| **学习者需求** | "我们要解决什么问题？""从哪里开始？""需要哪些资源？" |
| **编排模式** | **SINGLE**（主导）+ 可选 PARALLEL 双代理 |
| **主导代理** | `problem_progressor` |
| **辅助代理** | `evidence_researcher`（提供背景概念和任务说明） |
| **RAG 策略** | 优先检索 `task_brief`、`concept` 类型 Wiki + 项目文档 |
| **输出特点** | 聚焦问题澄清、任务拆解、下一步建议 |

**编排逻辑：**

```
1. 如果用户消息包含 "第一步"、"怎么开始"、"问题"、"任务" → SINGLE: problem_progressor

2. 如果用户消息包含 "背景"、"了解"、"基本概念" 且处于问题建构阶段
   → PARALLEL: problem_progressor + evidence_researcher

3. 如果当前阶段 = problem_construction 且无其他触发
   → SINGLE: problem_progressor
```

**Supervisor instruction 示例：**
> "当前处于问题建构阶段，学习者正在界定问题范围。请帮助澄清任务边界，逐步拆解问题，引导明确第一步。不要过早跳到证据探究或观点比较。"

---

#### 阶段二：意义探索（Meaning Exploration）

| 维度 | 描述 |
|---|---|
| **认知目标** | 收集多元信息、探索不同视角、建立初步理解、发散头脑风暴 |
| **学习者需求** | "有哪些不同的看法？""这个问题可以从哪些角度理解？""相关资料说了什么？" |
| **编排模式** | **PARALLEL**（主要）/ **DEBATE**（深入碰撞） |
| **主导代理** | `evidence_researcher` + `viewpoint_challenger` 联合 |
| **辅助代理** | `feedback_prompter`（追问深度） |
| **RAG 策略** | 广泛检索 wiki + resource，覆盖多种 `item_type` |
| **输出特点** | 多角度并行输出，各代理给出独立观点，帮助学习者打开思路 |

**编排逻辑：**

```
1. 如果用户消息包含 "有哪些观点"、"不同角度"、"资料"、"证据"
   → PARALLEL: evidence_researcher + viewpoint_challenger [+ feedback_prompter]

2. 如果用户对某个具体观点追问
   → SINGLE: evidence_researcher（聚焦该观点的证据）

3. 如果当前阶段 = meaning_exploration 且用户消息较开放
   → PARALLEL: 至少 2 个代理

4. 如果检测到用户需要深入碰撞（"你觉得XX对吗""有没有不同意见"）
   → DEBATE: evidence_researcher 先给分析 → viewpoint_challenger 挑战 → feedback_prompter 收束
```

**PARALLEL 输出示例：**

```
【资料研究员】
根据检索到的 3 篇文献，'游戏化学习'主要从动机理论和心流理论...

【观点挑战者】
但上述视角忽略了一个关键问题：外部奖励是否削弱内在动机？
Deci & Ryan 的自我决定理论提出了不同看法...

【反馈追问者】
请思考：你目前的判断是基于直觉还是可检验的证据？
如果需要修订观点，你会从哪个方面入手？
```

---

#### 阶段三：解释整合（Explanation Integration）

| 维度 | 描述 |
|---|---|
| **认知目标** | 比较不同解释、识别冲突与一致、构建综合理解、形成论证 |
| **学习者需求** | "哪个观点更有道理？""这些证据如何整合？""如何完善我的论证？" |
| **编排模式** | **DEBATE**（主要）/ **PIPELINE**（复杂论证） |
| **主导代理** | `viewpoint_challenger` + `feedback_prompter`（碰撞收敛） |
| **辅助代理** | `evidence_researcher`（补充缺失证据） |
| **RAG 策略** | 定向检索 `claim`、`controversy`、`evidence` 类型 Wiki |
| **输出特点** | 代理间对话式碰撞，展示推理过程，引导学习者做出自己的判断 |

**编排逻辑：**

```
1. 如果用户消息包含 "比较"、"哪个更好"、"对不对"、"完善"、"修订"
   → DEBATE 模式开启：
     Round 1: evidence_researcher 给出当前论证的证据基础
     Round 2: viewpoint_challenger 针对 R1 提出挑战
               feedback_prompter 追问修订方向
     Round 3: problem_progressor 综合前面输出，给出推进建议

2. 如果检测到阶段 = explanation_integration 且 rule_type = counterargument_missing
   → DEBATE: 重点激活 viewpoint_challenger

3. 如果用户需要完整论证链重建
   → PIPELINE: evidence_researcher → viewpoint_challenger → feedback_prompter → problem_progressor
```

**DEBATE 输出示例（前端展示）：**

```
📚 资料研究员（第一轮）：
根据项目资料，当前论证主要依赖 3 条证据：①... ②... ③...
其中①②有明确出处，③的来源标注不完整。

⚔️ 观点挑战者（第二轮 - 针对资料研究员的发现）：
资料研究员指出证据③来源单薄——这意味着你的核心结论有一处
脆弱点。如果换一种解释：'XX 现象也可能是 Y 原因导致的'，
现有的证据能排除这个替代解释吗？

🔍 反馈追问者（第二轮 - 同时回应）：
除了观点挑战者指出的证据缺口，请思考：
- 你的评价标准是什么？'可靠' vs '不可靠'的边界在哪里？
- 如果让你修订原判断，你会修改哪个部分？

📋 问题推进者（第三轮 - 综合）：
综合前面的分析，你的论证有三个待改进点：
1. 补全证据③的出处
2. 增加对替代解释 Y 的排除论证
3. 明确评价标准
建议下一步：先回项目资料库查找证据③的原始来源...
```

---

#### 阶段四：应用解决（Application & Solution）

| 维度 | 描述 |
|---|---|
| **认知目标** | 基于论证做出决策、设计方案、输出应用成果 |
| **学习者需求** | "基于以上分析，我的最终判断是什么？""具体的解决方案是什么？""如何落地？" |
| **编排模式** | **PIPELINE**（主要）/ **SINGLE**（简单方案） |
| **主导代理** | `problem_progressor`（最终输出者） |
| **辅助代理** | 前三者按序输入 |
| **RAG 策略** | 检索 `stage_summary`、`evidence`、`claim` 等已沉淀的 Wiki |
| **输出特点** | 单一最终方案，但附带完整的推理链和中间步骤可展开查看 |

**编排逻辑：**

```
1. 如果用户消息包含 "最终方案"、"解决方案"、"结论"、"怎么做"、"应用"
   → PIPELINE:
     Step 1: evidence_researcher 整理所有相关证据（从 Wiki stage_summary 提取）
     Step 2: viewpoint_challenger 做最终挑战和风险检查
     Step 3: feedback_prompter 审查完整性和修订建议
     Step 4: problem_progressor 综合前三步输出，给出完整方案

2. 如果问题较简单（"基于这个证据我的判断是什么"）
   → SINGLE: problem_progressor

3. 如果当前阶段 = application 且 rule_type = responsibility_risk
   → SINGLE: problem_progressor（强调学习者自主判断）
```

**PIPELINE 输出示例（前端展示）：**

```
📋 完整推理链（点击展开各步骤）：

  ▶ Step 1: 资料研究员 - 证据整理
  ▶ Step 2: 观点挑战者 - 风险与挑战
  ▶ Step 3: 反馈追问者 - 完整性审查
  ▼ Step 4: 问题推进者 - 最终方案

─────────────────────────────────────

基于前面的完整分析，你的最终判断可以表述为：

"结论：XX 更可能是 Y 原因导致的，因为①证据A(出处明确)、
②证据B(经实验验证)、③排除了替代解释Z(证据C支持)..."

下一步行动建议：
1. 将结论记录到协作文档
2. 标注证据链中的薄弱处，作为后续探究方向
3. 与小组讨论是否有遗漏的反方观点

⚠️ 注意：以上是基于现有证据的分析框架，最终判断应由你们
小组讨论后自主做出。
```

---

### 3.3 学习者提问意图检测

同一阶段内，不同提问意图也需要不同编排。以下是与阶段的联合决策矩阵：

#### 意图分类与特征词

| 意图类型 | 特征词/模式 | 趋向模式 |
|---|---|---|
| `clarify_task` | 做什么、任务、下一步、怎么开始、目标 | SINGLE (problem_progressor) |
| `seek_evidence` | 证据、资料、来源、数据、文献、查一下 | SINGLE (evidence_researcher) |
| `explore_perspectives` | 有哪些、不同角度、怎么理解、多种可能 | PARALLEL (2-3 agents) |
| `challenge_view` | 反驳、挑战、不对、另一种、但是 | DEBATE (challenger + feedback) |
| `compare_views` | 比较、区别、优劣、哪个好/对 | DEBATE |
| `improve_argument` | 改进、完善、补充、修订、能不能更好 | SINGLE/DEBATE (feedback_prompter 主导) |
| `seek_synthesis` | 综合、总结、归纳、概括、最终 | PIPELINE |
| `apply_solve` | 解决、方案、应用、结论、怎么做 | PIPELINE |
| `general_chat` | 闲聊、问候、谢谢 | SINGLE (第一个可用 agent) |

#### 阶段 × 意图 联合决策矩阵

| 阶段 ↓ / 意图 → | clarify_task | seek_evidence | explore_perspectives | challenge_view | compare_views | seek_synthesis |
|---|---|---|---|---|---|---|
| **问题建构** | SINGLE prog | SINGLE evid | PARALLEL evid+prog | — | — | — |
| **意义探索** | SINGLE prog | SINGLE evid | PARALLEL all | DEBATE evid→chal | PARALLEL chal+evid | — |
| **解释整合** | — | SINGLE evid | DEBATE evid→chal | DEBATE evid→chal→feed | DEBATE full | PIPELINE full |
| **应用解决** | SINGLE prog | SINGLE evid | — | DEBATE evid→chal | DEBATE evid→chal | PIPELINE full |

(evid=evidence_researcher, chal=viewpoint_challenger, feed=feedback_prompter, prog=problem_progressor)

---

### 3.4 统一 Orchestrator（决策流程）

将阶段匹配和意图检测合并为一个统一的编排决策器 `OrchestrationPlanner`：

```python
class OrchestrationPlanner:
    """根据阶段 + 用户意图 + 规则触发，决定编排模式与代理组合."""

    # 阶段到默认模式的映射
    STAGE_DEFAULT_MODE = {
        "problem_construction": "single",
        "meaning_exploration": "parallel",
        "explanation_integration": "debate",
        "application_solution": "pipeline",
    }

    # 意图关键词
    INTENT_PATTERNS = {
        "clarify_task": ["做什么", "任务", "下一步", "怎么开始", "目标", "计划"],
        "seek_evidence": ["证据", "资料", "来源", "数据", "文献", "查", "找"],
        "explore_perspectives": ["有哪些", "不同角度", "怎么理解", "多种可能", "观点"],
        "challenge_view": ["反驳", "挑战", "不对", "另一种", "但是", "可是"],
        "compare_views": ["比较", "区别", "优劣", "哪个好", "哪个对"],
        "improve_argument": ["改进", "完善", "补充", "修订", "能不能更好"],
        "seek_synthesis": ["综合", "总结", "归纳", "概括", "最终", "整合"],
        "apply_solve": ["解决", "方案", "应用", "结论", "怎么做"],
    }

    # 联合决策矩阵
    ORCHESTRATION_MATRIX = {
        ("problem_construction", "clarify_task"):
            ("single", ["problem_progressor"]),
        ("problem_construction", "seek_evidence"):
            ("single", ["evidence_researcher"]),
        ("problem_construction", "explore_perspectives"):
            ("parallel", ["evidence_researcher", "problem_progressor"]),
        ("meaning_exploration", "seek_evidence"):
            ("single", ["evidence_researcher"]),
        ("meaning_exploration", "explore_perspectives"):
            ("parallel", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter"]),
        ("meaning_exploration", "challenge_view"):
            ("debate", ["evidence_researcher", "viewpoint_challenger"]),
        ("meaning_exploration", "compare_views"):
            ("parallel", ["viewpoint_challenger", "evidence_researcher"]),
        ("explanation_integration", "challenge_view"):
            ("debate", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter"]),
        ("explanation_integration", "compare_views"):
            ("debate", ["evidence_researcher", "viewpoint_challenger", "feedback_prompter"]),
        ("explanation_integration", "improve_argument"):
            ("debate", ["evidence_researcher", "feedback_prompter"]),
        ("explanation_integration", "seek_synthesis"):
            ("pipeline", ["evidence_researcher", "viewpoint_challenger",
                          "feedback_prompter", "problem_progressor"]),
        ("application_solution", "apply_solve"):
            ("pipeline", ["evidence_researcher", "viewpoint_challenger",
                          "feedback_prompter", "problem_progressor"]),
        ("application_solution", "seek_synthesis"):
            ("pipeline", ["evidence_researcher", "viewpoint_challenger",
                          "feedback_prompter", "problem_progressor"]),
        ("application_solution", "seek_evidence"):
            ("single", ["evidence_researcher"]),
        ("application_solution", "challenge_view"):
            ("debate", ["evidence_researcher", "viewpoint_challenger"]),
    }

    @classmethod
    def detect_intent(cls, message: str) -> str:
        """从用户消息中检测核心提问意图."""
        msg_lower = message.lower()
        scores = {}
        for intent, keywords in cls.INTENT_PATTERNS.items():
            score = sum(1 for kw in keywords if kw in msg_lower)
            if score > 0:
                scores[intent] = score
        if not scores:
            return "general_chat"
        return max(scores, key=scores.get)

    @classmethod
    def plan(
        cls,
        *,
        stage: str,
        message: str,
        rule_type: Optional[str] = None,
        preferred_subagent: Optional[str] = None,
        enabled_subagents: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """返回编排计划."""
        # 1. 规则可覆盖阶段默认
        if rule_type:
            rule_to_mode = {
                "evidence_gap": ("single", ["evidence_researcher"]),
                "counterargument_missing": ("debate", ["evidence_researcher", "viewpoint_challenger"]),
                "revision_stall": ("single", ["feedback_prompter"]),
                "responsibility_risk": ("single", ["problem_progressor"]),
            }
            if rule_type in rule_to_mode:
                mode, agents = rule_to_mode[rule_type]
                return cls._build_plan(mode, agents, source="rule_trigger", rule_type=rule_type)

        # 2. 显式 @ 提及优先
        if preferred_subagent and preferred_subagent in (enabled_subagents or []):
            return cls._build_plan("single", [preferred_subagent], source="preferred_subagent")

        # 3. 意图检测
        intent = cls.detect_intent(message)

        # 4. 查联合决策矩阵
        key = (stage, intent)
        if key in cls.ORCHESTRATION_MATRIX:
            mode, agents = cls.ORCHESTRATION_MATRIX[key]
        else:
            # fallback: 阶段默认模式 + 第一个可用 agent
            mode = cls.STAGE_DEFAULT_MODE.get(stage, "single")
            agents = [enabled_subagents[0]] if enabled_subagents else ["evidence_researcher"]

        # 5. 限缩到 enabled_subagents
        if enabled_subagents:
            agents = [a for a in agents if a in enabled_subagents]
            if not agents:
                agents = [enabled_subagents[0]]

        return cls._build_plan(mode, agents, source="matrix", intent=intent)

    @classmethod
    def _build_plan(cls, mode, agents, source, **meta):
        return {
            "orchestration_mode": mode,
            "active_agents": agents,
            "decision_source": source,
            **meta,
        }
```

**集成位置：** 替代 `agent_service.py` 中 `_resolve_rag_plan()` 的角色选择部分。编排计划直接传入图的 `DeepAgentState.orchestration_plan`，图中按 `mode` 字段选择执行路径。

---

### 3.5 兼容旧阶段模型

当前代码中阶段 ID 为 `task_import`、`problem_planning`、`evidence_exploration`、`argumentation`、`reflection_revision`。新的四阶段模型可以与之映射：

| 新四阶段 | 旧五阶段（映射） |
|---|---|
| `problem_construction` | `task_import` + `problem_planning` |
| `meaning_exploration` | `evidence_exploration` |
| `explanation_integration` | `argumentation` |
| `application_solution` | `reflection_revision` |

在 `OrchestrationPlanner.plan()` 入口处做一次映射即可，不破坏现有数据模型：

```python
STAGE_ID_TO_PEDAGOGICAL = {
    "task_import": "problem_construction",
    "problem_planning": "problem_construction",
    "evidence_exploration": "meaning_exploration",
    "argumentation": "explanation_integration",
    "reflection_revision": "application_solution",
}
```

---

### 3.6 图中实现：模式分发

在 `deep_agents_shim.py` 的 `create_deep_agent()` 中，根据 `orchestration_mode` 将图入口分叉：

```python
async def supervisor_node(state: DeepAgentState):
    plan = state.get("orchestration_plan", {})
    mode = plan.get("orchestration_mode", "single")
    agents = plan.get("active_agents", [])

    if mode == "single":
        return {
            "next_step": agents[0] if agents else "FINISH",
            "active_agents": agents,
            "agent_instructions": {agents[0]: "请直接回应用户的问题。"} if agents else {},
        }

    elif mode == "parallel":
        instructions = {}
        for agent in agents:
            label = SUBAGENT_LABELS.get(agent, agent)
            instructions[agent] = (
                f"请从你作为{label}的职责出发，"
                f"独立回应用户的问题。不要参考其他角色的输出。"
            )
        return {
            "next_step": "__parallel__",
            "active_agents": agents,
            "agent_instructions": instructions,
        }

    elif mode == "debate":
        return {
            "next_step": agents[0],
            "active_agents": agents,
            "debate_round": 0,
            "debate_max_rounds": min(len(agents), 3),
        }

    elif mode == "pipeline":
        return {
            "next_step": agents[0],
            "active_agents": agents,
            "pipeline_step": 0,
        }
```

**文件：** `backend/app/services/agents/deep_agents_shim.py`、`agent_service.py`

---

## 四、兼容性与风险控制

### 4.1 渐进式开启

通过 `experiment_version.ai_scaffold_mode` 和 `orchestration_mode` 两个维度控制：

| 模式 | 描述 |
|---|---|
| `single_agent`（现有） | 保持现有 `ai_service.chat_stream()` 直连路径，不经过图 |
| `graph_single`（现有） | 当前图的单 agent 路由模式 |
| `graph_multi`（新增） | 启用多 agent 并行回复 |
| `graph_stage_aware`（新增） | 启用基于阶段的差异化编排（含所有四种模式） |

### 4.2 向后兼容

- 单 agent 模式行为与现有 `graph_single` 完全一致。
- 旧五阶段模型通过 `STAGE_ID_TO_PEDAGOGICAL` 映射无缝接入新编排逻辑。
- 如果前端不传 `current_stage`，编排器回退到 `intent_detection` 单层决策，自动选 SINGLE 模式。

### 4.3 成本与延迟控制

| 模式 | LLM 调用次数 | 延迟特征 |
|---|---|---|
| SINGLE | 1 | 基准 |
| PARALLEL (n agents) | n | ≈ max(所有 agent)，并行执行 |
| DEBATE (n agents, r rounds) | ≤ n×r (每轮 ≤2 并行) | ≈ r × 单 agent 时间 |
| PIPELINE (n steps) | n | ≈ n × 单 agent 时间，最长 |

PIPELINE 延迟最高，仅用于应用解决阶段且用户明确要求完整方案时。

### 4.4 Think 标签兜底

非 DeepSeek 类模型不输出 `<think>` 标签时，`ThinkTagParser` 在 50 字符内未检测到 `<think>` 即切换为无思考模式，全部内容作为输出。

---

## 五、改动范围汇总

| 文件 | 改动类型 | 改动内容 |
|---|---|---|
| `services/agents/state.py` | 修改 | `DeepAgentState` 增加 `active_agents`、`agent_outputs`、`agent_thinkings`、`agent_instructions`、`debate_round`、`pipeline_step` |
| `services/agents/deep_agents_shim.py` | 修改 | 图结构 Send fan-out + synthesizer 节点；supervisor 输出多代理列表及编排模式；sub_agent_node 改为 astream + think 指令；路由逻辑去重；新增 debate_aggregator、pipeline_step_executor |
| `services/agents/agent_service.py` | 修改 | `chat_stream()` 改为 yield 结构化 dict；新增 ThinkTagParser 流式解析；新增 `OrchestrationPlanner` 阶段感知编排决策器；`_resolve_rag_plan()` 适配多模式 |
| `services/agents/think_tag_parser.py` | **新建** | ThinkTagParser 流式标签解析器 |
| `services/agents/orchestration_planner.py` | **新建** | OrchestrationPlanner 阶段×意图联合决策 |
| `core/prompts/personas.py` | 修改 | 四个 Sub-Agent 的 system prompt 增加 think 标签指令；增加 debate/pipeline 阶段的 stage-aware instruction |
| `api/v1/ai.py` | 修改 | SSE 消费端适配结构化事件 |
| `websocket/handlers/chat_handler.py` | 修改 | WebSocket 消费端适配；新增 `ai_thinking` / `ai_output` / `ai_debate_round` 事件广播；传递 `current_stage` 给编排器 |
| **前端** | 修改 | 思考面板组件、多 agent 回复渲染、DEBATE 轮次展示、PIPELINE 步骤展开、折叠交互 |

---

## 六、优先级

| 优先级 | 优化项 | 理由 |
|---|---|---|
| **高** | 1.2 Supervisor 错误恢复 | 修复静默失败 bug |
| **高** | 1.3 确定性路由去重 | 减少维护风险 |
| **高** | 1.1 扩大确定性覆盖 | 改动最小，减少 LLM 调用延迟 |
| **高** | 3.1-3.6 阶段差异化编排 | 核心架构，直接决定不同阶段的学习体验 |
| **中** | 1.4 Checkpointer | 为多步推理和多轮连续性打基础 |
| **中** | 1.5 上下文窗口管理 | 防止 token 超限导致生成截断 |
| **低** | 2.1-2.9 多 Agent 并行回复 | 已被阶段化编排整合，部分可独立先行 |


---

## 七、当前实现 vs 提案设计 逐项对比

### 7.1 图结构

| 维度 | 当前 | 提案 |
|---|---|---|
| 拓扑 | `supervisor → 1 agent → END` 单向 | 根据模式可切换四种拓扑 |
| 单代理模式 | 已支持 SINGLE | 保留不变 |
| 并行模式 | 不支持 | PARALLEL：`Send()` fan-out，所有 agent 同时执行 |
| 循环模式 | 不支持 | DEBATE：`agent → aggregator → supervisor → agent` 多轮循环 |
| 串行模式 | 不支持 | PIPELINE：条件边逐 step 步进 |
| 合成节点 | 不存在 | `synthesizer` 汇聚多 agent 输出，单 agent 时透传 |

### 7.2 路由决策

| 维度 | 当前 | 提案 |
|---|---|---|
| 决策主体 | `derive_routing_decision_from_context` (确定性) + LLM Supervisor (兜底) | 新增 `OrchestrationPlanner` 统一调度，LLM Supervisor 降级为最后备用 |
| 决策粒度 | 只选 1 个 agent | 选模式 + 选 agent 列表（1~4） |
| 决策依据 | `preferred_subagent` → `rule_type` → `current_stage` → LLM | `rule_type` → `@提及` → `意图检测` → `阶段×意图矩阵` → LLM |
| 代码重复 | 三处重复（图内、图外、fallback） | 统一到 `OrchestrationPlanner.plan()` 单一路径 |
| 阶段感知 | 仅用于 route-to-agent 映射 | 直接决定编排模式，四阶段有不同的默认模式 |

### 7.3 Agent 协作方式

| 维度 | 当前 | 提案 |
|---|---|---|
| 协作模式 | **无**——每次只激活 1 个 agent | 四种模式分别对应无协作 / 独立并行 / 对话碰撞 / 接力 |
| Agent 间可见性 | N/A | PARALLEL：互不可见；DEBATE：后轮可见前轮；PIPELINE：逐步累积 |
| 多 agent 输出 | 不可能 | 支持：PARALLEL 和 DEBATE 均可输出多个 agent 的回复 |
| Agent 间对话 | 不存在 | DEBATE 模式中 agent 可针对性回应前序 agent 的输出 |
| 成本上限 | 1 次 LLM 调用 | SINGLE=1, PARALLEL≈n, DEBATE≤n×r, PIPELINE=n（见成本表） |

### 7.4 流式输出协议

| 维度 | 当前 | 提案 |
|---|---|---|
| 返回值 | `AsyncGenerator[str]` 纯文本 | `AsyncGenerator[Dict]` 结构化事件 |
| 事件类型 | 无区分（只有文本 chunk） | `thinking_start/thinking/thinking_end` + `output_start/output/output_end` + `supervisor_thinking` + `done` |
| 思考过程 | 只有 DeepSeek 自带的 `<think>`，无结构化解析 | 通过 `<think>` 标签 + `ThinkTagParser` 流式分离思考与回复 |
| Agent 来源标识 | 无 | 每个事件标注 `agent` 和 `label`，前端可按角色渲染 |
| HTTP SSE | `yield _sse_event("delta", chunk)` | `yield _sse_event("thinking", ...)` / `yield _sse_event("output", ...)` |
| WebSocket | `emit_partial(content)` 全文 | 新增 `ai_thinking`、`ai_output`、`ai_debate_round` 事件类型 |

### 7.5 状态管理

| 维度 | 当前 | 提案 |
|---|---|---|
| 持久化 | `thread_id` 传了但无 checkpointer | `SqliteSaver` / `PostgresSaver` 持久化 |
| Plan 跨轮 | 丢失 | 保留 |
| 消息历史 | 调用方只传最后一条 HumanMessage | 传入完整历史，`operator.add` 自动追加 |
| 新增字段 | — | `active_agents`、`agent_outputs`、`agent_thinkings`、`agent_instructions`、`debate_round`、`pipeline_step`、`orchestration_plan` |

### 7.6 上下文管理

| 维度 | 当前 | 提案 |
|---|---|---|
| Token 预算 | 无控制，直接拼接所有上下文 | 按优先级分级截断（RAG 1500 / 任务 600 / 阶段记忆 500 / 讨论记忆 500） |
| RAG 策略 | 单 agent 时固定策略（role_aware_*） | 根据编排模式动态调整：SINGLE 精准检索，PARALLEL 广泛检索，PIPELINE 分步检索 |
| 上下文注入 | 仅注入到 Sub-Agent system prompt | PARALLEL 每 agent 独立上下文；DEBATE 后轮注入前轮输出；PIPELINE 逐步累积 scratchpad |

### 7.7 错误处理

| 维度 | 当前 | 提案 |
|---|---|---|
| Supervisor 异常 | `next_step: "FINISH"`，用户收不到回复 | Fallback 到默认 agent 生成通用回复 + 记录事件 |
| 路由越界 | LLM 输出不在 enabled_subagents 时做一次修正 | `OrchestrationPlanner` 确保始终在 enabled 范围内 |
| Think 标签缺失 | N/A | `ThinkTagParser` 50 字符后无 `<think>` 切换为无思考模式 |

### 7.8 前端体验

| 维度 | 当前 | 提案 |
|---|---|---|
| 回复展示 | 单段纯文本 | 多 agent 分区展示，标明 **【角色名】** |
| 思考面板 | 不存在 | 可折叠展开，显示 Supervisor 决策理由 + 各 agent 思考过程 |
| DEBATE 轮次 | 不存在 | 分轮次渐进式展示（R1 → R2 → R3） |
| PIPELINE 步骤 | 不存在 | 步骤树展开/折叠，默认展示最终输出 |
| 向后兼容 | — | `graph_stage_aware` 关闭时完全回退到现有行为 |

### 7.9 关键指标对比

| 指标 | 当前 | SINGLE | PARALLEL | DEBATE | PIPELINE |
|---|---|---|---|---|---|
| 每次调用 LLM 次数 | 1(路由)+1(agent)=2 | 1(跳过路由LLM) | n | ≤ n×r | n |
| 首 token 延迟 | ~2s | ~1s | ~1.5s | ~3-5s | ~4-8s |
| 输出丰富度 | 低（单视角） | 低 | 高（多视角并行） | 很高（观点碰撞） | 中（完整推理链） |
| 学习支架契合度 | 一般 | 好（问题建构） | 很好（意义探索） | 很好（解释整合） | 很好（应用解决） |
| 服务器成本/调用 | ~$0.003 | ~$0.001 | ~$0.003 | ~$0.006 | ~$0.006 |
