import { ApiClient } from './base'
import { API_ENDPOINTS } from '../../config/api'
import { Project, CreateProjectData, UpdateProjectData, ExperimentVersion } from '../../types'

export class ProjectApi {
    private client: ApiClient

    constructor(client: ApiClient) {
        this.client = client
    }

    async getProjects(archived?: boolean): Promise<{ projects: Project[], total: number }> {
        const config = archived === undefined ? undefined : { params: { archived } }
        return this.client.get(API_ENDPOINTS.PROJECTS.BASE, config)
    }

    async getProject(id: string): Promise<Project> {
        return this.client.get(`${API_ENDPOINTS.PROJECTS.BASE}/${id}`)
    }

    async getExperimentVersion(projectId: string): Promise<ExperimentVersion> {
        return this.client.get(API_ENDPOINTS.PROJECTS.EXPERIMENT_VERSION(projectId))
    }

    async updateExperimentVersion(projectId: string, data: Partial<ExperimentVersion>): Promise<ExperimentVersion> {
        return this.client.put(API_ENDPOINTS.PROJECTS.EXPERIMENT_VERSION(projectId), data)
    }

    async createProject(data: CreateProjectData): Promise<Project> {
        return this.client.post(API_ENDPOINTS.PROJECTS.BASE, data)
    }

    async joinProject(data: { course_id: string; group_code: string }): Promise<Project> {
        return this.client.post(`${API_ENDPOINTS.PROJECTS.BASE}/join`, data)
    }

    async updateProject(id: string, data: UpdateProjectData): Promise<Project> {
        return this.client.put(`${API_ENDPOINTS.PROJECTS.BASE}/${id}`, data)
    }

    async deleteProject(id: string): Promise<void> {
        return this.client.delete(`${API_ENDPOINTS.PROJECTS.BASE}/${id}`)
    }

    async addMember(projectId: string, data: { userId?: string, email?: string, username?: string, account?: string, role: string }): Promise<void> {
        return this.client.post(API_ENDPOINTS.PROJECTS.MEMBERS(projectId), {
            user_id: data.userId,
            email: data.email,
            username: data.username,
            account: data.account,
            role: data.role,
        })
    }

    async removeMember(projectId: string, userId: string): Promise<void> {
        return this.client.delete(`${API_ENDPOINTS.PROJECTS.MEMBERS(projectId)}/${userId}`)
    }

    async archiveProject(id: string): Promise<Project> {
        return this.client.post(`${API_ENDPOINTS.PROJECTS.BASE}/${id}/archive`)
    }

    async unarchiveProject(id: string): Promise<Project> {
        return this.client.post(`${API_ENDPOINTS.PROJECTS.BASE}/${id}/unarchive`)
    }
}

export const projectService = new ProjectApi(ApiClient.getInstance())
