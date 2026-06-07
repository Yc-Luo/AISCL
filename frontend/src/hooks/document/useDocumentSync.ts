/**
 * Document Sync Hook
 * 用于初始化和管理文档模块的同步提供者
 */

import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { SyncServiceYjsProvider } from '../../services/sync/SyncServiceYjsProvider';
import { syncService } from '../../services/sync/SyncService';
import { DocumentPersistence } from '../../modules/document/DocumentPersistence';
import { useAuthStore } from '../../stores/authStore';

interface UseDocumentSyncProps {
    documentId: string;
    initialData?: Uint8Array;
    onMount?: () => void;
    documentUpdatedAt?: string;
    disableLocalFallback?: boolean;
    enabled?: boolean;
}

const isOlderThan = (candidate?: string, baseline?: string): boolean => {
    if (!candidate || !baseline) return false;
    const candidateTime = new Date(candidate).getTime();
    const baselineTime = new Date(baseline).getTime();
    return Number.isFinite(candidateTime) && Number.isFinite(baselineTime) && candidateTime < baselineTime;
};

export function useDocumentSync({
    documentId,
    initialData,
    onMount,
    documentUpdatedAt,
    disableLocalFallback = true,
    enabled = true,
}: UseDocumentSyncProps) {
    const { user } = useAuthStore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const ydoc = useMemo(() => new Y.Doc(), [documentId]);
    const [provider, setProvider] = useState<SyncServiceYjsProvider | null>(null);
    const [isSynced, setIsSynced] = useState(false);
    const [syncError, setSyncError] = useState<string | null>(null);
    const [snapshotUpdatedAt, setSnapshotUpdatedAt] = useState<string | null>(null);

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
        if (!documentId || !enabled) return;

        console.log('[useDocumentSync] Initializing for document:', documentId);

        setIsSynced(false);
        setSyncError(null);
        setSnapshotUpdatedAt(null);

        // 1. 创建 Provider
        // 使用 documentId 作为 roomId，前缀 'doc:'
        const roomId = `doc:${documentId}`;
        const newProvider = new SyncServiceYjsProvider(roomId, ydoc, 'document');
        setProvider(newProvider);

        // 2. 加载数据
        const initData = async () => {
            let loadedFromServer = false;
            let loadedFromLocal = false;
            try {
                console.log('[useDocumentSync] Fetching latest snapshot from server...');
                const { collaborationService } = await import('../../services/api/collaboration');
                const snapshot = await collaborationService.getSnapshot(documentId, 'document');

                if (snapshot && snapshot.data && !isOlderThan(snapshot.updated_at, documentUpdatedAt)) {
                    const binaryString = window.atob(snapshot.data);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }
                    Y.applyUpdate(ydoc, bytes);
                    console.log('[useDocumentSync] Loaded snapshot from server:', bytes.length, 'bytes');
                    loadedFromServer = true;
                    setSnapshotUpdatedAt(snapshot.updated_at || null);
                } else if (snapshot?.data) {
                    console.warn('[useDocumentSync] Ignoring stale document snapshot:', {
                        snapshotUpdatedAt: snapshot.updated_at,
                        documentUpdatedAt,
                    });
                }
            } catch (error) {
                console.error('[useDocumentSync] Failed to fetch snapshot from server:', error);
            }

            // Server snapshot is authoritative. Only use IndexedDB as a fallback
            // when the server has no document state; otherwise stale local state can
            // overwrite the shared document and make formatting appear corrupted.
            if (!loadedFromServer && !disableLocalFallback) {
                try {
                    loadedFromLocal = await DocumentPersistence.loadSnapshot(roomId, ydoc);
                } catch (error) {
                    console.warn('[useDocumentSync] Failed to load local fallback snapshot:', error);
                }
            } else if (!loadedFromServer && disableLocalFallback) {
                console.log('[useDocumentSync] Skipping local fallback snapshot; document HTML will seed editor.');
            }

            // 如果都没有，但有传入的 initialData (参数)，则使用
            if (!loadedFromServer && !loadedFromLocal && initialData && initialData.length > 0) {
                Y.applyUpdate(ydoc, initialData);
            }

            try {
                await syncService.init();
                await syncService.joinRoom(roomId, 'document');
                newProvider.connect();
                setIsSynced(true);
            } catch (error) {
                console.warn('[useDocumentSync] Failed to join document room:', error);
                setSyncError('文档协作连接失败。请先不要继续编辑，系统正在等待重新连接。');
                setIsSynced(false);
            }

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
            ydoc.destroy();
            setProvider(null);
            setIsSynced(false);
            setSyncError(null);
            setSnapshotUpdatedAt(null);
        };
    }, [disableLocalFallback, documentId, documentUpdatedAt, enabled, initialData, onMount, ydoc]);

    return { provider, ydoc, isSynced, syncError, snapshotUpdatedAt };
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
