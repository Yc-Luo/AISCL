import api from './client'
import { API_ENDPOINTS } from '../../config/api'

export interface BehaviorData {
  project_id: string
  user_id: string
  module: string
  action: string
  resource_id?: string
  metadata?: Record<string, any>
  timestamp?: Date
}

export interface HeartbeatData {
  project_id: string
  user_id: string
  module: string
  resource_id?: string
  timestamp: Date
}

export interface GroupStageFeatureRow {
  project_id: string
  experiment_version_id?: string | null
  group_id?: string | null
  group_key: string
  stage_id: string
  event_count: number
  unique_actor_count: number
  active_span_seconds?: number | null
  node_add_count: number
  edge_add_count: number
  evidence_source_bind_count: number
  evidence_source_open_count: number
  shared_record_content_commit_count: number
  shared_record_annotation_create_count: number
  shared_record_annotation_reply_count: number
  scaffold_rule_check_request_count: number
  scaffold_rule_check_result_count: number
  scaffold_rule_recommendation_accept_count: number
  stage_transition_count: number
}

export interface GroupStageFeatureListResponse {
  features: GroupStageFeatureRow[]
  total: number
}

export interface LSAReadyEventRow {
  project_id: string
  experiment_version_id?: string | null
  group_id?: string | null
  group_key: string
  stage_id: string
  sequence_index: number
  actor_type: string
  event_time: string
  event_domain: string
  event_type: string
  event_symbol: string
}

export interface LSAReadyEventListResponse {
  sequences: LSAReadyEventRow[]
  total: number
}

export interface GroupChatTranscriptRow {
  id: string
  project_id: string
  group_id: string
  sequence_index: number
  user_id: string
  username: string
  user_role?: string | null
  actor_type: string
  message_type: string
  content: string
  content_length: number
  mentions: string[]
  mention_count: number
  client_message_id?: string | null
  primary_agent?: string | null
  rationale_summary?: string | null
  routing_summary: string[]
  ai_meta?: Record<string, any> | null
  created_at: string
}

export interface GroupChatTranscriptListResponse {
  messages: GroupChatTranscriptRow[]
  total: number
}

export interface AITutorTranscriptRow {
  project_id: string
  conversation_id: string
  conversation_title: string
  conversation_user_id: string
  username: string
  user_role?: string | null
  persona_id?: string | null
  category: string
  message_id: string
  message_role: string
  turn_index: number
  content: string
  content_length: number
  citation_count: number
  citations: Record<string, any>[]
  primary_view?: string | null
  rationale_summary?: string | null
  processing_summary: string[]
  ai_meta?: Record<string, any> | null
  message_created_at: string
  conversation_created_at: string
  conversation_updated_at: string
}

export interface AITutorTranscriptListResponse {
  messages: AITutorTranscriptRow[]
  total: number
}

export interface ResearchProjectHealth {
  project_id: string
  experiment_version_count: number
  research_event_count: number
  stage_count: number
  has_scaffold_events: boolean
  has_inquiry_events: boolean
  has_shared_record_events: boolean
  has_stage_events: boolean
  has_rule_accept_events: boolean
  last_event_time?: string | null
  event_domain_counts: Record<string, number>
  key_event_counts: Record<string, number>
}

export interface ResearchEventRow {
  id: string
  project_id: string
  experiment_version_id?: string | null
  room_id?: string | null
  group_id?: string | null
  user_id?: string | null
  actor_type: string
  event_domain: string
  event_type: string
  event_time: string
  stage_id?: string | null
  sequence_index?: number | null
  payload?: Record<string, any>
  created_at: string
}

export interface ResearchEventListResponse {
  events: ResearchEventRow[]
  total: number
}

export const analyticsService = {
  async sendBehavior(data: BehaviorData): Promise<void> {
    await api.post(API_ENDPOINTS.ANALYTICS.BEHAVIOR, data)
  },

  async sendBehaviorBatch(behaviors: BehaviorData[]): Promise<void> {
    await api.post(API_ENDPOINTS.ANALYTICS.BATCH, {
      behaviors,
    })
  },

  async sendHeartbeat(data: HeartbeatData): Promise<void> {
    await api.post(API_ENDPOINTS.ANALYTICS.HEARTBEAT, data)
  },

  async getActivityLogs(
    projectId: string,
    startDate?: string,
    endDate?: string
  ): Promise<any> {
    const params: Record<string, string> = {}
    if (startDate) params.start_date = startDate
    if (endDate) params.end_date = endDate
    const response = await api.get(
      API_ENDPOINTS.ANALYTICS.ACTIVITY_LOGS(projectId),
      { params }
    )
    return response.data
  },

  async getDashboardData(
    projectId: string,
    userId?: string,
    startDate?: string,
    endDate?: string
  ): Promise<any> {
    const params: Record<string, string> = {}
    if (userId) params.user_id = userId
    if (startDate) params.start_date = startDate
    if (endDate) params.end_date = endDate
    const response = await api.get(
      API_ENDPOINTS.ANALYTICS.DASHBOARD(projectId),
      { params }
    )
    return response.data
  },

  async getBehaviorStream(
    projectId: string,
    startDate?: string,
    endDate?: string
  ): Promise<any> {
    const params: Record<string, string> = {}
    if (startDate) params.start_date = startDate
    if (endDate) params.end_date = endDate
    const response = await api.get(
      API_ENDPOINTS.ANALYTICS.BEHAVIOR_STREAM(projectId),
      { params }
    )
    return response.data
  },

  async exportData(
    projectId: string,
    format: 'json' | 'csv' = 'json',
    startDate?: string,
    endDate?: string
  ): Promise<any> {
    const params: Record<string, string> = { format }
    if (startDate) params.start_date = startDate
    if (endDate) params.end_date = endDate
    const response = await api.get(
      API_ENDPOINTS.ANALYTICS.EXPORT(projectId),
      { params }
    )
    return response.data
  },

  async getGroupStageFeatures(
    projectId: string,
    params?: {
      experiment_version_id?: string
      group_id?: string
      stage_id?: string
    }
  ): Promise<GroupStageFeatureListResponse> {
    const response = await api.get(
      API_ENDPOINTS.ANALYTICS.GROUP_STAGE_FEATURES(projectId),
      { params }
    )
    return response.data
  },

  async getLSAReady(
    projectId: string,
    params?: {
      experiment_version_id?: string
      group_id?: string
      stage_id?: string
    }
  ): Promise<LSAReadyEventListResponse> {
    const response = await api.get(
      API_ENDPOINTS.ANALYTICS.LSA_READY(projectId),
      { params }
    )
    return response.data
  },

  async getGroupChatTranscripts(
    projectId: string,
    params?: {
      start_date?: string
      end_date?: string
      limit?: number
    }
  ): Promise<GroupChatTranscriptListResponse> {
    const response = await api.get(
      API_ENDPOINTS.ANALYTICS.GROUP_CHAT_TRANSCRIPTS(projectId),
      { params }
    )
    return response.data
  },

  async getAITutorTranscripts(
    projectId: string,
    params?: {
      start_date?: string
      end_date?: string
      limit?: number
    }
  ): Promise<AITutorTranscriptListResponse> {
    const response = await api.get(
      API_ENDPOINTS.ANALYTICS.AI_TUTOR_TRANSCRIPTS(projectId),
      { params }
    )
    return response.data
  },

  async getResearchHealth(projectId: string): Promise<ResearchProjectHealth> {
    const response = await api.get(
      API_ENDPOINTS.ANALYTICS.RESEARCH_HEALTH(projectId)
    )
    return response.data
  },

  async getResearchEvents(
    projectId: string,
    params?: {
      event_domain?: string
      group_id?: string
      stage_id?: string
      start_date?: string
      end_date?: string
      skip?: number
      limit?: number
    }
  ): Promise<ResearchEventListResponse> {
    const response = await api.get(
      API_ENDPOINTS.ANALYTICS.RESEARCH_EVENTS(projectId),
      { params }
    )
    return response.data
  },
}
