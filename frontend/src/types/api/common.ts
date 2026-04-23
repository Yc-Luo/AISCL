import { Project } from '../domain/project'

export interface ApiResponse<T> {
    data: T
    message?: string
    errors?: string[]
    meta?: {
        pagination?: PaginationMeta
        timestamp: string
    }
}

export interface PaginationMeta {
    page: number
    limit: number
    total: number
    total_pages: number
}

export interface ApiError {
    code: string
    message: string
    details?: any
}

export type ProjectListResponse = ApiResponse<Project[]>
export type ProjectResponse = ApiResponse<Project>
export type CreateProjectResponse = ApiResponse<Project>
export type UpdateProjectResponse = ApiResponse<Project>
