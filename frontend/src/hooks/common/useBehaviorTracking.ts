import { useEffect, useRef, useCallback } from 'react'
import { analyticsService } from '../../services/api/analytics'
import { useAuthStore } from '../../stores/authStore'

interface BehaviorData {
  project_id: string
  user_id: string
  module: string
  action: string
  resource_id?: string
  metadata?: Record<string, any>
  timestamp?: Date
}

export function useBehaviorTracking(projectId: string | null, module: string) {
  const { user } = useAuthStore()
  const behaviorBuffer = useRef<BehaviorData[]>([])
  const flushTimer = useRef<NodeJS.Timeout | null>(null)
  const pageEnterTime = useRef<number>(Date.now())
  const lastActivityTime = useRef<number>(Date.now())
  const scrollDepth = useRef<number>(0)
  const mouseMovements = useRef<number>(0)

  // Batch size and flush interval
  const BATCH_SIZE = 10
  const FLUSH_INTERVAL = 5000 // 5 seconds

  // Track page view
  useEffect(() => {
    if (!projectId || !user) return

    pageEnterTime.current = Date.now()
    trackBehavior('view', 'page_enter')

    return () => {
      const duration = Math.floor((Date.now() - pageEnterTime.current) / 1000)
      trackBehavior('view', 'page_leave', undefined, { duration })
    }
  }, [projectId, module])

  // Track tab visibility
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        const duration = Math.floor((Date.now() - lastActivityTime.current) / 1000)
        trackBehavior('view', 'tab_hidden', undefined, { duration })
      } else {
        lastActivityTime.current = Date.now()
        trackBehavior('view', 'tab_visible')
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  // Track mouse movements
  useEffect(() => {
    const handleMouseMove = () => {
      mouseMovements.current++
      lastActivityTime.current = Date.now()
    }

    document.addEventListener('mousemove', handleMouseMove, { passive: true })
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
    }
  }, [])

  // Track scroll depth
  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop
      const scrollHeight = document.documentElement.scrollHeight
      const clientHeight = document.documentElement.clientHeight
      const depth = Math.floor((scrollTop / (scrollHeight - clientHeight)) * 100)

      if (depth > scrollDepth.current) {
        scrollDepth.current = depth
        trackBehavior('view', 'scroll', undefined, { depth })
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  // Track tab switch
  useEffect(() => {
    const handleTabSwitch = () => {
      trackBehavior('view', 'tab_switch')
    }

    window.addEventListener('focus', handleTabSwitch)
    window.addEventListener('blur', handleTabSwitch)
    return () => {
      window.removeEventListener('focus', handleTabSwitch)
      window.removeEventListener('blur', handleTabSwitch)
    }
  }, [])

  const trackBehavior = useCallback(
    (
      action: string,
      subAction?: string,
      resourceId?: string,
      metadata?: Record<string, any>
    ) => {
      if (!projectId || !user) return

      const behavior: BehaviorData = {
        project_id: projectId,
        user_id: user.id,
        module,
        action: subAction ? `${action}_${subAction}` : action,
        resource_id: resourceId,
        metadata: {
          ...metadata,
          mouse_movements: mouseMovements.current,
          scroll_depth: scrollDepth.current,
        },
        timestamp: new Date(),
      }

      behaviorBuffer.current.push(behavior)

      // Flush if buffer is full
      if (behaviorBuffer.current.length >= BATCH_SIZE) {
        flushBehaviors()
      } else {
        // Schedule flush
        if (flushTimer.current) {
          clearTimeout(flushTimer.current)
        }
        flushTimer.current = setTimeout(flushBehaviors, FLUSH_INTERVAL)
      }
    },
    [projectId, user, module]
  )

  const flushBehaviors = useCallback(async () => {
    if (behaviorBuffer.current.length === 0) return

    const behaviors = [...behaviorBuffer.current]
    behaviorBuffer.current = []

    if (flushTimer.current) {
      clearTimeout(flushTimer.current)
      flushTimer.current = null
    }

    try {
      // Use sendBeacon for better reliability
      // Use analyticsService (axios) to ensure Authorization headers are sent
      // navigator.sendBeacon does not support custom headers easily without CORS complications
      await analyticsService.sendBehaviorBatch(behaviors)
    } catch (error) {
      console.error('Failed to send behavior data:', error)
      // Re-add to buffer on failure
      behaviorBuffer.current.unshift(...behaviors)
    }
  }, [])

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (behaviorBuffer.current.length > 0) {
        flushBehaviors()
      }
    }
  }, [])

  return { trackBehavior }
}

