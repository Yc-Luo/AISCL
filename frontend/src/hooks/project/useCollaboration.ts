import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { config } from '../../config/env'
import { useAuthStore } from '../../stores/authStore'
import { documentService } from '../../services/api/document'
// Room mapping helper (will be moved to service later)

interface CollaborationState {
  yjs: {
    connected: boolean
    status: 'connecting' | 'connected' | 'disconnected' | 'error'
    error: string | null
  }
  socketio: {
    connected: boolean
    status: 'connecting' | 'connected' | 'disconnected' | 'error'
    error: string | null
  }
  aggregated: 'full' | 'degraded' | 'offline'
}

interface UseCollaborationOptions {
  projectId: string
  resourceId?: string // For document rooms: document_id, for whiteboard: project_id
  resourceType?: 'collaboration' | 'document' | 'inquiry'
  skipYjs?: boolean // Skip Y.js connection (for some modules that manage their own)
}

export function useCollaboration({
  projectId,
  resourceId,
  resourceType = 'collaboration',
  skipYjs = false,
}: UseCollaborationOptions) {
  const [state, setState] = useState<CollaborationState>({
    yjs: {
      connected: false,
      status: 'disconnected',
      error: null,
    },
    socketio: {
      connected: false,
      status: 'disconnected',
      error: null,
    },
    aggregated: 'offline',
  })

  const yjsProviderRef = useRef<WebsocketProvider | null>(null)
  const yjsDocRef = useRef<Y.Doc | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const reconnectAttemptsRef = useRef({ yjs: 0, socketio: 0 })
  const { user, tokens } = useAuthStore()
  const MAX_RECONNECT_ATTEMPTS = 5
  const RECONNECT_DELAY = 3000

  // Get room mapping
  const getRoomMapping = useCallback(() => {
    // Socket.IO room: project:{project_id}
    const socketioRoom = `project:${projectId}`

    // Y.js room based on resource type
    let yjsRoom: string
    if (resourceType === 'collaboration') {
      yjsRoom = `wb:${projectId}`
    } else if (resourceType === 'document' && resourceId) {
      yjsRoom = `doc:${resourceId}`
    } else if (resourceType === 'inquiry') {
      yjsRoom = `inquiry:${projectId}`
    } else {
      yjsRoom = `wb:${projectId}` // Default to whiteboard
    }

    return { socketioRoom, yjsRoom }
  }, [projectId, resourceId, resourceType])

  // Refresh token function
  const refreshToken = useCallback(async (): Promise<string | null> => {
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refresh_token: tokens?.refresh_token,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        // Update tokens in store
        useAuthStore.getState().setTokens({
          access_token: data.access_token,
          refresh_token: data.refresh_token || tokens?.refresh_token,
        })
        return data.access_token
      }
      return null
    } catch (error) {
      console.error('Failed to refresh token:', error)
      return null
    }
  }, [tokens])

  // Connect Y.js WebSocket
  const connectYjs = useCallback(async () => {
    if (!user || !tokens?.access_token) return

    try {
      setState(prev => ({
        ...prev,
        yjs: { ...prev.yjs, status: 'connecting', error: null },
      }))

      const { yjsRoom } = getRoomMapping()
      const yjsDoc = new Y.Doc()
      yjsDocRef.current = yjsDoc

      // Load snapshot for document rooms before connecting
      if (resourceType === 'document' && resourceId) {
        try {
          const snapshotData = await documentService.getSnapshot(resourceId)
          if (snapshotData) {
            Y.applyUpdate(yjsDoc, snapshotData)
            console.log('Document snapshot loaded and applied')
          }
        } catch (error) {
          console.error('Failed to load document snapshot:', error)
        }
      }

      // Build WebSocket URL (base only)
      const wsUrl = `${config.wsUrl}/ysocket`

      const provider = new WebsocketProvider(wsUrl, yjsRoom, yjsDoc, {
        connect: true,
        params: {
          token: tokens.access_token
        },
      })

      yjsProviderRef.current = provider

      provider.on('status', (event: { status: string }) => {
        if (event.status === 'connected') {
          setState(prev => ({
            ...prev,
            yjs: {
              connected: true,
              status: 'connected',
              error: null,
            },
            aggregated: prev.socketio.connected ? 'full' : 'degraded',
          }))
          reconnectAttemptsRef.current.yjs = 0
        } else if (event.status === 'disconnected') {
          setState(prev => ({
            ...prev,
            yjs: {
              connected: false,
              status: 'disconnected',
              error: null,
            },
            aggregated: prev.socketio.connected ? 'degraded' : 'offline',
          }))
        }
      })

      provider.on('connection-error', (error: Error) => {
        console.error('Y.js connection error:', error)
        setState(prev => ({
          ...prev,
          yjs: {
            connected: false,
            status: 'error',
            error: error.message,
          },
          aggregated: prev.socketio.connected ? 'degraded' : 'offline',
        }))
      })
    } catch (error) {
      console.error('Failed to connect Y.js:', error)
      setState(prev => ({
        ...prev,
        yjs: {
          connected: false,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        aggregated: prev.socketio.connected ? 'degraded' : 'offline',
      }))
    }
  }, [user, tokens, getRoomMapping])

  // Connect Socket.IO
  const connectSocketIO = useCallback(async () => {
    if (!user || !tokens?.access_token) return

    try {
      setState(prev => ({
        ...prev,
        socketio: { ...prev.socketio, status: 'connecting', error: null },
      }))

      const { socketioRoom } = getRoomMapping()
      const socket = io(config.socketIOUrl, {
        auth: {
          token: tokens.access_token,
        },
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: RECONNECT_DELAY,
        reconnectionAttempts: MAX_RECONNECT_ATTEMPTS,
      })

      socketRef.current = socket

      socket.on('connect', () => {
        setState(prev => ({
          ...prev,
          socketio: {
            connected: true,
            status: 'connected',
            error: null,
          },
          aggregated: prev.yjs.connected ? 'full' : 'degraded',
        }))
        reconnectAttemptsRef.current.socketio = 0

        // Join project room
        socket.emit('join_room', { room_id: socketioRoom })
      })

      socket.on('disconnect', () => {
        setState(prev => ({
          ...prev,
          socketio: {
            connected: false,
            status: 'disconnected',
            error: null,
          },
          aggregated: prev.yjs.connected ? 'degraded' : 'offline',
        }))
      })

      socket.on('connect_error', async (error) => {
        console.error('Socket.IO connection error:', error)

        // Check if it's a token expiration error
        if (error.message.includes('token') || error.message.includes('auth')) {
          const newToken = await refreshToken()
          if (newToken) {
            // Retry connection with new token
            socket.auth = { token: newToken }
            socket.connect()
          } else {
            // Token refresh failed, redirect to login
            window.location.href = '/login'
          }
        } else {
          setState(prev => ({
            ...prev,
            socketio: {
              connected: false,
              status: 'error',
              error: error.message,
            },
            aggregated: prev.yjs.connected ? 'degraded' : 'offline',
          }))
        }
      })
    } catch (error) {
      console.error('Failed to connect Socket.IO:', error)
      setState(prev => ({
        ...prev,
        socketio: {
          connected: false,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        aggregated: prev.yjs.connected ? 'degraded' : 'offline',
      }))
    }
  }, [user, tokens, getRoomMapping, refreshToken])

  // Connect both channels
  const connect = useCallback(async () => {
    // Only connect Y.js if not skipped
    const promises: Promise<void>[] = [connectSocketIO()]
    if (!skipYjs) {
      promises.push(connectYjs())
    }
    await Promise.all(promises)
  }, [connectYjs, connectSocketIO, skipYjs])

  // Disconnect both channels
  const disconnect = useCallback(() => {
    if (yjsProviderRef.current) {
      yjsProviderRef.current.destroy()
      yjsProviderRef.current = null
    }
    if (yjsDocRef.current) {
      yjsDocRef.current.destroy()
      yjsDocRef.current = null
    }
    if (socketRef.current) {
      const { socketioRoom } = getRoomMapping()
      socketRef.current.emit('leave_room', { room_id: socketioRoom })
      socketRef.current.disconnect()
      socketRef.current = null
    }

    setState({
      yjs: {
        connected: false,
        status: 'disconnected',
        error: null,
      },
      socketio: {
        connected: false,
        status: 'disconnected',
        error: null,
      },
      aggregated: 'offline',
    })
  }, [getRoomMapping])

  // Reconnect both channels
  const reconnect = useCallback(async () => {
    disconnect()
    await new Promise(resolve => setTimeout(resolve, 1000))
    await connect()
  }, [connect, disconnect])

  // Auto-connect on mount and when connection params change
  useEffect(() => {
    if (projectId && user && tokens?.access_token) {
      connect()
    }

    return () => {
      disconnect()
    }
  }, [projectId, resourceId, resourceType, skipYjs, user, tokens?.access_token, connect, disconnect])

  return {
    yjs_state: state.yjs,
    socketio_state: state.socketio,
    aggregated_state: state.aggregated,
    yjs_doc: yjsDocRef.current,
    yjs_provider: yjsProviderRef.current,
    socket: socketRef.current,
    connect,
    disconnect,
    reconnect,
  }
}


