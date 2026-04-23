/**
 * 操作队列管理器
 * 负责操作的排队、批量发送、失败重试、顺序保证
 */

import { Operation, OperationLogEntry } from '../../types/sync';
import { storageManager } from '../storage/StorageManager';

/** 操作队列配置 */
export interface OperationQueueConfig {
    /** 批量发送的最大操作数 */
    batchSize?: number;
    /** 批量发送的时间间隔（毫秒） */
    batchInterval?: number;
    /** 最大重试次数 */
    maxRetries?: number;
    /** 重试延迟（毫秒） */
    retryDelay?: number;
    /** 队列最大长度 */
    maxQueueSize?: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: Required<OperationQueueConfig> = {
    batchSize: 10,
    batchInterval: 100,
    maxRetries: 3,
    retryDelay: 1000,
    maxQueueSize: 1000,
};

/** 操作状态 */
type OperationStatus = 'pending' | 'sending' | 'sent' | 'confirmed' | 'failed';

/** 队列中的操作 */
interface QueuedOperation {
    entry: OperationLogEntry;
    retries: number;
    lastAttempt: number | null;
}

/**
 * 操作队列管理器类
 */
export class OperationQueue {
    private config: Required<OperationQueueConfig>;
    private queue: Map<string, QueuedOperation> = new Map();
    private batchTimer: NodeJS.Timeout | null = null;
    private sendCallback: ((operations: Operation[]) => Promise<void>) | null = null;
    private confirmCallback: ((operationId: string) => void) | null = null;

    constructor(config: OperationQueueConfig = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * 初始化队列
     */
    async init(): Promise<void> {
        // 从存储中恢复待处理的操作
        await this.loadPendingOperations();

        // 启动批量发送定时器
        this.startBatchTimer();

        console.log('[OperationQueue] Initialized');
    }

    /**
     * 从存储中加载待处理的操作
     */
    private async loadPendingOperations(): Promise<void> {
        try {
            const pendingOps = await storageManager.getPendingOperations();

            pendingOps.forEach(entry => {
                this.queue.set(entry.id, {
                    entry,
                    retries: entry.retries,
                    lastAttempt: entry.sentAt || null,
                });
            });

            if (pendingOps.length > 0) {
                console.log(`[OperationQueue] Loaded ${pendingOps.length} pending operations`);
            }
        } catch (error) {
            console.error('[OperationQueue] Failed to load pending operations:', error);
        }
    }

    /**
     * 添加操作到队列
     */
    async enqueue(operation: Operation): Promise<string> {
        // 检查队列是否已满
        if (this.queue.size >= this.config.maxQueueSize) {
            throw new Error('Operation queue is full');
        }

        // 创建操作日志条目
        const entry: OperationLogEntry = {
            id: operation.id,
            operation,
            status: 'pending',
            retries: 0,
            createdAt: Date.now(),
        };

        // 添加到队列
        this.queue.set(entry.id, {
            entry,
            retries: 0,
            lastAttempt: null,
        });

        // 保存到存储
        await storageManager.saveOperation(entry);

        console.log(`[OperationQueue] Enqueued operation: ${entry.id}`);

        // 如果配置了立即发送，触发批量发送
        if (this.config.batchInterval === 0) {
            this.processBatch();
        }

        return entry.id;
    }

    /**
     * 启动批量发送定时器
     */
    private startBatchTimer(): void {
        if (this.batchTimer || this.config.batchInterval === 0) {
            return;
        }

        this.batchTimer = setInterval(() => {
            this.processBatch();
        }, this.config.batchInterval);
    }

    /**
     * 停止批量发送定时器
     */
    private stopBatchTimer(): void {
        if (this.batchTimer) {
            clearInterval(this.batchTimer);
            this.batchTimer = null;
        }
    }

    /**
     * 处理批量发送
     */
    private async processBatch(): Promise<void> {
        if (!this.sendCallback) {
            return;
        }

        // 获取待发送的操作
        const operations = this.getPendingOperations();

        if (operations.length === 0) {
            return;
        }

        // 批量发送
        const batch = operations.slice(0, this.config.batchSize);

        try {
            // 更新状态为发送中
            batch.forEach(op => {
                const queued = this.queue.get(op.id);
                if (queued) {
                    queued.entry.status = 'sending';
                    queued.entry.sentAt = Date.now();
                    queued.lastAttempt = Date.now();
                }
            });

            // 调用发送回调
            await this.sendCallback(batch);

            // 更新状态为已发送
            batch.forEach(op => {
                const queued = this.queue.get(op.id);
                if (queued) {
                    queued.entry.status = 'sent';
                    storageManager.saveOperation(queued.entry);
                }
            });

            console.log(`[OperationQueue] Sent batch of ${batch.length} operations`);
        } catch (error) {
            // connection-related errors are expected when offline/reconnecting, so use debug instead of warn
            if (error instanceof Error && error.message.includes('No connection')) {
                console.debug('[OperationQueue] Batch send deferred: No connection to server');
            } else {
                console.error('[OperationQueue] Batch send error:', error);
            }

            // 更新失败的操作
            batch.forEach(op => {
                this.handleSendFailure(op.id, error instanceof Error && error.message.includes('No connection'));
            });
        }
    }

    /**
     * 获取待发送的操作
     */
    private getPendingOperations(): Operation[] {
        const now = Date.now();
        const operations: Operation[] = [];

        this.queue.forEach((queued, _) => {
            const { entry, retries, lastAttempt } = queued;

            // 待处理的操作
            if (entry.status === 'pending') {
                operations.push(entry.operation);
            }
            // 失败但可以重试的操作
            else if (entry.status === 'failed' && retries < this.config.maxRetries) {
                // 检查重试延迟
                if (!lastAttempt || now - lastAttempt >= this.config.retryDelay) {
                    operations.push(entry.operation);
                }
            }
        });

        return operations;
    }

    /**
     * 处理发送失败
     */
    private async handleSendFailure(operationId: string, isConnectionIssue: boolean = false): Promise<void> {
        const queued = this.queue.get(operationId);
        if (!queued) {
            return;
        }

        queued.retries++;
        queued.entry.retries = queued.retries;

        if (queued.retries >= this.config.maxRetries) {
            // 超过最大重试次数，标记为失败
            queued.entry.status = 'failed';
            console.error(`[OperationQueue] Operation failed after ${queued.retries} retries: ${operationId}`);
        } else {
            // 重新标记为待处理，等待重试
            queued.entry.status = 'pending';
            if (isConnectionIssue) {
                console.debug(`[OperationQueue] Operation queued for retry (waiting for connection): ${operationId}`);
            } else {
                console.warn(`[OperationQueue] Operation retry ${queued.retries}/${this.config.maxRetries}: ${operationId}`);
            }
        }

        await storageManager.saveOperation(queued.entry);
    }

    /**
     * 确认操作已被服务器接收
     */
    async confirm(operationId: string): Promise<void> {
        const queued = this.queue.get(operationId);
        if (!queued) {
            return;
        }

        queued.entry.status = 'confirmed';
        queued.entry.confirmedAt = Date.now();

        // 从队列中移除
        this.queue.delete(operationId);

        // 从存储中删除
        await storageManager.deleteOperation(operationId);

        // 触发确认回调
        if (this.confirmCallback) {
            this.confirmCallback(operationId);
        }

        console.log(`[OperationQueue] Operation confirmed: ${operationId}`);
    }

    /**
     * 批量确认操作
     */
    async confirmBatch(operationIds: string[]): Promise<void> {
        await Promise.all(operationIds.map(id => this.confirm(id)));
    }

    /**
     * 取消操作
     */
    async cancel(operationId: string): Promise<void> {
        const queued = this.queue.get(operationId);
        if (!queued) {
            return;
        }

        // 从队列中移除
        this.queue.delete(operationId);

        // 从存储中删除
        await storageManager.deleteOperation(operationId);

        console.log(`[OperationQueue] Operation cancelled: ${operationId}`);
    }

    /**
     * 获取操作状态
     */
    getStatus(operationId: string): OperationStatus | null {
        const queued = this.queue.get(operationId);
        return queued ? queued.entry.status : null;
    }

    /**
     * 获取队列大小
     */
    getSize(): number {
        return this.queue.size;
    }

    /**
     * 获取待处理操作数量
     */
    getPendingCount(): number {
        let count = 0;
        this.queue.forEach(queued => {
            if (queued.entry.status === 'pending' || queued.entry.status === 'failed') {
                count++;
            }
        });
        return count;
    }

    /**
     * 清空队列
     */
    async clear(): Promise<void> {
        // 删除所有存储的操作
        const deletePromises = Array.from(this.queue.keys()).map(id =>
            storageManager.deleteOperation(id)
        );
        await Promise.all(deletePromises);

        // 清空队列
        this.queue.clear();

        console.log('[OperationQueue] Queue cleared');
    }

    /**
     * 设置发送回调
     */
    onSend(callback: (operations: Operation[]) => Promise<void>): void {
        this.sendCallback = callback;
    }

    /**
     * 设置确认回调
     */
    onConfirm(callback: (operationId: string) => void): void {
        this.confirmCallback = callback;
    }

    /**
     * 手动触发批量发送
     */
    flush(): void {
        this.processBatch();
    }

    /**
     * 获取失败的操作
     */
    getFailedOperations(): Operation[] {
        const failed: Operation[] = [];

        this.queue.forEach(queued => {
            if (queued.entry.status === 'failed') {
                failed.push(queued.entry.operation);
            }
        });

        return failed;
    }

    /**
     * Skip processing batch (Pause)
     */
    pause(): void {
        this.stopBatchTimer();
        console.log('[OperationQueue] Paused');
    }

    /**
     * Resume processing batch
     */
    resume(): void {
        this.startBatchTimer();
        console.log('[OperationQueue] Resumed');
        // Trigger immediate processing if there are pending ops
        if (this.getPendingOperations().length > 0) {
            this.processBatch();
        }
    }

    /**
     * 重试失败的操作
     */
    async retryFailed(): Promise<void> {
        this.queue.forEach(queued => {
            if (queued.entry.status === 'failed') {
                queued.entry.status = 'pending';
                queued.retries = 0;
                queued.entry.retries = 0;
                storageManager.saveOperation(queued.entry);
            }
        });

        console.log('[OperationQueue] Retrying failed operations');
        this.flush();
    }

    /**
     * 销毁队列
     */
    destroy(): void {
        this.stopBatchTimer();
        this.sendCallback = null;
        this.confirmCallback = null;
        console.log('[OperationQueue] Destroyed');
    }
}
