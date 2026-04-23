/**
 * 聊天持久化服务
 * 负责本地缓存聊天消息
 */

import { storageManager } from '../../services/storage/StorageManager';
import { ChatOperation } from '../../types/sync';

const ISO_WITHOUT_TIMEZONE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

export const normalizeChatTimestamp = (timestamp: string | number | Date | undefined | null): string => {
    if (!timestamp) return new Date().toISOString();
    if (timestamp instanceof Date) return timestamp.toISOString();
    if (typeof timestamp === 'number') return new Date(timestamp).toISOString();

    const normalized = ISO_WITHOUT_TIMEZONE_PATTERN.test(timestamp) ? `${timestamp}Z` : timestamp;
    const time = new Date(normalized).getTime();
    return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
};

export const getChatTimestampMs = (timestamp: string | number | Date | undefined | null): number =>
    new Date(normalizeChatTimestamp(timestamp)).getTime();

export interface ChatMessage {
    id: string;
    client_message_id?: string;
    user_id: string;
    username: string;
    avatar_url?: string;
    content: string;
    message_type: string;
    mentions: string[];
    timestamp: string;
    isPending?: boolean;
    ai_meta?: {
        primary_agent?: string;
        rationale_summary?: string;
        routing_summary?: string[];
    };
    file_info?: {
        name: string;
        size: number;
        url: string;
        mime_type: string;
    };
    reply_to?: string;
    is_recalled?: boolean;
}

export class ChatPersistence {


    /**
     * 保存最近的消息列表到本地快照
     */
    static async saveMessages(roomId: string, messages: ChatMessage[]): Promise<void> {
        // 只保留最近的 100 条用于缓存
        const recentMessages = messages.slice(-100);

        await storageManager.saveSnapshot({
            roomId,
            module: 'chat',
            data: recentMessages,
            version: Date.now(),
            timestamp: Date.now()
        });
    }

    /**
     * 加载本地消息缓存
     */
    static async loadMessages(roomId: string): Promise<ChatMessage[]> {
        const snapshot = await storageManager.getSnapshot(roomId);

        if (snapshot && snapshot.module === 'chat' && Array.isArray(snapshot.data)) {
            return snapshot.data as ChatMessage[];
        }

        return [];
    }

    /**
     * 将 ChatOperation 转换为 ChatMessage
     */
    static operationToMessage(op: ChatOperation, user: any): ChatMessage {
        return {
            id: op.data.messageId || op.id,
            client_message_id: op.data.clientMessageId || op.data.messageId || op.id,
            user_id: user.id || op.clientId,
            username: user.username || user.name || 'Unknown',
            avatar_url: user.avatarUrl,
            content: op.data.content || '',
            message_type: op.data.fileInfo ? 'file' : 'text',
            mentions: op.data.mentions || [],
            timestamp: normalizeChatTimestamp(op.timestamp),
            isPending: false,
            ai_meta: op.data.aiMeta,
            file_info: op.data.fileInfo ? {
                name: op.data.fileInfo.name,
                size: op.data.fileInfo.size,
                url: op.data.fileInfo.url,
                mime_type: op.data.fileInfo.mimeType
            } : undefined,
            reply_to: op.data.replyTo,
            is_recalled: op.data.isRecalled
        };
    }
}
