import { useCallback } from 'react';
import { useAuthStore } from '../../../stores/authStore';
import { InquiryCard, InquiryCardType } from '../types';
import { inquiryService } from '../../../services/api/inquiry';
import { syncService } from '../../../services/sync/SyncService';

/**
 * A lightweight hook to add items to the scrapbook from anywhere in the project.
 * It connects to the inquiry room temporarily/persistently to perform the action.
 */
export const useScrapbookActions = (projectId: string) => {
    const { user } = useAuthStore();

    const addMaterial = useCallback(async (content: string, sourceTitle?: string, sourceUrl?: string, imageUrl?: string) => {
        if (!projectId || !user) return;

        console.log('[ScrapbookActions] Adding material to inquiry room...', { projectId, content: content.substring(0, 20) });

        try {
            // 1. 获取最新快照
            let nodes = [];
            let edges = [];
            let scrapbook = [];

            try {
                const response = await inquiryService.getSnapshot(projectId);
                if (response?.data) {
                    // 我们借用 useInquirySync 里的解码函数逻辑（逻辑重复，之后可提取工具类）
                    const decodeBase64 = (base64: string): string => {
                        const binary = atob(base64);
                        const bytes = new Uint8Array(binary.length);
                        for (let i = 0; i < binary.length; i++) {
                            bytes[i] = binary.charCodeAt(i);
                        }
                        return new TextDecoder().decode(bytes);
                    };

                    const decoded = decodeBase64(response.data);
                    const parsed = JSON.parse(decoded);
                    if (parsed) {
                        nodes = parsed.nodes || [];
                        edges = parsed.edges || [];
                        scrapbook = parsed.scrapbook || [];
                    }
                }
            } catch (err) {
                console.log('[ScrapbookActions] No existing snapshot, starting with empty scrapbook');
            }

            // 2. 创建新卡片
            const id = `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const card: InquiryCard = {
                id,
                content,
                type: (imageUrl ? 'image' : 'text') as InquiryCardType,
                authorId: user.id || '',
                authorName: user.username || 'System',
                createdAt: Date.now(),
                sourceUrl,
                sourceTitle,
                imageUrl
            };

            // 3. 更新状态并保存
            const newScrapbook = [...scrapbook, card];

            const encodeBase64 = (str: string): string => {
                const bytes = new TextEncoder().encode(str);
                let binary = '';
                bytes.forEach(byte => binary += String.fromCharCode(byte));
                return btoa(binary);
            };

            const stateData = JSON.stringify({ nodes, edges, scrapbook: newScrapbook });
            const base64Data = encodeBase64(stateData);

            await inquiryService.saveSnapshot(projectId, base64Data);

            // 4. 发送 WebSocket 广播，通知已打开的 InquirySpace 更新
            const opId = `state-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const operation: any = {
                id: opId,
                module: 'inquiry',
                roomId: `inquiry:${projectId}`,
                timestamp: Date.now(),
                clientId: `external-${user.id}`,
                version: 0,
                type: 'update',
                data: { fullState: stateData }
            };

            await syncService.sendOperation(operation);

            console.log('[ScrapbookActions] Successfully added material and broadcasted update');
        } catch (error) {
            console.error('[ScrapbookActions] Failed to add material:', error);
            throw error;
        }
    }, [projectId, user]);

    return { addMaterial };
};
