import { useEffect, useRef, useCallback } from 'react'
import { analyticsService } from '../../services/api/analytics'
import { useAuthStore } from '../../stores/authStore'

export function useActivityTracking(projectId: string | null, module: string) {
  const { user } = useAuthStore()
  const heartbeatInterval = useRef<NodeJS.Timeout | null>(null)
  const lastActivityTime = useRef<number>(Date.now())
  const INACTIVITY_THRESHOLD = 60000 // 1 minute
  const HEARTBEAT_INTERVAL = 30000 // 30 seconds

  // Track user activity events
  useEffect(() => {
    if (!projectId || !user) return

    const activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart']
    const handleActivity = () => {
      lastActivityTime.current = Date.now()
    }

    activityEvents.forEach((event) => {
      document.addEventListener(event, handleActivity, { passive: true })
    })

    return () => {
      activityEvents.forEach((event) => {
        document.removeEventListener(event, handleActivity)
      })
    }
  }, [projectId, user])

  // Send heartbeat
  const sendHeartbeat = useCallback(async () => {
    if (!projectId || !user) return

    const timeSinceLastActivity = Date.now() - lastActivityTime.current

    // Only send heartbeat if user is active (not idle)
    if (timeSinceLastActivity < INACTIVITY_THRESHOLD) {
      try {
        await analyticsService.sendHeartbeat({
          project_id: projectId,
          user_id: user.id,
          module,
          timestamp: new Date(),
        })
      } catch (error) {
        console.error('Failed to send heartbeat:', error)
      }
    }
  }, [projectId, user, module])

  // Start heartbeat interval
  useEffect(() => {
    if (!projectId || !user) return

    // Send initial heartbeat
    sendHeartbeat()

    // Set up interval
    heartbeatInterval.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL)

    return () => {
      if (heartbeatInterval.current) {
        clearInterval(heartbeatInterval.current)
      }
    }
  }, [projectId, user, module, sendHeartbeat])

  // Send heartbeat on page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      sendHeartbeat()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [sendHeartbeat])
}

