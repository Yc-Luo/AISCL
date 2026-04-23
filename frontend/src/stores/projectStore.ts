import { create } from 'zustand'
import { Project, CreateProjectData, UpdateProjectData } from '../types'
import { projectService } from '../services'

interface ProjectState {
    currentProject: Project | null
    projects: Project[]
    loading: boolean
    error: string | null
    activeTab: string
    leftSidebarOpen: boolean
    rightSidebarOpen: boolean
}

interface ProjectActions {
    setCurrentProject: (project: Project | null) => void
    loadProjects: () => Promise<void>
    loadProject: (id: string) => Promise<void>
    createProject: (data: CreateProjectData) => Promise<Project>
    updateProject: (id: string, data: UpdateProjectData) => Promise<void>
    deleteProject: (id: string) => Promise<void>

    setActiveTab: (tab: string) => void
    toggleLeftSidebar: () => void
    toggleRightSidebar: () => void

    setError: (error: string | null) => void
}

export const useProjectStore = create<ProjectState & ProjectActions>((set) => ({
    currentProject: null,
    projects: [],
    loading: false,
    error: null,
    activeTab: 'whiteboard',
    leftSidebarOpen: true,
    rightSidebarOpen: true,

    setCurrentProject: (project) => set({ currentProject: project }),

    loadProjects: async () => {
        set({ loading: true, error: null })
        try {
            const response = await projectService.getProjects()
            set({ projects: response.projects, loading: false })
        } catch (error: any) {
            set({ error: error.message || 'Failed to load projects', loading: false })
        }
    },

    loadProject: async (id) => {
        set({ loading: true, error: null })
        try {
            const project = await projectService.getProject(id)
            set({ currentProject: project, loading: false })
        } catch (error: any) {
            set({ error: error.message || 'Failed to load project', loading: false })
        }
    },

    createProject: async (data) => {
        set({ loading: true, error: null })
        try {
            const project = await projectService.createProject(data)
            set((state) => ({
                projects: [...state.projects, project],
                loading: false
            }))
            return project
        } catch (error: any) {
            set({ error: error.message || 'Failed to create project', loading: false })
            throw error
        }
    },

    updateProject: async (id, data) => {
        set({ loading: true, error: null })
        try {
            const updatedProject = await projectService.updateProject(id, data)
            set((state) => ({
                projects: state.projects.map(p => p.id === id ? updatedProject : p),
                currentProject: state.currentProject?.id === id ? updatedProject : state.currentProject,
                loading: false
            }))
        } catch (error: any) {
            set({ error: error.message || 'Failed to update project', loading: false })
            throw error
        }
    },

    deleteProject: async (id) => {
        set({ loading: true, error: null })
        try {
            await projectService.deleteProject(id)
            set((state) => ({
                projects: state.projects.filter(p => p.id !== id),
                currentProject: state.currentProject?.id === id ? null : state.currentProject,
                loading: false
            }))
        } catch (error: any) {
            set({ error: error.message || 'Failed to delete project', loading: false })
            throw error
        }
    },

    setActiveTab: (tab) => set({ activeTab: tab }),
    toggleLeftSidebar: () => set((state) => ({ leftSidebarOpen: !state.leftSidebarOpen })),
    toggleRightSidebar: () => set((state) => ({ rightSidebarOpen: !state.rightSidebarOpen })),

    setError: (error) => set({ error })
}))
