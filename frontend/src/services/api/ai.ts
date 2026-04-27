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

export interface AIStreamStatus {
    step?: string
    message: string
    primary_view?: string
    citation_count?: number
    detail?: string
}

export interface AIStreamMeta {
    ai_meta?: {
        primary_view?: string
        rationale_summary?: string
        processing_summary?: string[]
    }
    citations?: Array<Record<string, unknown>>
    conversation_id?: string
    message_id?: string
    citation_count?: number
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
            onStatus?: (status: AIStreamStatus) => void
            onMeta?: (meta: AIStreamMeta) => void
            onDone?: (meta: AIStreamMeta) => void
            onError?: (error: AIStreamStatus) => void
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

        const eventDelimiterPattern = /\r?\n\r?\n/

        const parseJsonPayload = <T,>(payload: string, fallback: T): T => {
            try {
                return JSON.parse(payload) as T
            } catch {
                return fallback
            }
        }

        const flushEvent = (rawEvent: string) => {
            const lines = rawEvent
                .split(/\r?\n/)
                .map((line) => line.trimEnd())
                .filter((line) => line.length > 0 && !line.startsWith(':'))

            const eventLine = lines.find((line) => line.startsWith('event:'))
            const eventName = eventLine ? eventLine.slice(6).trim() : 'message'
            const dataLines = lines
                .filter((line) => line.startsWith('data:'))
                .map((line) => line.slice(5).replace(/^ /, ''))

            if (dataLines.length === 0) return null
            return {
                event: eventName,
                data: dataLines.join('\n'),
            }
        }

        const handleEvent = (parsed: { event: string; data: string } | null) => {
            if (!parsed) return
            const { event, data } = parsed

            if (event === 'status') {
                handlers?.onStatus?.(parseJsonPayload<AIStreamStatus>(data, { message: data }))
                return
            }
            if (event === 'meta') {
                handlers?.onMeta?.(parseJsonPayload<AIStreamMeta>(data, {}))
                return
            }
            if (event === 'done') {
                handlers?.onDone?.(parseJsonPayload<AIStreamMeta>(data, {}))
                return
            }
            if (event === 'error') {
                handlers?.onError?.(parseJsonPayload<AIStreamStatus>(data, { message: data }))
                return
            }

            // Backward compatibility: older backend streams used default
            // message events with raw text chunks.
            fullText += data
            handlers?.onChunk?.(data, fullText)
        }

        while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            while (true) {
                const delimiterMatch = buffer.match(eventDelimiterPattern)
                if (!delimiterMatch || delimiterMatch.index === undefined) break

                const rawEvent = buffer.slice(0, delimiterMatch.index)
                buffer = buffer.slice(delimiterMatch.index + delimiterMatch[0].length)
                handleEvent(flushEvent(rawEvent))
            }
        }

        if (buffer.trim()) {
            handleEvent(flushEvent(buffer))
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
        context_type: 'document' | 'whiteboard' | 'dashboard'
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
