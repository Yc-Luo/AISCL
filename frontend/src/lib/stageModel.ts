export const CANONICAL_STAGES = [
  'problem_construction',
  'meaning_exploration',
  'explanation_integration',
  'application_solution',
] as const

export type CanonicalStageId = typeof CANONICAL_STAGES[number]

export const STAGE_LABELS: Record<CanonicalStageId, string> = {
  problem_construction: '问题构建',
  meaning_exploration: '意义探索',
  explanation_integration: '解释整合',
  application_solution: '应用解决',
}

const LEGACY_STAGE_ALIASES: Record<string, CanonicalStageId> = {
  orientation: 'problem_construction',
  task_import: 'problem_construction',
  '任务导入': 'problem_construction',
  planning: 'problem_construction',
  problem_planning: 'problem_construction',
  '问题规划': 'problem_construction',
  problem_construction: 'problem_construction',
  '问题构建': 'problem_construction',
  inquiry: 'meaning_exploration',
  evidence_exploration: 'meaning_exploration',
  '证据探究': 'meaning_exploration',
  meaning_exploration: 'meaning_exploration',
  '意义探索': 'meaning_exploration',
  argumentation: 'explanation_integration',
  '论证协商': 'explanation_integration',
  explanation_integration: 'explanation_integration',
  '解释整合': 'explanation_integration',
  revision: 'application_solution',
  reflection_revision: 'application_solution',
  summary: 'application_solution',
  reflection: 'application_solution',
  '反思修订': 'application_solution',
  application_solution: 'application_solution',
  '应用解决': 'application_solution',
}

export const TAB_LABELS: Record<string, string> = {
  document: '协作文档',
  inquiry: '论证空间',
  resources: '小组资料',
  wiki: '知识沉淀',
  ai: 'AI 对话',
  dashboard: '学习概览',
}

export function normalizeStageId(stageId?: string | null): CanonicalStageId | null {
  const raw = (stageId || '').trim()
  if (!raw) return null
  if (LEGACY_STAGE_ALIASES[raw]) return LEGACY_STAGE_ALIASES[raw]
  const lowered = raw.toLowerCase()
  if (LEGACY_STAGE_ALIASES[lowered]) return LEGACY_STAGE_ALIASES[lowered]
  return CANONICAL_STAGES.includes(raw as CanonicalStageId)
    ? raw as CanonicalStageId
    : null
}

export function formatStageLabel(stageId?: string | null): string {
  const normalized = normalizeStageId(stageId)
  if (normalized) return STAGE_LABELS[normalized]
  if (!stageId) return '未设置'
  return stageId
    .split(/[_-]/g)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

export function getTabLabel(tabId: string): string {
  return TAB_LABELS[tabId] || tabId
}

export function getStageToolGuidance(stageId?: string | null) {
  const stage = normalizeStageId(stageId)
  if (!stage) {
    return {
      primaryTab: 'document',
      recommendedTabs: [] as string[],
      guidance: '当前未配置任务阶段，按任务需要自主选择工具。',
    }
  }

  const guidance: Record<CanonicalStageId, {
    primaryTab: string
    recommendedTabs: string[]
    guidance: string
  }> = {
    problem_construction: {
      primaryTab: 'document',
      recommendedTabs: ['document', 'resources', 'wiki', 'ai'],
      guidance: '围绕任务目标、核心问题和判断标准展开讨论，先明确要解决什么问题以及分歧在哪里。',
    },
    meaning_exploration: {
      primaryTab: 'inquiry',
      recommendedTabs: ['inquiry', 'resources', 'wiki', 'ai', 'document'],
      guidance: '围绕资料、证据、不同观点和判断标准展开探索，注意比较 AI 输出、资料来源和同伴意见。',
    },
    explanation_integration: {
      primaryTab: 'inquiry',
      recommendedTabs: ['inquiry', 'document', 'wiki', 'ai'],
      guidance: '把资料证据、同伴观点、AI 建议和评价标准组织成可辩护的解释或方案。',
    },
    application_solution: {
      primaryTab: 'document',
      recommendedTabs: ['document', 'inquiry', 'wiki', 'ai', 'dashboard'],
      guidance: '将解释或方案放回任务情境中检验适用条件，完成成果表达、修订和反思。',
    },
  }

  return guidance[stage]
}
