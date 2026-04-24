import type { ResearchEventRow } from '../services/api/analytics'

type ResearchPayload = Record<string, unknown>

type EventTypeMeta = {
  label: string
  description: string
  analysisCategory: string
}

const EVENT_DOMAIN_LABELS: Record<string, string> = {
  dialogue: '小组对话',
  scaffold: '智能支架',
  inquiry_structure: '探究结构',
  shared_record: '共享文档',
  stage_transition: '学习阶段',
  wiki: '项目知识库',
  rag: '检索增强',
}

const ACTOR_LABELS: Record<string, string> = {
  student: '学习者',
  teacher: '教师',
  ai_assistant: 'AI智能助手',
  ai_tutor: 'AI导师',
  system: '系统',
}

const STAGE_LABELS: Record<string, string> = {
  orientation: '任务导入',
  planning: '问题规划',
  inquiry: '证据探究',
  argumentation: '论证协商',
  revision: '反思修订',
  summary: '成果整合',
  reflection: '总结反思',
  task_import: '任务导入',
  problem_planning: '问题规划',
  evidence_exploration: '证据探究',
  reflection_revision: '反思修订',
}

const SUBAGENT_LABELS: Record<string, string> = {
  evidence_researcher: '资料研究员',
  viewpoint_challenger: '观点挑战者',
  feedback_prompter: '反馈追问者',
  problem_progressor: '问题推进者',
}

const SCAFFOLD_ROLE_LABELS: Record<string, string> = {
  cognitive_support: '认知支持角色',
  viewpoint_challenge: '观点挑战角色',
  feedback_prompting: '反馈追问角色',
  problem_progression: '问题推进角色',
}

const SCAFFOLD_ROLE_TO_SUBAGENT: Record<string, string> = {
  cognitive_support: 'evidence_researcher',
  viewpoint_challenge: 'viewpoint_challenger',
  feedback_prompting: 'feedback_prompter',
  problem_progression: 'problem_progressor',
}

const RULE_TYPE_LABELS: Record<string, string> = {
  evidence_gap: '证据不足',
  counterargument_missing: '反驳缺失',
  revision_stall: '修订停滞',
  responsibility_risk: '责任风险',
}

const NODE_TYPE_LABELS: Record<string, string> = {
  claim: '观点节点',
  evidence: '证据节点',
  'counter-argument': '反方观点节点',
  rebuttal: '回应反驳节点',
}

const EVENT_TYPE_META: Record<string, EventTypeMeta> = {
  peer_message_send: {
    label: '小组消息发送',
    description: '学习者在小组聊天中发送文本消息。',
    analysisCategory: '对话参与',
  },
  peer_image_send: {
    label: '小组图片发送',
    description: '学习者在小组聊天中发送图片或媒体材料。',
    analysisCategory: '对话参与',
  },
  graph_routing_decision: {
    label: '多智能体路由决策',
    description: '系统根据当前问题、阶段、规则或角色提及选择主要回应智能体。',
    analysisCategory: 'AI支架编排',
  },
  scaffold_request: {
    label: '支架请求',
    description: '学习者主动请求 AI 支架或工具支持。',
    analysisCategory: 'AI支架使用',
  },
  assistant_scaffold_response: {
    label: 'AI助手支架回应',
    description: 'AI智能助手完成一次支架性回应。',
    analysisCategory: 'AI支架使用',
  },
  tutor_scaffold_response: {
    label: 'AI导师支架回应',
    description: 'AI导师完成一次个体化支架性回应。',
    analysisCategory: 'AI支架使用',
  },
  shadow_prompt_candidate: {
    label: '支架规则候选触发',
    description: '系统检测到可能需要支架介入的协作过程状态。',
    analysisCategory: '过程支架触发',
  },
  auto_group_prompt_send: {
    label: '群聊自动提示发送',
    description: '系统在满足冷却与连续窗口条件后向小组群聊发送低频支架提示。',
    analysisCategory: '过程支架触发',
  },
  scaffold_rule_check_request: {
    label: '支架规则检查请求',
    description: '学习者或系统发起一次支架规则检查。',
    analysisCategory: '过程支架触发',
  },
  scaffold_rule_check_result: {
    label: '支架规则检查结果',
    description: '系统返回一次支架规则检查结果。',
    analysisCategory: '过程支架触发',
  },
  scaffold_rule_recommendation_accept: {
    label: '支架推荐采纳',
    description: '学习者采纳系统推荐的支架提示或智能体支持。',
    analysisCategory: '过程支架采纳',
  },
  node_add: {
    label: '探究节点新增',
    description: '学习者在深度探究空间中新增论证或证据节点。',
    analysisCategory: '论证结构建构',
  },
  node_remove: {
    label: '探究节点删除',
    description: '学习者删除深度探究空间中的节点。',
    analysisCategory: '论证结构调整',
  },
  node_position_commit: {
    label: '探究节点位置调整',
    description: '学习者完成节点拖拽或布局调整。',
    analysisCategory: '论证结构调整',
  },
  node_content_commit: {
    label: '探究节点内容提交',
    description: '学习者提交或修订探究节点内容。',
    analysisCategory: '论证内容修订',
  },
  node_type_update: {
    label: '探究节点类型调整',
    description: '学习者调整探究节点的论证类型。',
    analysisCategory: '论证结构调整',
  },
  node_delete: {
    label: '探究节点删除',
    description: '学习者删除深度探究空间中的节点。',
    analysisCategory: '论证结构调整',
  },
  edge_add: {
    label: '论证关系新增',
    description: '学习者在两个探究节点之间建立支持、反驳或关联关系。',
    analysisCategory: '论证结构建构',
  },
  edge_relation_toggle: {
    label: '论证关系类型切换',
    description: '学习者调整节点之间的论证关系类型。',
    analysisCategory: '论证结构调整',
  },
  edge_delete: {
    label: '论证关系删除',
    description: '学习者删除节点之间的论证关系。',
    analysisCategory: '论证结构调整',
  },
  card_to_node: {
    label: '素材转为证据节点',
    description: '学习者将灵感素材池内容拖入画布并转化为探究节点。',
    analysisCategory: '证据建构',
  },
  evidence_source_bind: {
    label: '证据来源绑定',
    description: '学习者将资料来源信息绑定到证据节点或素材。',
    analysisCategory: '证据建构',
  },
  evidence_source_open: {
    label: '证据来源打开',
    description: '学习者打开已绑定的证据或资料来源。',
    analysisCategory: '证据使用',
  },
  scrapbook_image_add: {
    label: '素材图片加入',
    description: '学习者将图片材料加入灵感素材池。',
    analysisCategory: '证据建构',
  },
  snapshot_save: {
    label: '探究空间保存',
    description: '学习者保存深度探究空间的当前状态。',
    analysisCategory: '协作产物保存',
  },
  shared_record_open: {
    label: '共享文档打开',
    description: '学习者打开共享项目文档。',
    analysisCategory: '共享文档使用',
  },
  shared_record_create: {
    label: '共享文档创建',
    description: '学习者创建新的共享项目文档。',
    analysisCategory: '共享文档建构',
  },
  shared_record_switch: {
    label: '共享文档切换',
    description: '学习者切换当前编辑的共享项目文档。',
    analysisCategory: '共享文档使用',
  },
  shared_record_delete: {
    label: '共享文档删除',
    description: '学习者删除共享项目文档。',
    analysisCategory: '共享文档管理',
  },
  shared_record_title_update: {
    label: '共享文档标题修改',
    description: '学习者修改共享项目文档标题。',
    analysisCategory: '共享文档建构',
  },
  shared_record_content_commit: {
    label: '共享文档内容提交',
    description: '学习者保存或提交共享文档内容修订。',
    analysisCategory: '共享文档建构',
  },
  shared_record_save: {
    label: '共享文档保存',
    description: '学习者触发共享文档保存。',
    analysisCategory: '协作产物保存',
  },
  shared_record_extract_to_scrapbook: {
    label: '文档摘录到素材池',
    description: '学习者将共享文档中的内容摘录到灵感素材池。',
    analysisCategory: '证据建构',
  },
  shared_record_annotation_create: {
    label: '共享文档批注创建',
    description: '学习者在共享文档中创建批注。',
    analysisCategory: '协作反馈',
  },
  shared_record_annotation_edit: {
    label: '共享文档批注修改',
    description: '学习者修改共享文档批注。',
    analysisCategory: '协作反馈',
  },
  shared_record_annotation_resolve: {
    label: '共享文档批注解决',
    description: '学习者将共享文档批注标记为已解决。',
    analysisCategory: '协作反馈',
  },
  shared_record_annotation_delete: {
    label: '共享文档批注删除',
    description: '学习者删除共享文档批注。',
    analysisCategory: '协作反馈',
  },
  shared_record_annotation_reply: {
    label: '共享文档批注回复',
    description: '学习者回复共享文档批注。',
    analysisCategory: '协作反馈',
  },
  learning_stage_enter: {
    label: '学习阶段进入',
    description: '学习者进入某一协作学习阶段。',
    analysisCategory: '阶段推进',
  },
  learning_stage_transition: {
    label: '学习阶段切换',
    description: '学习者或系统完成一次学习阶段切换。',
    analysisCategory: '阶段推进',
  },
  stage_tool_guidance_apply: {
    label: '阶段工具建议应用',
    description: '系统根据当前阶段将学习者引导到建议工具。',
    analysisCategory: '阶段支架',
  },
  experiment_version_refresh_apply: {
    label: '实验版本刷新应用',
    description: '学生端接收并应用教师端更新的实验版本配置。',
    analysisCategory: '实验控制',
  },
  stage_update_notice_display: {
    label: '阶段更新提示展示',
    description: '学生端展示教师阶段调整提示。',
    analysisCategory: '实验控制',
  },
  stage_manual_change_blocked: {
    label: '阶段手动切换被阻止',
    description: '学习者尝试手动切换阶段，但被当前实验控制配置阻止。',
    analysisCategory: '实验控制',
  },
  teacher_experiment_config_update: {
    label: '教师实验配置更新',
    description: '教师在项目仪表盘中更新实验版本、阶段或支架配置。',
    analysisCategory: '实验控制',
  },
  wiki_item_created: {
    label: '知识库条目创建',
    description: '系统或学习者将项目说明、证据、观点或阶段总结沉淀为项目知识库条目。',
    analysisCategory: '知识沉淀',
  },
  wiki_item_updated: {
    label: '知识库条目更新',
    description: '学习者或教师修订项目知识库中的结构化条目。',
    analysisCategory: '知识沉淀',
  },
  wiki_item_quoted: {
    label: '知识库来源引用',
    description: '学习者将文档、资源或探究节点中的内容沉淀或引用到项目 Wiki。',
    analysisCategory: '知识沉淀',
  },
  retrieval_requested: {
    label: 'RAG检索请求',
    description: 'AI 回答前根据问题从项目知识库、文档或聊天记录中检索上下文。',
    analysisCategory: '检索增强',
  },
  citation_attached: {
    label: 'AI回答附加引用',
    description: 'AI 回答生成时附加 Wiki、资源、文档或聊天来源。',
    analysisCategory: '检索增强',
  },
}

const fallbackLabel = (value: string | undefined | null): string => {
  if (!value) return ''
  return value
    .split(/[_-]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

const asString = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  return String(value)
}

const asBoolean = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value.toLowerCase() === 'true'
  if (typeof value === 'number') return value !== 0
  return false
}

const getFirstString = (payload: ResearchPayload, keys: string[]): string => {
  for (const key of keys) {
    const value = payload[key]
    if (value !== null && value !== undefined && String(value).trim()) {
      return String(value)
    }
  }
  return ''
}

const normalizeSubagentKey = (key: string): string => {
  return key
}

const resolveSubagentKey = (event: ResearchEventRow): string => {
  const payload = event.payload || {}
  const directKey = getFirstString(payload, [
    'preferred_subagent',
    'selected_subagent',
    'recommended_subagent',
    'preselected_subagent',
  ])
  if (directKey) return normalizeSubagentKey(directKey)

  const scaffoldRole = getFirstString(payload, ['scaffold_role'])
  if (scaffoldRole && SCAFFOLD_ROLE_TO_SUBAGENT[scaffoldRole]) {
    return SCAFFOLD_ROLE_TO_SUBAGENT[scaffoldRole]
  }

  return ''
}

const resolveScaffoldRoleKey = (event: ResearchEventRow): string => {
  const payload = event.payload || {}
  return getFirstString(payload, ['scaffold_role'])
}

const buildDetailLabel = (
  event: ResearchEventRow,
  targetAgentLabel: string,
  scaffoldRoleLabel: string,
  ruleTypeLabel: string
): string => {
  const payload = event.payload || {}
  const containsAiMention = asBoolean(payload.contains_ai_mention)

  if (event.event_type === 'peer_message_send') {
    if (containsAiMention && targetAgentLabel) return `AI提及：${targetAgentLabel}`
    if (containsAiMention) return 'AI提及'
    if (Number(payload.mention_count || 0) > 0) return '成员提及'
    return '普通同伴消息'
  }

  if (event.event_type === 'graph_routing_decision' && targetAgentLabel) {
    return `主要回应：${targetAgentLabel}`
  }

  if (event.event_type === 'scaffold_request' && scaffoldRoleLabel) {
    return `请求角色：${scaffoldRoleLabel}`
  }

  if (event.event_type === 'assistant_scaffold_response' && scaffoldRoleLabel) {
    return `回应角色：${scaffoldRoleLabel}`
  }

  if (event.event_type === 'tutor_scaffold_response' && scaffoldRoleLabel) {
    return `主要视角：${scaffoldRoleLabel}`
  }

  if ((event.event_type === 'shadow_prompt_candidate' || event.event_type === 'auto_group_prompt_send') && ruleTypeLabel) {
    return `触发规则：${ruleTypeLabel}`
  }

  if (event.event_type === 'wiki_item_created' || event.event_type === 'wiki_item_updated') {
    const itemType = getFirstString(payload, ['item_type'])
    return itemType ? `条目类型：${fallbackLabel(itemType)}` : ''
  }

  if (event.event_type === 'retrieval_requested') {
    const wikiCount = Number(payload.wiki_result_count || 0)
    const resultCount = Number(payload.result_count || 0)
    return `检索结果：${resultCount}条，其中Wiki ${wikiCount}条`
  }

  const nodeType = getFirstString(payload, ['node_type', 'to_type'])
  if (nodeType && NODE_TYPE_LABELS[nodeType]) {
    return NODE_TYPE_LABELS[nodeType]
  }

  return ''
}

const buildDescription = (
  event: ResearchEventRow,
  baseDescription: string,
  detailLabel: string,
  targetAgentLabel: string,
  ruleTypeLabel: string
): string => {
  if (event.event_type === 'peer_message_send' && detailLabel.startsWith('AI提及')) {
    return targetAgentLabel
      ? `学习者在小组聊天中提及 ${targetAgentLabel}，触发面向该角色的AI协作支持。`
      : '学习者在小组聊天中提及 AI，触发智能体协作支持。'
  }

  if (event.event_type === 'graph_routing_decision' && targetAgentLabel) {
    return `系统完成多智能体路由，本轮主要由 ${targetAgentLabel} 组织或生成回应。`
  }

  if (event.event_type === 'shadow_prompt_candidate' && ruleTypeLabel) {
    return `系统检测到“${ruleTypeLabel}”规则候选，用于判断是否需要低频过程干预。`
  }

  if (event.event_type === 'auto_group_prompt_send' && ruleTypeLabel) {
    return `系统基于“${ruleTypeLabel}”规则向小组群聊发送低频过程提示。`
  }

  return baseDescription
}

export const buildReadableResearchEventRow = (event: ResearchEventRow): Record<string, unknown> => {
  const payload = event.payload || {}
  const meta = EVENT_TYPE_META[event.event_type] || {
    label: fallbackLabel(event.event_type),
    description: '尚未在事件说明表中配置的研究事件。',
    analysisCategory: '其他事件',
  }

  const subagentKey = resolveSubagentKey(event)
  const targetAgentLabel = SUBAGENT_LABELS[subagentKey] || ''
  const scaffoldRoleKey = resolveScaffoldRoleKey(event)
  const scaffoldRoleLabel = SCAFFOLD_ROLE_LABELS[scaffoldRoleKey] || ''
  const ruleType = getFirstString(payload, ['rule_type'])
  const ruleTypeLabel = RULE_TYPE_LABELS[ruleType] || ''
  const detailLabel = buildDetailLabel(event, targetAgentLabel, scaffoldRoleLabel, ruleTypeLabel)
  const containsAiMention = asBoolean(payload.contains_ai_mention)

  return {
    id: event.id,
    project_id: event.project_id,
    experiment_version_id: event.experiment_version_id,
    room_id: event.room_id,
    group_id: event.group_id,
    user_id: event.user_id,
    actor_type: event.actor_type,
    actor_label: ACTOR_LABELS[event.actor_type] || fallbackLabel(event.actor_type),
    event_domain: event.event_domain,
    event_domain_label: EVENT_DOMAIN_LABELS[event.event_domain] || fallbackLabel(event.event_domain),
    event_type: event.event_type,
    event_type_label: meta.label,
    event_detail_label: detailLabel,
    event_description: buildDescription(event, meta.description, detailLabel, targetAgentLabel, ruleTypeLabel),
    analysis_category: meta.analysisCategory,
    stage_id: event.stage_id,
    stage_label: event.stage_id ? STAGE_LABELS[event.stage_id] || fallbackLabel(event.stage_id) : '',
    sequence_index: event.sequence_index,
    event_time: event.event_time,
    is_ai_mention: containsAiMention,
    target_agent_key: subagentKey,
    target_agent_label: targetAgentLabel,
    scaffold_role_key: scaffoldRoleKey,
    scaffold_role_label: scaffoldRoleLabel,
    rule_type: ruleType,
    rule_type_label: ruleTypeLabel,
    routing_source: asString(payload.routing_source),
    decision_source: asString(payload.decision_source),
    trigger_source: asString(payload.trigger_source),
    trigger_reason: asString(payload.trigger_reason),
    response_mode: asString(payload.response_mode),
    message_length: payload.message_length ?? payload.length ?? '',
    mention_count: payload.mention_count ?? '',
    node_type: asString(payload.node_type || payload.to_type),
    node_type_label: NODE_TYPE_LABELS[asString(payload.node_type || payload.to_type)] || '',
    node_count: payload.node_count ?? '',
    edge_count: payload.edge_count ?? '',
    document_id: asString(payload.document_id),
    content_length: payload.content_length ?? '',
    annotation_id: asString(payload.annotation_id),
    payload,
    payload_json: JSON.stringify(payload),
    created_at: event.created_at,
  }
}

export const getResearchEventCodebook = () => ({
  event_domains: EVENT_DOMAIN_LABELS,
  event_types: EVENT_TYPE_META,
  actor_types: ACTOR_LABELS,
  stages: STAGE_LABELS,
  subagents: SUBAGENT_LABELS,
  scaffold_roles: SCAFFOLD_ROLE_LABELS,
  rule_types: RULE_TYPE_LABELS,
  node_types: NODE_TYPE_LABELS,
})
