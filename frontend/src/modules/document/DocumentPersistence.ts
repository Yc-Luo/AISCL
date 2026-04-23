/**
 * 文档持久化服务
 * 专门处理文档数据的持久化逻辑（Yjs Doc <-> IndexedDB）
 */

import * as Y from 'yjs';
import { storageManager } from '../../services/storage/StorageManager';
import { fromUint8Array, toUint8Array } from '../../utils/encoding';

export class DocumentPersistence {
    /**
     * 保存文档快照
     */
    static async saveSnapshot(roomId: string, doc: Y.Doc): Promise<void> {
        const update = Y.encodeStateAsUpdate(doc);
        const base64Update = fromUint8Array(update);

        await storageManager.saveSnapshot({
            roomId,
            module: 'document',
            data: { update: base64Update, format: 'yjs-update' },
            version: 0,
            timestamp: Date.now()
        });

        console.log(`[DocumentPersistence] Saved snapshot for ${roomId}`);
    }

    /**
     * 加载文档快照
     */
    static async loadSnapshot(roomId: string, doc: Y.Doc): Promise<boolean> {
        const snapshot = await storageManager.getSnapshot(roomId);

        if (snapshot && snapshot.module === 'document' && snapshot.data) {
            try {
                const data = snapshot.data as any;
                if (data.format === 'yjs-update' && data.update) {
                    const update = toUint8Array(data.update);
                    Y.applyUpdate(doc, update);
                    console.log(`[DocumentPersistence] Loaded snapshot for ${roomId}`);
                    return true;
                }
            } catch (error) {
                console.error('[DocumentPersistence] Failed to apply snapshot:', error);
            }
        }

        return false;
    }

    /**
     * 清除文档数据
     */
    static async clearData(roomId: string): Promise<void> {
        // IndexedDBService 没有直接按房间删除所有数据的接口，但有 deleteSnapshot
        // @ts-ignore
        await storageManager.indexedDB['deleteSnapshot'](roomId);
    }
}
