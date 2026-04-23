import { apiClient } from './api/base'
import { ProjectApi } from './api/projectApi'
import { ProjectRepository } from './repositories/projectRepository'

// Initialize instances
export const projectApi = new ProjectApi(apiClient)
export const projectService = new ProjectRepository(projectApi)

// Re-export types if needed, or keep them in types/ directory
export * from './api/base'
export * from './api/projectApi'
export * from './repositories/projectRepository'
