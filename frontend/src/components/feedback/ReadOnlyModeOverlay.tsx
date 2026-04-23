interface ReadOnlyModeOverlayProps {
  visible: boolean
  message?: string
}

export default function ReadOnlyModeOverlay({
  visible,
  message = '同步服务断开，进入只读模式',
}: ReadOnlyModeOverlayProps) {
  if (!visible) return null

  return (
    <div className="absolute inset-0 bg-yellow-50 bg-opacity-90 z-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-md text-center">
        <div className="text-yellow-600 mb-2">
          <svg
            className="w-12 h-12 mx-auto"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">只读模式</h3>
        <p className="text-sm text-gray-600">{message}</p>
      </div>
    </div>
  )
}

