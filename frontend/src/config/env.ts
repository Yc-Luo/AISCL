const getWsUrl = () => {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}`
}

export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || '',
  wsUrl: getWsUrl(),
  socketIOUrl: import.meta.env.VITE_SOCKETIO_URL || '',
} as const

