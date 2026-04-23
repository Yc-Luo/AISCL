import { useEffect, useState } from 'react'

interface ConnectionStatusBannerProps {
  yjsConnected: boolean
  socketioConnected: boolean
  aggregatedState: 'full' | 'degraded' | 'offline'
  onReconnect?: () => void
}

export default function ConnectionStatusBanner({
  yjsConnected,
  socketioConnected,
  aggregatedState,
  onReconnect,
}: ConnectionStatusBannerProps) {
  const [visible, setVisible] = useState(false)
  const [autoHideTimer, setAutoHideTimer] = useState<NodeJS.Timeout | null>(null)

  useEffect(() => {
    // Show banner when connection state changes
    if (aggregatedState !== 'full') {
      setVisible(true)
      
      // Auto-hide after 5 seconds if degraded (not offline)
      if (aggregatedState === 'degraded') {
        const timer = setTimeout(() => {
          setVisible(false)
        }, 5000)
        setAutoHideTimer(timer)
      } else {
        // Keep visible if offline
        if (autoHideTimer) {
          clearTimeout(autoHideTimer)
          setAutoHideTimer(null)
        }
      }
    } else {
      setVisible(false)
      if (autoHideTimer) {
        clearTimeout(autoHideTimer)
        setAutoHideTimer(null)
      }
    }

    return () => {
      if (autoHideTimer) {
        clearTimeout(autoHideTimer)
      }
    }
  }, [aggregatedState])

  if (!visible) return null

  const getBannerConfig = () => {
    if (aggregatedState === 'offline') {
      return {
        type: 'error' as const,
        message: '连接已断开，正在尝试重连...',
        bgColor: 'bg-red-50',
        textColor: 'text-red-800',
        borderColor: 'border-red-200',
      }
    } else if (!yjsConnected && socketioConnected) {
      return {
        type: 'warning' as const,
        message: '同步服务断开，进入只读模式',
        bgColor: 'bg-yellow-50',
        textColor: 'text-yellow-800',
        borderColor: 'border-yellow-200',
      }
    } else if (yjsConnected && !socketioConnected) {
      return {
        type: 'warning' as const,
        message: '聊天服务重连中...',
        bgColor: 'bg-yellow-50',
        textColor: 'text-yellow-800',
        borderColor: 'border-yellow-200',
      }
    } else {
      return {
        type: 'info' as const,
        message: '连接状态异常',
        bgColor: 'bg-blue-50',
        textColor: 'text-blue-800',
        borderColor: 'border-blue-200',
      }
    }
  }

  const config = getBannerConfig()

  return (
    <div
      className={`${config.bgColor} ${config.textColor} ${config.borderColor} border-b px-4 py-2 flex items-center justify-between`}
    >
      <div className="flex items-center space-x-2">
        {aggregatedState === 'offline' && (
          <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent" />
        )}
        <span className="text-sm font-medium">{config.message}</span>
      </div>
      {onReconnect && aggregatedState === 'offline' && (
        <button
          onClick={onReconnect}
          className="text-sm underline hover:no-underline"
        >
          手动重连
        </button>
      )}
    </div>
  )
}

