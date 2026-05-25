import api from './client'
import { API_ENDPOINTS } from '../../config/api'
import { Task, TaskSubmissionArtifact, TeacherSubmission } from '../../types'

export interface TaskListResponse {
  tasks: Task[]
  total: number
}

export interface TaskCreateRequest {
  title: string
  column: 'todo' | 'doing' | 'done'
  priority?: 'low' | 'medium' | 'high'
  assignees?: string[]
  description?: string
  due_date?: string
}

export interface TaskUpdateRequest {
  title?: string
  priority?: 'low' | 'medium' | 'high'
  assignees?: string[]
  description?: string
  due_date?: string
}

export interface TaskColumnUpdateRequest {
  column: 'todo' | 'doing' | 'done'
}

export interface TaskOrderUpdateRequest {
  order: number
}

export interface TaskSubmitPayload {
  note?: string
  artifact_document_id?: string
  artifact_document_ids?: string[]
  artifact_snapshot_id?: string
  artifact_inquiry_snapshot_id?: string
  artifact_wiki_item_ids?: string[]
  artifact_ids?: string[]
}

export const taskService = {
  async getTasks(projectId: string): Promise<TaskListResponse> {
    const response = await api.get<TaskListResponse>(
      `${API_ENDPOINTS.TASKS}/projects/${projectId}`
    )
    return response.data
  },

  async createTask(projectId: string, data: TaskCreateRequest): Promise<Task> {
    const response = await api.post<Task>(
      `${API_ENDPOINTS.TASKS}/projects/${projectId}`,
      data
    )
    return response.data
  },

  async updateTask(taskId: string, data: TaskUpdateRequest): Promise<Task> {
    const response = await api.put<Task>(
      `${API_ENDPOINTS.TASKS}/${taskId}`,
      data
    )
    return response.data
  },

  async updateTaskColumn(taskId: string, column: 'todo' | 'doing' | 'done'): Promise<Task> {
    const response = await api.put<Task>(
      `${API_ENDPOINTS.TASKS}/${taskId}/column?column=${column}`
    )
    return response.data
  },

  async updateTaskOrder(taskId: string, prev_order?: number, next_order?: number): Promise<Task> {
    const response = await api.put<Task>(
      `${API_ENDPOINTS.TASKS}/${taskId}/order`,
      { prev_order, next_order }
    )
    return response.data
  },

  async deleteTask(taskId: string): Promise<void> {
    await api.delete(`${API_ENDPOINTS.TASKS}/${taskId}`)
  },

  async submitTask(taskId: string, payload: TaskSubmitPayload): Promise<Task> {
    const response = await api.post<Task>(
      `${API_ENDPOINTS.TASKS}/${taskId}/submit`,
      payload
    )
    return response.data
  },

  async uploadTaskArtifact(taskId: string, file: File): Promise<TaskSubmissionArtifact> {
    const formData = new FormData()
    formData.append('file', file)
    const response = await api.post<TaskSubmissionArtifact>(
      `${API_ENDPOINTS.TASKS}/${taskId}/artifacts`,
      formData
    )
    return response.data
  },

  async getTaskArtifacts(taskId: string): Promise<TaskSubmissionArtifact[]> {
    const response = await api.get<{ artifacts: TaskSubmissionArtifact[] }>(
      `${API_ENDPOINTS.TASKS}/${taskId}/artifacts`
    )
    return response.data.artifacts
  },

  async deleteTaskArtifact(taskId: string, artifactId: string): Promise<void> {
    await api.delete(`${API_ENDPOINTS.TASKS}/${taskId}/artifacts/${artifactId}`)
  },

  async downloadTaskArtifact(artifactId: string): Promise<Blob> {
    const response = await api.get(
      `${API_ENDPOINTS.TASKS}/artifacts/${artifactId}/download`,
      { responseType: 'blob' }
    )
    return response.data
  },

  async getTeacherSubmissions(params?: {
    course_id?: string
    release_id?: string
    status?: string
  }): Promise<TeacherSubmission[]> {
    const response = await api.get<{ submissions: TeacherSubmission[] }>(
      `${API_ENDPOINTS.TASKS}/teacher/submissions`,
      { params }
    )
    return response.data.submissions
  },

  async exportTeacherSubmissions(params?: { course_id?: string; release_id?: string }): Promise<Blob> {
    const response = await api.get(
      `${API_ENDPOINTS.TASKS}/teacher/submissions/export`,
      { params, responseType: 'blob' }
    )
    return response.data
  },

  async exportTeacherSubmissionArtifactsZip(params?: { course_id?: string; release_id?: string }): Promise<Blob> {
    const response = await api.get(
      `${API_ENDPOINTS.TASKS}/teacher/submissions/artifacts.zip`,
      { params, responseType: 'blob' }
    )
    return response.data
  },

  async reviewSubmission(taskId: string, data: {
    review_status: 'reviewed' | 'revision_requested'
    review_comment?: string
  }): Promise<Task> {
    const response = await api.post<Task>(
      `${API_ENDPOINTS.TASKS}/${taskId}/review`,
      data
    )
    return response.data
  },
}
