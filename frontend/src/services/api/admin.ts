import api from './client'
import { API_ENDPOINTS } from '../../config/api'

export interface User {
    id: string
    username: string
    email: string
    role: 'student' | 'teacher' | 'admin'
    status: 'active' | 'suspended' | 'banned'
    is_active: boolean
    is_banned?: boolean
    created_at: string
    last_active?: string
    course_name?: string
}

export interface SystemStats {
    total_users: number
    active_projects: number
    system_load: number
    storage_used: number // in bytes
}

export interface Config {
    key: string
    value: string
    description?: string
    updated_by?: string
    updated_at?: string
}

export interface ActivityLog {
    id: string
    project_id: string
    user_id: string
    username?: string
    module: string
    action: string
    target_id?: string
    duration: number
    metadata?: any
    timestamp: string
}

export const adminService = {
    getUsers: async (page = 1, limit = 10, role?: string): Promise<{ items: User[], total: number }> => {
        const response = await api.get(API_ENDPOINTS.ADMIN.USERS, {
            params: { page, limit, role }
        })
        return response.data
    },

    getSystemStats: async (): Promise<SystemStats> => {
        const response = await api.get(API_ENDPOINTS.ADMIN.STATS)
        return response.data
    },

    createUser: async (userData: Partial<User>) => {
        const response = await api.post(API_ENDPOINTS.ADMIN.USERS, userData)
        return response.data
    },

    updateUser: async (userId: string, data: Partial<User>) => {
        const response = await api.put(`${API_ENDPOINTS.ADMIN.USERS}/${userId}`, data)
        return response.data
    },

    deleteUser: async (userId: string) => {
        const response = await api.delete(`${API_ENDPOINTS.ADMIN.USERS}/${userId}`)
        return response.data
    },

    broadcastNotification: async (title: string, body: string) => {
        const response = await api.post(API_ENDPOINTS.ADMIN.BROADCAST, { title, body })
        return response.data
    },

    getConfigs: async (): Promise<Config[]> => {
        const response = await api.get(API_ENDPOINTS.ADMIN.CONFIGS)
        return response.data
    },

    updateConfig: async (key: string, value: string, description?: string): Promise<Config> => {
        const response = await api.put(API_ENDPOINTS.ADMIN.CONFIG_DETAIL(key), { value, description })
        return response.data
    },

    getBehaviorLogs: async (params: {
        user_id?: string,
        project_id?: string,
        module?: string,
        start_date?: string,
        end_date?: string,
        skip?: number,
        limit?: number
    }): Promise<{ logs: ActivityLog[], total: number }> => {
        const response = await api.get(API_ENDPOINTS.ADMIN.BEHAVIOR_LOGS, { params })
        return response.data
    },

    // New method for fetching raw behavior stream
    getBehaviorStream: async (projectId: string, limit = 1000): Promise<{ behaviors: any[], total: number }> => {
        // Note: Using the analytics endpoint directly as admin usually has access
        // Ideally there should be an admin-specific endpoint for this if permission logic differs greatly
        const response = await api.get(`/analytics/projects/${projectId}/behavior`, {
            params: { limit }
        })
        return response.data
    },

    exportBehaviorLogs: async (params: {
        user_id?: string,
        project_id?: string,
        module?: string,
        start_date?: string,
        end_date?: string,
        format?: 'csv' | 'json'
    }) => {
        if (params.format === 'csv') {
            const response = await api.get(API_ENDPOINTS.ADMIN.BEHAVIOR_LOGS_EXPORT, {
                params,
                responseType: 'blob'
            })

            // Create a temporary link to download the blob
            const url = window.URL.createObjectURL(new Blob([response.data]))
            const link = document.createElement('a')
            link.href = url
            const filename = `behavior_logs_${new Date().toISOString().slice(0, 10)}.csv`
            link.setAttribute('download', filename)
            document.body.appendChild(link)
            link.click()

            // Clean up
            document.body.removeChild(link)
            window.URL.revokeObjectURL(url)
            return
        }
        const response = await api.get(API_ENDPOINTS.ADMIN.BEHAVIOR_LOGS_EXPORT, { params })
        return response.data
    }
}
