/**
 * 聊天适配器
 * 负责将聊天操作转换为 SyncService 操作，并处理接收到的消息
 */

import { syncService } from '../../services/sync/SyncService';
import { ChatOperation, ChatOperationData } from '../../types/sync';
import { ChatMessage, ChatPersistence } from './ChatPersistence';

import { useRoomStore } from '../../stores/roomStore';

export class ChatAdapter {
    roomId: string;
    private onMessageReceived: (message: ChatMessage) => void;
    private boundHandleRemoteOperation: (op: any) => void;

    constructor(roomId: string, onMessageReceived: (message: ChatMessage) => void) {
        this.roomId = roomId;
        this.onMessageReceived = onMessageReceived;
        this.boundHandleRemoteOperation = this.handleRemoteOperation.bind(this);
        this.init();
    }

    private init() {
        syncService.on('operation:chat', this.boundHandleRemoteOperation);
    }

    /**
     * 发送消息
     */
    async sendMessage(content: string, mentions: string[], user: any, fileInfo?: any, replyTo?: string, isRecalled?: boolean): Promise<ChatMessage> {
        const messageId = isRecalled ? content : `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const timestamp = Date.now();

        const opData: ChatOperationData = {
            messageId: isRecalled ? content : messageId,
            clientMessageId: isRecalled ? content : messageId,
            content: isRecalled ? '' : content,
            mentions,
            fileInfo,
            replyTo,
            isRecalled
        };

        const op: ChatOperation = {
            id: isRecalled ? `recall-${content}` : messageId,
            module: 'chat',
            roomId: this.roomId,
            timestamp,
            clientId: user.id || 'unknown',
            version: 0,
            type: isRecalled ? 'edit' : 'message',
            data: opData
        };

        const message: ChatMessage = {
            id: messageId,
            client_message_id: messageId,
            user_id: user.id,
            username: user.username || 'Me',
            avatar_url: user.avatarUrl,
            content: isRecalled ? '' : content,
            message_type: isRecalled ? 'text' : (fileInfo ? 'file' : 'text'),
            mentions,
            timestamp: new Date(timestamp).toISOString(),
            isPending: true,
            is_recalled: isRecalled,
            reply_to: replyTo,
            file_info: fileInfo ? {
                name: fileInfo.name,
                size: fileInfo.size,
                url: fileInfo.url,
                mime_type: fileInfo.mimeType || fileInfo.mime_type
            } : undefined
        };

        // 注意：不在这里调用 onMessageReceived，因为 sendOperation 
        // 会触发本地 broadcast 从而由 handleRemoteOperation 处理

        try {
            await syncService.sendOperation(op);
            message.isPending = false;
        } catch (e) {
            console.error('Failed to send message:', e);
        }

        return message;
    }

    /**
     * 处理远程操作
     */
    private handleRemoteOperation(op: ChatOperation) {
        if (op.roomId !== this.roomId) return;

        // 获取发送者信息
        const roomUsers = useRoomStore.getState().roomUsers[this.roomId] || [];
        const senderUser = roomUsers.find(u => u.id === op.clientId);

        // Allow explicit sender info in operation data (e.g. for AI agents)
        const explicitSender = (op.data as any)?.sender;

        const sender = {
            id: op.clientId,
            username: explicitSender?.username || senderUser?.name || `User ${op.clientId.substr(0, 4)}`,
            avatarUrl: explicitSender?.avatar || senderUser?.avatar
        };

        const message = ChatPersistence.operationToMessage(op, sender);
        this.onMessageReceived(message);
    }

    destroy() {
        syncService.off('operation:chat', this.boundHandleRemoteOperation);
    }
}
