import api from './client'

export interface TeacherSupportMessageRequest {
  content: string
  support_type?: string
}

export interface TeacherSupportMessageResponse {
  id: string
  client_message_id?: string | null
  project_id: string
  user_id: string
  username: string
  avatar_url?: string | null
  content: string
  message_type: string
  mentions: string[]
  created_at: string
}

export interface TeacherHelpRequestCreate {
  content: string
  help_type?: string
  allow_public_reply?: boolean
  stage_id?: string | null
  page_source?: string | null
}

export interface TeacherHelpReply {
  id: string
  project_id: string
  user_id: string
  username: string
  content: string
  support_type?: string | null
  public_reply: boolean
  created_at: string
}

export interface TeacherHelpRequest {
  id: string
  project_id: string
  user_id: string
  username: string
  content: string
  help_type?: string | null
  allow_public_reply: boolean
  stage_id?: string | null
  page_source?: string | null
  status: 'pending' | 'replied' | 'resolved'
  created_at: string
  replies: TeacherHelpReply[]
}

export interface TeacherHelpRequestListResponse {
  requests: TeacherHelpRequest[]
  total: number
}

export const chatService = {
  async sendTeacherSupport(
    projectId: string,
    data: TeacherSupportMessageRequest
  ): Promise<TeacherSupportMessageResponse> {
    const response = await api.post(`/chat/projects/${projectId}/teacher-support`, data)
    return response.data
  },

  async createTeacherHelpRequest(
    projectId: string,
    data: TeacherHelpRequestCreate
  ): Promise<TeacherSupportMessageResponse> {
    const response = await api.post(`/chat/projects/${projectId}/teacher-help-requests`, data)
    return response.data
  },

  async getTeacherHelpRequests(
    projectId: string,
    status?: 'pending' | 'replied' | 'resolved'
  ): Promise<TeacherHelpRequestListResponse> {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    const suffix = params.toString() ? `?${params.toString()}` : ''
    const response = await api.get(`/chat/projects/${projectId}/teacher-help-requests${suffix}`)
    return response.data
  },

  async updateTeacherHelpRequestStatus(
    requestId: string,
    status: 'pending' | 'replied' | 'resolved'
  ): Promise<TeacherHelpRequest> {
    const response = await api.patch(`/chat/teacher-help-requests/${requestId}/status`, { status })
    return response.data
  },

  async replyTeacherHelpRequest(
    requestId: string,
    data: { content: string; support_type?: string; public_reply?: boolean }
  ): Promise<TeacherHelpReply> {
    const response = await api.post(`/chat/teacher-help-requests/${requestId}/reply`, data)
    return response.data
  },
}
