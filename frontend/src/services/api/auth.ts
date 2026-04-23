import api from './client'
import { API_ENDPOINTS } from '../../config/api'
import { LoginRequest, TokenResponse, User } from '../../types'

export const authService = {
  async login(credentials: LoginRequest): Promise<TokenResponse> {
    const response = await api.post<TokenResponse>(
      API_ENDPOINTS.AUTH.LOGIN,
      credentials
    )
    return response.data
  },

  async getCurrentUser(): Promise<User> {
    const response = await api.get<User>(API_ENDPOINTS.AUTH.ME)
    return response.data
  },

  async logout(): Promise<void> {
    await api.post(API_ENDPOINTS.AUTH.LOGOUT)
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
  },

  async requestPasswordReset(email: string): Promise<void> {
    await api.post('/auth/password/reset-request', { email })
  },

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await api.post('/auth/password/reset', { token, new_password: newPassword })
  },
}

