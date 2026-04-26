import { create } from 'zustand'

interface ContextState {
    projectId: string | null
    activeTab: string | null
    currentStage: string | null
    experimentVersionId: string | null
    documentId: string | null
    documentContent: string | null
    whiteboardSummary: string | null
}

interface ContextActions {
    setProjectId: (id: string | null) => void
    setActiveTab: (tab: string | null) => void
    setCurrentStage: (stage: string | null) => void
    setExperimentVersionId: (id: string | null) => void
    setDocumentId: (id: string | null) => void
    setDocumentContent: (content: string | null) => void
    setWhiteboardSummary: (summary: string | null) => void
}

export type ContextStore = ContextState & ContextActions

export const useContextStore = create<ContextStore>((set) => ({
    projectId: null,
    activeTab: null,
    currentStage: null,
    experimentVersionId: null,
    documentId: null,
    documentContent: null,
    whiteboardSummary: null,

    setProjectId: (id) => set({ projectId: id }),
    setActiveTab: (tab) => set({ activeTab: tab }),
    setCurrentStage: (stage) => set({ currentStage: stage }),
    setExperimentVersionId: (id) => set({ experimentVersionId: id }),
    setDocumentId: (id) => set({ documentId: id }),
    setDocumentContent: (content) => set({ documentContent: content }),
    setWhiteboardSummary: (summary) => set({ whiteboardSummary: summary }),
}))
