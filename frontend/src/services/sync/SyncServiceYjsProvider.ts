/**
 * SyncService Yjs Provider
 * 将 Yjs 文档通过 SyncService 进行同步，模拟 y-websocket 的 WebsocketProvider
 */

import * as Y from 'yjs';
import * as AwarenessProtocol from 'y-protocols/awareness';
import { syncService } from './SyncService';
import { fromUint8Array, toUint8Array } from '../../utils/encoding';
import { Operation } from '../../types/sync';

// 简单的 Observable 实现
class Observable {
    private _observers = new Map<string, Set<Function>>();

    on(name: string, f: Function) {
        if (!this._observers.has(name)) {
            this._observers.set(name, new Set());
        }
        this._observers.get(name)!.add(f);
    }

    off(name: string, f: Function) {
        this._observers.get(name)?.delete(f);
    }

    once(name: string, f: Function) {
        const _f = (...args: any[]) => {
            this.off(name, _f);
            f(...args);
        };
        this.on(name, _f);
    }

    emit(name: string, args: any[]) {
        this._observers.get(name)?.forEach(f => f(...args));
    }

    destroy() {
        this._observers.clear();
    }
}

export class SyncServiceYjsProvider extends Observable {
    doc: Y.Doc;
    roomId: string;
    module: 'collaboration' | 'document' | 'inquiry';

    awareness: AwarenessProtocol.Awareness;
    wsconnected: boolean = false;
    wsconnecting: boolean = false;
    synced: boolean = false;
    shouldConnect: boolean = true;

    private _boundLocalUpdate: any;
    private _boundAwarenessUpdate: any;
    private _boundRemoteOp: any;
    private _boundStateSync: any;
    private _boundSyncReady: any;

    constructor(roomId: string, doc: Y.Doc, module: 'collaboration' | 'document' | 'inquiry' = 'collaboration') {
        super();
        this.roomId = roomId;
        this.doc = doc;
        this.module = module;

        // 初始化 Awareness
        this.awareness = new AwarenessProtocol.Awareness(doc);

        // Ensure explicit compatibilty with extensions that expect 'document' instead of 'doc'
        // (Some Tiptap providers use .document)
        Object.defineProperty(this, 'document', {
            get: () => this.doc
        });

        // 绑定方法
        this._boundLocalUpdate = this.handleLocalUpdate.bind(this);
        this._boundAwarenessUpdate = this.handleAwarenessUpdate.bind(this);
        this._boundRemoteOp = this.handleRemoteOperation.bind(this);
        this._boundStateSync = this.handleStateSync.bind(this);
        this._boundSyncReady = this.handleSyncReady.bind(this);

        // 监听本地更新
        doc.on('update', this._boundLocalUpdate);

        // 监听 Awareness 更新
        this.awareness.on('update', this._boundAwarenessUpdate);

        // 监听 SyncService 事件
        syncService.on(`operation:${module}`, this._boundRemoteOp);
        syncService.on(`state:${module}`, this._boundStateSync);
        syncService.on(`ready:${module}`, this._boundSyncReady);

        // 初始状态
        this.wsconnecting = false;
        this.wsconnected = false;
    }

    /**
     * 处理本地 Yjs 更新
     */
    private handleLocalUpdate(update: Uint8Array, origin: any) {
        if (this.module === 'inquiry') return;
        if (origin === this) {
            return; // 忽略来自本 Provider 的更新
        }

        const base64Update = fromUint8Array(update);

        const operation: Operation = {
            id: `upd-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            module: this.module,
            roomId: this.roomId,
            timestamp: Date.now(),
            clientId: this.doc.clientID.toString(),
            version: 0,
            type: 'update',
            data: {
                update: base64Update
            }
        };

        // 发送操作
        syncService.sendOperation(operation).catch(err => {
            console.error('[SyncServiceYjsProvider] Failed to send update:', err);
        });
    }

    /**
     * 处理本地 Awareness 更新
     */
    private handleAwarenessUpdate({ added, updated, removed }: any, origin: any) {
        if (this.module === 'inquiry') return;
        if (origin === 'remote') {
            return;
        }

        const changedClients = added.concat(updated).concat(removed);
        const update = AwarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients);
        const base64Update = fromUint8Array(update);

        const operation: Operation = {
            id: `aw-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            module: this.module,
            roomId: this.roomId,
            timestamp: Date.now(),
            clientId: this.doc.clientID.toString(),
            version: 0,
            type: 'awareness',
            data: {
                update: base64Update
            }
        };

        // Awareness 通常不需要持久化队列，直接发送
        // 但为了简单，暂时也走 sendOperation
        syncService.sendOperation(operation).catch(err => {
            // Awareness 失败通常可以忽略，因为下一次更新会覆盖
            console.debug('[SyncServiceYjsProvider] Awareness sync failed (expected if offline):', err);
        });
    }

    /**
     * 处理远程操作
     */
    private handleRemoteOperation(operation: Operation) {
        // Inquiry 模块现在使用全量 JSON 同步，不由 Yjs 负责
        if (this.module === 'inquiry') {
            return;
        }

        // CRITICAL: Skip remote operations until initial sync is complete
        // This prevents early updates from corrupting the state
        if (!this.synced) {
            console.log(`[SyncServiceYjsProvider] Skipping remote op (not synced yet): ${operation.id}`);
            return;
        }

        console.log(`[SyncServiceYjsProvider] Received operation:`, {
            roomId: operation.roomId,
            myRoomId: this.roomId,
            opClientId: operation.clientId,
            myClientId: this.doc.clientID.toString(),
            type: operation.type
        });

        if (operation.roomId !== this.roomId) {
            console.log(`[SyncServiceYjsProvider] Skipping: roomId mismatch`);
            return;
        }

        // 忽略自己发送的操作
        if (operation.clientId === this.doc.clientID.toString()) {
            console.log(`[SyncServiceYjsProvider] Skipping: own operation`);
            return;
        }

        const opData = operation.data as any;
        if (opData && opData.update) {
            try {
                const update = toUint8Array(opData.update as string);

                const type = (operation as any).type;

                if (type === 'update') {
                    // 应用更新到本地 Doc
                    Y.applyUpdate(this.doc, update, this);
                } else if (type === 'awareness') {
                    // 应用 Awareness 更新
                    AwarenessProtocol.applyAwarenessUpdate(this.awareness, update, 'remote');
                } else if (type === 'sync-step-1') {
                    // 收到远程状态向量，回复 Step 2 (缺失的更新)
                    const missingUpdate = Y.encodeStateAsUpdate(this.doc, update);
                    this.sendSyncStep(2, missingUpdate);
                } else if (type === 'sync-step-2') {
                    // 收到 Step 2，应用缺失的更新
                    Y.applyUpdate(this.doc, update, this);
                }
            } catch (e) {
                console.error('[SyncServiceYjsProvider] Failed to apply remote operation:', e);
            }
        }
    }

    /**
     * 发送同步步骤消息
     */
    private sendSyncStep(step: 1 | 2, stateData: Uint8Array) {
        if (stateData.length === 0 && step === 2) return;

        const operation: any = {
            id: `sync-${step}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            module: this.module,
            roomId: this.roomId,
            timestamp: Date.now(),
            clientId: this.doc.clientID.toString(),
            version: 0,
            type: step === 1 ? 'sync-step-1' : 'sync-step-2',
            data: {
                update: fromUint8Array(stateData)
            }
        };

        syncService.sendOperation(operation).catch(err => {
            console.error(`[SyncServiceYjsProvider] Failed to send sync step ${step}:`, err);
        });
    }

    private markSynced() {
        if (!this.synced) {
            this.synced = true;
            this.emit('status', [{ status: 'connected' }]);
            this.emit('sync', [true]);

            // 发送 Step 1: 状态向量，请求其他客户端同步缺失数据
            const sv = Y.encodeStateVector(this.doc);
            this.sendSyncStep(1, sv);
        }
    }

    /**
     * 处理全量状态同步
     */
    private handleStateSync(data: { roomId?: string; room_id?: string; state: any; isDraft?: boolean; isSnapshot?: boolean }) {
        // Inquiry 模块不由 Yjs 负责同步
        if (this.module === 'inquiry') {
            return;
        }

        // IMPORTANT: Verify roomId to prevent cross-room data contamination
        const incomingRoomId = data.roomId || data.room_id;
        if (incomingRoomId && incomingRoomId !== this.roomId) {
            return;
        }

        if (data.state) {
            try {
                let updateBlob: string | null = null;

                // 兼容不同格式
                if (typeof data.state === 'string') {
                    updateBlob = data.state;
                } else if (data.state && typeof data.state === 'object' && (data.state as any).update) {
                    updateBlob = (data.state as any).update;
                }

                if (updateBlob) {
                    const update = toUint8Array(updateBlob);
                    Y.applyUpdate(this.doc, update, this);
                    this.markSynced();
                } else {
                    this.markSynced();
                }
            } catch (e) {
                console.error('[SyncServiceYjsProvider] Failed to apply state sync:', e);
                this.markSynced(); // 即使失败也标记为同步，防止锁定
            }
        } else {
            this.markSynced();
        }
    }

    /**
     * 处理同步就绪（通常用于没有初始数据的情况）
     */
    private handleSyncReady(data: any) {
        const incomingRoomId = data.roomId || data.room_id;
        if (incomingRoomId && incomingRoomId !== this.roomId) return;

        console.log(`[SyncServiceYjsProvider] Received sync_ready for ${this.roomId}`);
        this.markSynced();
    }

    async connect() {
        if (this.wsconnected || this.wsconnecting) return;

        this.shouldConnect = true;
        this.wsconnecting = true;
        this.emit('status', [{ status: 'connecting' }]);

        try {
            // Join via sync service (triggers join_room on server)
            await syncService.joinRoom(this.roomId, this.module);

            console.log(`[SyncServiceYjsProvider] Joined ${this.roomId} via SyncService`);
            this.wsconnecting = false;
            this.wsconnected = true;
            this.emit('status', [{ status: 'connected' }]);
        } catch (error) {
            console.error(`[SyncServiceYjsProvider] Failed to connect to ${this.roomId}:`, error);
            this.wsconnecting = false;
            this.emit('status', [{ status: 'error', error }]);
        }
    }

    /**
     * 断开连接
     */
    disconnect() {
        this.shouldConnect = false;
        this.wsconnected = false;

        // Leave via sync service
        syncService.leaveRoom(this.roomId, this.module);

        this.emit('status', [{ status: 'disconnected' }]);
        this.emit('connection-close', [{ code: 1000, reason: 'Client disconnected' }]);
    }

    /**
     * 销毁
     */
    destroy() {
        this.disconnect();

        // 解除所有监听
        this.doc.off('update', this._boundLocalUpdate);
        this.awareness.off('update', this._boundAwarenessUpdate);
        syncService.off(`operation:${this.module}`, this._boundRemoteOp);
        syncService.off(`state:${this.module}`, this._boundStateSync);
        syncService.off(`ready:${this.module}`, this._boundSyncReady);

        this.awareness.destroy();

        super.destroy();
    }
}
