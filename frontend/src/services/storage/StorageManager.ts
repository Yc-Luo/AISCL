/**
 * 统一存储管理器
 * 协调IndexedDB和LocalStorage的使用，提供统一的存储接口
 */

import { indexedDBService, IndexedDBService } from './IndexedDBService';
import { localStorageService, LocalStorageService } from './LocalStorageService';
import { DataSnapshot, OperationLogEntry, ModuleType } from '../../types/sync';

/** 存储策略 */
export type StorageStrategy = 'indexeddb' | 'localstorage' | 'both';

/** 存储管理器配置 */
export interface StorageManagerConfig {
    /**用于大数据的默认策略 */
    largeDataStrategy?: StorageStrategy;
    /** 用于小数据的默认策略 */
    smallDataStrategy?: StorageStrategy;
    /** 自动清理旧数据的时间间隔（毫秒） */
    cleanupInterval?: number;
    /** 操作日志保留时间（毫秒） */
    operationRetentionTime?: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: Required<StorageManagerConfig> = {
    largeDataStrategy: 'indexeddb',
    smallDataStrategy: 'localstorage',
    cleanupInterval: 60 * 60 * 1000, // 1小时
    operationRetentionTime: 7 * 24 * 60 * 60 * 1000, // 7天
};

/**
 * 统一存储管理器类
 */
export class StorageManager {
    private config: Required<StorageManagerConfig>;
    private indexedDB: IndexedDBService;
    private localStorage: LocalStorageService;
    private cleanupTimer: NodeJS.Timeout | null = null;

    constructor(
        config: StorageManagerConfig = {},
        indexedDB: IndexedDBService = indexedDBService,
        localStorage: LocalStorageService = localStorageService
    ) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.indexedDB = indexedDB;
        this.localStorage = localStorage;
    }

    /**
     * 初始化存储管理器
     */
    async init(): Promise<void> {
        try {
            // 初始化IndexedDB
            await this.indexedDB.init();
            console.log('[StorageManager] IndexedDB initialized');

            // 启动自动清理
            this.startAutoCleanup();

            console.log('[StorageManager] Initialized successfully');
        } catch (error) {
            console.error('[StorageManager] Initialization error:', error);
            throw error;
        }
    }

    // ============ 数据快照管理 ============

    /**
     * 保存房间数据快照
     */
    async saveSnapshot(snapshot: DataSnapshot): Promise<void> {
        try {
            // 大数据使用IndexedDB
            await this.indexedDB.saveSnapshot(snapshot);

            // 同时在localStorage保存元数据以便快速访问
            this.localStorage.set(`snapshot:${snapshot.roomId}:meta`, {
                version: snapshot.version,
                timestamp: snapshot.timestamp,
                checksum: snapshot.checksum,
            });

            console.log(`[StorageManager] Snapshot saved for room: ${snapshot.roomId}`);
        } catch (error) {
            console.error('[StorageManager] Save snapshot error:', error);
            throw error;
        }
    }

    /**
     * 获取房间数据快照
     */
    async getSnapshot(roomId: string): Promise<DataSnapshot | null> {
        try {
            return await this.indexedDB.getSnapshot(roomId);
        } catch (error) {
            console.error('[StorageManager] Get snapshot error:', error);
            return null;
        }
    }

    /**
     * 删除房间数据快照
     */
    async deleteSnapshot(roomId: string): Promise<void> {
        try {
            await this.indexedDB.deleteSnapshot(roomId);
            this.localStorage.remove(`snapshot:${roomId}:meta`);
            console.log(`[StorageManager] Snapshot deleted for room: ${roomId}`);
        } catch (error) {
            console.error('[StorageManager] Delete snapshot error:', error);
        }
    }

    // ============ 操作日志管理 ============

    /**
     * 保存操作
     */
    async saveOperation(operation: OperationLogEntry): Promise<void> {
        try {
            await this.indexedDB.saveOperation(operation);
        } catch (error) {
            console.error('[StorageManager] Save operation error:', error);
            throw error;
        }
    }

    /**
     * 获取操作
     */
    async getOperation(id: string): Promise<OperationLogEntry | null> {
        try {
            return await this.indexedDB.getOperation(id);
        } catch (error) {
            console.error('[StorageManager] Get operation error:', error);
            return null;
        }
    }

    /**
     * 获取房间的所有操作
     */
    async getOperationsByRoom(roomId: string): Promise<OperationLogEntry[]> {
        try {
            return await this.indexedDB.getOperationsByRoom(roomId);
        } catch (error) {
            console.error('[StorageManager] Get operations by room error:', error);
            return [];
        }
    }

    /**
     * 获取待处理的操作
     */
    async getPendingOperations(): Promise<OperationLogEntry[]> {
        try {
            return await this.indexedDB.getPendingOperations();
        } catch (error) {
            console.error('[StorageManager] Get pending operations error:', error);
            return [];
        }
    }

    /**
     * 删除操作
     */
    async deleteOperation(id: string): Promise<void> {
        try {
            await this.indexedDB.deleteOperation(id);
        } catch (error) {
            console.error('[StorageManager] Delete operation error:', error);
        }
    }

    // ============ 草稿管理 ============

    /**
     * 保存草稿
     */
    async saveDraft(roomId: string, module: ModuleType, data: unknown): Promise<void> {
        try {
            // 使用IndexedDB保存完整数据
            await this.indexedDB.saveDraft(roomId, { module, data });

            // 在localStorage标记有草稿
            this.localStorage.set(`draft:${roomId}`, Date.now());

            console.log(`[StorageManager] Draft saved for room: ${roomId}`);
        } catch (error) {
            console.error('[StorageManager] Save draft error:', error);
            throw error;
        }
    }

    /**
     * 获取草稿
     */
    async getDraft(roomId: string): Promise<{ module: ModuleType; data: unknown } | null> {
        try {
            const draft = await this.indexedDB.getDraft(roomId);
            return draft as { module: ModuleType; data: unknown } | null;
        } catch (error) {
            console.error('[StorageManager] Get draft error:', error);
            return null;
        }
    }

    /**
     * 删除草稿
     */
    async deleteDraft(roomId: string): Promise<void> {
        try {
            await this.indexedDB.deleteDraft(roomId);
            this.localStorage.remove(`draft:${roomId}`);
            console.log(`[StorageManager] Draft deleted for room: ${roomId}`);
        } catch (error) {
            console.error('[StorageManager] Delete draft error:', error);
        }
    }

    /**
     * 检查是否有草稿
     */
    hasDraft(roomId: string): boolean {
        return this.localStorage.has(`draft:${roomId}`);
    }

    /**
     * 获取所有有草稿的房间ID
     */
    getDraftRoomIds(): string[] {
        const allData = this.localStorage.getAll<number>();
        return Object.keys(allData)
            .filter(key => key.startsWith('draft:'))
            .map(key => key.substring(6)); // 移除 "draft:" 前缀
    }

    // ============ 元数据管理 ============

    /**
     * 保存元数据（使用localStorage以便快速访问）
     */
    setMetadata<T = unknown>(key: string, value: T): void {
        this.localStorage.set(`meta:${key}`, value);
    }

    /**
     * 获取元数据
     */
    getMetadata<T = unknown>(key: string): T | null {
        return this.localStorage.get<T>(`meta:${key}`);
    }

    /**
     * 删除元数据
     */
    removeMetadata(key: string): void {
        this.localStorage.remove(`meta:${key}`);
    }

    // ============ 清理和维护 ============

    /**
     * 启动自动清理
     */
    private startAutoCleanup(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }

        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, this.config.cleanupInterval);

        // 立即执行一次清理
        this.cleanup();
    }

    /**
     * 停止自动清理
     */
    stopAutoCleanup(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    }

    /**
     * 清理旧数据
     */
    async cleanup(): Promise<void> {
        try {
            // 清理过期的localStorage数据
            this.localStorage.cleanup();

            // 清理旧的操作日志
            const cutoffTime = Date.now() - this.config.operationRetentionTime;
            const deletedCount = await this.indexedDB.cleanupOldOperations(cutoffTime);

            if (deletedCount > 0) {
                console.log(`[StorageManager] Cleaned up ${deletedCount} old operations`);
            }
        } catch (error) {
            console.error('[StorageManager] Cleanup error:', error);
        }
    }

    /**
     * 获取存储使用情况
     */
    getStorageUsage(): {
        localStorage: { used: number; total: number; percentage: number };
    } {
        return {
            localStorage: this.localStorage.getUsage(),
        };
    }

    /**
     * 清空所有数据
     */
    async clearAll(): Promise<void> {
        try {
            this.localStorage.clear();
            await this.indexedDB.close();
            await IndexedDBService.deleteDatabase();
            await this.indexedDB.init();
            console.log('[StorageManager] All data cleared');
        } catch (error) {
            console.error('[StorageManager] Clear all error:', error);
            throw error;
        }
    }

    /**
     * 销毁存储管理器
     */
    destroy(): void {
        this.stopAutoCleanup();
        this.indexedDB.close();
        console.log('[StorageManager] Destroyed');
    }
}

// 导出单例实例
export const storageManager = new StorageManager();
