/**
 * IndexedDB服务
 * 提供IndexedDB的封装和操作接口
 */

import { IndexedDBConfig, DataSnapshot, OperationLogEntry } from '../../types/sync';

/** 默认数据库配置 */
const DEFAULT_DB_CONFIG: IndexedDBConfig = {
    dbName: 'CollabDB',
    version: 1,
    stores: [
        {
            name: 'snapshots',
            keyPath: 'roomId',
            indexes: [
                { name: 'module', keyPath: 'module', unique: false },
                { name: 'timestamp', keyPath: 'timestamp', unique: false },
            ],
        },
        {
            name: 'operations',
            keyPath: 'id',
            indexes: [
                { name: 'roomId', keyPath: 'operation.roomId', unique: false },
                { name: 'status', keyPath: 'status', unique: false },
                { name: 'createdAt', keyPath: 'createdAt', unique: false },
            ],
        },
        {
            name: 'drafts',
            keyPath: 'roomId',
            indexes: [
                { name: 'timestamp', keyPath: 'timestamp', unique: false },
            ],
        },
        {
            name: 'metadata',
            keyPath: 'key',
        },
    ],
};

/**
 * IndexedDB服务类
 */
export class IndexedDBService {
    private db: IDBDatabase | null = null;
    private config: IndexedDBConfig;
    private initPromise: Promise<void> | null = null;

    constructor(config: Partial<IndexedDBConfig> = {}) {
        this.config = { ...DEFAULT_DB_CONFIG, ...config };
    }

    /**
     * 初始化数据库
     */
    async init(): Promise<void> {
        // 如果已经在初始化中，返回现有的Promise
        if (this.initPromise) {
            return this.initPromise;
        }

        // 如果已经初始化完成，直接返回
        if (this.db) {
            return Promise.resolve();
        }

        this.initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.config.dbName, this.config.version);

            request.onerror = () => {
                console.error('[IndexedDB] Open error:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                console.log('[IndexedDB] Database opened successfully');
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                console.log('[IndexedDB] Upgrading database...');

                // 创建对象存储空间
                this.config.stores.forEach((storeConfig) => {
                    // 如果存储空间已存在，先删除
                    if (db.objectStoreNames.contains(storeConfig.name)) {
                        db.deleteObjectStore(storeConfig.name);
                    }

                    // 创建新的存储空间
                    const objectStore = db.createObjectStore(storeConfig.name, {
                        keyPath: storeConfig.keyPath,
                        autoIncrement: storeConfig.autoIncrement,
                    });

                    // 创建索引
                    storeConfig.indexes?.forEach((indexConfig) => {
                        objectStore.createIndex(indexConfig.name, indexConfig.keyPath, {
                            unique: indexConfig.unique,
                            multiEntry: indexConfig.multiEntry,
                        });
                    });

                    console.log(`[IndexedDB] Created object store: ${storeConfig.name}`);
                });
            };
        });

        return this.initPromise;
    }

    /**
     * 确保数据库已初始化
     */
    private async ensureInit(): Promise<IDBDatabase> {
        await this.init();
        if (!this.db) {
            throw new Error('[IndexedDB] Database not initialized');
        }
        return this.db;
    }

    /**
     * 保存数据快照
     */
    async saveSnapshot(snapshot: DataSnapshot): Promise<void> {
        const db = await this.ensureInit();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['snapshots'], 'readwrite');
            const store = transaction.objectStore('snapshots');
            const request = store.put(snapshot);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 获取数据快照
     */
    async getSnapshot(roomId: string): Promise<DataSnapshot | null> {
        const db = await this.ensureInit();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['snapshots'], 'readonly');
            const store = transaction.objectStore('snapshots');
            const request = store.get(roomId);

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 删除数据快照
     */
    async deleteSnapshot(roomId: string): Promise<void> {
        const db = await this.ensureInit();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['snapshots'], 'readwrite');
            const store = transaction.objectStore('snapshots');
            const request = store.delete(roomId);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 保存操作日志
     */
    async saveOperation(operation: OperationLogEntry): Promise<void> {
        const db = await this.ensureInit();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['operations'], 'readwrite');
            const store = transaction.objectStore('operations');
            const request = store.put(operation);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 获取操作日志
     */
    async getOperation(id: string): Promise<OperationLogEntry | null> {
        const db = await this.ensureInit();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['operations'], 'readonly');
            const store = transaction.objectStore('operations');
            const request = store.get(id);

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 获取指定房间的所有操作
     */
    async getOperationsByRoom(roomId: string): Promise<OperationLogEntry[]> {
        const db = await this.ensureInit();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['operations'], 'readonly');
            const store = transaction.objectStore('operations');
            const index = store.index('roomId');
            const request = index.getAll(roomId);

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 获取待处理的操作
     */
    async getPendingOperations(): Promise<OperationLogEntry[]> {
        const db = await this.ensureInit();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['operations'], 'readonly');
            const store = transaction.objectStore('operations');
            const index = store.index('status');
            const request = index.getAll('pending');

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 删除操作
     */
    async deleteOperation(id: string): Promise<void> {
        const db = await this.ensureInit();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['operations'], 'readwrite');
            const store = transaction.objectStore('operations');
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 清理旧的操作日志
     */
    async cleanupOldOperations(beforeTimestamp: number): Promise<number> {
        const db = await this.ensureInit();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['operations'], 'readwrite');
            const store = transaction.objectStore('operations');
            const index = store.index('createdAt');
            const request = index.openCursor(IDBKeyRange.upperBound(beforeTimestamp));

            let deletedCount = 0;

            request.onsuccess = (event) => {
                const cursor = (event.target as IDBRequest).result;
                if (cursor) {
                    cursor.delete();
                    deletedCount++;
                    cursor.continue();
                } else {
                    resolve(deletedCount);
                }
            };

            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 保存草稿
     */
    async saveDraft(roomId: string, data: unknown): Promise<void> {
        const db = await this.ensureInit();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['drafts'], 'readwrite');
            const store = transaction.objectStore('drafts');
            const request = store.put({ roomId, data, timestamp: Date.now() });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 获取草稿
     */
    async getDraft(roomId: string): Promise<unknown | null> {
        const db = await this.ensureInit();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['drafts'], 'readonly');
            const store = transaction.objectStore('drafts');
            const request = store.get(roomId);

            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.data : null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 删除草稿
     */
    async deleteDraft(roomId: string): Promise<void> {
        const db = await this.ensureInit();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['drafts'], 'readwrite');
            const store = transaction.objectStore('drafts');
            const request = store.delete(roomId);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 保存元数据
     */
    async setMetadata(key: string, value: unknown): Promise<void> {
        const db = await this.ensureInit();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['metadata'], 'readwrite');
            const store = transaction.objectStore('metadata');
            const request = store.put({ key, value, timestamp: Date.now() });

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 获取元数据
     */
    async getMetadata(key: string): Promise<unknown | null> {
        const db = await this.ensureInit();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['metadata'], 'readonly');
            const store = transaction.objectStore('metadata');
            const request = store.get(key);

            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.value : null);
            };
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 关闭数据库
     */
    close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
            this.initPromise = null;
            console.log('[IndexedDB] Database closed');
        }
    }

    /**
     * 删除数据库
     */
    static async deleteDatabase(dbName: string = DEFAULT_DB_CONFIG.dbName): Promise<void> {
        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(dbName);

            request.onsuccess = () => {
                console.log(`[IndexedDB] Database ${dbName} deleted`);
                resolve();
            };

            request.onerror = () => reject(request.error);
        });
    }
}

// 导出单例实例
export const indexedDBService = new IndexedDBService();
