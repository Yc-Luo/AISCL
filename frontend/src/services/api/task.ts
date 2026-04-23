import api from './client'
import { API_ENDPOINTS } from '../../config/api'
import { Task } from '../../types'

export interface TaskListResponse {
  tasks: Task[]
  total: number
}

export interface TaskCreateRequest {
  title: string
  column: 'todo' | 'doing' | 'done'
  priority?: 'low' | 'medium' | 'high'
  assignees?: string[]
  due_date?: string
}

export interface TaskUpdateRequest {
  title?: string
  priority?: 'low' | 'medium' | 'high'
  assignees?: string[]
  due_date?: string
}

export interface TaskColumnUpdateRequest {
  column: 'todo' | 'doing' | 'done'
}

export interface TaskOrderUpdateRequest {
  order: number
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
}

