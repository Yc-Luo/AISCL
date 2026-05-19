import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bot, ChevronDown, Image as ImageIcon, Loader2, MessageCircle, SendHorizontal, X } from 'lucide-react';
import { aiService } from '../../../../services/api/ai';
import { storageService } from '../../../../services/api/storage';
import { trackingService } from '../../../../services/tracking/TrackingService';
import { useContextStore } from '../../../../stores/contextStore';
import { useScaffoldRecommendationStore } from '../../../../stores/scaffoldRecommendationStore';
import { ExperimentVersion } from '../../../../types';
import { getTabLabel } from '../../../../lib/stageModel';

const MAX_FLOATING_IMAGE_BYTES = 10 * 1024 * 1024;

interface FloatingMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
}

interface PendingImage {
    name: string;
    size: number;
    url: string;
    resourceId: string;
}

interface ContextualAIAssistantProps {
    projectId: string;
    experimentVersion?: ExperimentVersion | null;
    onOpenTutor: () => void;
}

const stripThinkBlocks = (raw: string) => {
    let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
    const openIndex = cleaned.lastIndexOf('<think>');
    if (openIndex !== -1) cleaned = cleaned.slice(0, openIndex);
    return cleaned.replace(/<\/?think>/g, '').trim();
};

const getSelectedText = () => {
    if (typeof window === 'undefined') return '';
    return window.getSelection()?.toString().trim().slice(0, 2000) || '';
};

export default function ContextualAIAssistant({
    projectId,
    experimentVersion,
    onOpenTutor,
}: ContextualAIAssistantProps) {
    const [expanded, setExpanded] = useState(false);
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState<FloatingMessage[]>([]);
    const [processingSummary, setProcessingSummary] = useState<string[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const rawContentRef = useRef('');
    const enqueueRecommendation = useScaffoldRecommendationStore((state) => state.enqueueRecommendation);

    const activeTab = useContextStore((state) => state.activeTab);
    const currentStage = useContextStore((state) => state.currentStage);
    const activeTabLabel = getTabLabel(activeTab || 'document');

    const quickPrompts = [
        '基于当前页面，提醒我下一步最重要的行动。',
        '请检查我当前思路可能缺少什么证据或反例。',
        '把这个问题转成适合小组讨论的一个聚焦问题。',
    ];

    const handleImageUpload = async (file?: File) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setError('请选择图片文件。');
            return;
        }
        if (file.size > MAX_FLOATING_IMAGE_BYTES) {
            setError('图片过大，请压缩到 10MB 以内。');
            return;
        }

        setUploading(true);
        setError(null);
        try {
            const resource = await storageService.uploadResourceFile({
                file,
                project_id: projectId,
                source_type: 'chat_attachment',
            });
            setPendingImage({
                name: file.name,
                size: file.size,
                url: storageService.getResourceViewUrl(resource.id),
                resourceId: resource.id,
            });
        } catch (err) {
            console.error('Floating AI image upload failed:', err);
            setError('图片上传失败，请检查网络后重试。');
        } finally {
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleSend = async (content = input) => {
        const selectedText = getSelectedText();
        const imagePrompt = pendingImage
            ? `\n\n![${pendingImage.name}](${pendingImage.url})\n图片附件：${pendingImage.name}。如果无法直接识别图片，请提示我补充图片中的关键信息。`
            : '';
        const prompt = `${content.trim()}${imagePrompt}`.trim();
        if (!prompt || isStreaming) return;

        const userMessage: FloatingMessage = {
            id: `floating-user-${Date.now()}`,
            role: 'user',
            content: prompt,
        };
        const assistantId = `floating-assistant-${Date.now() + 1}`;
        setMessages((prev) => [
            ...prev,
            userMessage,
            { id: assistantId, role: 'assistant', content: '' },
        ]);
        setInput('');
        setPendingImage(null);
        setIsStreaming(true);
        setError(null);
        setProcessingSummary(['正在读取当前页面与任务阶段', '正在组织简短学习建议']);
        rawContentRef.current = '';

        trackingService.trackResearchEvent({
            project_id: projectId,
            experiment_version_id: experimentVersion?.version_name,
            actor_type: 'student',
            event_domain: 'scaffold',
            event_type: 'floating_ai_request',
            stage_id: currentStage || undefined,
            payload: {
                active_tab: activeTab,
                context_source: 'floating_ai',
                has_selected_text: Boolean(selectedText),
                has_image_attachment: Boolean(pendingImage),
                image_resource_id: pendingImage?.resourceId,
            },
        });

        try {
            await aiService.streamChat({
                project_id: projectId,
                role_id: 'default-tutor',
                message: prompt,
                current_stage: currentStage || undefined,
                enabled_rule_set: experimentVersion?.enabled_rule_set || undefined,
                enabled_scaffold_roles: experimentVersion?.enabled_scaffold_roles || [],
                active_tab: activeTab || undefined,
                selected_text: selectedText || undefined,
                selected_resource_id: pendingImage?.resourceId,
                context_source: 'floating_ai',
            }, {
                onChunk: (_chunk, fullText) => {
                    rawContentRef.current = fullText;
                    const displayText = stripThinkBlocks(fullText);
                    setMessages((prev) => prev.map((message) =>
                        message.id === assistantId ? { ...message, content: displayText } : message
                    ));
                },
                onStatus: (status) => {
                    if (!status.message) return;
                    setProcessingSummary((prev) =>
                        prev.includes(status.message) ? prev : [...prev, status.message]
                    );
                },
                onDone: () => {
                    setProcessingSummary((prev) =>
                        prev.includes('回答生成完成') ? prev : [...prev, '回答生成完成']
                    );
                },
                onError: (streamError) => {
                    setError(streamError.message || 'AI 回应失败，请稍后重试。');
                },
            });
        } catch (err) {
            console.error('Floating AI request failed:', err);
            setError('AI 回应失败，请稍后重试。');
        } finally {
            const finalContent = stripThinkBlocks(rawContentRef.current);
            if (!finalContent) {
                setMessages((prev) => prev.map((message) =>
                    message.id === assistantId ? { ...message, content: '本轮未生成有效回应，请换一种问法再试。' } : message
                ));
            }
            setIsStreaming(false);
        }
    };

    const handleDeepDive = () => {
        const recent = messages.slice(-6).map((message) =>
            `${message.role === 'user' ? '我' : 'AI'}：${message.content}`
        ).join('\n');
        enqueueRecommendation({
            id: `floating-ai-deep-dive-${Date.now()}`,
            target: 'tutor',
            source: 'assistant',
            ruleId: 'floating_ai_transfer',
            ruleType: 'floating_ai_deep_dive',
            ruleName: '浮窗 AI 深入讨论',
            recommendedRole: 'problem_progression',
            prompt: `请基于以下浮窗 AI 对话继续深入分析，并给出我接下来可以执行的 2-3 个步骤：\n\n${recent}`,
            createdAt: new Date().toISOString(),
        });
        onOpenTutor();
        setExpanded(false);
    };

    if (!expanded) {
        return (
            <button
                type="button"
                onClick={() => setExpanded(true)}
                className="absolute bottom-4 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-indigo-600 text-white shadow-xl shadow-indigo-200 transition hover:bg-indigo-700"
                title="AI 助手"
            >
                <Bot className="h-5 w-5" />
            </button>
        );
    }

    return (
        <div className="absolute bottom-4 right-4 z-40 flex h-[560px] max-h-[78vh] w-[400px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-3xl border border-indigo-100 bg-white shadow-2xl shadow-indigo-200/60">
            <div className="flex items-center justify-between border-b border-indigo-50 bg-indigo-50/80 px-4 py-3">
                <div>
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <MessageCircle className="h-4 w-4 text-indigo-600" />
                        AI 助手
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">当前页面：{activeTabLabel}</p>
                </div>
                <button
                    type="button"
                    onClick={() => setExpanded(false)}
                    className="rounded-full p-1.5 text-slate-400 transition hover:bg-white hover:text-slate-700"
                >
                    <ChevronDown className="h-5 w-5" />
                </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {messages.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-indigo-100 bg-indigo-50/40 p-4 text-sm leading-6 text-slate-600">
                        可以先选中页面中的文字，再向我提问。我会结合当前任务阶段、页面位置和选中文本给出短建议。
                    </div>
                ) : (
                    messages.map((message) => (
                        <div
                            key={message.id}
                            className={`rounded-2xl px-3 py-2 text-sm leading-6 ${
                                message.role === 'user'
                                    ? 'ml-10 bg-indigo-600 text-white'
                                    : 'mr-8 border border-slate-100 bg-slate-50 text-slate-800'
                            }`}
                        >
                            {message.role === 'assistant' ? (
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || '正在生成...'}</ReactMarkdown>
                            ) : (
                                message.content
                            )}
                        </div>
                    ))
                )}

                {processingSummary.length > 0 ? (
                    <details className="rounded-2xl border border-slate-100 bg-white px-3 py-2 text-xs text-slate-500">
                        <summary className="cursor-pointer font-semibold text-slate-600">处理摘要</summary>
                        <ul className="mt-2 list-disc space-y-1 pl-4">
                            {processingSummary.slice(-5).map((step, index) => (
                                <li key={`${step}-${index}`}>{step}</li>
                            ))}
                        </ul>
                    </details>
                ) : null}

                {error ? (
                    <div className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs text-rose-700">{error}</div>
                ) : null}
            </div>

            <div className="border-t border-slate-100 bg-white p-3">
                {messages.length === 0 ? (
                    <div className="mb-2 flex flex-wrap gap-2">
                        {quickPrompts.map((prompt) => (
                            <button
                                key={prompt}
                                type="button"
                                onClick={() => handleSend(prompt)}
                                disabled={isStreaming}
                                className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                            >
                                {prompt}
                            </button>
                        ))}
                    </div>
                ) : null}

                {pendingImage ? (
                    <div className="mb-2 flex items-center justify-between rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
                        <span className="truncate">{pendingImage.name}</span>
                        <button type="button" onClick={() => setPendingImage(null)} className="rounded-full p-1 hover:bg-white">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                ) : null}

                <div className="flex items-center gap-2">
                    <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        accept="image/*"
                        onChange={(event) => handleImageUpload(event.target.files?.[0])}
                    />
                    <button
                        type="button"
                        disabled={uploading || isStreaming}
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                        {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImageIcon className="h-5 w-5" />}
                    </button>
                    <input
                        value={input}
                        onChange={(event) => setInput(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                handleSend();
                            }
                        }}
                        disabled={isStreaming}
                        placeholder="结合当前页面提问..."
                        className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
                    />
                    <button
                        type="button"
                        onClick={() => handleSend()}
                        disabled={isStreaming || (!input.trim() && !pendingImage)}
                        className="rounded-xl bg-indigo-600 p-2 text-white transition hover:bg-indigo-700 disabled:bg-slate-300"
                    >
                        {isStreaming ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
                    </button>
                </div>

                {messages.length > 1 ? (
                    <button
                        type="button"
                        onClick={handleDeepDive}
                        className="mt-2 w-full rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-200"
                    >
                        到 AI 对话继续深入
                    </button>
                ) : null}
            </div>
        </div>
    );
}
