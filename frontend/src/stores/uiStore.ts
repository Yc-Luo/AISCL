import { create } from 'zustand'

interface Notification {
    id: string
    message: string
    type: 'info' | 'success' | 'warning' | 'error'
    timestamp: string
}

interface UiState {
    modals: Record<string, boolean>
    notifications: Notification[]
    loadingStates: Record<string, boolean>
    sidebarCollapsed: boolean
    theme: 'light' | 'dark'
}

interface UiActions {
    openModal: (modalId: string) => void
    closeModal: (modalId: string) => void
    toggleModal: (modalId: string) => void

    addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void
    removeNotification: (id: string) => void
    clearNotifications: () => void

    setLoading: (key: string, loading: boolean) => void
    toggleSidebar: () => void
    setTheme: (theme: 'light' | 'dark') => void
}

export const useUiStore = create<UiState & UiActions>((set) => ({
    modals: {},
    notifications: [],
    loadingStates: {},
    sidebarCollapsed: false,
    theme: 'light',

    openModal: (modalId) => set((state) => ({
        modals: { ...state.modals, [modalId]: true }
    })),

    closeModal: (modalId) => set((state) => ({
        modals: { ...state.modals, [modalId]: false }
    })),

    toggleModal: (modalId) => set((state) => ({
        modals: { ...state.modals, [modalId]: !state.modals[modalId] }
    })),

    addNotification: (notification) => set((state) => ({
        notifications: [...state.notifications, {
            ...notification,
            id: Date.now().toString(),
            timestamp: new Date().toISOString()
        }]
    })),

    removeNotification: (id) => set((state) => ({
        notifications: state.notifications.filter(n => n.id !== id)
    })),

    clearNotifications: () => set({ notifications: [] }),

    setLoading: (key, loading) => set((state) => ({
        loadingStates: { ...state.loadingStates, [key]: loading }
    })),

    toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
    setTheme: (theme) => set({ theme })
}))
