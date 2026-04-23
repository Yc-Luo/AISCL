/**
 * 统一同步服务
 * 整个协同系统的核心协调者，集成连接管理、操作队列、存储管理和多标签页协调
 */
import {
    Operation,
    ModuleType,
} from '../../types/sync';
import { useSyncStore } from '../../stores/syncStore';
import { useRoomStore } from '../../stores/roomStore';
import { tabManager } from '../TabManager';
import { storageManager } from '../storage/StorageManager';
import { ConnectionManager } from './ConnectionManager';
import { OperationQueue } from './OperationQueue';


/**
 * 简单的事件发射器实现
 */
class EventEmitter {
    private handlers: Map<string, Set<Function>> = new Map();

    on(event: string, handler: Function): () => void {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }
        this.handlers.get(event)!.add(handler);
        return () => this.off(event, handler);
    }

    off(event: string, handler: Function): void {
        const handlers = this.handlers.get(event);
        if (handlers) {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.handlers.delete(event);
            }
        }
    }

    emit(event: string, data?: any): void {
        const handlers = this.handlers.get(event);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`[EventEmitter] Error in handler for ${event}:`, error);
                }
            });
        }
    }
}

/** 同步服务配置 */
export interface SyncServiceConfig {
    autoConnect?: boolean;
}

/**
 * 同步服务类
 */
export class SyncService extends EventEmitter {
    private static instance: SyncService;
    private connectionManager: ConnectionManager;
    private operationQueue: OperationQueue;
    private initialized: boolean = false;
    private subscriptions: Map<string, Set<ModuleType>> = new Map(); // roomId -> Set<ModuleType>

    private seenOperationIds: Set<string> = new Set(); // 用于去重
    private readonly MAX_SEEN_IDS = 1000;

    private isDuplicate(id: string): boolean {
        if (this.seenOperationIds.has(id)) return true;
        this.seenOperationIds.add(id);
        if (this.seenOperationIds.size > this.MAX_SEEN_IDS) {
            const first = this.seenOperationIds.values().next().value;
            if (first) this.seenOperationIds.delete(first);
        }
        return false;
    }

    private constructor(config: SyncServiceConfig = {}) {
        super();
        this.connectionManager = new ConnectionManager({
            autoConnect: config.autoConnect ?? true
        });
        this.operationQueue = new OperationQueue();
    }

    /**
     * 获取单例实例
     */
    static getInstance(): SyncService {
        if (!SyncService.instance) {
            SyncService.instance = new SyncService();
        }
        return SyncService.instance;
    }

    private initPromise: Promise<void> | null = null;

    /**
     * 初始化服务
     */
    async init(): Promise<void> {
        if (this.initialized) return;
        if (this.initPromise) return this.initPromise;

        this.initPromise = (async () => {
            try {
                console.log('[SyncService] Initializing subsystem...');
                // 1. 初始化各子模块
                await storageManager.init();
                await tabManager.init();
                await this.operationQueue.init();

                // 2. 设置事件监听
                this.setupEventListeners();

                // 3. 初始化连接管理器
                const token = localStorage.getItem('access_token');
                if (token) {
                    console.log('[SyncService] Setting token for ConnectionManager');
                    this.connectionManager.setToken(token);
                }

                await this.connectionManager.init();

                this.initialized = true;
                console.log('[SyncService] Initialized successfully');
            } catch (error) {
                console.error('[SyncService] Initialization error:', error);
                throw error;
            } finally {
                this.initPromise = null;
            }
        })();

        return this.initPromise;
    }

    /**
     * 设置事件监听
     */
    private setupEventListeners(): void {
        // 监听连接状态变化
        this.connectionManager.addEventListener('status-changed', (data: any) => {
            const { newStatus } = data;
            useSyncStore.getState().setConnectionStatus(newStatus);

            if (newStatus === 'connected') {
                this.handleConnected();
            } else if (newStatus === 'disconnected') {
                useSyncStore.getState().setSyncStatus('idle');
                // Pause operation queue when disconnected
                if (tabManager.isMaster()) {
                    this.operationQueue.pause();
                }
            }
        });

        this.connectionManager.addEventListener('message', (payload: any) => {
            const { event, data } = payload;
            this.handleServerMessage(event, data);
        });

        // 监听标签页消息
        tabManager.on('sync-operation', (payload) => {
            // 从其他标签页接收到的操作，需要应用到本地
            this.handleRemoteOperation(payload as Operation, { source: 'tab' });
        });

        tabManager.on('forward-operation', (payload) => {
            // 作为主标签页，接收从标签页转发来的操作，需要发送到服务器
            if (tabManager.isMaster()) {
                const operation = payload as Operation;
                this.enqueueOperation(operation);
            }
        });

        // 监听操作队列
        this.operationQueue.onSend(async (operations) => {
            await this.sendOperationsToServer(operations);
        });
    }

    /**
     * 处理连接成功
     */
    private handleConnected(): void {
        // Authentication is handled via the 'auth' option in ConnectionManager
        // which sends it during the initial handshake. No separate 'auth' message needed.

        // 重新加入所有订阅的房间
        this.subscriptions.forEach((modules, roomId) => {
            modules.forEach(module => {
                this.connectionManager.send('join_room', { roomId, module });
                console.log(`[SyncService] Re-joined room on connect: ${roomId} (${module})`);
            });
        });

        // 处理离线队列 - 稍微延迟一点点确保所有 rejoin 消息已发出
        if (tabManager.isMaster()) {
            setTimeout(() => {
                if (this.connectionManager.isConnected()) {
                    this.operationQueue.resume();
                    this.operationQueue.retryFailed();
                }
            }, 100);
        }

        useSyncStore.getState().setSyncStatus('synced');
    }

    /**
     * 加入协作房间
     */
    async joinRoom(roomId: string, module: ModuleType): Promise<void> {
        // 更新Store
        useRoomStore.getState().joinRoom(roomId, module);

        // 记录订阅
        if (!this.subscriptions.has(roomId)) {
            this.subscriptions.set(roomId, new Set());
        }
        this.subscriptions.get(roomId)!.add(module);

        // 如果已连接，发送加入消息
        if (this.connectionManager.isConnected()) {
            this.connectionManager.send('join_room', { roomId, module });
            console.log(`[SyncService] Joining room: ${roomId} (${module})`);
        } else {
            console.log(`[SyncService] Queued join room: ${roomId} (${module}) - waiting for connection`);
        }

        // 尝试加载本地数据（快照或草稿）
        await this.loadLocalData(roomId, module);
    }

    /**
     * 离开协作房间
     */
    leaveRoom(roomId: string, module: ModuleType): void {
        // 更新Store
        useRoomStore.getState().leaveRoom(roomId);

        // 移除订阅
        const modules = this.subscriptions.get(roomId);
        if (modules) {
            modules.delete(module);
            if (modules.size === 0) {
                this.subscriptions.delete(roomId);
            }
        }

        // 发送离开消息
        if (this.connectionManager.isConnected()) {
            this.connectionManager.send('leave_room', { roomId, module });
        }

        console.log(`[SyncService] Left room: ${roomId} (${module})`);
    }

    /**
     * 发送操作（统一入口）
     */
    async sendOperation(operation: Operation): Promise<string> {
        // Only log non-awareness operations to keep console clean
        if (operation.type !== 'awareness') {
            console.log(`[SyncService] Sending operation: ${operation.type} (${operation.id})`);
        }

        // 1. 立即应用到本地（乐观更新）
        await this.applyLocalOperation(operation);

        // 2. 广播到其他标签页
        tabManager.broadcast('sync-operation', operation);

        // 3. 处理发送逻辑
        // Awareness 和光标同步不需要可靠传输，直接发送，不进队列
        if (operation.type === 'awareness') {
            if (this.connectionManager.isConnected()) {
                this.connectionManager.send('operation', operation);
            }
            return operation.id;
        }

        return this.enqueueOperation(operation);
    }

    /**
     * 将操作加入发送队列
     */
    private async enqueueOperation(operation: Operation): Promise<string> {
        // 如果是主标签页，直接加入队列
        if (tabManager.isMaster()) {
            useSyncStore.getState().incrementPendingOperations();

            try {
                const id = await this.operationQueue.enqueue(operation);
                return id;
            } catch (error) {
                console.error('[SyncService] Enqueue error:', error);
                useSyncStore.getState().decrementPendingOperations();
                throw error;
            }
        }
        // 如果是从标签页，转发给主标签页
        else {
            console.log('[SyncService] Forwarding operation to master tab');
            tabManager.broadcast('forward-operation', operation);

            // 仍然在本地记录操作日志，但不加入发送队列（防止重复发送）
            return operation.id;
        }
    }

    /**
     * 发送操作到服务器
     */
    private async sendOperationsToServer(operations: Operation[]): Promise<void> {
        if (!this.connectionManager.isConnected()) {
            throw new Error('No connection to server');
        }

        useSyncStore.getState().setSyncStatus('syncing');

        // 计算数据大小 (主要针对 Yjs 更新或聊天内容)
        const totalSize = operations.reduce((acc, op) => {
            const data = op.data as any;
            const str = data.update || data.content || '';
            return acc + (typeof str === 'string' ? str.length : 0);
        }, 0);
        console.log(`[SyncService] Sending batch of ${operations.length} operations (${(totalSize / 1024).toFixed(2)} KB)`);

        try {
            // 批量发送 - 给更长的超时时间 (30s) 处理包含大资产（如图片）或高负载的情况
            await this.connectionManager.sendWithAck('batch-operations', { operations }, 30000);

            // 确认发送成功
            for (const op of operations) {
                await this.operationQueue.confirm(op.id);
                useSyncStore.getState().decrementPendingOperations();
                useSyncStore.getState().incrementOperationsSent();
            }

            useSyncStore.getState().setSyncStatus('synced');
        } catch (error) {
            console.error('[SyncService] Send to server failed:', error);
            useSyncStore.getState().setSyncStatus('error');
            useSyncStore.getState().setError('Sync failed');
            throw error;
        }
    }

    /**
     * 应用本地操作
     */
    private async applyLocalOperation(operation: Operation): Promise<void> {
        // 如果已经处理过（去重），则忽略
        if (this.isDuplicate(operation.id)) return;

        this.emit(`operation:${operation.module}`, operation);
    }

    /**
     * 处理远程操作（来自服务器或其他标签页）
     */
    private async handleRemoteOperation(
        operation: Operation,
        metadata: { source: 'server' | 'tab' }
    ): Promise<void> {
        // 如果已经处理过（去重），则忽略
        if (this.isDuplicate(operation.id)) return;

        console.log(`[SyncService] Handling remote operation from ${metadata.source}:`, operation.id);

        // 触发事件通知Adapter应用操作
        this.emit(`operation:${operation.module}`, operation);

        if (metadata.source === 'server') {
            useSyncStore.getState().incrementOperationsReceived();
        }
    }

    /**
     * 处理服务器消息
     */
    private handleServerMessage(event: string, data: any): void {
        // Unpack arguments array from ConnectionManager
        // Socket.IO sends arguments as an array [arg1, arg2, ...]
        const payload = Array.isArray(data) ? data[0] : data;

        switch (event) {
            case 'operation':
                this.handleRemoteOperation(payload as Operation, { source: 'server' });
                break;

            case 'batch-operations':
                const operations = payload.operations as Operation[];
                operations.forEach((op: Operation) => this.handleRemoteOperation(op, { source: 'server' }));
                break;

            case 'room-state':
                // 全量同步
                this.handleRoomStateSync(payload);
                break;

            case 'sync_ready':
                // 通知模块已就绪（即使没有初始状态）
                this.emit(`ready:${payload.module}`, payload);
                break;

            case 'error':
                console.error('[SyncService] Server error:', payload);
                useSyncStore.getState().setError(payload.message || 'Server error');
                break;

            case 'user_joined':
                this.handleUserJoined(payload);
                break;

            case 'user_left':
                this.handleUserLeft(payload);
                break;

            case 'typing':
                this.emit('typing', payload);
                break;

            case 'stop_typing':
                this.emit('stop_typing', payload);
                break;
        }
    }

    /**
     * 处理用户加入
     */
    private handleUserJoined(data: any): void {
        const { roomId, user_id, username, avatar_url } = data;

        if (roomId) {
            useRoomStore.getState().addRoomUser(roomId, {
                id: user_id,
                name: username,
                avatar: avatar_url,
                color: '#000000', // Default
                isOnline: true,
                lastSeen: Date.now()
            });
        }
    }

    /**
     * 处理用户离开
     */
    private handleUserLeft(data: any): void {
        const { roomId, user_id } = data;
        if (roomId) {
            useRoomStore.getState().removeRoomUser(roomId, user_id);
        }
    }

    /**
     * 处理房间状态全量同步
     */
    private async handleRoomStateSync(data: any): Promise<void> {
        const { roomId, module, state } = data;
        console.log(`[SyncService] Received full state for ${roomId} (${module})`);

        // 保存快照
        await storageManager.saveSnapshot({
            roomId,
            module,
            data: typeof state === 'string' ? { update: state, format: 'yjs-update' } : state,
            version: data.version || 0,
            timestamp: Date.now()
        });

        // 通知UI
        this.emit(`state:${module}`, { roomId, state });
    }

    /**
     * 加载本地数据
     */
    private async loadLocalData(roomId: string, module: ModuleType): Promise<void> {
        // For inquiry module, SKIP local data and wait for server state
        // This prevents stale local cache from conflicting with authoritative server state
        if (module === 'inquiry') {
            console.log(`[SyncService] Skipping local data for ${roomId} (inquiry uses server state only)`);
            return;
        }

        // 1. 尝试加载草稿（最新的未保存数据）
        const draft = await storageManager.getDraft(roomId);
        if (draft && draft.module === module) {
            console.log(`[SyncService] Loaded draft for ${roomId}`);
            this.emit(`state:${module}`, { roomId, state: draft.data, isDraft: true });
            useRoomStore.getState().markDraft(roomId);
            return;
        }

        // 2. 尝试加载快照
        const snapshot = await storageManager.getSnapshot(roomId);
        if (snapshot && snapshot.module === module) {
            console.log(`[SyncService] Loaded snapshot for ${roomId}`);
            this.emit(`state:${module}`, { roomId, state: snapshot.data, isSnapshot: true });
            return;
        }

        console.log(`[SyncService] No local data for ${roomId}`);
    }

    /**
     * 保存草稿
     */
    async saveDraft(roomId: string, module: ModuleType, data: any): Promise<void> {
        await storageManager.saveDraft(roomId, module, data);
        useRoomStore.getState().markDraft(roomId);
    }

    /**
     * 清除草稿
     */
    async clearDraft(roomId: string): Promise<void> {
        await storageManager.deleteDraft(roomId);
        useRoomStore.getState().clearDraft(roomId);
    }

    /**
     * 更新认证token
     */
    setToken(token: string): void {
        this.connectionManager.setToken(token);
    }

    /**
     * 重置服务 (用于登出)
     */
    reset(): void {
        this.connectionManager.disconnect();
        this.subscriptions.clear();
        this.operationQueue.clear();
        this.seenOperationIds.clear();
        useSyncStore.getState().setConnectionStatus('disconnected');
        useSyncStore.getState().setSyncStatus('idle');
        console.log('[SyncService] Service reset');
    }

    /**
     * 销毁服务
     */
    destroy(): void {
        this.connectionManager.destroy();
        this.operationQueue.destroy();
        tabManager.destroy();
        storageManager.destroy();
        this.initialized = false;
        console.log('[SyncService] Destroyed');
    }
}

// 导出单例
export const syncService = SyncService.getInstance();
