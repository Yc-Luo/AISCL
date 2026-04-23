import { ExperimentVersion } from '../types'

export type ScaffoldLayerKey = 'multi_agent_scaffold' | 'process_scaffold'
export type ScaffoldRoleKey =
  | 'cognitive_support'
  | 'feedback_prompting'
  | 'viewpoint_challenge'
  | 'problem_progression'

const LAYER_ALIAS_MAP: Record<string, ScaffoldLayerKey> = {
  agent_scaffold: 'multi_agent_scaffold',
  multi_agent_scaffold: 'multi_agent_scaffold',
  process_scaffold: 'process_scaffold',
}

const ROLE_ALIAS_MAP: Record<string, ScaffoldRoleKey> = {
  cognitive_support: 'cognitive_support',
  evidence_coach: 'cognitive_support',
  feedback_prompting: 'feedback_prompting',
  revision_coach: 'feedback_prompting',
  viewpoint_challenge: 'viewpoint_challenge',
  counterargument_challenger: 'viewpoint_challenge',
  counterargument_challenge: 'viewpoint_challenge',
  challenge: 'viewpoint_challenge',
  problem_progression: 'problem_progression',
  process_monitor: 'problem_progression',
  problem_advancing: 'problem_progression',
}

export type RecommendationRuleType =
  | 'evidence_gap'
  | 'counterargument_missing'
  | 'revision_stall'
  | 'responsibility_risk'

export interface RecommendationAvailability {
  scaffoldLayer: ScaffoldLayerKey
  roleKey: ScaffoldRoleKey
  target: 'assistant' | 'tutor'
  available: boolean
  reason?: string
}

export function roleKeyToPreferredSubagent(role: ScaffoldRoleKey): string {
  const mapping: Record<ScaffoldRoleKey, string> = {
    cognitive_support: 'evidence_researcher',
    viewpoint_challenge: 'viewpoint_challenger',
    feedback_prompting: 'feedback_prompter',
    problem_progression: 'problem_progressor',
  }
  return mapping[role]
}

const PROCESS_ROLES: ScaffoldRoleKey[] = [
  'cognitive_support',
  'feedback_prompting',
  'viewpoint_challenge',
  'problem_progression',
]

function normalizeLayerKeys(layers: string[] | null | undefined): ScaffoldLayerKey[] {
  return Array.from(
    new Set(
      (layers || [])
        .map((layer) => LAYER_ALIAS_MAP[layer])
        .filter((layer): layer is ScaffoldLayerKey => Boolean(layer)),
    ),
  )
}

function normalizeRoleKeys(roles: string[] | null | undefined): ScaffoldRoleKey[] {
  return Array.from(
    new Set(
      (roles || [])
        .map((role) => ROLE_ALIAS_MAP[role])
        .filter((role): role is ScaffoldRoleKey => Boolean(role)),
    ),
  )
}

export function isLayerConfigured(
  experimentVersion: ExperimentVersion | null | undefined,
  layer: ScaffoldLayerKey,
) {
  if (!experimentVersion) return true
  const configuredLayers = normalizeLayerKeys(experimentVersion.enabled_scaffold_layers)
  if (configuredLayers.length === 0) return true
  return configuredLayers.includes(layer)
}

export function isRoleConfigured(
  experimentVersion: ExperimentVersion | null | undefined,
  role: ScaffoldRoleKey,
) {
  if (!experimentVersion) return true
  const configuredRoles = normalizeRoleKeys(experimentVersion.enabled_scaffold_roles)
  if (configuredRoles.length === 0) return true
  return configuredRoles.includes(role)
}

export function isProcessScaffoldActive(experimentVersion: ExperimentVersion | null | undefined) {
  if (!experimentVersion) return true
  return (
    experimentVersion.process_scaffold_mode === 'on' &&
    isLayerConfigured(experimentVersion, 'process_scaffold')
  )
}

export function isAssistantActionEnabled(
  experimentVersion: ExperimentVersion | null | undefined,
  role: ScaffoldRoleKey,
) {
  if (!experimentVersion) return true
  return isLayerConfigured(experimentVersion, 'multi_agent_scaffold') && isRoleConfigured(experimentVersion, role)
}

export function isTutorTabEnabled(experimentVersion: ExperimentVersion | null | undefined) {
  if (!experimentVersion) return true
  if (experimentVersion.ai_scaffold_mode !== 'multi_agent') return false
  if (!isProcessScaffoldActive(experimentVersion)) return false
  const configuredRoles = normalizeRoleKeys(experimentVersion.enabled_scaffold_roles)
  if (configuredRoles.length === 0) return true
  return configuredRoles.some((role) => PROCESS_ROLES.includes(role))
}

export function getRuleRecommendationAvailability(
  experimentVersion: ExperimentVersion | null | undefined,
  ruleType: RecommendationRuleType,
): RecommendationAvailability {
  const mapping: Record<
    RecommendationRuleType,
    { scaffoldLayer: ScaffoldLayerKey; roleKey: ScaffoldRoleKey }
  > = {
    evidence_gap: { scaffoldLayer: 'multi_agent_scaffold', roleKey: 'cognitive_support' },
    counterargument_missing: { scaffoldLayer: 'multi_agent_scaffold', roleKey: 'viewpoint_challenge' },
    revision_stall: { scaffoldLayer: 'process_scaffold', roleKey: 'feedback_prompting' },
    responsibility_risk: { scaffoldLayer: 'process_scaffold', roleKey: 'problem_progression' },
  }

  const { scaffoldLayer, roleKey } = mapping[ruleType]
  const target =
    experimentVersion?.ai_scaffold_mode === 'single_agent'
      ? 'assistant'
      : scaffoldLayer === 'process_scaffold'
        ? 'tutor'
        : 'assistant'

  if (scaffoldLayer === 'process_scaffold' && !isProcessScaffoldActive(experimentVersion)) {
    return {
      scaffoldLayer,
      roleKey,
      target,
      available: false,
      reason: '当前实验配置已关闭协作过程支架。',
    }
  }

  if (scaffoldLayer === 'multi_agent_scaffold' && !isLayerConfigured(experimentVersion, 'multi_agent_scaffold')) {
    return {
      scaffoldLayer,
      roleKey,
      target,
      available: false,
      reason: '当前实验配置未启用多智能体支架层。',
    }
  }

  if (!isRoleConfigured(experimentVersion, roleKey)) {
    return {
      scaffoldLayer,
      roleKey,
      target,
      available: false,
      reason: '当前实验配置未启用该支架角色。',
    }
  }

  return {
    scaffoldLayer,
    roleKey,
    target,
    available: true,
  }
}
