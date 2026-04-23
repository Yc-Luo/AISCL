/**
 * 同步模块类型定义
 * 定义协同和持久化所需的所有类型
 */

// ============ 基础类型 ============

/** 操作模块类型 */
export type ModuleType = 'collaboration' | 'document' | 'chat' | 'inquiry';

/** 连接状态 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

/** 同步状态 */
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'offline';

// ============ 操作类型 ============

/** 基础操作接口 */
export interface BaseOperation {
    id: string;
    module: ModuleType;
    roomId: string;
    timestamp: number;
    clientId: string;
    version: number;
    metadata?: OperationMetadata;
}

/** 操作元数据 */
export interface OperationMetadata {
    tabId?: string;
    isLocal?: boolean;
    compressed?: boolean;
    batchId?: string;
}

/** 协作操作 */
export interface CollaborationOperation extends BaseOperation {
    module: 'collaboration';
    // 增加 'update' 类型，用于 Yjs 的二进制更新
    type: 'draw' | 'update' | 'delete' | 'transform' | 'reorder' | 'modify' | 'awareness';
    data: CollaborationOperationData;
}

/** 协作操作数据 */
export interface CollaborationOperationData {
    // Yjs 更新数据 (Base64 字符串)
    update?: string;

    // 原有的 OT 字段 (保留以兼容可能的混合模式)
    elementId?: string;
    elementIds?: string[];
    element?: Record<string, unknown>;
    elements?: Record<string, unknown>[];
    transform?: {
        x?: number;
        y?: number;
        rotation?: number;
        scale?: number;
    };
    order?: string[];
}

/** 文档操作 */
export interface DocumentOperation extends BaseOperation {
    module: 'document';
    type: 'insert' | 'delete' | 'format' | 'update' | 'awareness';
    data: DocumentOperationData;
}

/** 文档操作数据 */
export interface DocumentOperationData {
    position?: number;
    content?: string;
    length?: number;
    format?: Record<string, unknown>;
    path?: string[];
    update?: string; // Yjs binary update
}

/** 聊天操作 */
export interface ChatOperation extends BaseOperation {
    module: 'chat';
    type: 'message' | 'reaction' | 'edit' | 'delete';
    data: ChatOperationData;
}

/** 聊天操作数据 */
export interface ChatOperationData {
    messageId?: string;
    clientMessageId?: string;
    content?: string;
    mentions?: string[];
    replyTo?: string;
    reaction?: string;
    fileInfo?: {
        name: string;
        size: number;
        url: string;
        mimeType: string;
    };
    aiMeta?: {
        primary_agent?: string;
        rationale_summary?: string;
        routing_summary?: string[];
    };
    isRecalled?: boolean;
}

/** 深度探究空间操作 */
export interface InquiryOperation extends BaseOperation {
    module: 'inquiry';
    type: 'create' | 'update' | 'delete' | 'move' | 'awareness';
    data: InquiryOperationData;
}

/** 深度探究空间数据 */
export interface InquiryOperationData {
    update?: string; // Yjs binary update (Base64)
}

/** 通用操作类型 */
export type Operation = CollaborationOperation | DocumentOperation | ChatOperation | InquiryOperation;

// ============ 房间类型 ============

/** 房间信息 */
export interface RoomInfo {
    id: string;
    projectId: string;
    module: ModuleType;
    users: RoomUser[];
    createdAt: number;
    lastActivity: number;
}

/** 房间用户 */
export interface RoomUser {
    id: string;
    name: string;
    avatar?: string;
    color: string;
    cursor?: CursorInfo;
    isOnline: boolean;
    lastSeen: number;
}

/** 光标信息 */
export interface CursorInfo {
    x: number;
    y: number;
    module: ModuleType;
    timestamp: number;
}

// ============ 存储类型 ============

/** 存储项基础接口 */
export interface StorageItem {
    key: string;
    value: unknown;
    timestamp: number;
    expires?: number;
}

/** IndexedDB存储配置 */
export interface IndexedDBConfig {
    dbName: string;
    version: number;
    stores: IndexedDBStoreConfig[];
}

/** IndexedDB存储表配置 */
export interface IndexedDBStoreConfig {
    name: string;
    keyPath?: string;
    autoIncrement?: boolean;
    indexes?: IndexedDBIndexConfig[];
}

/** IndexedDB索引配置 */
export interface IndexedDBIndexConfig {
    name: string;
    keyPath: string | string[];
    unique?: boolean;
    multiEntry?: boolean;
}

/** 持久化数据快照 */
export interface DataSnapshot {
    roomId: string;
    module: ModuleType;
    data: unknown;
    version: number;
    timestamp: number;
    checksum?: string;
}

/** 操作日志条目 */
export interface OperationLogEntry {
    id: string;
    operation: Operation;
    status: 'pending' | 'sending' | 'sent' | 'confirmed' | 'failed';
    retries: number;
    createdAt: number;
    sentAt?: number;
    confirmedAt?: number;
}

// ============ 标签页类型 ============

/** 标签页信息 */
export interface TabInfo {
    id: string;
    isMaster: boolean;
    createdAt: number;
    lastHeartbeat: number;
    activeRoomId?: string;
}

/** 标签页消息类型 */
export type TabMessageType =
    | 'tab-joined'
    | 'tab-left'
    | 'master-election'
    | 'sync-operation'
    | 'room-data'
    | 'room-data-request'
    | 'room-data-response'
    | 'forward-operation'
    | 'heartbeat';

/** 标签页消息 */
export interface TabMessage<T = unknown> {
    type: TabMessageType;
    payload: T;
    sourceTabId: string;
    timestamp: number;
}

// ============ 同步服务类型 ============

/** 同步服务事件 */
export type SyncEventType =
    | 'connection:open'
    | 'connection:close'
    | 'connection:error'
    | 'operation:local'
    | 'operation:remote'
    | 'conflict:detected'
    | 'conflict:resolved'
    | 'sync:started'
    | 'sync:completed'
    | 'sync:failed';

/** 同步事件处理器 */
export type SyncEventHandler<T = unknown> = (data: T) => void;

/** 冲突解决结果 */
export interface ConflictResolution {
    roomId: string;
    module: ModuleType;
    resolvedState: unknown;
    discardedOperations: Operation[];
    appliedOperations: Operation[];
}

// ============ Store状态类型 ============

/** 同步Store状态 */
export interface SyncStoreState {
    // 连接状态
    connectionStatus: ConnectionStatus;
    syncStatus: SyncStatus;

    // 标签页状态
    tabId: string;
    isMasterTab: boolean;

    // 在线状态
    isOnline: boolean;
    lastOnlineAt: number | null;

    // 错误信息
    lastError: string | null;

    // 待同步操作
    pendingOperationsCount: number;

    // 统计信息
    totalOperationsSent: number;
    totalOperationsReceived: number;
}

/** 同步Store操作 */
export interface SyncStoreActions {
    // 连接管理
    setConnectionStatus: (status: ConnectionStatus) => void;
    setSyncStatus: (status: SyncStatus) => void;

    // 标签页管理
    setTabId: (id: string) => void;
    setIsMasterTab: (isMaster: boolean) => void;

    // 在线状态
    setOnlineStatus: (isOnline: boolean) => void;

    // 错误处理
    setError: (error: string | null) => void;
    clearError: () => void;

    // 操作计数
    incrementPendingOperations: () => void;
    decrementPendingOperations: () => void;
    setPendingOperationsCount: (count: number) => void;

    // 统计更新
    incrementOperationsSent: () => void;
    incrementOperationsReceived: () => void;

    // 重置
    reset: () => void;
}

/** 房间Store状态 */
export interface RoomStoreState {
    // 当前房间
    currentRoomId: string | null;
    currentModule: ModuleType | null;

    // 房间列表
    rooms: Record<string, RoomInfo>;

    // 用户列表
    roomUsers: Record<string, RoomUser[]>;

    // 草稿状态
    draftRooms: Record<string, number>; // roomId -> lastDraftTime

    // 加载状态
    isLoading: boolean;
}

/** 房间Store操作 */
export interface RoomStoreActions {
    // 房间管理
    setCurrentRoom: (roomId: string | null, module: ModuleType | null) => void;
    joinRoom: (roomId: string, module: ModuleType) => void;
    leaveRoom: (roomId: string) => void;

    // 房间信息
    updateRoomInfo: (roomId: string, info: Partial<RoomInfo>) => void;
    removeRoom: (roomId: string) => void;

    // 用户管理
    setRoomUsers: (roomId: string, users: RoomUser[]) => void;
    addRoomUser: (roomId: string, user: RoomUser) => void;
    updateRoomUser: (roomId: string, userId: string, updates: Partial<RoomUser>) => void;
    removeRoomUser: (roomId: string, userId: string) => void;

    // 草稿管理
    markDraft: (roomId: string) => void;
    clearDraft: (roomId: string) => void;

    // 加载状态
    setLoading: (isLoading: boolean) => void;

    // 重置
    reset: () => void;
}
