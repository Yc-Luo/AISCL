// Export all authentication types
export interface User {
  id: string
  username: string
  email: string
  phone?: string
  avatar_url?: string
  role: 'student' | 'teacher' | 'admin'
  settings: Record<string, unknown>
  class_id?: string
  is_active: boolean
  is_banned?: boolean
  created_at: string
}

export interface LoginRequest {
  email?: string
  username?: string
  phone?: string
  password: string
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
}

// Re-export domain types
export * from './domain/project'

// Re-export API types
export * from './api/common'

// Re-export UI types
export * from './ui/common'

// Legacy/Other types (Task, CalendarEvent, Resource) - Should be moved to domain/ eventually
export interface Task {
  id: string
  project_id: string
  title: string
  column: 'todo' | 'doing' | 'done'
  priority: 'low' | 'medium' | 'high'
  assignees: string[]
  order: number
  due_date?: string
  created_at: string
  updated_at: string
}

export interface CalendarEvent {
  id: string
  project_id: string
  title: string
  start_time: string
  end_time: string
  type: 'meeting' | 'deadline' | 'personal'
  created_by: string
  is_private: boolean
  created_at: string
}

export interface Resource {
  id: string
  filename: string
  url: string
  size: number
  mime_type: string
  uploaded_by: string
  uploaded_at: string
}
