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

export const chatService = {
  async sendTeacherSupport(
    projectId: string,
    data: TeacherSupportMessageRequest
  ): Promise<TeacherSupportMessageResponse> {
    const response = await api.post(`/chat/projects/${projectId}/teacher-support`, data)
    return response.data
  },
}
