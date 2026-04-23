/**
 * WebSocket连接管理器
 * 负责WebSocket连接的生命周期管理、重连、心跳等
 */

import { io, Socket } from 'socket.io-client';
import { config } from '../../config/env';
import { ConnectionStatus } from '../../types/sync';

/** 连接管理器配置 */
export interface ConnectionManagerConfig {
    /** Socket.IO服务器URL */
    serverUrl?: string;
    /** 认证token */
    token?: string;
    /** 是否自动连接 */
    autoConnect?: boolean;
    /** 重连间隔（毫秒） */
    reconnectDelay?: number;
    /** 最大重连尝试次数 */
    maxReconnectAttempts?: number;
    /** 心跳间隔（毫秒） */
    heartbeatInterval?: number;
    /** 心跳超时（毫秒） */
    heartbeatTimeout?: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: Required<ConnectionManagerConfig> = {
    serverUrl: config.socketIOUrl,
    token: '',
    autoConnect: true,
    reconnectDelay: 2000,
    maxReconnectAttempts: 20,
    heartbeatInterval: 30000,
    heartbeatTimeout: 20000,
};

/** 连接事件类型 */
export type ConnectionEventType =
    | 'status-changed'
    | 'connected'
    | 'disconnected'
    | 'reconnecting'
    | 'error'
    | 'message';

/** 连接事件处理器 */
export type ConnectionEventHandler<T = unknown> = (data: T) => void;

/**
 * WebSocket连接管理器类
 */
export class ConnectionManager {
    private config: Required<ConnectionManagerConfig>;
    private socket: Socket | null = null;
    private status: ConnectionStatus = 'disconnected';
    private reconnectAttempts: number = 0;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private heartbeatTimeoutTimer: NodeJS.Timeout | null = null;
    private lastPongTime: number = 0;
    private eventHandlers: Map<ConnectionEventType, Set<ConnectionEventHandler>> = new Map();

    constructor(config: ConnectionManagerConfig = {}) {
        this.config = { ...DEFAULT_CONFIG };

        // Manual merge to avoid 'undefined' overriding defaults and ensure type safety
        if (config.serverUrl !== undefined) this.config.serverUrl = config.serverUrl;
        if (config.token !== undefined) this.config.token = config.token;
        if (config.autoConnect !== undefined) this.config.autoConnect = config.autoConnect;
        if (config.reconnectDelay !== undefined) this.config.reconnectDelay = config.reconnectDelay;
        if (config.maxReconnectAttempts !== undefined) this.config.maxReconnectAttempts = config.maxReconnectAttempts;
        if (config.heartbeatInterval !== undefined) this.config.heartbeatInterval = config.heartbeatInterval;
        if (config.heartbeatTimeout !== undefined) this.config.heartbeatTimeout = config.heartbeatTimeout;
    }

    /**
     * 初始化连接
     */
    async init(): Promise<void> {
        if (this.socket) {
            console.warn('[ConnectionManager] Already initialized');
            return;
        }

        if (this.config.autoConnect) {
            await this.connect();
        }
    }

    /**
     * 连接到服务器
     */
    async connect(): Promise<void> {
        if (this.socket?.connected) {
            console.log('[ConnectionManager] Already connected');
            return;
        }

        return new Promise((resolve, reject) => {
            try {
                this.setStatus('connecting');

                // 创建Socket.IO连接
                this.socket = io(this.config.serverUrl, {
                    auth: {
                        token: this.config.token,
                    },
                    transports: ['websocket'],
                    reconnection: true,
                    reconnectionDelay: this.config.reconnectDelay,
                    reconnectionAttempts: this.config.maxReconnectAttempts,
                });

                // 连接成功
                this.socket.on('connect', () => {
                    console.log('[ConnectionManager] Connected');
                    this.reconnectAttempts = 0;
                    this.setStatus('connected');
                    this.startHeartbeat();
                    this.emit('connected', { socketId: this.socket?.id });
                    resolve();
                });

                // 连接断开
                this.socket.on('disconnect', (reason) => {
                    console.log('[ConnectionManager] Disconnected:', reason);
                    this.setStatus('disconnected');
                    this.stopHeartbeat();
                    this.emit('disconnected', { reason });
                });

                // 连接错误
                this.socket.on('connect_error', (error) => {
                    console.error('[ConnectionManager] Connection error:', error.message, (error as any).data);
                    this.setStatus('error');
                    this.emit('error', { error: error.message });

                    if (this.reconnectAttempts === 0) {
                        reject(error);
                    }
                });

                // 重连尝试
                this.socket.io.on('reconnect_attempt', () => {
                    this.reconnectAttempts++;
                    console.log(`[ConnectionManager] Reconnection attempt ${this.reconnectAttempts}`);
                    this.setStatus('reconnecting');
                    this.emit('reconnecting', { attempt: this.reconnectAttempts });
                });

                // 重连成功
                this.socket.io.on('reconnect', (attempt) => {
                    console.log(`[ConnectionManager] Reconnected after ${attempt} attempts`);
                    this.reconnectAttempts = 0;
                    // Do not set status here, wait for socket 'connect' event to ensure connectivity
                });

                // 重连失败
                this.socket.io.on('reconnect_failed', () => {
                    console.error('[ConnectionManager] Reconnection failed');
                    this.setStatus('error');
                    this.emit('error', { error: 'Reconnection failed' });
                });

                // Pong响应（心跳）
                this.socket.on('pong', () => {
                    this.lastPongTime = Date.now();
                    this.resetHeartbeatTimeout();
                });

                // 监听所有消息
                this.socket.onAny((eventName, ...args) => {
                    if (eventName !== 'pong' && eventName !== 'ping') {
                        this.emit('message', { event: eventName, data: args });
                    }
                });

            } catch (error) {
                console.error('[ConnectionManager] Connect error:', error);
                this.setStatus('error');
                reject(error);
            }
        });
    }

    /**
     * 断开连接
     */
    disconnect(): void {
        if (!this.socket) {
            return;
        }

        this.stopHeartbeat();
        this.socket.disconnect();
        this.socket = null;
        this.setStatus('disconnected');
        console.log('[ConnectionManager] Disconnected');
    }

    /**
     * 发送消息
     */
    send(event: string, data: unknown): void {
        if (!this.isConnected()) {
            const socketInfo = this.socket ? ` (socket.connected: ${this.socket.connected})` : ' (no socket)';
            console.warn(`[ConnectionManager] Cannot send ${event} - not connected${socketInfo}`);
            throw new Error('Not connected');
        }

        this.socket!.emit(event, data);
    }

    /**
     * 发送消息并等待响应
     */
    async sendWithAck(event: string, data: unknown, timeout: number = 5000): Promise<unknown> {
        if (!this.socket?.connected) {
            throw new Error('Not connected');
        }

        return new Promise((resolve, reject) => {
            const timeoutTimer = setTimeout(() => {
                reject(new Error('Request timeout'));
            }, timeout);

            this.socket!.emit(event, data, (response: unknown) => {
                clearTimeout(timeoutTimer);
                resolve(response);
            });
        });
    }

    /**
     * 监听事件
     */
    on(event: string, handler: (...args: unknown[]) => void): () => void {
        if (!this.socket) {
            throw new Error('Socket not initialized');
        }

        this.socket.on(event, handler);

        // 返回取消监听函数
        return () => {
            this.socket?.off(event, handler);
        };
    }

    /**
     * 取消监听事件
     */
    off(event: string, handler?: (...args: unknown[]) => void): void {
        if (!this.socket) {
            return;
        }

        if (handler) {
            this.socket.off(event, handler);
        } else {
            this.socket.off(event);
        }
    }

    /**
     * 启动心跳
     */
    private startHeartbeat(): void {
        this.stopHeartbeat();

        this.heartbeatTimer = setInterval(() => {
            if (this.socket?.connected) {
                this.socket.emit('ping');
                this.startHeartbeatTimeout();
            }
        }, this.config.heartbeatInterval);

        // 立即发送一次心跳
        if (this.socket?.connected) {
            this.socket.emit('ping');
            this.startHeartbeatTimeout();
        }
    }

    /**
     * 启动心跳超时检测
     */
    private startHeartbeatTimeout(): void {
        this.resetHeartbeatTimeout();

        this.heartbeatTimeoutTimer = setTimeout(() => {
            console.warn('[ConnectionManager] Heartbeat timeout');
            // 心跳超时，可能连接已断开
            this.disconnect();
        }, this.config.heartbeatTimeout);
    }

    /**
     * 重置心跳超时
     */
    private resetHeartbeatTimeout(): void {
        if (this.heartbeatTimeoutTimer) {
            clearTimeout(this.heartbeatTimeoutTimer);
            this.heartbeatTimeoutTimer = null;
        }
    }

    /**
     * 停止心跳
     */
    private stopHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        this.resetHeartbeatTimeout();
    }

    /**
     * 设置连接状态
     */
    private setStatus(status: ConnectionStatus): void {
        if (this.status === status) {
            return;
        }

        const oldStatus = this.status;
        this.status = status;

        this.emit('status-changed', { oldStatus, newStatus: status });
        console.log(`[ConnectionManager] Status changed: ${oldStatus} -> ${status}`);
    }

    /**
     * 更新认证token
     */
    setToken(token: string): void {
        this.config.token = token;

        // 如果已连接，需要重新连接以使用新token
        if (this.socket?.connected) {
            console.log('[ConnectionManager] Token updated, reconnecting...');
            this.disconnect();
            this.connect();
        }
    }

    /**
     * 注册连接事件处理器
     */
    addEventListener(type: ConnectionEventType, handler: ConnectionEventHandler): () => void {
        if (!this.eventHandlers.has(type)) {
            this.eventHandlers.set(type, new Set());
        }

        const handlers = this.eventHandlers.get(type)!;
        handlers.add(handler);

        // 返回取消注册函数
        return () => {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.eventHandlers.delete(type);
            }
        };
    }

    /**
     * 触发连接事件
     */
    private emit(type: ConnectionEventType, data: unknown): void {
        const handlers = this.eventHandlers.get(type);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`[ConnectionManager] Event handler error for ${type}:`, error);
                }
            });
        }
    }

    /**
     * 获取连接状态
     */
    getStatus(): ConnectionStatus {
        return this.status;
    }

    /**
     * 是否已连接
     */
    isConnected(): boolean {
        return this.status === 'connected' && this.socket?.connected === true;
    }

    /**
     * 获取Socket ID
     */
    getSocketId(): string | undefined {
        return this.socket?.id;
    }

    /**
     * 获取最后一次Pong时间
     */
    getLastPongTime(): number {
        return this.lastPongTime;
    }

    /**
     * 销毁连接管理器
     */
    destroy(): void {
        this.stopHeartbeat();
        this.disconnect();
        this.eventHandlers.clear();
        console.log('[ConnectionManager] Destroyed');
    }
}
