import api from './client'
import { config } from '../../config/env'

export interface AIPersona {
    id: string
    name: string
    icon: string
    description: string
    system_prompt?: string
}

export interface ChatMessage {
    role: 'user' | 'assistant'
    content: string
    created_at?: string
}

export interface InterventionCheckContextPayload {
    last_message_time?: string
    recent_messages: Array<{
        role: 'user' | 'assistant' | 'system'
        content: string
    }>
    user_activity?: Record<string, unknown>
    evidence_node_count?: number
    counter_argument_count?: number
    recent_revision_count?: number
    last_revision_time?: string
    session_elapsed_seconds?: number
    ai_assistance_ratio?: number
}

export interface InterventionCheckResult {
    rule_id: string
    rule_name: string
    rule_type: string
    rule_set_applied?: string | null
    action_type: string
    message: string
    ai_role_id?: string | null
    trigger_reason: string
}

export interface AIResearchContextPayload {
    current_stage?: string
    enabled_rule_set?: string
    enabled_scaffold_roles?: string[]
    preferred_subagent?: string
}

export const aiService = {
    getPersonas: async (): Promise<AIPersona[]> => {
        const response = await api.get('/ai/personas')
        return response.data
    },

    createConversation: async (personaId: string, contextConfig: any) => {
        console.log('[AI API] Creating conversation with:', { personaId, contextConfig });
        const response = await api.post('/ai/conversations', {
            project_id: contextConfig.project_id,
            role_id: personaId,
        })
        return response.data
    },

    sendMessage: async (
        conversationId: string | null | undefined,
        message: string,
        projectId: string,
        researchContext?: AIResearchContextPayload
    ) => {
        const response = await api.post('/ai/chat', {
            project_id: projectId,
            conversation_id: conversationId || undefined,
            message: message,
            current_stage: researchContext?.current_stage,
            enabled_rule_set: researchContext?.enabled_rule_set,
            enabled_scaffold_roles: researchContext?.enabled_scaffold_roles || [],
            preferred_subagent: researchContext?.preferred_subagent,
        })
        return response.data
    },

    streamChat: async (
        payload: {
            project_id: string
            message: string
            conversation_id?: string
            role_id?: string
            use_rag?: boolean
        } & AIResearchContextPayload,
        handlers?: {
            onChunk?: (chunk: string, fullText: string) => void
        }
    ) => {
        const token = localStorage.getItem('access_token')
        const response = await fetch(`${config.apiBaseUrl}/api/v1/ai/chat/stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(payload),
        })

        if (!response.ok) {
            const errorText = await response.text().catch(() => '')
            throw new Error(errorText || `Stream request failed: ${response.status}`)
        }

        if (!response.body) {
            throw new Error('Stream response body is empty')
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder('utf-8')
        let buffer = ''
        let fullText = ''

        const flushEvent = (rawEvent: string) => {
            const lines = rawEvent
                .split('\n')
                .map((line) => line.trimEnd())
                .filter((line) => line.length > 0 && !line.startsWith(':'))

            const dataLines = lines
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).trimStart())

            if (dataLines.length === 0) return ''
            return dataLines.join('\n')
        }

        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const events = buffer.split('\n\n')
            buffer = events.pop() || ''

            for (const rawEvent of events) {
                const chunk = flushEvent(rawEvent)
                if (!chunk) continue
                fullText += chunk
                handlers?.onChunk?.(chunk, fullText)
            }
        }

        if (buffer.trim()) {
            const tailChunk = flushEvent(buffer)
            if (tailChunk) {
                fullText += tailChunk
                handlers?.onChunk?.(tailChunk, fullText)
            }
        }

        return fullText
    },

    // Get conversations for a project
    getConversations: async (projectId: string): Promise<any> => {
        const response = await api.get(`/ai/conversations/${projectId}`)
        return response.data
    },

    // Get messages for a conversation
    getMessages: async (conversationId: string): Promise<any> => {
        const response = await api.get(`/ai/conversations/${conversationId}/messages`)
        return response.data
    },

    // Delete a conversation
    deleteConversation: async (conversationId: string): Promise<void> => {
        await api.delete(`/ai/conversations/${conversationId}`)
    },

    // Perform specialized context actions
    performAction: async (data: {
        project_id: string
        action_type: 'summarize' | 'knowledge_graph' | 'optimize' | 'devil_advocate' | 'inquiry_clustering'
        context_type: 'document' | 'whiteboard' | 'browser' | 'dashboard'
        content: string
        additional_query?: string
    }) => {
        const response = await api.post('/ai/action', data)
        return response.data
    },

    checkInterventions: async (data: {
        project_id: string
        user_id?: string
        enabled_rule_set?: string
        context: InterventionCheckContextPayload
    }): Promise<InterventionCheckResult[]> => {
        const response = await api.post('/ai/interventions/check', data)
        return response.data
    },

    // Helper to get streaming URL
    getStreamUrl: (conversationId: string) => {
        return `/ai/conversations/${conversationId}/messages/stream`
    }
}
