import api from './client'
import { API_ENDPOINTS } from '../../config/api'

export interface User {
    id: string
    username: string
    email: string
    role: 'student' | 'teacher' | 'admin'
    class_id?: string | null
    teacher_tags?: string[]
    config_permissions?: ConfigPermissions | null
    status: 'active' | 'suspended' | 'banned'
    is_active: boolean
    is_banned?: boolean
    created_at: string
    last_active?: string
    course_name?: string
}

export interface ConfigPermissions {
    allowed_template_ids?: string[]
    allowed_rule_profile_ids?: string[]
    allowed_model_ids?: string[]
}

export interface PermissionOption {
    id?: string
    key?: string
    label?: string
    name?: string
    rule_set?: string
    provider?: string
    base_url?: string
    summary?: string
}

export interface ConfigPermissionOptions {
    templates: PermissionOption[]
    rule_profiles: PermissionOption[]
    models: PermissionOption[]
    teacher_tags: string[]
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

export interface ModelConfigTestResult {
    success: boolean
    service: 'llm' | 'embedding' | 'web_search' | 'document_parse'
    latency_ms?: number
    response_preview?: string
    vector_dimensions?: number
    result_count?: number
    error?: string
    config?: {
        provider?: string
        base_url?: string
        model?: string
        has_key?: boolean
        configured_dimensions?: string
        max_results?: number
        enabled?: boolean
    }
}

export interface CandidateLLMModelConfig {
    id: string
    provider: string
    base_url?: string
    api_key?: string
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
    metadata?: Record<string, unknown>
    timestamp: string
}

export interface ExportJob {
    id: string
    job_type: string
    status: 'queued' | 'running' | 'completed' | 'failed' | 'expired'
    course_id: string
    course_name?: string
    include_files: boolean
    include_raw_heartbeat: boolean
    progress: number
    message: string
    filename?: string
    file_size: number
    error?: string
    created_at: string
    started_at?: string | null
    completed_at?: string | null
    updated_at: string
    download_url?: string | null
}

export interface BehaviorStreamItem {
    timestamp?: string
    metadata?: Record<string, unknown>
    [key: string]: unknown
}

export interface DataStorageOverview {
    resource_count: number
    total_resource_size: number
    project_count: number
    archived_project_count: number
    research_event_count: number
    activity_log_count: number
    group_chat_count: number
    ai_conversation_count: number
    ai_message_count: number
    document_count: number
    behavior_stream_count: number
    heartbeat_stream_count: number
    by_type?: Record<string, { count: number, size: number }>
    by_scope?: Record<string, { count: number, size: number }>
}

export interface DataStorageProject {
    project_id: string
    project_name: string
    file_count: number
    total_size: number
}

export interface DataRetentionPreview {
    older_than_days: number
    cutoff: string
    operational_cleanup_candidates: Record<string, number>
    protected_research_data: Record<string, number>
    note?: string
}

export interface DataProject {
    id: string
    name: string
    course_id?: string
    owner_id?: string
    leader_id?: string
    member_count: number
    is_archived: boolean
    created_at: string
    updated_at: string
}

export const adminService = {
    getUsers: async (page = 1, limit = 10, role?: string, search?: string, teacher_tag?: string): Promise<{ items: User[], total: number }> => {
        const response = await api.get(API_ENDPOINTS.ADMIN.USERS, {
            params: { page, limit, role, search, teacher_tag }
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

    testLLMConfig: async (): Promise<ModelConfigTestResult> => {
        const response = await api.post(API_ENDPOINTS.ADMIN.TEST_LLM_CONFIG)
        return response.data
    },

    testLLMModelConfig: async (candidate: CandidateLLMModelConfig): Promise<ModelConfigTestResult> => {
        const response = await api.post(API_ENDPOINTS.ADMIN.TEST_LLM_MODEL_CONFIG, candidate)
        return response.data
    },

    testEmbeddingConfig: async (): Promise<ModelConfigTestResult> => {
        const response = await api.post(API_ENDPOINTS.ADMIN.TEST_EMBEDDING_CONFIG)
        return response.data
    },

    testWebSearchConfig: async (): Promise<ModelConfigTestResult> => {
        const response = await api.post(API_ENDPOINTS.ADMIN.TEST_WEB_SEARCH_CONFIG)
        return response.data
    },

    testDocumentParseConfig: async (): Promise<ModelConfigTestResult> => {
        const response = await api.post(API_ENDPOINTS.ADMIN.TEST_DOCUMENT_PARSE_CONFIG)
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
    getBehaviorStream: async (projectId: string, limit = 1000): Promise<{ behaviors: BehaviorStreamItem[], total: number }> => {
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
    },

    getTeacherPermissions: async (params: {
        page?: number,
        limit?: number,
        search?: string,
        tag?: string
    }): Promise<{ items: User[], total: number }> => {
        const response = await api.get(API_ENDPOINTS.ADMIN.CONFIG_PERMISSION_TEACHERS, { params })
        return response.data
    },

    updateTeacherPermissions: async (teacherId: string, data: {
        teacher_tags?: string[],
        config_permissions?: ConfigPermissions | null
    }): Promise<User> => {
        const response = await api.put(API_ENDPOINTS.ADMIN.CONFIG_PERMISSION_TEACHER(teacherId), data)
        return response.data
    },

    batchUpdateTeacherPermissions: async (data: {
        teacher_ids: string[],
        teacher_tags?: string[],
        config_permissions?: ConfigPermissions | null,
        replace_tags?: boolean
    }): Promise<{ updated: number }> => {
        const response = await api.put(API_ENDPOINTS.ADMIN.CONFIG_PERMISSION_BATCH, data)
        return response.data
    },

    getConfigPermissionOptions: async (): Promise<ConfigPermissionOptions> => {
        const response = await api.get(API_ENDPOINTS.ADMIN.CONFIG_PERMISSION_OPTIONS)
        return response.data
    },

    getDataStorageOverview: async (): Promise<DataStorageOverview> => {
        const response = await api.get(API_ENDPOINTS.ADMIN.DATA_STORAGE_OVERVIEW)
        return response.data
    },

    getDataStorageByProject: async (limit = 50): Promise<{ items: DataStorageProject[], total: number }> => {
        const response = await api.get(API_ENDPOINTS.ADMIN.DATA_STORAGE_BY_PROJECT, { params: { limit } })
        return response.data
    },

    getDataRetentionPreview: async (older_than_days = 90): Promise<DataRetentionPreview> => {
        const response = await api.get(API_ENDPOINTS.ADMIN.DATA_RETENTION_PREVIEW, { params: { older_than_days } })
        return response.data
    },

    runDataRetentionCleanup: async (data: { collections: string[], older_than_days: number, confirm_operational_only?: boolean }): Promise<{ deleted: Record<string, number>, cutoff: string }> => {
        const response = await api.post(API_ENDPOINTS.ADMIN.DATA_RETENTION_CLEANUP, data)
        return response.data
    },

    getDataProjects: async (params: { page?: number, limit?: number, search?: string, archived?: boolean }): Promise<{ items: DataProject[], total: number }> => {
        const response = await api.get(API_ENDPOINTS.ADMIN.DATA_PROJECTS, { params })
        return response.data
    },

    archiveDataProject: async (projectId: string) => {
        const response = await api.post(API_ENDPOINTS.ADMIN.DATA_PROJECT_ARCHIVE(projectId))
        return response.data
    },

    unarchiveDataProject: async (projectId: string) => {
        const response = await api.post(API_ENDPOINTS.ADMIN.DATA_PROJECT_UNARCHIVE(projectId))
        return response.data
    },

    exportResearchData: async (params: { project_id?: string, format?: 'json' | 'csv' }) => {
        const response = await api.post(API_ENDPOINTS.ADMIN.DATA_EXPORT, undefined, {
            params,
            responseType: params.format === 'csv' ? 'blob' : 'json'
        })
        if (params.format === 'csv') {
            const url = window.URL.createObjectURL(new Blob([response.data]))
            const link = document.createElement('a')
            link.href = url
            link.setAttribute('download', `aiscl_research_export_${new Date().toISOString().slice(0, 10)}.csv`)
            document.body.appendChild(link)
            link.click()
            document.body.removeChild(link)
            window.URL.revokeObjectURL(url)
            return
        }
        return response.data
    },

    exportCourseResearchPackage: async (courseId: string, params: { include_files?: boolean, include_raw_heartbeat?: boolean }) => {
        const response = await api.get(API_ENDPOINTS.ADMIN.DATA_COURSE_RESEARCH_PACKAGE(courseId), {
            params,
            responseType: 'blob'
        })
        const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/zip' }))
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', `aiscl_course_research_${courseId}_${new Date().toISOString().slice(0, 10)}.zip`)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        window.URL.revokeObjectURL(url)
    },

    createCourseResearchPackageJob: async (courseId: string, params: { include_files?: boolean, include_raw_heartbeat?: boolean }): Promise<ExportJob> => {
        const response = await api.post(API_ENDPOINTS.ADMIN.DATA_COURSE_RESEARCH_PACKAGE_JOBS(courseId), params)
        return response.data
    },

    getExportJob: async (jobId: string): Promise<ExportJob> => {
        const response = await api.get(API_ENDPOINTS.ADMIN.DATA_EXPORT_JOB(jobId))
        return response.data
    },

    downloadExportJob: async (job: ExportJob) => {
        const response = await api.get(API_ENDPOINTS.ADMIN.DATA_EXPORT_JOB_DOWNLOAD(job.id), {
            responseType: 'blob'
        })
        const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/zip' }))
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', job.filename || `aiscl_export_${job.id}.zip`)
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        window.URL.revokeObjectURL(url)
    },

    backupConfigs: async () => {
        const response = await api.get(API_ENDPOINTS.ADMIN.DATA_BACKUP_CONFIG)
        return response.data
    },

    restoreConfigs: async (configs: Record<string, unknown>[]) => {
        const response = await api.post(API_ENDPOINTS.ADMIN.DATA_RESTORE_CONFIG, { configs })
        return response.data
    }
}
