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
  user?: User
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
  description?: string
  due_date?: string
  source_type?: string
  course_task_release_id?: string
  submission_status?: 'submitted' | 'late_submitted' | 'auto_submitted'
  submitted_at?: string
  submitted_by?: string
  submission_note?: string
  artifact_document_id?: string
  artifact_snapshot_id?: string
  submission_artifact_ids?: string[]
  review_status?: 'pending' | 'reviewed' | 'revision_requested'
  review_comment?: string
  reviewed_by?: string
  reviewed_at?: string
  created_at: string
  updated_at: string
}

export interface TaskSubmissionArtifact {
  id: string
  task_id: string
  project_id: string
  course_id?: string | null
  course_task_release_id?: string | null
  filename: string
  file_key: string
  mime_type: string
  size: number
  artifact_type: 'document' | 'slides' | 'image' | 'video' | 'archive' | 'other'
  checksum_sha256?: string | null
  uploaded_by: string
  uploaded_at: string
  download_url?: string | null
}

export interface TeacherSubmission {
  task: Task
  project_id: string
  project_name: string
  course_id?: string | null
  course_name?: string | null
  release_id?: string | null
  release_title?: string | null
  artifacts: TaskSubmissionArtifact[]
  artifact_count: number
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
  project_id?: string | null
  course_id?: string | null
  scope?: 'project' | 'course'
  source_type?: string
  uploaded_by: string
  uploaded_at: string
}
