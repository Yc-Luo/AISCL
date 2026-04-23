interface ReconnectingIndicatorProps {
  visible: boolean
  message?: string
}

export default function ReconnectingIndicator({
  visible,
  message = '正在重连...',
}: ReconnectingIndicatorProps) {
  if (!visible) return null

  return (
    <div className="fixed bottom-4 right-4 bg-gray-900 text-white px-4 py-2 rounded-lg shadow-lg flex items-center space-x-2 z-50">
      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
      <span className="text-sm">{message}</span>
    </div>
  )
}

