/**
 * Document Sync Hook
 * 用于初始化和管理文档模块的同步提供者
 */

import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { SyncServiceYjsProvider } from '../../services/sync/SyncServiceYjsProvider';
import { syncService } from '../../services/sync/SyncService';
import { DocumentPersistence } from '../../modules/document/DocumentPersistence';
import { useAuthStore } from '../../stores/authStore';

interface UseDocumentSyncProps {
    documentId: string;
    initialData?: Uint8Array;
    onMount?: () => void;
}

export function useDocumentSync({ documentId, initialData, onMount }: UseDocumentSyncProps) {
    const { user } = useAuthStore();
    const [ydoc] = useState(() => new Y.Doc());
    const [provider, setProvider] = useState<SyncServiceYjsProvider | null>(null);
    const [isSynced, setIsSynced] = useState(false);

    // 确保 SyncService 已初始化
    useEffect(() => {
        syncService.init().catch(console.error);
    }, []);

    // 设置用户信息到 Y.Doc (通过 Provider 的 awareness)
    useEffect(() => {
        if (!provider || !user) return;

        // Yjs Awareness user info
        // Tiptap CollaborationCursor extension expects user in specific format
        const awarenessUser = {
            name: user.username || user.email || 'Anonymous',
            color: getColorForUser(user.id),
            // avatar: user.avatarUrl 
        };

        provider.awareness.setLocalStateField('user', awarenessUser);

    }, [provider, user]);

    // 初始化 Provider 和加载数据
    useEffect(() => {
        if (!documentId) return;

        console.log('[useDocumentSync] Initializing for document:', documentId);

        // 1. 创建 Provider
        // 使用 documentId 作为 roomId，前缀 'doc:'
        const roomId = `doc:${documentId}`;
        const newProvider = new SyncServiceYjsProvider(roomId, ydoc, 'document');
        setProvider(newProvider);

        // 2. 加载数据
        const initData = async () => {
            // 优先从 IndexedDB 加载离线数据
            let loadedFromLocal = await DocumentPersistence.loadSnapshot(roomId, ydoc);

            // 如果没有本地数据，尝试从服务器拉取
            if (!loadedFromLocal) {
                try {
                    console.log('[useDocumentSync] No local data, fetching from server...');
                    const { collaborationService } = await import('../../services/api/collaboration');
                    const snapshot = await collaborationService.getSnapshot(documentId, 'document');

                    if (snapshot && snapshot.data) {
                        const binaryString = window.atob(snapshot.data);
                        const bytes = new Uint8Array(binaryString.length);
                        for (let i = 0; i < binaryString.length; i++) {
                            bytes[i] = binaryString.charCodeAt(i);
                        }
                        Y.applyUpdate(ydoc, bytes);
                        console.log('[useDocumentSync] Loaded snapshot from server:', bytes.length, 'bytes');
                        loadedFromLocal = true;
                    }
                } catch (error) {
                    console.error('[useDocumentSync] Failed to fetch snapshot from server:', error);
                }
            }

            // 如果都没有，但有传入的 initialData (参数)，则使用
            if (!loadedFromLocal && initialData && initialData.length > 0) {
                Y.applyUpdate(ydoc, initialData);
            }

            // 加入房间以启动实时同步
            syncService.joinRoom(roomId, 'document').catch(console.error);

            // 连接 Provider
            newProvider.connect();
            setIsSynced(true);

            if (onMount) onMount();
        };

        initData();

        // 3. 自动保存到 IndexedDB
        const handleUpdate = () => {
            DocumentPersistence.saveSnapshot(roomId, ydoc);
        };
        ydoc.on('update', handleUpdate);

        return () => {
            console.log('[useDocumentSync] Cleaning up for:', documentId);
            ydoc.off('update', handleUpdate);
            newProvider.disconnect();
            syncService.leaveRoom(roomId, 'document');
            newProvider.destroy();
            // 在 key 重启机制下，此处不销毁 ydoc 也可以，但为了严谨可留
            ydoc.destroy();
            setProvider(null);
            setIsSynced(false);
        };
    }, [documentId]);

    return { provider, ydoc, isSynced };
}

// 辅助函数：生成颜色
function getColorForUser(userId: string): string {
    const colors = [
        '#958DF1', '#F98181', '#FBBC88', '#FAF594',
        '#70CFF8', '#94FADB', '#B9F18D', '#C3AED6'
    ];
    const hash = userId.split('').reduce((acc, char) => {
        return char.charCodeAt(0) + ((acc << 5) - acc);
    }, 0);
    return colors[Math.abs(hash) % colors.length];
}
