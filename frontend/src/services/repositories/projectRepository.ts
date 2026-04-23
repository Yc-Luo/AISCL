import { ProjectApi } from '../api/projectApi'
import { Project, CreateProjectData, UpdateProjectData } from '../../types'

export class ProjectRepository {
    private api: ProjectApi
    private cache = new Map<string, Project>()
    private listCache: Project[] | null = null
    private lastFetchTime: number = 0
    private CACHE_TTL = 30000 // 30 seconds

    constructor(api: ProjectApi) {
        this.api = api
    }

    async getProjects(forceRefresh = false, archived = false): Promise<{ projects: Project[], total: number }> {
        const timeSinceLastFetch = Date.now() - this.lastFetchTime
        if (!forceRefresh && !archived && this.listCache && timeSinceLastFetch < this.CACHE_TTL) {
            return { projects: this.listCache, total: this.listCache.length }
        }

        const response = await this.api.getProjects(archived)

        if (!archived) {
            this.listCache = response.projects
            this.lastFetchTime = Date.now()
        }

        // Update individual cache
        response.projects.forEach(p => {
            this.cache.set(p.id, p)
        })

        return response
    }

    async getProject(id: string, forceRefresh = false): Promise<Project> {
        if (!forceRefresh && this.cache.has(id)) {
            return this.cache.get(id)!
        }

        const project = await this.api.getProject(id)
        this.cache.set(id, project)
        return project
    }

    async createProject(data: CreateProjectData): Promise<Project> {
        const project = await this.api.createProject(data)
        this.cache.set(project.id, project)
        this.listCache = null // Invalidate list cache
        return project
    }

    async updateProject(id: string, data: UpdateProjectData): Promise<Project> {
        const project = await this.api.updateProject(id, data)
        this.cache.set(id, project)
        this.listCache = null // Invalidate list cache
        return project
    }

    async deleteProject(id: string): Promise<void> {
        await this.api.deleteProject(id)
        this.cache.delete(id)
        this.listCache = null // Invalidate list cache
    }

    async addMember(projectId: string, data: { userId?: string, email?: string, role: string }): Promise<void> {
        await this.api.addMember(projectId, data)
        this.cache.delete(projectId)
        this.listCache = null
    }

    async removeMember(projectId: string, userId: string): Promise<void> {
        await this.api.removeMember(projectId, userId)
        this.cache.delete(projectId)
        this.listCache = null
    }
}
