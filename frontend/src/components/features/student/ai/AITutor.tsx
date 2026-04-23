import { useState, useRef, useEffect } from 'react'
import { aiService } from '../../../../services/api/ai'
import { trackingService } from '../../../../services/tracking/TrackingService'
import { useScrapbookActions } from '../../../../modules/inquiry/hooks/useScrapbookActions'
import { Lightbulb } from 'lucide-react'
import { Toast } from '../../../ui/Toast'
import { ExperimentVersion } from '../../../../types'
import { useContextStore } from '../../../../stores/contextStore'
import { useScaffoldRecommendationStore } from '../../../../stores/scaffoldRecommendationStore'
import { roleKeyToPreferredSubagent, type ScaffoldRoleKey } from '../../../../lib/experimentScaffold'

interface AITutorProps {
    projectId: string
    experimentVersion?: ExperimentVersion | null
}

interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    timestamp: Date
    aiMeta?: {
        primaryView?: string
        rationaleSummary?: string
        processingSummary?: string[]
    }
}

export default function AITutor({ projectId, experimentVersion }: AITutorProps) {
    const experimentVersionId = experimentVersion?.version_name || undefined
    const [messages, setMessages] = useState<Message[]>([
        {
            id: 'welcome',
            role: 'assistant',
            content: '你好！我是你的 AI 导师。有什么我可以帮你的吗？不管是小组任务思路还是协作问题，随时问我！',
            timestamp: new Date()
        }
    ])
    const [inputValue, setInputValue] = useState('')
    const [isTyping, setIsTyping] = useState(false)
    const [conversationId, setConversationId] = useState<string | null>(null)
    const [conversations, setConversations] = useState<any[]>([])
    const [isHistoryOpen, setIsHistoryOpen] = useState(false)
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [convToDelete, setConvToDelete] = useState<string | null>(null)
    const [showProcessingSummary, setShowProcessingSummary] = useState(false)
    const [processingCollapsed, setProcessingCollapsed] = useState(false)
    const [processingSummary, setProcessingSummary] = useState<string[]>([])

    const { addMaterial } = useScrapbookActions(projectId)
    const [showToast, setShowToast] = useState(false)
    const [toastMessage, setToastMessage] = useState('')

    const messagesEndRef = useRef<HTMLDivElement>(null)
    const consumeRecommendation = useScaffoldRecommendationStore((state) => state.consumeRecommendation)
    const rawStreamContentRef = useRef('')

    const [suggestions, setSuggestions] = useState<string[]>([
        "我们的小组目前进展如何？",
        "能帮我梳理一下下一步的任务吗？",
        "这个小组协作过程中有什么我可以学习的重点？"
    ])

    const {
        currentStage,
    } = useContextStore()

    const getStageDefaultRole = (stage?: string | null): ScaffoldRoleKey => {
        if (!stage) return 'problem_progression'
        if (/(argumentation|论证|协商)/.test(stage)) return 'viewpoint_challenge'
        if (/(revision|reflection|修订|反思)/.test(stage)) return 'feedback_prompting'
        if (/(inquiry|evidence|证据|探究)/.test(stage)) return 'cognitive_support'
        return 'problem_progression'
    }

    const inferTutorRole = (text: string): ScaffoldRoleKey => {
        const normalized = text.trim()
        const scoreMap: Record<ScaffoldRoleKey, number> = {
            cognitive_support: 0,
            viewpoint_challenge: 0,
            feedback_prompting: 0,
            problem_progression: 0,
        }

        const weightedPatterns: Array<[ScaffoldRoleKey, RegExp, number]> = [
            ['viewpoint_challenge', /反驳|质疑|不同意见|替代方案|反方|反例|漏洞|站不住脚|局限|偏见|争议|挑战|对立观点|另一种解释/g, 3],
            ['feedback_prompting', /修改|优化|改进|完善|修订|修正|调整|反馈|评价标准|标准|不足|薄弱|怎么改|如何改进|如何完善|如何修正|证据够吗|充分吗/g, 3],
            ['problem_progression', /下一步|推进|计划|步骤|先做什么|怎么开始|如何开展|如何推进|任务|分工|安排|进展|卡住|梳理|路线|流程/g, 3],
            ['cognitive_support', /资料|证据|出处|来源|文献|背景|概念|什么是|材料|案例|信息|查找|搜集|搜索|依据|数据/g, 3],
            ['feedback_prompting', /学习重点|收获|哪里需要注意|怎么提升|如何提高/g, 2],
            ['problem_progression', /目前进展|现在到哪一步|当前情况|整体情况/g, 2],
            ['cognitive_support', /帮我解释|帮我说明|了解一下|背景知识/g, 2],
        ]

        for (const [roleKey, pattern, weight] of weightedPatterns) {
            const matches = normalized.match(pattern)
            if (matches?.length) {
                scoreMap[roleKey] += matches.length * weight
            }
        }

        const ranked = Object.entries(scoreMap).sort((a, b) => b[1] - a[1]) as Array<[ScaffoldRoleKey, number]>
        if (ranked[0] && ranked[0][1] > 0) {
            return ranked[0][0]
        }

        return getStageDefaultRole(currentStage)
    }

    const inferTutorResponseMode = (text: string) => {
        if (/反驳|挑战/.test(text)) return 'challenge'
        if (/建议|可以|尝试|下一步/.test(text)) return 'question'
        return 'suggestion'
    }

    const getTutorRoleLabel = (roleKey: string) => {
        switch (roleKey) {
            case 'viewpoint_challenge':
                return '观点挑战者'
            case 'feedback_prompting':
                return '反馈追问者'
            case 'problem_progression':
                return '问题推进者'
            default:
                return '资料研究员'
        }
    }

    const buildTutorRationaleSummary = (roleKey: string, stage?: string | null) => {
        const roleLabel = getTutorRoleLabel(roleKey)
        if (stage) {
            return `结合当前阶段与提问内容，本轮 AI 导师主要采用“${roleLabel}”的支架视角。`
        }
        return `结合当前提问内容，本轮 AI 导师主要采用“${roleLabel}”的支架视角。`
    }

    const buildProcessingSummary = (content: string) => {
        const inferredRole = inferTutorRole(content)
        const summary = [
            `正在识别当前阶段目标：${currentStage || '未设置阶段'}`,
            `正在调用 ${getTutorRoleLabel(inferredRole)} 组织本轮支架回应`,
        ]

        if (experimentVersion?.enabled_rule_set) {
            summary.push(`正在结合规则集 ${experimentVersion.enabled_rule_set} 调整回应重点`)
        }

        summary.push('正在生成面向当前任务的下一步建议')
        return summary
    }

    const stripThinkBlocksForDisplay = (raw: string) => {
        let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '')
        const openIndex = cleaned.lastIndexOf('<think>')
        if (openIndex !== -1) {
            cleaned = cleaned.slice(0, openIndex)
        }
        cleaned = cleaned.replace(/<\/?think>/g, '')
        return cleaned
    }

    const loadMessages = async (convId: string) => {
        try {
            const msgsResponse = await aiService.getMessages(convId);
            if (msgsResponse.messages) {
                const history = msgsResponse.messages.map((m: any) => ({
                    id: m.id,
                    role: m.role,
                    content: m.content,
                    timestamp: new Date(m.created_at),
                    aiMeta: m.ai_meta
                        ? {
                            primaryView: m.ai_meta.primary_view,
                            rationaleSummary: m.ai_meta.rationale_summary,
                            processingSummary: m.ai_meta.processing_summary || [],
                        }
                        : undefined,
                }));
                // If history is empty, show welcome
                if (history.length === 0) {
                    setMessages([
                        {
                            id: 'welcome',
                            role: 'assistant',
                            content: '你好！我是你的 AI 导师。有什么我可以帮你的吗？不管是小组任务思路还是协作问题，随时问我！',
                            timestamp: new Date()
                        }
                    ]);
                } else {
                    setMessages(history);
                }
            }
        } catch (error) {
            console.error('Failed to load messages', error);
        }
    };

    const loadConversationsList = async () => {
        try {
            const response = await aiService.getConversations(projectId);
            setConversations(response.conversations || []);
            return response.conversations || [];
        } catch (error) {
            console.error('Failed to load conversations', error);
            return [];
        }
    };

    const handleNewChat = async () => {
        setConversationId(null);
        setMessages([
            {
                id: 'welcome',
                role: 'assistant',
                content: '你好！新的对话已开启。有什么我可以帮你的吗？',
                timestamp: new Date()
            }
        ]);
        setSuggestions([
            "我们的小组目前进展如何？",
            "能帮我梳理一下下一步的任务吗？",
            "这个小组协作过程中有什么我可以学习的重点？"
        ]);
        setIsHistoryOpen(false);
        trackingService.track({
            module: 'ai',
            action: 'ai_conversation_start',
            metadata: { projectId }
        });
    };

    const handleSwitchChat = async (convId: string) => {
        setConversationId(convId);
        await loadMessages(convId);
        setIsHistoryOpen(false);
        trackingService.track({
            module: 'ai',
            action: 'ai_conversation_switch',
            metadata: { conversationId: convId }
        });
    };

    const handleDeleteChat = async (e: React.MouseEvent, convId: string) => {
        e.stopPropagation();
        setConvToDelete(convId);
        setIsDeleteModalOpen(true);
    };

    const confirmDelete = async () => {
        if (!convToDelete) return;

        try {
            await aiService.deleteConversation(convToDelete);
            trackingService.track({
                module: 'ai',
                action: 'ai_conversation_delete',
                metadata: { conversationId: convToDelete }
            });
            const updatedList = await loadConversationsList();

            // If we deleted the current conversation, switch to the most recent one or start a new one
            if (convToDelete === conversationId) {
                if (updatedList.length > 0) {
                    const nextId = updatedList[0].id;
                    setConversationId(nextId);
                    await loadMessages(nextId);
                } else {
                    await handleNewChat();
                }
            }
        } catch (error) {
            console.error('Failed to delete chat', error);
        } finally {
            setIsDeleteModalOpen(false);
            setConvToDelete(null);
        }
    };

    // Initialize conversation and load history
    useEffect(() => {
        const init = async () => {
            const list = await loadConversationsList();
            if (list.length > 0) {
                const activeId = list[0].id;
                setConversationId(activeId);
                await loadMessages(activeId);
            } else {
                // If no history, don't create backend conversation yet.
                // Just keep it in a 'new' state.
                setConversationId(null);
                setMessages([
                    {
                        id: 'welcome',
                        role: 'assistant',
                        content: '你好！我是你的 AI 导师。有什么我可以帮你的吗？',
                        timestamp: new Date()
                    }
                ]);
            }
        };
        if (projectId) {
            init();
        }
    }, [projectId]);

    useEffect(() => {
        const scrollToBottom = () => {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        };
        // 稍微延迟确保 DOM 已渲染完成且高度已更新
        const timeoutId = setTimeout(scrollToBottom, 100);
        return () => clearTimeout(timeoutId);
    }, [messages, isTyping]);

    const handleSend = async (
        content: string = inputValue,
        options?: {
            triggerSource?: 'manual_call' | 'rule_recommendation'
            triggerReason?: string
            metadata?: Record<string, unknown>
        }
    ) => {
        if (!content.trim()) return

        const newMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: content,
            timestamp: new Date()
        }

        setMessages(prev => [...prev, newMessage])
        setInputValue('')
        setIsTyping(true)

        trackingService.trackResearchEvent({
            project_id: projectId,
            experiment_version_id: experimentVersionId,
            actor_type: 'student',
            event_domain: 'scaffold',
            event_type: 'scaffold_request',
            stage_id: currentStage || undefined,
            payload: {
                scaffold_layer: 'process_scaffold',
                scaffold_role: inferTutorRole(content),
                trigger_source: options?.triggerSource || 'manual_call',
                trigger_reason: options?.triggerReason || 'tutor_chat',
                current_stage: currentStage,
                conversation_id: conversationId,
                ...options?.metadata,
            }
        })

        try {
            const startTime = Date.now();
            trackingService.track({
                module: 'ai',
                action: 'ai_query_start',
                metadata: { projectId, length: content.length }
            });

            let activeConvId = conversationId;

            // Late initialization: if no conversation exists yet, create it now
            if (!activeConvId) {
                const response = await aiService.createConversation('default-tutor', { project_id: projectId });
                activeConvId = response.id;
                setConversationId(activeConvId);
            }

            if (activeConvId) {
                const inferredRole = inferTutorRole(content);
                const assistantMsgId = (Date.now() + 1).toString();
                const assistantMsg: Message = {
                    id: assistantMsgId,
                    role: 'assistant',
                    content: '',
                    timestamp: new Date(),
                    aiMeta: {
                        primaryView: getTutorRoleLabel(inferredRole),
                        rationaleSummary: buildTutorRationaleSummary(inferredRole, currentStage),
                        processingSummary: buildProcessingSummary(content),
                    }
                }
                setMessages(prev => [...prev, assistantMsg]);
                const streamPayload = {
                    project_id: projectId,
                    conversation_id: activeConvId,
                    message: content,
                    role_id: 'default-tutor',
                    current_stage: currentStage || undefined,
                    enabled_rule_set: experimentVersion?.enabled_rule_set || undefined,
                    enabled_scaffold_roles: experimentVersion?.enabled_scaffold_roles || [],
                    preferred_subagent: roleKeyToPreferredSubagent(inferredRole),
                }
                setProcessingSummary(buildProcessingSummary(content))
                setShowProcessingSummary(true)
                setProcessingCollapsed(false)
                rawStreamContentRef.current = ''

                let finalMessage = ''
                try {
                    await aiService.streamChat(streamPayload, {
                        onChunk: (_chunk, fullText) => {
                            rawStreamContentRef.current = fullText
                            const displayText = stripThinkBlocksForDisplay(fullText)
                            setMessages(prev => prev.map(msg =>
                                msg.id === assistantMsgId
                                    ? {
                                        ...msg,
                                        content: displayText,
                                        aiMeta: {
                                            primaryView: getTutorRoleLabel(inferredRole),
                                            rationaleSummary: buildTutorRationaleSummary(inferredRole, currentStage),
                                            processingSummary: buildProcessingSummary(content),
                                        }
                                    }
                                    : msg
                            ))
                        }
                    })
                    finalMessage = stripThinkBlocksForDisplay(rawStreamContentRef.current).trim()
                } catch (streamError) {
                    console.warn('Tutor stream failed, fallback to non-streaming chat:', streamError)
                    const fallbackResponse = await aiService.sendMessage(
                        activeConvId,
                        content,
                        projectId,
                        {
                            current_stage: currentStage || undefined,
                            enabled_rule_set: experimentVersion?.enabled_rule_set || undefined,
                            enabled_scaffold_roles: experimentVersion?.enabled_scaffold_roles || [],
                            preferred_subagent: roleKeyToPreferredSubagent(inferredRole),
                        }
                    )
                    finalMessage = (fallbackResponse.content || fallbackResponse.message || '').trim()
                    if (fallbackResponse.ai_meta) {
                        setMessages(prev => prev.map(msg =>
                            msg.id === assistantMsgId
                                ? {
                                    ...msg,
                                    aiMeta: {
                                        primaryView: fallbackResponse.ai_meta.primary_view,
                                        rationaleSummary: fallbackResponse.ai_meta.rationale_summary,
                                        processingSummary: fallbackResponse.ai_meta.processing_summary || [],
                                    }
                                }
                                : msg
                        ))
                    }
                }
                finalMessage = finalMessage || '抱歉，本轮未生成有效回应。'

                trackingService.trackResearchEvent({
                    project_id: projectId,
                    experiment_version_id: experimentVersionId,
                    actor_type: 'ai_tutor',
                    event_domain: 'scaffold',
                    event_type: 'tutor_scaffold_response',
                    stage_id: currentStage || undefined,
                    payload: {
                        scaffold_layer: 'process_scaffold',
                        scaffold_role: inferTutorRole(finalMessage || content),
                        trigger_source: options?.triggerSource || 'manual_call',
                        trigger_reason: options?.triggerReason || 'tutor_chat',
                        response_mode: inferTutorResponseMode(finalMessage || content),
                        current_stage: currentStage,
                        conversation_id: activeConvId,
                        ...options?.metadata,
                    }
                })

                const latency = Date.now() - startTime;
                trackingService.track({
                    module: 'ai',
                    action: 'ai_response_end',
                    metadata: {
                        projectId,
                        conversationId: activeConvId,
                        latency,
                        responseLength: finalMessage.length
                    }
                });
                setSuggestions([])

                setMessages(prev => prev.map(msg =>
                    msg.id === assistantMsgId
                        ? {
                            ...msg,
                            content: finalMessage,
                            aiMeta: {
                                primaryView: getTutorRoleLabel(inferredRole),
                                rationaleSummary: buildTutorRationaleSummary(inferredRole, currentStage),
                                processingSummary: buildProcessingSummary(content),
                            }
                        }
                        : msg
                ));
                setProcessingCollapsed(true)

                // If this was the first message exchange, refresh the history list
                if (messages.length <= 1) {
                    await loadConversationsList();
                }
            } else {
                // Fallback if no conversation ID (e.g. backend down)
                setTimeout(() => {
                    const responseMessage: Message = {
                        id: (Date.now() + 1).toString(),
                        role: 'assistant',
                        content: `[离线模式] 后端连接似乎不可用。这是针对 "${content}" 的本地响应。`,
                        timestamp: new Date()
                    }
                    setMessages(prev => [...prev, responseMessage])
                }, 1000);
            }
        } catch (error) {
            console.error("AI Error:", error);
            setMessages(prev => [...prev, {
                id: Date.now().toString(),
                role: 'assistant',
                content: '抱歉，AI 服务暂时不可用。',
                timestamp: new Date()
            }]);
        } finally {
            setIsTyping(false);
        }
    }

    const handleSaveToScrapbook = async (content: string) => {
        try {
            await addMaterial(
                content,
                '来自 AI 导师的解答',
                window.location.href // Or a specific identifier for the chat
            );
            setToastMessage('已提取到探究空间素材池');
            setShowToast(true);
        } catch (error) {
            setToastMessage('保存失败');
            setShowToast(true);
        }
    }

    useEffect(() => {
        if (!projectId || isTyping) return
        const pending = consumeRecommendation('tutor')
        if (!pending) return

        handleSend(pending.prompt, {
            triggerSource: 'rule_recommendation',
            triggerReason: pending.ruleType,
            metadata: {
                rule_id: pending.ruleId,
                recommendation_target: pending.target,
                recommendation_role: pending.recommendedRole,
                recommendation_source: pending.source,
            }
        })
    }, [consumeRecommendation, isTyping, projectId])

    return (
        <div className="flex h-full relative overflow-hidden bg-white/80 backdrop-blur-xl rounded-2xl shadow-xl border border-white/50 transition-all duration-300 hover:shadow-2xl ring-1 ring-black/5">
            {/* Main Chat Area */}
            <div className={`flex-1 flex flex-col h-full min-w-0 transition-all duration-300 ${isHistoryOpen ? 'mr-0' : ''}`}>
                {/* Header */}
                <div className="py-2 px-4 bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 border-b border-indigo-100/50 flex items-center justify-between backdrop-blur-md sticky top-0 z-10">
                    <div>
                        <h3 className="font-bold text-gray-800 flex items-center gap-1.5 text-base">
                            <span className="text-xl filter drop-shadow-sm">🎓</span>
                            <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">AI 智能导师</span>
                        </h3>
                        <p className="text-[10px] text-indigo-500/80 mt-0 font-medium tracking-tight">✨ 您的实时协作学习助手</p>
                    </div>
                    <button
                        onClick={() => setIsHistoryOpen(!isHistoryOpen)}
                        className={`p-1.5 rounded-lg transition-all ${isHistoryOpen ? 'bg-indigo-100 text-indigo-600' : 'text-gray-400 hover:bg-gray-100'}`}
                        title="历史对话"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                    </button>
                </div>

                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto p-3 space-y-3 scroll-smooth">
                    {showProcessingSummary && processingSummary.length > 0 && (
                        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 px-3 py-2">
                            <button
                                type="button"
                                onClick={() => setProcessingCollapsed((prev) => !prev)}
                                className="flex w-full items-center justify-between text-left"
                            >
                                <div className="flex items-center gap-2">
                                    <span className="text-sm">🧭</span>
                                    <span className="text-sm font-medium text-indigo-700">
                                        {isTyping ? 'AI 导师正在处理' : '处理摘要'}
                                    </span>
                                </div>
                                <span className="text-xs text-indigo-500">
                                    {processingCollapsed ? '展开' : '收起'}
                                </span>
                            </button>
                            {!processingCollapsed && (
                                <ul className="mt-2 space-y-1 pl-5 text-xs text-indigo-700">
                                    {processingSummary.map((item, index) => (
                                        <li key={`${item}-${index}`} className="list-disc">
                                            {item}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                    {messages.map((msg) => (
                        <div
                            key={msg.id}
                            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fadeIn`}
                        >
                            <div
                                className={`max-w-[96%] px-3.5 py-2 shadow-sm transition-all duration-200 hover:shadow-md ${msg.role === 'user'
                                    ? 'bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-2xl rounded-tr-sm'
                                    : 'bg-white border border-gray-100 text-gray-700 rounded-2xl rounded-tl-sm shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)]'
                                    }`}
                            >
                                {msg.role === 'assistant' && msg.aiMeta && (
                                    <div className="mb-2 rounded-xl border border-indigo-100 bg-indigo-50/80 px-3 py-2 text-xs text-indigo-800">
                                        <div className="font-semibold">AI 导师</div>
                                        {msg.aiMeta.primaryView && (
                                            <div className="mt-1 text-[11px] font-medium text-indigo-700">
                                                本轮主要视角：{msg.aiMeta.primaryView}
                                            </div>
                                        )}
                                        {msg.aiMeta.rationaleSummary && (
                                            <div className="mt-1 text-[11px] leading-5 text-indigo-700">
                                                {msg.aiMeta.rationaleSummary}
                                            </div>
                                        )}
                                        {msg.aiMeta.processingSummary && msg.aiMeta.processingSummary.length > 0 && (
                                            <details className="mt-2">
                                                <summary className="cursor-pointer text-[11px] font-medium text-indigo-600">
                                                    查看处理摘要
                                                </summary>
                                                <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-indigo-700">
                                                    {msg.aiMeta.processingSummary.map((item, index) => (
                                                        <li key={`${msg.id}-processing-${index}`}>{item}</li>
                                                    ))}
                                                </ul>
                                            </details>
                                        )}
                                    </div>
                                )}
                                <div className={`text-sm whitespace-pre-wrap leading-6 ${msg.role === 'assistant' ? 'markdown-body' : ''}`}>
                                    {msg.content || (msg.role === 'assistant' && isTyping && msg.id === messages[messages.length - 1].id ? '...' : '')}
                                </div>
                                <div className={`text-[10px] mt-1 flex items-center gap-1 ${msg.role === 'user' ? 'text-indigo-200 justify-end' : 'text-gray-400'}`}>
                                    <span>{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    {msg.role === 'assistant' && <span>• AI Tutor</span>}
                                    {msg.role === 'assistant' && msg.content && (
                                        <button
                                            onClick={() => handleSaveToScrapbook(msg.content)}
                                            className="ml-2 hover:text-indigo-500 transition-colors p-0.5"
                                            title="存入探究空间素材池"
                                        >
                                            <Lightbulb className="w-3 h-3" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                    {isTyping && messages[messages.length - 1].role === 'user' && (
                        <div className="flex justify-start animate-pulse">
                            <div className="bg-white border border-gray-100 px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm flex items-center gap-1.5">
                                <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></span>
                                <span className="w-2 h-2 bg-purple-400 rounded-full animate-bounce delay-75"></span>
                                <span className="w-2 h-2 bg-pink-400 rounded-full animate-bounce delay-150"></span>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div className="p-3 bg-white/50 backdrop-blur-md border-t border-indigo-50">
                    {suggestions.length > 0 && !isTyping && (
                        <div className="mb-4 flex flex-wrap gap-2 animate-slideUp">
                            {suggestions.map((chip, index) => (
                                <button
                                    key={index}
                                    onClick={() => handleSend(chip)}
                                    className="text-xs font-medium px-4 py-2 bg-white text-indigo-600 rounded-full shadow-sm hover:shadow-md hover:bg-indigo-50 transition-all duration-200 border border-indigo-100 hover:scale-105 active:scale-95"
                                >
                                    {chip}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="flex gap-2 items-end">
                        <div className="flex-1 relative group">
                            <input
                                type="text"
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                                placeholder="向 AI 导师提问..."
                                className="w-full px-4 py-2 bg-white border-0 ring-1 ring-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/50 shadow-sm transition-all placeholder:text-gray-400 text-sm focus:shadow-inner"
                            />
                            <div className="absolute inset-0 rounded-2xl ring-1 ring-indigo-500/20 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                        </div>
                        <button
                            onClick={() => handleSend()}
                            disabled={!inputValue.trim() || isTyping}
                            className="p-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl shadow-lg hover:shadow-indigo-500/30 hover:translate-y-[-1px] active:translate-y-[1px] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 group"
                        >
                            <svg className="w-5 h-5 transform group-hover:rotate-12 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                            </svg>
                        </button>
                    </div>
                </div>
            </div>

            {/* History Sidebar */}
            <div className={`absolute top-0 right-0 h-full w-64 bg-gray-50/95 backdrop-blur-md border-l border-indigo-100 shadow-2xl transition-transform duration-300 z-20 flex flex-col ${isHistoryOpen ? 'translate-x-0' : 'translate-x-full'}`}>
                <div className="p-4 border-b border-indigo-100 flex items-center justify-between bg-white/50">
                    <h4 className="font-bold text-gray-700 text-sm">历史对话</h4>
                    <button
                        onClick={() => setIsHistoryOpen(false)}
                        className="p-1 hover:bg-gray-200 rounded-md text-gray-400 transition-colors"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-3">
                    <button
                        onClick={handleNewChat}
                        className="w-full py-2 px-4 bg-white border-2 border-dashed border-indigo-200 text-indigo-600 rounded-xl text-sm font-medium hover:border-indigo-400 hover:bg-indigo-50 transition-all flex items-center justify-center gap-2 mb-4"
                    >
                        <span>+</span> 新建对话
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-2">
                    {conversations.map((conv) => (
                        <div
                            key={conv.id}
                            className="group relative"
                        >
                            <button
                                onClick={() => handleSwitchChat(conv.id)}
                                className={`w-full p-3 text-left rounded-xl transition-all border ${conversationId === conv.id
                                    ? 'bg-white border-indigo-300 shadow-sm ring-1 ring-indigo-100'
                                    : 'bg-transparent border-transparent hover:bg-white/50 hover:border-gray-200'
                                    }`}
                            >
                                <div className="font-medium text-gray-800 text-xs truncate mb-1 pr-6">
                                    {conv.title || (conv.id === conversationId && messages.length > 1 ? messages[1].content.substring(0, 20) : "新对话")}
                                </div>
                                <div className="text-[10px] text-gray-400 flex items-center justify-between">
                                    <span>{new Date(conv.updated_at).toLocaleDateString()}</span>
                                </div>
                            </button>
                            <button
                                onClick={(e) => handleDeleteChat(e, conv.id)}
                                className="absolute right-2 top-3 p-1.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all rounded-lg hover:bg-red-50"
                                title="删除对话"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        </div>
                    ))}
                    {conversations.length === 0 && (
                        <div className="text-center py-8">
                            <p className="text-xs text-gray-400">暂无历史对话</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Sidebar Overlay */}
            {isHistoryOpen && (
                <div
                    className="absolute inset-0 bg-black/5 z-10 animate-fadeIn"
                    onClick={() => setIsHistoryOpen(false)}
                />
            )}

            {/* Custom Delete Confirmation Modal */}
            {isDeleteModalOpen && (
                <div className="absolute inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-gray-900/20 backdrop-blur-sm animate-fadeIn"
                        onClick={() => setIsDeleteModalOpen(false)}
                    />
                    <div className="relative bg-white rounded-2xl shadow-2xl border border-gray-100 p-5 w-full max-w-[280px] animate-scaleUp">
                        <div className="text-center mb-4">
                            <div className="w-12 h-12 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-3">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </div>
                            <h4 className="text-gray-800 font-bold text-base mb-1">确定要删除吗？</h4>
                            <p className="text-gray-500 text-xs">删除后对话内容将无法恢复</p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setIsDeleteModalOpen(false)}
                                className="flex-1 px-4 py-2 text-sm font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={confirmDelete}
                                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-xl transition-all shadow-lg shadow-red-500/20"
                            >
                                确定删除
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showToast && (
                <Toast message={toastMessage} onClose={() => setShowToast(false)} />
            )}
        </div>
    )
}
