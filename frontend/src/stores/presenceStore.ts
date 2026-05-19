import { create } from 'zustand';

const DEFAULT_STALE_MS = 45_000;

export interface PresenceUser {
    userId: string;
    username?: string;
    avatarUrl?: string;
    role?: string;
    projectId: string;
    module?: string;
    pageSource?: string;
    currentStage?: string | null;
    lastSeenAt: number;
    isLocal?: boolean;
}

interface PresenceState {
    onlineUsersByProject: Record<string, Record<string, PresenceUser>>;
    markOnline: (
        projectId: string,
        user: Omit<PresenceUser, 'projectId' | 'lastSeenAt'> & { lastSeenAt?: number }
    ) => void;
    markOffline: (projectId: string, userId: string) => void;
    pruneStale: (maxAgeMs?: number) => void;
    isOnline: (projectId?: string | null, userId?: string | null) => boolean;
    getProjectUsers: (projectId?: string | null) => PresenceUser[];
    resetProject: (projectId: string) => void;
}

export const usePresenceStore = create<PresenceState>((set, get) => ({
    onlineUsersByProject: {},

    markOnline: (projectId, user) => {
        if (!projectId || !user.userId) return;
        set((state) => {
            const projectUsers = state.onlineUsersByProject[projectId] || {};
            const previous = projectUsers[user.userId] || {};
            return {
                onlineUsersByProject: {
                    ...state.onlineUsersByProject,
                    [projectId]: {
                        ...projectUsers,
                        [user.userId]: {
                            ...previous,
                            ...user,
                            projectId,
                            lastSeenAt: user.lastSeenAt || Date.now(),
                        },
                    },
                },
            };
        });
    },

    markOffline: (projectId, userId) => {
        if (!projectId || !userId) return;
        set((state) => {
            const projectUsers = state.onlineUsersByProject[projectId];
            if (!projectUsers || !projectUsers[userId]) return state;
            const { [userId]: _removed, ...remainingUsers } = projectUsers;
            return {
                onlineUsersByProject: {
                    ...state.onlineUsersByProject,
                    [projectId]: remainingUsers,
                },
            };
        });
    },

    pruneStale: (maxAgeMs = DEFAULT_STALE_MS) => {
        const cutoff = Date.now() - maxAgeMs;
        set((state) => {
            const next: Record<string, Record<string, PresenceUser>> = {};
            Object.entries(state.onlineUsersByProject).forEach(([projectId, users]) => {
                const activeUsers = Object.fromEntries(
                    Object.entries(users).filter(([, user]) => user.lastSeenAt >= cutoff)
                );
                next[projectId] = activeUsers;
            });
            return { onlineUsersByProject: next };
        });
    },

    isOnline: (projectId, userId) => {
        if (!projectId || !userId) return false;
        const user = get().onlineUsersByProject[projectId]?.[userId];
        return Boolean(user && Date.now() - user.lastSeenAt < DEFAULT_STALE_MS);
    },

    getProjectUsers: (projectId) => {
        if (!projectId) return [];
        return Object.values(get().onlineUsersByProject[projectId] || {}).filter(
            (user) => Date.now() - user.lastSeenAt < DEFAULT_STALE_MS
        );
    },

    resetProject: (projectId) => {
        set((state) => {
            const { [projectId]: _removed, ...remainingProjects } = state.onlineUsersByProject;
            return { onlineUsersByProject: remainingProjects };
        });
    },
}));
