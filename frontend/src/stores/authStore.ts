import { create } from 'zustand'
import { User } from '../types'
import { authService } from '../services/api/auth'
import { userService } from '../services/api/user'
import { syncService } from '../services/sync/SyncService'

interface AuthTokens {
  access_token: string
  refresh_token: string
}

interface AuthState {
  user: User | null
  tokens: AuthTokens | null
  isAuthenticated: boolean
  isLoading: boolean
  isInitialized: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  fetchUser: () => Promise<void>
  updateUser: (data: Partial<User>) => Promise<void>
  setTokens: (tokens: AuthTokens) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  tokens: null,
  isAuthenticated: false,
  isLoading: false,
  isInitialized: false,

  setTokens: (tokens: AuthTokens) => set({ tokens }),

  login: async (email: string, password: string) => {
    set({ isLoading: true })
    try {
      const tokens = await authService.login({ email, password })
      localStorage.setItem('access_token', tokens.access_token)
      localStorage.setItem('refresh_token', tokens.refresh_token)

      set({ tokens }) // Update tokens in store

      // Update SyncService token to ensure WebSocket reconnects with new user identity
      syncService.setToken(tokens.access_token)

      const user = await authService.getCurrentUser()
      set({ user, isAuthenticated: true, isLoading: false, isInitialized: true })
    } catch (error) {
      set({ isLoading: false, isInitialized: true })
      throw error
    }
  },

  logout: async () => {
    try {
      await authService.logout()
    } catch (error) {
      console.error('Logout error:', error)
    } finally {
      // Reset SyncService to clear previous user's connection and state
      try {
        syncService.reset()
      } catch (e) {
        console.warn("Failed to reset sync service:", e)
      }
      set({ user: null, tokens: null, isAuthenticated: false, isInitialized: true })
    }
  },

  fetchUser: async () => {
    const token = localStorage.getItem('access_token')
    const refreshToken = localStorage.getItem('refresh_token')

    if (!token) {
      set({ user: null, tokens: null, isAuthenticated: false, isInitialized: true })
      return
    }

    // Initialize tokens from local storage
    if (token && refreshToken) {
      set({ tokens: { access_token: token, refresh_token: refreshToken } })
    }

    set({ isLoading: true })
    try {
      const user = await authService.getCurrentUser()
      set({ user, isAuthenticated: true, isLoading: false, isInitialized: true })
    } catch (error) {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      set({ user: null, tokens: null, isAuthenticated: false, isLoading: false, isInitialized: true })
    }
  },

  updateUser: async (data: Partial<User>) => {
    set({ isLoading: true })
    try {
      const updatedUser = await userService.updateCurrentUser(data)
      set({ user: updatedUser, isLoading: false })
    } catch (error) {
      set({ isLoading: false })
      throw error
    }
  },
}))
