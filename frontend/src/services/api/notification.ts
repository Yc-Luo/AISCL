import { io, Socket } from 'socket.io-client'
import { config } from '../../config/env'

export type NotificationType = 'info' | 'success' | 'warning' | 'error'

export interface Notification {
    id: string
    title: string
    message: string
    type: NotificationType
    timestamp: string
    read: boolean
}

class NotificationService {
    private socket: Socket | null = null
    private listeners: ((notification: Notification) => void)[] = []

    connect() {
        if (this.socket?.connected) return

        const token = localStorage.getItem('access_token')
        if (!token) return

        this.socket = io(`${config.apiBaseUrl}/notifications`, {
            auth: { token },
            transports: ['websocket'],
        })

        this.socket.on('notification', (data: any) => {
            const notification: Notification = {
                id: Date.now().toString(),
                title: data.title,
                message: data.message,
                type: data.type || 'info',
                timestamp: new Date().toISOString(),
                read: false,
            }
            this.notifyListeners(notification)
        })
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect()
            this.socket = null
        }
    }

    onNotification(callback: (notification: Notification) => void) {
        this.listeners.push(callback)
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback)
        }
    }

    private notifyListeners(notification: Notification) {
        this.listeners.forEach(listener => listener(notification))
    }
}

export const notificationService = new NotificationService()
