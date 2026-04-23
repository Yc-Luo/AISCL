/**
 * 同步状态管理Store
 * 管理WebSocket连接状态、同步状态、标签页状态等全局同步信息
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
    SyncStoreState,
    SyncStoreActions,
    ConnectionStatus,
    SyncStatus
} from '../types/sync';

/** 生成唯一的标签页ID */
const generateTabId = (): string => {
    return `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
};

/** 初始状态 */
const initialState: SyncStoreState = {
    connectionStatus: 'disconnected',
    syncStatus: 'idle',
    tabId: generateTabId(),
    isMasterTab: false,
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    lastOnlineAt: null,
    lastError: null,
    pendingOperationsCount: 0,
    totalOperationsSent: 0,
    totalOperationsReceived: 0,
};

/** 同步Store类型 */
export type SyncStore = SyncStoreState & SyncStoreActions;

/**
 * 同步状态Store
 * 使用Zustand persist中间件将部分状态持久化到localStorage
 */
export const useSyncStore = create<SyncStore>()(
    persist(
        (set, get) => ({
            ...initialState,

            // ============ 连接管理 ============

            setConnectionStatus: (status: ConnectionStatus) => {
                set({ connectionStatus: status });

                // 连接成功时清除错误
                if (status === 'connected') {
                    set({ lastError: null });
                }
            },

            setSyncStatus: (status: SyncStatus) => {
                set({ syncStatus: status });
            },

            // ============ 标签页管理 ============

            setTabId: (id: string) => {
                set({ tabId: id });
            },

            setIsMasterTab: (isMaster: boolean) => {
                set({ isMasterTab: isMaster });

                // 如果成为主标签页，记录日志
                if (isMaster) {
                    console.log(`[SyncStore] Tab ${get().tabId} became master`);
                }
            },

            // ============ 在线状态 ============

            setOnlineStatus: (isOnline: boolean) => {
                const prevOnline = get().isOnline;

                set({
                    isOnline,
                    lastOnlineAt: isOnline ? Date.now() : get().lastOnlineAt,
                    // 离线时将同步状态设为offline
                    syncStatus: isOnline ? get().syncStatus : 'offline'
                });

                // 状态变化时记录日志
                if (prevOnline !== isOnline) {
                    console.log(`[SyncStore] Online status changed: ${prevOnline} -> ${isOnline}`);
                }
            },

            // ============ 错误处理 ============

            setError: (error: string | null) => {
                set({ lastError: error });

                if (error) {
                    console.error(`[SyncStore] Error: ${error}`);
                }
            },

            clearError: () => {
                set({ lastError: null });
            },

            // ============ 操作计数 ============

            incrementPendingOperations: () => {
                set((state) => ({
                    pendingOperationsCount: state.pendingOperationsCount + 1
                }));
            },

            decrementPendingOperations: () => {
                set((state) => ({
                    pendingOperationsCount: Math.max(0, state.pendingOperationsCount - 1)
                }));
            },

            setPendingOperationsCount: (count: number) => {
                set({ pendingOperationsCount: Math.max(0, count) });
            },

            // ============ 统计更新 ============

            incrementOperationsSent: () => {
                set((state) => ({
                    totalOperationsSent: state.totalOperationsSent + 1
                }));
            },

            incrementOperationsReceived: () => {
                set((state) => ({
                    totalOperationsReceived: state.totalOperationsReceived + 1
                }));
            },

            // ============ 重置 ============

            reset: () => {
                set({
                    ...initialState,
                    tabId: get().tabId, // 保持tabId不变
                });
            },
        }),
        {
            name: 'sync-store',
            storage: createJSONStorage(() => localStorage),
            // 只持久化必要的状态
            partialize: (state) => ({
                totalOperationsSent: state.totalOperationsSent,
                totalOperationsReceived: state.totalOperationsReceived,
            }),
        }
    )
);

// ============ 选择器 ============

/** 获取连接状态的便捷选择器 */
export const selectConnectionStatus = (state: SyncStore) => state.connectionStatus;

/** 获取同步状态的便捷选择器 */
export const selectSyncStatus = (state: SyncStore) => state.syncStatus;

/** 获取是否在线的便捷选择器 */
export const selectIsOnline = (state: SyncStore) => state.isOnline;

/** 获取是否为主标签页的便捷选择器 */
export const selectIsMasterTab = (state: SyncStore) => state.isMasterTab;

/** 获取待处理操作数的便捷选择器 */
export const selectPendingOperationsCount = (state: SyncStore) => state.pendingOperationsCount;

/** 获取是否有待处理操作的便捷选择器 */
export const selectHasPendingOperations = (state: SyncStore) => state.pendingOperationsCount > 0;

/** 获取是否已连接的便捷选择器 */
export const selectIsConnected = (state: SyncStore) => state.connectionStatus === 'connected';

/** 获取是否正在同步的便捷选择器 */
export const selectIsSyncing = (state: SyncStore) => state.syncStatus === 'syncing';
