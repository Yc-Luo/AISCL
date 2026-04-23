import { useState, useEffect } from 'react'
import { notificationService, Notification } from '../../services/api/notification'

export default function NotificationCenter() {
    const [isOpen, setIsOpen] = useState(false)
    const [notifications, setNotifications] = useState<Notification[]>([])

    useEffect(() => {
        notificationService.connect()

        const removeListener = notificationService.onNotification((notification) => {
            setNotifications(prev => [notification, ...prev])
        })

        return () => {
            removeListener()
            notificationService.disconnect() // verify if we want to disconnect on unmount of component or keep global
        }
    }, [])

    const unreadCount = notifications.filter(n => !n.read).length

    const markAllAsRead = () => {
        setNotifications(notifications.map(n => ({ ...n, read: true })))
    }

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="relative p-2 text-gray-400 hover:text-gray-500 focus:outline-none"
            >
                <span className="sr-only">View notifications</span>
                {/* Bell Icon */}
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {unreadCount > 0 && (
                    <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-400 ring-2 ring-white"></span>
                )}
            </button>

            {isOpen && (
                <div className="origin-top-right absolute right-0 mt-2 w-80 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 focus:outline-none z-50">
                    <div className="py-1" role="menu" aria-orientation="vertical">
                        <div className="px-4 py-2 border-b border-gray-100 flex justify-between items-center">
                            <h3 className="text-sm font-medium text-gray-900">通知</h3>
                            {unreadCount > 0 && (
                                <button onClick={markAllAsRead} className="text-xs text-indigo-600 hover:text-indigo-800">
                                    全部已读
                                </button>
                            )}
                        </div>

                        <div className="max-h-96 overflow-y-auto">
                            {notifications.length === 0 ? (
                                <div className="px-4 py-6 text-center text-sm text-gray-500">
                                    没有新通知
                                </div>
                            ) : (
                                notifications.map((notification) => (
                                    <div key={notification.id} className={`px-4 py-3 hover:bg-gray-50 ${!notification.read ? 'bg-indigo-50' : ''}`}>
                                        <div className="flex justify-between items-start">
                                            <p className={`text-sm font-medium ${!notification.read ? 'text-indigo-900' : 'text-gray-900'}`}>{notification.title}</p>
                                            <p className="text-xs text-gray-400 whitespace-nowrap ml-2">
                                                {new Date(notification.timestamp).toLocaleTimeString()}
                                            </p>
                                        </div>
                                        <p className="mt-1 text-sm text-gray-600 line-clamp-2">{notification.message}</p>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="border-t border-gray-100">
                            <a href="#" className="block px-4 py-2 text-center text-sm text-indigo-600 hover:text-indigo-800 hover:bg-gray-50">
                                查看全部
                            </a>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
