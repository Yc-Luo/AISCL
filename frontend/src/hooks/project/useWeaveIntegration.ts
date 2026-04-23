import { useMemo } from 'react'
// @ts-ignore
import { WebsocketsStore } from '@inditextech/weave-store-websockets'
import { config } from '../../config/env'
import { useAuthStore } from '../../stores/authStore'

export const useWeaveIntegration = (projectId: string) => {
    const { tokens } = useAuthStore()

    // Initialize Weave.js store
    const store = useMemo(() => {
        if (!projectId || !tokens?.access_token) return null

        // Backend WebSocket URL
        const wsUrl = `${config.wsUrl}/ysocket/wb:${projectId}`

        // We append the token to the URL as Weave's WebsocketsStore might not support
        // custom headers/params configuration in its constructor easily.
        // If it supports it, we should use it. For now, assuming standard Y-Websocket protocol.
        const urlWithAuth = `${wsUrl}?token=${tokens.access_token}`

        return new WebsocketsStore(urlWithAuth)
    }, [projectId, tokens?.access_token])

    return store
}
