/**
 * LocalStorage服务
 * 提供localStorage的封装和操作接口
 */

import { StorageItem } from '../../types/sync';

/** 默认前缀 */
const DEFAULT_PREFIX = 'collab:';

/**
 * LocalStorage服务类
 */
export class LocalStorageService {
    private prefix: string;

    constructor(prefix: string = DEFAULT_PREFIX) {
        this.prefix = prefix;
    }

    /**
     * 生成完整的key
     */
    private getKey(key: string): string {
        return `${this.prefix}${key}`;
    }

    /**
     * 设置值
     */
    set<T = unknown>(key: string, value: T, expiresInMs?: number): void {
        try {
            const item: StorageItem = {
                key,
                value,
                timestamp: Date.now(),
                expires: expiresInMs ? Date.now() + expiresInMs : undefined,
            };

            localStorage.setItem(this.getKey(key), JSON.stringify(item));
        } catch (error) {
            console.error('[LocalStorage] Set error:', error);
            // 如果存储空间已满，尝试清理过期数据
            this.cleanup();
            throw error;
        }
    }

    /**
     * 获取值
     */
    get<T = unknown>(key: string): T | null {
        try {
            const itemStr = localStorage.getItem(this.getKey(key));
            if (!itemStr) {
                return null;
            }

            const item: StorageItem = JSON.parse(itemStr);

            // 检查是否过期
            if (item.expires && Date.now() > item.expires) {
                this.remove(key);
                return null;
            }

            return item.value as T;
        } catch (error) {
            console.error('[LocalStorage] Get error:', error);
            return null;
        }
    }

    /**
     * 删除值
     */
    remove(key: string): void {
        try {
            localStorage.removeItem(this.getKey(key));
        } catch (error) {
            console.error('[LocalStorage] Remove error:', error);
        }
    }

    /**
     * 检查是否存在
     */
    has(key: string): boolean {
        return localStorage.getItem(this.getKey(key)) !== null;
    }

    /**
     * 清空所有带前缀的数据
     */
    clear(): void {
        try {
            const keys = this.getAllKeys();
            keys.forEach(key => localStorage.removeItem(key));
            console.log(`[LocalStorage] Cleared ${keys.length} items`);
        } catch (error) {
            console.error('[LocalStorage] Clear error:', error);
        }
    }

    /**
     * 获取所有带前缀的key
     */
    private getAllKeys(): string[] {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(this.prefix)) {
                keys.push(key);
            }
        }
        return keys;
    }

    /**
     * 清理过期数据
     */
    cleanup(): void {
        try {
            const keys = this.getAllKeys();
            let cleanedCount = 0;

            keys.forEach(fullKey => {
                try {
                    const itemStr = localStorage.getItem(fullKey);
                    if (itemStr) {
                        const item: StorageItem = JSON.parse(itemStr);
                        if (item.expires && Date.now() > item.expires) {
                            localStorage.removeItem(fullKey);
                            cleanedCount++;
                        }
                    }
                } catch (error) {
                    // 如果解析失败，删除该项
                    localStorage.removeItem(fullKey);
                    cleanedCount++;
                }
            });

            if (cleanedCount > 0) {
                console.log(`[LocalStorage] Cleaned up ${cleanedCount} expired items`);
            }
        } catch (error) {
            console.error('[LocalStorage] Cleanup error:', error);
        }
    }

    /**
     * 获取存储使用情况
     */
    getUsage(): { used: number; total: number; percentage: number } {
        try {
            let used = 0;
            const keys = this.getAllKeys();

            keys.forEach(key => {
                const value = localStorage.getItem(key);
                if (value) {
                    used += key.length + value.length;
                }
            });

            // 大多数浏览器的localStorage限制是5MB
            const total = 5 * 1024 * 1024; // 5MB in bytes
            const percentage = (used / total) * 100;

            return { used, total, percentage };
        } catch (error) {
            console.error('[LocalStorage] Get usage error:', error);
            return { used: 0, total: 0, percentage: 0 };
        }
    }

    /**
     * 批量设置
     */
    setMany(items: Record<string, unknown>): void {
        Object.entries(items).forEach(([key, value]) => {
            this.set(key, value);
        });
    }

    /**
     * 批量获取
     */
    getMany<T = unknown>(keys: string[]): Record<string, T | null> {
        const result: Record<string, T | null> = {};
        keys.forEach(key => {
            result[key] = this.get<T>(key);
        });
        return result;
    }

    /**
     * 批量删除
     */
    removeMany(keys: string[]): void {
        keys.forEach(key => this.remove(key));
    }

    /**
     * 获取所有项
     */
    getAll<T = unknown>(): Record<string, T> {
        const result: Record<string, T> = {};
        const keys = this.getAllKeys();

        keys.forEach(fullKey => {
            const key = fullKey.substring(this.prefix.length);
            const value = this.get<T>(key);
            if (value !== null) {
                result[key] = value;
            }
        });

        return result;
    }

    /**
     * 监听存储变化
     */
    onChange(callback: (key: string, newValue: unknown, oldValue: unknown) => void): () => void {
        const handler = (event: StorageEvent) => {
            if (event.key && event.key.startsWith(this.prefix)) {
                const key = event.key.substring(this.prefix.length);

                let oldValue = null;
                let newValue = null;

                try {
                    if (event.oldValue) {
                        const oldItem: StorageItem = JSON.parse(event.oldValue);
                        oldValue = oldItem.value;
                    }
                    if (event.newValue) {
                        const newItem: StorageItem = JSON.parse(event.newValue);
                        newValue = newItem.value;
                    }
                } catch (error) {
                    console.error('[LocalStorage] Parse change error:', error);
                }

                callback(key, newValue, oldValue);
            }
        };

        window.addEventListener('storage', handler);

        // 返回取消监听函数
        return () => {
            window.removeEventListener('storage', handler);
        };
    }
}

// 导出单例实例
export const localStorageService = new LocalStorageService();
