import { projectService as newProjectService } from './projectApi' // Assuming index was renamed or migrated? Or I remove this import if project.ts IS the new service?
import { Project, CreateProjectData, ExperimentVersion } from '../../types'

export type ProjectListResponse = {
  projects: Project[]
  total: number
}

export type ProjectCreateRequest = CreateProjectData

export const projectService = {
  async getProjects(archived?: boolean): Promise<ProjectListResponse> {
    return newProjectService.getProjects(!!archived)
  },

  async getProject(projectId: string): Promise<Project> {
    return newProjectService.getProject(projectId)
  },

  async getExperimentVersion(projectId: string): Promise<ExperimentVersion> {
    return newProjectService.getExperimentVersion(projectId)
  },

  async updateExperimentVersion(projectId: string, data: Partial<ExperimentVersion>): Promise<ExperimentVersion> {
    return newProjectService.updateExperimentVersion(projectId, data)
  },

  async createProject(data: ProjectCreateRequest): Promise<Project> {
    return newProjectService.createProject(data)
  },

  async updateProject(projectId: string, data: Partial<Project>): Promise<Project> {
    return newProjectService.updateProject(projectId, data)
  },

  async deleteProject(projectId: string): Promise<void> {
    return newProjectService.deleteProject(projectId)
  },

  async addMember(projectId: string, data: { userId?: string, email?: string, role: string }): Promise<void> {
    return newProjectService.addMember(projectId, data)
  },

  async removeMember(projectId: string, userId: string): Promise<void> {
    return newProjectService.removeMember(projectId, userId)
  },

  async archiveProject(projectId: string): Promise<Project> {
    return newProjectService.archiveProject(projectId)
  },

  async unarchiveProject(projectId: string): Promise<Project> {
    return newProjectService.unarchiveProject(projectId)
  },
}
