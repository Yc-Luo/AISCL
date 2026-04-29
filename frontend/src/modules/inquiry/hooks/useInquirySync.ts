/**
 * useInquirySync - 深度探究协作同步钩子（简化版）
 * 
 * 设计原则：
 * 1. 使用简单的全量状态同步，避免 Y.js CRDT 冲突
 * 2. 每次操作都发送当前完整状态
 * 3. 接收方直接替换本地状态
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import {
    Node,
    Edge,
    NodeChange,
    EdgeChange,
    Connection,
    applyNodeChanges,
    applyEdgeChanges,
    addEdge
} from 'reactflow';
import { useInquiryStore } from '../store/useInquiryStore';
import { useAuthStore } from '../../../stores/authStore';
import { InquiryNodeData, InquiryEdgeData, InquiryCard, InquiryCardType } from '../types';
import { inquiryService } from '../../../services/api/inquiry';
import { syncService } from '../../../services/sync/SyncService';

// UTF-8 安全的 Base64 编码/解码
const encodeBase64 = (str: string): string => {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach(byte => binary += String.fromCharCode(byte));
    return btoa(binary);
};

const decodeBase64 = (base64: string): string => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
};

// 简单的序列化/反序列化
// 移除本地状态属性 (selected, dragging 等)
const serializeState = (nodes: Node[], edges: Edge[], scrapbook: InquiryCard[]) => {
    // 清理节点中的本地状态
    const cleanNodes = nodes.map(node => {
        const { selected, dragging, ...rest } = node as any;
        return rest;
    });
    // 清理边中的本地状态
    const cleanEdges = edges.map(edge => {
        const { selected, ...rest } = edge as any;
        return rest;
    });
    return JSON.stringify({ nodes: cleanNodes, edges: cleanEdges, scrapbook });
};

const deserializeState = (data: string): { nodes: Node[], edges: Edge[], scrapbook: InquiryCard[] } | null => {
    try {
        return JSON.parse(data);
    } catch {
        return null;
    }
};

export const useInquirySync = (projectId: string) => {
    const store = useInquiryStore();
    const { user } = useAuthStore();
    const [isHydrated, setIsHydrated] = useState(false);
    const isHydratedRef = useRef(false);
    const isSyncingRef = useRef(false);
    const lastSyncTimeRef = useRef(0);
    const pendingBroadcastRef = useRef(false);
    const hasLocalMutationRef = useRef(false);
    const syncUnlockTimerRef = useRef<number | null>(null);

    // 唯一的 session ID，用于识别自己发送的操作
    const sessionIdRef = useRef(`session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    // 追踪已发送的操作 ID，防止处理 echo
    const sentOperationIds = useRef(new Set<string>());

    // 发送当前状态到服务器。显式用户操作可以绕过同步锁，避免本地修改被吞掉。
    const sendCurrentState = useCallback((ignoreSyncLock: boolean = false) => {
        if (!isHydratedRef.current) return;
        if (!ignoreSyncLock && isSyncingRef.current) return;

        const currentState = useInquiryStore.getState();
        const stateData = serializeState(currentState.nodes, currentState.edges, currentState.scrapbook);
        const opId = `state-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        console.log('[InquirySync] Broadcasting local state:', {
            opId,
            ignoreSyncLock,
            sessionId: sessionIdRef.current,
            nodes: currentState.nodes.length,
            edges: currentState.edges.length,
            scrapbook: currentState.scrapbook.length,
            projectId,
        });

        // 记录发送的操作 ID
        sentOperationIds.current.add(opId);
        // 限制集合大小，只保留最近 100 个
        if (sentOperationIds.current.size > 100) {
            const first = sentOperationIds.current.values().next().value as string | undefined;
            if (first) sentOperationIds.current.delete(first);
        }

        // 使用 SyncService 发送操作
        const operation: any = {
            id: opId,
            module: 'inquiry',
            roomId: `inquiry:${projectId}`,
            timestamp: Date.now(),
            clientId: sessionIdRef.current,
            version: 0,
            type: 'update',
            data: { fullState: stateData }
        };

        syncService.sendOperation(operation).catch(err => {
            console.error('[InquirySync] Failed to broadcast state:', err);
        });
    }, [projectId]);

    const broadcastState = useCallback(() => {
        sendCurrentState(false);
    }, [sendCurrentState]);

    const forceBroadcastState = useCallback(() => {
        sendCurrentState(true);
    }, [sendCurrentState]);

    const requestBroadcast = useCallback(() => {
        if (!isHydratedRef.current) return;

        if (isSyncingRef.current) {
            console.log('[InquirySync] Queueing pending local broadcast while sync lock is active');
            pendingBroadcastRef.current = true;
            return;
        }

        pendingBroadcastRef.current = false;
        broadcastState();
    }, [broadcastState]);

    const releaseSyncLock = useCallback(() => {
        if (syncUnlockTimerRef.current) {
            window.clearTimeout(syncUnlockTimerRef.current);
        }

        syncUnlockTimerRef.current = window.setTimeout(() => {
            isSyncingRef.current = false;
            console.log('[InquirySync] Sync lock released');

            if (pendingBroadcastRef.current) {
                console.log('[InquirySync] Flushing pending local broadcast');
                pendingBroadcastRef.current = false;
                broadcastState();
            }
        }, 100);
    }, [broadcastState]);

    const persistStateToBackend = useCallback(async (
        nodes: Node<InquiryNodeData>[],
        edges: Edge<InquiryEdgeData>[],
        scrapbook: InquiryCard[],
        reason: string
    ) => {
        if (!projectId || !isHydratedRef.current) return;

        const isEmpty = nodes.length === 0 && edges.length === 0 && scrapbook.length === 0;
        if (isEmpty && !hasLocalMutationRef.current) {
            console.log('[InquirySync] Skip empty snapshot without local mutation:', reason);
            return;
        }

        const stateData = serializeState(nodes, edges, scrapbook);
        const base64Data = encodeBase64(stateData);
        await inquiryService.saveSnapshot(projectId, base64Data);
        hasLocalMutationRef.current = false;
        console.log('[InquirySync] Snapshot persisted:', {
            reason,
            nodes: nodes.length,
            edges: edges.length,
            scrapbook: scrapbook.length,
        });
    }, [projectId]);

    // 处理远程状态更新
    const handleRemoteState = useCallback((operation: any) => {
        if (operation.roomId !== `inquiry:${projectId}`) return;

        // 忽略自己发送的操作（通过 session ID 或操作 ID）
        if (operation.clientId === sessionIdRef.current) return;
        if (sentOperationIds.current.has(operation.id)) return;

        // 只处理包含 fullState 的操作
        const stateData = operation.data?.fullState;
        if (!stateData) return;

        const parsed = deserializeState(stateData);
        if (!parsed) return;

        console.log('[InquirySync] Received remote state:', {
            nodes: parsed.nodes.length,
            edges: parsed.edges.length,
            scrapbook: parsed.scrapbook.length
        });

        // 锁定同步状态，防止触发循环
        isSyncingRef.current = true;
        store.setFullState(parsed.nodes, parsed.edges, parsed.scrapbook);

        console.log('[InquirySync] State applied to store. Waiting for layout...');

        // 短暂延迟后解锁，允许真实用户操作在解锁后继续广播
        releaseSyncLock();
    }, [projectId, store, releaseSyncLock]);

    // 保存 handleRemoteState 的引用以在 useEffect 中使用
    const handleRemoteStateRef = useRef(handleRemoteState);
    handleRemoteStateRef.current = handleRemoteState;

    // 初始化 - 只依赖 projectId
    useEffect(() => {
        if (!projectId) return;

        // 快速水合：如果 Store 里已经是当前项目的数据，直接标记为已水合
        const currentStore = useInquiryStore.getState();
        if (currentStore.projectId === projectId && (currentStore.nodes.length > 0 || currentStore.scrapbook.length > 0)) {
            console.log('[InquirySync] 🚀 Fast-path hydration: project already in store');
            setIsHydrated(true);
            isHydratedRef.current = true;
        }

        console.log('[InquirySync] Initializing for project:', projectId);

        // 加载初始数据
        const loadInitialData = async () => {
            try {
                console.log('[InquirySync] 🛰️ Fetching initial snapshot from backend...');
                const response = await inquiryService.getSnapshot(projectId);

                if (response?.data) {
                    console.log(`[InquirySync] 📦 Received snapshot data (Base64 length: ${response.data.length})`);
                    // 解码 Base64
                    const decoded = decodeBase64(response.data);
                    const parsed = deserializeState(decoded);
                    if (parsed) {
                        console.log('[InquirySync] ✅ Parsed initial state:', {
                            nodes: parsed.nodes.length,
                            edges: parsed.edges.length,
                            scrapbook: parsed.scrapbook.length
                        });

                        // 在应用状态前加锁
                        isSyncingRef.current = true;
                        useInquiryStore.getState().setFullState(parsed.nodes, parsed.edges, parsed.scrapbook, projectId);

                        // 延迟解锁以避开 React Flow 初始化时的自动变化
                        setTimeout(() => {
                            isSyncingRef.current = false;
                            isHydratedRef.current = true;
                            setIsHydrated(true);
                            console.log('[InquirySync] 🏁 Initialization and hydration complete');
                        }, 300);
                        return; // 提前退出，上面已经处理了 hydrated
                    } else {
                        console.error('[InquirySync] ❌ Failed to parse snapshot JSON');
                    }
                } else {
                    console.log('[InquirySync] ℹ️ No snapshot data returned from backend');
                }
            } catch (error) {
                console.warn('[InquirySync] ⚠️ API request failed or project fresh:', error);
            }

            isHydratedRef.current = true;
            setIsHydrated(true);
        };

        loadInitialData();

        // 监听远程操作
        const handleOperation = (operation: any) => {
            handleRemoteStateRef.current(operation);
        };

        syncService.on('operation:inquiry', handleOperation);

        // 加入房间
        syncService.joinRoom(`inquiry:${projectId}`, 'inquiry');

        return () => {
            syncService.off('operation:inquiry', handleOperation);
            syncService.leaveRoom(`inquiry:${projectId}`, 'inquiry');
            isHydratedRef.current = false;
        };
    }, [projectId]); // 只依赖 projectId

    // 节点变化处理
    const onNodesChange = useCallback((changes: NodeChange[]) => {
        // 如果正在同步远程状态，不处理
        if (isSyncingRef.current) return;

        const currentNodes = useInquiryStore.getState().nodes;
        const newNodes = applyNodeChanges(changes, currentNodes);

        // 过滤只处理用户主动发起的重要变化（不包括 dimensions 和 select）
        const hasUserChange = changes.some(c =>
            c.type === 'position' && (c as any).dragging === true
        );
        const hasAddRemove = changes.some(c =>
            c.type === 'remove' || c.type === 'add'
        );

        // 检测拖拽结束
        const hasDragEnd = changes.some(c =>
            c.type === 'position' && (c as any).dragging === false
        );

        store.setFullState(newNodes, useInquiryStore.getState().edges, useInquiryStore.getState().scrapbook);

        // 只有用户主动拖拽或添加/删除时才广播
        if ((hasUserChange || hasAddRemove) && isHydratedRef.current) {
            hasLocalMutationRef.current = true;
            // 节流：最多每 200ms 广播一次
            const now = Date.now();
            if (now - lastSyncTimeRef.current > 200) {
                lastSyncTimeRef.current = now;
                requestBroadcast();
            }
        }

        // 拖拽结束或添加/删除时，立即保存到后端
        if ((hasDragEnd || hasAddRemove) && isHydratedRef.current) {
            // 使用 saveToBackendRef 来避免依赖循环
            setTimeout(() => {
                const { nodes, edges, scrapbook } = useInquiryStore.getState();
                persistStateToBackend(nodes, edges, scrapbook, hasAddRemove ? 'node_add_remove' : 'node_drag_end')
                    .catch(e => console.error('[InquirySync] Save after node change failed:', e));
            }, 100);
        }
    }, [store, requestBroadcast, persistStateToBackend]);

    // 边变化处理
    const onEdgesChange = useCallback((changes: EdgeChange[]) => {
        const currentEdges = useInquiryStore.getState().edges;
        const newEdges = applyEdgeChanges(changes, currentEdges);
        const { nodes, scrapbook } = useInquiryStore.getState();
        store.setFullState(nodes, newEdges, scrapbook);

        if (isHydratedRef.current) {
            hasLocalMutationRef.current = true;
            forceBroadcastState();
            if (changes.some(c => c.type === 'remove' || c.type === 'add')) {
                persistStateToBackend(nodes, newEdges, scrapbook, 'edge_add_remove')
                    .catch(e => console.error('[InquirySync] Save after edge change failed:', e));
            }
        }
    }, [store, forceBroadcastState, persistStateToBackend]);

    // 连接处理
    const onConnect = useCallback((params: Connection) => {
        const currentEdges = useInquiryStore.getState().edges;
        const newEdges = addEdge({
            ...params,
            id: `edge-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'argument',
            data: {
                label: 'supports',
                sourceId: params.source,
                targetId: params.target,
            }
        }, currentEdges);
        const nodes = useInquiryStore.getState().nodes;
        const scrapbook = useInquiryStore.getState().scrapbook;
        store.setFullState(nodes, newEdges, scrapbook);

        if (isHydratedRef.current) {
            hasLocalMutationRef.current = true;
            requestBroadcast();
            persistStateToBackend(nodes, newEdges, scrapbook, 'edge_connect')
                .catch(e => console.error('[InquirySync] Save after edge connect failed:', e));
        }
    }, [store, requestBroadcast, persistStateToBackend]);

    // 添加卡片
    const addCard = useCallback((
        content: string,
        type: string = 'text',
        sourceUrl?: string,
        sourceTitle?: string,
        imageUrl?: string
    ) => {
        const card: InquiryCard = {
            id: `card-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            content,
            type: type as InquiryCardType,
            authorId: user?.id || '',
            authorName: user?.username || 'Anonymous',
            createdAt: Date.now(),
            sourceUrl,
            sourceTitle,
            imageUrl
        };

        const { nodes, edges, scrapbook } = useInquiryStore.getState();
        store.setFullState(nodes, edges, [...scrapbook, card]);

        if (isHydratedRef.current) {
            hasLocalMutationRef.current = true;
            forceBroadcastState();
            persistStateToBackend(nodes, edges, [...scrapbook, card], 'card_add')
                .catch(e => console.error('[InquirySync] Save after card add failed:', e));
        }
    }, [user, store, forceBroadcastState, persistStateToBackend]);

    // 删除卡片
    const deleteCard = useCallback((cardId: string) => {
        const { nodes, edges, scrapbook } = useInquiryStore.getState();
        const nextScrapbook = scrapbook.filter(c => c.id !== cardId);
        store.setFullState(nodes, edges, nextScrapbook);

        if (isHydratedRef.current) {
            hasLocalMutationRef.current = true;
            forceBroadcastState();
            persistStateToBackend(nodes, edges, nextScrapbook, 'card_delete')
                .catch(e => console.error('[InquirySync] Save after card delete failed:', e));
        }
    }, [store, forceBroadcastState, persistStateToBackend]);

    // 转换卡片为节点
    const convertCardToNode = useCallback((
        cardId: string,
        position: { x: number; y: number },
        nodeType: string
    ) => {
        const { nodes, edges, scrapbook } = useInquiryStore.getState();
        const card = scrapbook.find(c => c.id === cardId);
        if (!card) return;

        const newNode: Node<InquiryNodeData> = {
            id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: nodeType,
            position,
            data: {
                label: card.type,
                sourceRef: card.id,
                content: card.content,
                sourceUrl: card.sourceUrl,
                sourceTitle: card.sourceTitle,
                imageUrl: card.imageUrl
            }
        };

        store.setFullState([...nodes, newNode], edges, scrapbook);

        if (isHydratedRef.current) {
            hasLocalMutationRef.current = true;
            forceBroadcastState();
            persistStateToBackend([...nodes, newNode], edges, scrapbook, 'card_to_node')
                .catch(e => console.error('[InquirySync] Save after card to node failed:', e));
        }
    }, [store, forceBroadcastState, persistStateToBackend]);

    // 更新节点
    const updateNode = useCallback((nodeId: string, updates: Partial<Node<InquiryNodeData>>) => {
        const { nodes, edges, scrapbook } = useInquiryStore.getState();
        const newNodes = nodes.map(n => n.id === nodeId ? { ...n, ...updates } : n);
        store.setFullState(newNodes, edges, scrapbook);

        if (isHydratedRef.current) {
            hasLocalMutationRef.current = true;
            forceBroadcastState();
        }
    }, [store, forceBroadcastState]);

    // 删除节点
    const deleteNode = useCallback((nodeId: string) => {
        const { nodes, edges, scrapbook } = useInquiryStore.getState();
        const newNodes = nodes.filter(n => n.id !== nodeId);
        const newEdges = edges.filter(e => e.source !== nodeId && e.target !== nodeId);
        store.setFullState(newNodes, newEdges, scrapbook);

        if (isHydratedRef.current) {
            hasLocalMutationRef.current = true;
            forceBroadcastState();
            persistStateToBackend(newNodes, newEdges, scrapbook, 'node_delete')
                .catch(e => console.error('[InquirySync] Save after node delete failed:', e));
        }
    }, [store, forceBroadcastState, persistStateToBackend]);

    // 更新边
    const updateEdge = useCallback((edgeId: string, updates: Partial<Edge<InquiryEdgeData>>) => {
        const { nodes, edges, scrapbook } = useInquiryStore.getState();
        const newEdges = edges.map(e => e.id === edgeId ? { ...e, ...updates } : e);
        store.setFullState(nodes, newEdges, scrapbook);

        if (isHydratedRef.current) {
            hasLocalMutationRef.current = true;
            forceBroadcastState();
            persistStateToBackend(nodes, newEdges, scrapbook, 'edge_update')
                .catch(e => console.error('[InquirySync] Save after edge update failed:', e));
        }
    }, [store, forceBroadcastState, persistStateToBackend]);

    // 删除边
    const deleteEdge = useCallback((edgeId: string) => {
        const { nodes, edges, scrapbook } = useInquiryStore.getState();
        const newEdges = edges.filter(e => e.id !== edgeId);
        store.setFullState(nodes, newEdges, scrapbook);

        if (isHydratedRef.current) {
            hasLocalMutationRef.current = true;
            forceBroadcastState();
            persistStateToBackend(nodes, newEdges, scrapbook, 'edge_delete')
                .catch(e => console.error('[InquirySync] Save after edge delete failed:', e));
        }
    }, [store, forceBroadcastState, persistStateToBackend]);

    // 保存到后端
    const saveToBackend = useCallback(async () => {
        if (!projectId || !isHydratedRef.current) return;

        try {
            const { nodes, edges, scrapbook } = useInquiryStore.getState();

            await persistStateToBackend(nodes, edges, scrapbook, 'manual_or_auto_save');
        } catch (error) {
            console.error('[InquirySync] Save failed:', error);
        }
    }, [projectId, persistStateToBackend]);

    // 自动保存
    useEffect(() => {
        if (!isHydrated) return;

        // 每 10 秒自动保存
        const timer = setInterval(() => {
            saveToBackend();
        }, 10000);

        // 页面关闭/刷新前保存 - 移除 sendBeacon，因为它不带 Auth Token，会返回 401
        // 依赖组件卸载时的 saveToBackend()
        const handleBeforeUnload = () => {
            // 这里可以加一个提示提示用户正在保存（可选）
            console.log('[InquirySync] Page unloading...');
        };

        window.addEventListener('beforeunload', handleBeforeUnload);

        return () => {
            if (syncUnlockTimerRef.current) {
                window.clearTimeout(syncUnlockTimerRef.current);
                syncUnlockTimerRef.current = null;
            }
            clearInterval(timer);
            window.removeEventListener('beforeunload', handleBeforeUnload);
            // 组件卸载时也保存一次
            saveToBackend();
        };
    }, [isHydrated, saveToBackend, projectId]);

    return {
        onNodesChange,
        onEdgesChange,
        onConnect,
        addCard,
        deleteCard,
        convertCardToNode,
        updateNode,
        deleteNode,
        updateEdge,
        deleteEdge,
        saveToBackend,
        isConnected: true,
        isHydrated
    };
};
