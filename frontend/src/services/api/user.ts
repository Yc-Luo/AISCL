import api from './client'
import { API_ENDPOINTS } from '../../config/api'
import { User } from '../../types'

export const userService = {
  async getUser(userId: string): Promise<User> {
    const response = await api.get<User>(`${API_ENDPOINTS.USERS}/${userId}`)
    return response.data
  },

  async getUsers(userIds: string[]): Promise<User[]> {
    const promises = userIds.map(id => this.getUser(id))
    return Promise.all(promises)
  },

  async updateCurrentUser(data: Partial<User>): Promise<User> {
    const response = await api.put<User>(`${API_ENDPOINTS.USERS}/me`, data)
    return response.data
  },

  async searchUsers(params: { class_id?: string; role?: string; search?: string }): Promise<User[]> {
    const response = await api.get<{ users: User[] }>(API_ENDPOINTS.USERS, { params })
    return response.data.users
  },

  async createUser(data: any): Promise<User> {
    const response = await api.post<User>(API_ENDPOINTS.USERS, data)
    return response.data
  }
}
