/**
 * 标签页管理器
 * 负责多标签页间的协调、主标签页选举、标签页间通信
 */

import { TabInfo, TabMessage, TabMessageType } from '../types/sync';
import { localStorageService } from './storage/LocalStorageService';

/** 标签页心跳间隔（毫秒） */
const HEARTBEAT_INTERVAL = 5000;

/** 标签页超时时间（毫秒） */
const TAB_TIMEOUT = 15000;

/** 主标签页检查间隔（毫秒） */
const MASTER_CHECK_INTERVAL = 10000;

/**
 * 标签页管理器类
 */
export class TabManager {
    private tabId: string;
    private tabInfo: TabInfo;
    private broadcastChannel: BroadcastChannel | null = null;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private masterCheckTimer: NodeJS.Timeout | null = null;
    private messageHandlers: Map<TabMessageType, Set<(data: unknown) => void>> = new Map();
    private initialized: boolean = false;

    constructor(tabId?: string) {
        this.tabId = tabId || this.generateTabId();
        this.tabInfo = {
            id: this.tabId,
            isMaster: false,
            createdAt: Date.now(),
            lastHeartbeat: Date.now(),
        };
    }

    /**
     * 生成唯一的标签页ID
     */
    private generateTabId(): string {
        return `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * 初始化标签页管理器
     */
    async init(): Promise<void> {
        if (this.initialized) {
            console.warn('[TabManager] Already initialized');
            return;
        }

        try {
            // 初始化Broadcast Channel
            this.initBroadcastChannel();

            // 注册标签页
            this.registerTab();

            // 选举主标签页
            await this.electMaster();

            // 启动心跳
            this.startHeartbeat();

            // 启动主标签页检查
            this.startMasterCheck();

            // 监听页面卸载
            this.setupUnloadHandler();

            this.initialized = true;
            console.log(`[TabManager] Initialized, tabId: ${this.tabId}, isMaster: ${this.tabInfo.isMaster}`);
        } catch (error) {
            console.error('[TabManager] Initialization error:', error);
            throw error;
        }
    }

    /**
     * 初始化Broadcast Channel
     */
    private initBroadcastChannel(): void {
        try {
            this.broadcastChannel = new BroadcastChannel('collab-tabs');

            this.broadcastChannel.onmessage = (event) => {
                this.handleMessage(event.data);
            };

            this.broadcastChannel.onmessageerror = (error) => {
                console.error('[TabManager] Broadcast channel message error:', error);
            };

            console.log('[TabManager] Broadcast channel initialized');
        } catch (error) {
            console.error('[TabManager] Failed to initialize broadcast channel:', error);
            // Broadcast Channel不可用时的回退方案
            // 可以使用localStorage事件进行通信
        }
    }

    /**
     * 注册标签页
     */
    private registerTab(): void {
        // 广播标签页加入消息
        this.broadcast('tab-joined', { tabId: this.tabId });

        // 在localStorage中注册
        const tabs = this.getAllTabs();
        tabs[this.tabId] = this.tabInfo;
        this.saveTabs(tabs);
    }

    /**
     * 选举主标签页
     */
    async electMaster(): Promise<void> {
        const tabs = this.getActiveTabs();
        const tabIds = Object.keys(tabs);

        if (tabIds.length === 0 || tabIds.length === 1) {
            // 没有其他标签页，或只有当前标签页，成为主标签页
            this.becomeMaster();
        } else {
            // 检查是否已有主标签页
            const masterTab = Object.values(tabs).find(tab => tab.isMaster);

            if (!masterTab) {
                // 没有主标签页，选择最早创建的标签页
                const sortedTabIds = tabIds.sort((a, b) => {
                    return tabs[a].createdAt - tabs[b].createdAt;
                });

                if (sortedTabIds[0] === this.tabId) {
                    this.becomeMaster();
                }
            } else if (masterTab.id === this.tabId) {
                // 当前标签页是主标签页
                this.tabInfo.isMaster = true;
            }
        }

        console.log(`[TabManager] Election result - isMaster: ${this.tabInfo.isMaster}`);
    }

    /**
     * 成为主标签页
     */
    private becomeMaster(): void {
        this.tabInfo.isMaster = true;

        // 更新localStorage
        const tabs = this.getAllTabs();
        tabs[this.tabId] = this.tabInfo;
        this.saveTabs(tabs);

        // 广播主标签页选举结果
        this.broadcast('master-election', { masterTabId: this.tabId });

        console.log(`[TabManager] Became master tab: ${this.tabId}`);
    }

    /**
     * 启动心跳
     */
    private startHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }

        this.heartbeatTimer = setInterval(() => {
            this.sendHeartbeat();
        }, HEARTBEAT_INTERVAL);

        // 立即发送一次心跳
        this.sendHeartbeat();
    }

    /**
     * 发送心跳
     */
    private sendHeartbeat(): void {
        this.tabInfo.lastHeartbeat = Date.now();

        // 更新localStorage
        const tabs = this.getAllTabs();
        tabs[this.tabId] = this.tabInfo;
        this.saveTabs(tabs);

        // 广播心跳（可选，用于实时同步）
        // this.broadcast('heartbeat', { tabId: this.tabId });
    }

    /**
     * 启动主标签页检查
     */
    private startMasterCheck(): void {
        if (this.masterCheckTimer) {
            clearInterval(this.masterCheckTimer);
        }

        this.masterCheckTimer = setInterval(() => {
            this.checkMasterStatus();
        }, MASTER_CHECK_INTERVAL);
    }

    /**
     * 检查主标签页状态
     */
    private checkMasterStatus(): void {
        const tabs = this.getActiveTabs();
        const masterTab = Object.values(tabs).find(tab => tab.isMaster);

        if (!masterTab && !this.tabInfo.isMaster) {
            // 没有主标签页，重新选举
            console.log('[TabManager] No master tab found, re-electing...');
            this.electMaster();
        } else if (masterTab && masterTab.id !== this.tabId && this.tabInfo.isMaster) {
            // 有其他主标签页，但当前标签页也认为自己是主标签页（冲突）
            console.warn('[TabManager] Master conflict detected, resolving...');
            // 比较创建时间，较晚的标签页放弃主地位
            if (this.tabInfo.createdAt > masterTab.createdAt) {
                this.tabInfo.isMaster = false;
                console.log('[TabManager] Stepped down as master');
            }
        }

        // 清理超时的标签页
        this.cleanupInactiveTabs();
    }

    /**
     * 清理不活跃的标签页
     */
    private cleanupInactiveTabs(): void {
        const tabs = this.getAllTabs();
        const now = Date.now();
        let cleaned = false;

        Object.keys(tabs).forEach(tabId => {
            if (tabId !== this.tabId) {
                const tab = tabs[tabId];
                if (now - tab.lastHeartbeat > TAB_TIMEOUT) {
                    console.log(`[TabManager] Removing inactive tab: ${tabId}`);
                    delete tabs[tabId];
                    cleaned = true;
                }
            }
        });

        if (cleaned) {
            this.saveTabs(tabs);
        }
    }

    /**
     * 获取所有标签页
     */
    private getAllTabs(): Record<string, TabInfo> {
        const tabsData = localStorageService.get<Record<string, TabInfo>>('tabs');
        return tabsData || {};
    }

    /**
     * 获取活跃的标签页
     */
    private getActiveTabs(): Record<string, TabInfo> {
        const allTabs = this.getAllTabs();
        const now = Date.now();
        const activeTabs: Record<string, TabInfo> = {};

        Object.entries(allTabs).forEach(([tabId, tab]) => {
            if (now - tab.lastHeartbeat <= TAB_TIMEOUT) {
                activeTabs[tabId] = tab;
            }
        });

        return activeTabs;
    }

    /**
     * 保存标签页列表
     */
    private saveTabs(tabs: Record<string, TabInfo>): void {
        localStorageService.set('tabs', tabs);
    }

    /**
     * 广播消息到所有标签页
     */
    broadcast<T = unknown>(type: TabMessageType, payload: T): void {
        const message: TabMessage<T> = {
            type,
            payload,
            sourceTabId: this.tabId,
            timestamp: Date.now(),
        };

        if (this.broadcastChannel) {
            try {
                this.broadcastChannel.postMessage(message);
            } catch (error) {
                console.error('[TabManager] Broadcast error:', error);
                this.fallbackBroadcast(message);
            }
        } else {
            this.fallbackBroadcast(message);
        }
    }

    /**
     * 使用localStorage进行广播（回退方案）
     */
    private fallbackBroadcast(message: TabMessage): void {
        try {
            // 使用一个特殊的key触发storage事件
            const key = 'tab-msg-fallback';
            localStorage.setItem(key, JSON.stringify(message));
            // 立即移除，以便下次触发
            localStorage.removeItem(key);
        } catch (error) {
            console.error('[TabManager] Fallback broadcast error:', error);
        }
    }

    /**
     * 处理收到的消息
     */
    private handleMessage(message: TabMessage): void {
        // 忽略自己发送的消息
        if (message.sourceTabId === this.tabId) {
            return;
        }

        // 触发对应类型的处理器
        const handlers = this.messageHandlers.get(message.type);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(message.payload);
                } catch (error) {
                    console.error(`[TabManager] Handler error for ${message.type}:`, error);
                }
            });
        }

        // 处理特定消息类型
        switch (message.type) {
            case 'tab-joined':
                this.handleTabJoined(message.payload);
                break;
            case 'tab-left':
                this.handleTabLeft(message.payload);
                break;
            case 'master-election':
                this.handleMasterElection(message.payload);
                break;
        }
    }

    /**
     * 处理标签页加入
     */
    private handleTabJoined(payload: unknown): void {
        const { tabId } = payload as { tabId: string };
        console.log(`[TabManager] Tab joined: ${tabId}`);
    }

    /**
     * 处理标签页离开
     */
    private handleTabLeft(payload: unknown): void {
        const { tabId } = payload as { tabId: string };
        console.log(`[TabManager] Tab left: ${tabId}`);
    }

    /**
     * 处理主标签页选举
     */
    private handleMasterElection(payload: unknown): void {
        const { masterTabId } = payload as { masterTabId: string };

        if (masterTabId !== this.tabId && this.tabInfo.isMaster) {
            // 有其他标签页声称是主标签页
            console.log(`[TabManager] Another master elected: ${masterTabId}`);
            this.tabInfo.isMaster = false;
        }
    }

    /**
     * 注册消息处理器
     */
    on(type: TabMessageType, handler: (data: unknown) => void): () => void {
        if (!this.messageHandlers.has(type)) {
            this.messageHandlers.set(type, new Set());
        }

        const handlers = this.messageHandlers.get(type)!;
        handlers.add(handler);

        // 返回取消注册函数
        return () => {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.messageHandlers.delete(type);
            }
        };
    }

    /**
     * 设置页面卸载处理器
     */
    private setupUnloadHandler(): void {
        const handleUnload = () => {
            // 广播标签页离开消息
            this.broadcast('tab-left', { tabId: this.tabId });

            // 从localStorage中移除
            const tabs = this.getAllTabs();
            delete tabs[this.tabId];
            this.saveTabs(tabs);

            // 如果是主标签页，清除主标签页标记
            if (this.tabInfo.isMaster) {
                // 其他标签页会在检查时重新选举
            }
        };

        window.addEventListener('beforeunload', handleUnload);
        window.addEventListener('unload', handleUnload);
    }

    /**
     * 获取标签页ID
     */
    getTabId(): string {
        return this.tabId;
    }

    /**
     * 是否为主标签页
     */
    isMaster(): boolean {
        return this.tabInfo.isMaster;
    }

    /**
     * 获取活跃标签页数量
     */
    getActiveTabCount(): number {
        return Object.keys(this.getActiveTabs()).length;
    }

    /**
     * 销毁标签页管理器
     */
    destroy(): void {
        // 停止定时器
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        if (this.masterCheckTimer) {
            clearInterval(this.masterCheckTimer);
            this.masterCheckTimer = null;
        }

        // 关闭Broadcast Channel
        if (this.broadcastChannel) {
            this.broadcastChannel.close();
            this.broadcastChannel = null;
        }

        // 从localStorage中移除
        const tabs = this.getAllTabs();
        delete tabs[this.tabId];
        this.saveTabs(tabs);

        // 清除消息处理器
        this.messageHandlers.clear();

        this.initialized = false;
        console.log(`[TabManager] Destroyed, tabId: ${this.tabId}`);
    }
}

// 导出单例实例
export const tabManager = new TabManager();
