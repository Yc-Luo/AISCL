import { useState, useEffect, useCallback } from 'react'
import {
    Settings,
    Key,
    Cpu,
    HardDrive,
    FileText,
    Users,
    History,
    Save,
    RotateCcw,
    ShieldCheck,
    Loader2,
    CheckCircle2,
    AlertCircle,
    Plus,
    Trash2,
    Globe,
    Cpu as ModelIcon,
    FileSearch
} from 'lucide-react'
import { Button, Input } from '../../../ui'
import { adminService, ModelConfigTestResult } from '../../../../services/api/admin'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from '../../../ui/dialog'

type CustomModelConfig = {
    id: string
    name: string
    provider: string
    url: string
    key: string
    usage?: string
}

type RoleModelAssignments = Record<string, string>

const MASKED_SECRET_VALUE = '********'

const ROLE_BINDINGS = [
    { key: 'default_chat', label: '默认聊天模型', hint: '对照组/普通 AI 对话使用' },
    { key: 'group_multi_agent', label: '小组多智能体默认模型', hint: '小组聊天 @AI 时的默认模型' },
    { key: 'tutor_multi_agent', label: 'AI 导师模型', hint: '学生个人 AI 对话使用' },
    { key: 'langgraph_supervisor', label: 'LangGraph 监督者', hint: '全局路由、监督与复杂决策' },
    { key: 'orchestration_planner', label: '编排规划器', hint: '阶段、意图、协作模式规划' },
    { key: 'routing_decision', label: '路由决策者', hint: '选择角色、判断触发来源' },
    { key: 'retrieval_planner', label: '检索规划器', hint: '判断是否检索资料/Wiki/任务说明' },
    { key: 'answer_synthesizer', label: '回答综合器', hint: '多角色结果整合与最终表达' },
    { key: 'auto_prompt_policy', label: '自动提示策略', hint: '群聊自动提示触发判断' },
    { key: 'group_memory_summarizer', label: '小组记忆摘要器', hint: '阶段记忆、小组状态与滚动摘要' },
    { key: 'problem_progressor', label: '问题推进者', hint: '澄清焦点、切分下一步' },
    { key: 'evidence_researcher', label: '资料研究员', hint: '资料线索、证据标准、来源判断' },
    { key: 'viewpoint_challenger', label: '观点挑战者', hint: '反例、替代解释、逻辑漏洞' },
    { key: 'feedback_prompter', label: '反馈追问者', hint: '依据、表达、推理链、修订方向' },
]

const ROLE_RECOMMENDATIONS: Record<string, string> = {
    default_chat: '建议使用稳定、成本可控的通用对话模型，保持对照组体验一致。',
    group_multi_agent: '建议先跟随系统默认模型，避免小组可见回答风格过度分裂。',
    tutor_multi_agent: '建议使用稳定通用模型；个人导师不宜比小组支架强太多，以免替学生完成任务。',
    langgraph_supervisor: '建议配置推理能力更强、上下文较长的模型，负责复杂路由和全局判断。',
    orchestration_planner: '建议跟随 LangGraph 监督者或系统默认；当前主要由规则矩阵约束，不必单独使用昂贵模型。',
    routing_decision: '建议使用快速稳定模型或跟随默认，降低自动提示和路由延迟。',
    retrieval_planner: '建议使用快速稳定模型；它只判断是否检索资料、Wiki 和任务说明。',
    answer_synthesizer: '建议使用表达稳定、上下文较长的模型，用来把多角色输出整合为一条学生可读支架。',
    auto_prompt_policy: '建议使用低延迟模型；自动提示策略更重触发准确性和并发稳定性。',
    group_memory_summarizer: '建议使用低温、长上下文、稳定模型；它负责压缩小组态势，避免记忆膨胀和腐烂。',
    problem_progressor: '建议跟随小组多智能体默认模型，保持亲和、清晰和行动导向。',
    evidence_researcher: '建议使用可靠的通用或检索友好模型，重点是来源判断和证据标准。',
    viewpoint_challenger: '可配置推理能力稍强的模型，但需观察是否过度尖锐或输出过长。',
    feedback_prompter: '建议使用表达稳定模型，重点是温和追问、修订方向和同伴协作。',
}

const ROLE_GROUP_RECOMMENDATIONS = [
    '先只给 LangGraph 监督者、回答综合器、小组记忆摘要器配置更强或更稳的模型。',
    '四个学生可见角色初期建议共用同一个稳定模型，避免同一小组里语气和判断标准混乱。',
    '自动提示策略和路由决策者优先低延迟，复杂推理交给监督者和回答综合器。',
    '新增模型必须测试通过后再加入模型池；上线后先观察失败率、平均延迟和学生端可读性。',
]

const safeJsonParse = <T,>(value: string, fallback: T): T => {
    try {
        return JSON.parse(value) as T
    } catch {
        return fallback
    }
}

const DEFAULT_CONFIG_VALUES = {
    llmProvider: 'openai_compatible',
    llmKey: '',
    llmKeyPool: '',
    llmBaseUrl: 'https://api.minimaxi.com/v1',
    llmModel: 'gpt-4o',
    llmMaxConcurrentRequests: '8',
    llmKeyCooldownSeconds: '60',
    llmRoleModelMap: '{}',
    embeddingProvider: 'minimax',
    embeddingKey: '',
    embeddingBaseUrl: 'https://api.minimax.chat/v1/embeddings',
    embeddingModel: 'embo-01',
    embeddingType: 'db',
    embeddingGroupId: '',
    embeddingDimensions: '',
    webSearchEnabled: 'false',
    webSearchProvider: 'searxng',
    webSearchKey: '',
    webSearchBaseUrl: '',
    webSearchMaxResults: '3',
    documentParseProvider: 'none',
    mineruApiToken: '',
    mineruBaseUrl: 'https://mineru.net',
    mineruModelVersion: 'vlm',
    mineruEnableTable: 'true',
    mineruEnableFormula: 'true',
    mineruIsOcr: 'false',
    mineruLanguage: 'ch',
    storageQuota: 5,
    fileLimit: 50,
    memberLimit: 5,
    dataRetention: 365,
    modelPricing: '{}',
    collaborationOptimizationMode: 'active',
    collaborationOptimizationVersion: 'opt-v1',
    memoryStaleAfterDays: '14',
    memoryPromptObjectLimit: '8',
    scaffoldFollowupWindowMinutes: '30',
}

type ConfigValues = typeof DEFAULT_CONFIG_VALUES

const getErrorMessage = (error: unknown, fallback: string) => {
    const possible = error as { response?: { data?: { detail?: string } }; message?: string }
    return possible.response?.data?.detail || possible.message || fallback
}

export default function SystemConfig() {
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [isSavingLLM, setIsSavingLLM] = useState(false)
    const [isSavingEmbedding, setIsSavingEmbedding] = useState(false)
    const [isSavingWebSearch, setIsSavingWebSearch] = useState(false)
    const [isSavingDocumentParse, setIsSavingDocumentParse] = useState(false)
    const [isSavingCollaborationOptimization, setIsSavingCollaborationOptimization] = useState(false)
    const [isTestingLLM, setIsTestingLLM] = useState(false)
    const [isTestingEmbedding, setIsTestingEmbedding] = useState(false)
    const [isTestingWebSearch, setIsTestingWebSearch] = useState(false)
    const [isTestingDocumentParse, setIsTestingDocumentParse] = useState(false)
    const [isTestingTempModel, setIsTestingTempModel] = useState(false)
    const [llmTestResult, setLlmTestResult] = useState<ModelConfigTestResult | null>(null)
    const [embeddingTestResult, setEmbeddingTestResult] = useState<ModelConfigTestResult | null>(null)
    const [webSearchTestResult, setWebSearchTestResult] = useState<ModelConfigTestResult | null>(null)
    const [documentParseTestResult, setDocumentParseTestResult] = useState<ModelConfigTestResult | null>(null)
    const [tempModelTestResult, setTempModelTestResult] = useState<ModelConfigTestResult | null>(null)

    // Mapping keys to local state for easier UI handling
    const [configValues, setConfigValues] = useState<ConfigValues>({ ...DEFAULT_CONFIG_VALUES })

    const [customModels, setCustomModels] = useState<CustomModelConfig[]>([])
    const [roleModelAssignments, setRoleModelAssignments] = useState<RoleModelAssignments>({})
    const [isModelModalOpen, setIsModelModalOpen] = useState(false)
    const [tempModel, setTempModel] = useState<CustomModelConfig>({
        id: '',
        name: '',
        provider: 'openai_compatible',
        url: '',
        key: '',
        usage: 'general',
    })

    const [notice, setNotice] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        type: 'success' | 'error';
    }>({
        isOpen: false,
        title: '',
        message: '',
        type: 'success'
    })

    const fetchConfigs = useCallback(async () => {
        try {
            setIsLoading(true)
            const data = await adminService.getConfigs()

            // Sync data to state
            const newValues = { ...DEFAULT_CONFIG_VALUES }
            data.forEach(c => {
                if (c.key === 'llm_provider') newValues.llmProvider = c.value
                if (c.key === 'llm_key') newValues.llmKey = c.value
                if (c.key === 'llm_key_pool') newValues.llmKeyPool = c.value
                if (c.key === 'llm_base_url') newValues.llmBaseUrl = c.value
                if (c.key === 'llm_model') newValues.llmModel = c.value
                if (c.key === 'llm_max_concurrent_requests') newValues.llmMaxConcurrentRequests = c.value
                if (c.key === 'llm_key_cooldown_seconds') newValues.llmKeyCooldownSeconds = c.value
                if (c.key === 'llm_role_model_map') {
                    newValues.llmRoleModelMap = c.value || '{}'
                    setRoleModelAssignments(safeJsonParse<RoleModelAssignments>(c.value || '{}', {}))
                }
                if (c.key === 'embedding_provider') newValues.embeddingProvider = c.value
                if (c.key === 'embedding_key') newValues.embeddingKey = c.value
                if (c.key === 'embedding_base_url') newValues.embeddingBaseUrl = c.value
                if (c.key === 'embedding_model') newValues.embeddingModel = c.value
                if (c.key === 'embedding_type') newValues.embeddingType = c.value
                if (c.key === 'embedding_group_id') newValues.embeddingGroupId = c.value
                if (c.key === 'embedding_dimensions') newValues.embeddingDimensions = c.value
                if (c.key === 'web_search_enabled') newValues.webSearchEnabled = c.value
                if (c.key === 'web_search_provider') newValues.webSearchProvider = c.value
                if (c.key === 'web_search_key') newValues.webSearchKey = c.value
                if (c.key === 'web_search_base_url') newValues.webSearchBaseUrl = c.value
                if (c.key === 'web_search_max_results') newValues.webSearchMaxResults = c.value
                if (c.key === 'document_parse_provider') newValues.documentParseProvider = c.value
                if (c.key === 'mineru_api_token') newValues.mineruApiToken = c.value
                if (c.key === 'mineru_base_url') newValues.mineruBaseUrl = c.value
                if (c.key === 'mineru_model_version') newValues.mineruModelVersion = c.value
                if (c.key === 'mineru_enable_table') newValues.mineruEnableTable = c.value
                if (c.key === 'mineru_enable_formula') newValues.mineruEnableFormula = c.value
                if (c.key === 'mineru_is_ocr') newValues.mineruIsOcr = c.value
                if (c.key === 'mineru_language') newValues.mineruLanguage = c.value
                if (c.key === 'storage_quota') newValues.storageQuota = Number(c.value)
                if (c.key === 'file_limit') newValues.fileLimit = Number(c.value)
                if (c.key === 'member_limit') newValues.memberLimit = Number(c.value)
                if (c.key === 'data_retention') newValues.dataRetention = Number(c.value)
                if (c.key === 'model_pricing') newValues.modelPricing = c.value
                if (c.key === 'collaboration_optimization_mode') newValues.collaborationOptimizationMode = c.value
                if (c.key === 'collaboration_optimization_version') newValues.collaborationOptimizationVersion = c.value
                if (c.key === 'memory_stale_after_days') newValues.memoryStaleAfterDays = c.value
                if (c.key === 'memory_prompt_object_limit') newValues.memoryPromptObjectLimit = c.value
                if (c.key === 'scaffold_followup_window_minutes') newValues.scaffoldFollowupWindowMinutes = c.value
                if (c.key === 'user_custom_models') {
                    try {
                        setCustomModels(JSON.parse(c.value))
                    } catch (e) {
                        setCustomModels([])
                    }
                }
            })
            setConfigValues(newValues)
        } catch (error) {
            console.error('Failed to fetch configs:', error)
        } finally {
            setIsLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchConfigs()
    }, [fetchConfigs])

    const handleChange = <K extends keyof ConfigValues>(field: K, value: ConfigValues[K]) => {
        setConfigValues(prev => ({ ...prev, [field]: value }))
    }

    const hasConfiguredValue = (value: unknown) => {
        return typeof value === 'string' && value.trim().length > 0
    }

    const getEffectiveRoleModelMap = () => {
        const cleanEntries = Object.entries(roleModelAssignments)
            .filter(([, modelId]) => modelId && modelId !== 'follow_system_default')
        return Object.fromEntries(cleanEntries)
    }

    const getModelOptions = () => {
        const base = [
            { id: 'follow_system_default', name: '跟随系统默认模型' },
            { id: configValues.llmModel, name: `系统默认：${configValues.llmModel}` },
        ].filter((item, index, array) => item.id && array.findIndex((next) => next.id === item.id) === index)
        const custom = customModels.map((model) => ({ id: model.id, name: model.name || model.id }))
        return [...base, ...custom]
    }

    const updateTempModel = (next: Partial<CustomModelConfig>) => {
        setTempModel((previous) => ({ ...previous, ...next }))
        setTempModelTestResult(null)
    }

    const validateRuntimeConfig = () => {
        const concurrent = Number(configValues.llmMaxConcurrentRequests)
        const cooldown = Number(configValues.llmKeyCooldownSeconds)
        if (!Number.isInteger(concurrent) || concurrent < 1 || concurrent > 64) {
            return 'LLM 并发数需要是 1-64 之间的整数。'
        }
        if (!Number.isInteger(cooldown) || cooldown < 1 || cooldown > 3600) {
            return 'API Key 冷却时间需要是 1-3600 秒之间的整数。'
        }
        const ids = new Set<string>()
        for (const model of customModels) {
            if (!model.id.trim() || !model.name.trim()) return '模型池中的每个模型都需要填写名称和模型 ID。'
            if (ids.has(model.id.trim())) return `模型 ID 重复：${model.id}`
            ids.add(model.id.trim())
            if (model.provider !== 'ollama' && !model.url.trim()) return `模型 ${model.name || model.id} 需要填写 Base URL。`
            if (!model.key.trim() && model.key !== MASKED_SECRET_VALUE && model.provider !== 'ollama') return `模型 ${model.name || model.id} 需要填写 API Key。`
        }
        return null
    }

    const validateCollaborationOptimizationConfig = () => {
        const allowedModes = new Set(['off', 'shadow', 'active', 'review'])
        if (!allowedModes.has(configValues.collaborationOptimizationMode)) {
            return '协作优化模式只能选择关闭、影子观察、启用或人工评审。'
        }
        if (!configValues.collaborationOptimizationVersion.trim()) {
            return '策略版本号不能为空。'
        }
        const staleDays = Number(configValues.memoryStaleAfterDays)
        const objectLimit = Number(configValues.memoryPromptObjectLimit)
        const followupWindow = Number(configValues.scaffoldFollowupWindowMinutes)
        if (!Number.isInteger(staleDays) || staleDays < 1 || staleDays > 90) {
            return '记忆过期天数需要是 1-90 之间的整数。'
        }
        if (!Number.isInteger(objectLimit) || objectLimit < 1 || objectLimit > 20) {
            return '每次读取对象数需要是 1-20 之间的整数。'
        }
        if (!Number.isInteger(followupWindow) || followupWindow < 5 || followupWindow > 120) {
            return '支架跟进窗口需要是 5-120 分钟之间的整数。'
        }
        return null
    }

    const buildCollaborationOptimizationUpdates = () => [
        adminService.updateConfig('collaboration_optimization_mode', configValues.collaborationOptimizationMode, 'Experimental collaboration optimization mode'),
        adminService.updateConfig('collaboration_optimization_version', configValues.collaborationOptimizationVersion.trim(), 'Collaboration optimization policy version'),
        adminService.updateConfig('memory_stale_after_days', configValues.memoryStaleAfterDays, 'Days before proposed or active learning objects become stale'),
        adminService.updateConfig('memory_prompt_object_limit', configValues.memoryPromptObjectLimit, 'Maximum learning objects inserted into one AI prompt'),
        adminService.updateConfig('scaffold_followup_window_minutes', configValues.scaffoldFollowupWindowMinutes, 'Minutes to observe student follow-up after an AI scaffold'),
    ]

    const buildLLMConfigUpdates = () => {
        const roleMap = getEffectiveRoleModelMap()
        const normalizedModels = customModels.map((model) => ({
            id: model.id.trim(),
            name: model.name.trim(),
            provider: model.provider.trim() || 'openai_compatible',
            url: model.url.trim(),
            base_url: model.url.trim(),
            key: model.key,
            usage: model.usage || 'general',
        }))
        return [
            adminService.updateConfig('llm_provider', configValues.llmProvider, 'LLM provider type'),
            adminService.updateConfig('llm_key', configValues.llmKey, 'LLM API Authorization Key'),
            adminService.updateConfig('llm_key_pool', configValues.llmKeyPool, 'Comma-separated LLM API key pool'),
            adminService.updateConfig('llm_base_url', configValues.llmBaseUrl, 'LLM API base URL'),
            adminService.updateConfig('llm_model', configValues.llmModel, 'Default LLM model'),
            adminService.updateConfig('llm_max_concurrent_requests', configValues.llmMaxConcurrentRequests, 'Max concurrent LLM calls per backend process'),
            adminService.updateConfig('llm_key_cooldown_seconds', configValues.llmKeyCooldownSeconds, 'Cooldown seconds for failed or rate-limited LLM API keys'),
            adminService.updateConfig('llm_role_model_map', JSON.stringify(roleMap), 'Role-specific LLM model binding map'),
            adminService.updateConfig('user_custom_models', JSON.stringify(normalizedModels), 'User defined LLM models'),
        ]
    }

    const formatTestSummary = (result: ModelConfigTestResult) => {
        if (!result) return ''
        if (result.success) {
            if (result.service === 'embedding') {
                return `测试成功，返回 ${result.vector_dimensions ?? '-'} 维向量，耗时 ${result.latency_ms ?? '-'} ms。`
            }
            if (result.service === 'web_search') {
                return `测试成功，返回 ${result.result_count ?? '-'} 条搜索结果，耗时 ${result.latency_ms ?? '-'} ms。`
            }
            if (result.service === 'document_parse') {
                return `测试成功，MinerU 服务可访问，耗时 ${result.latency_ms ?? '-'} ms。`
            }
            return `测试成功，模型返回 ${result.response_preview || '有效响应'}，耗时 ${result.latency_ms ?? '-'} ms。`
        }
        return `测试失败：${result.error || '未知错误'}`
    }

    const renderTestResult = (result: ModelConfigTestResult | null) => {
        if (!result) return null
        return (
            <div className={`rounded-xl border p-3 text-xs leading-relaxed ${result.success
                ? 'border-emerald-100 bg-emerald-50 text-emerald-800'
                : 'border-rose-100 bg-rose-50 text-rose-800'
                }`}>
                <div className="flex items-center gap-2 font-bold">
                    {result.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    {result.success ? '连通性测试通过' : '连通性测试未通过'}
                </div>
                <p className="mt-1">{formatTestSummary(result)}</p>
                <p className="mt-1 opacity-80">
                    当前测试配置：provider={result.config?.provider || '-'}，model={result.config?.model || '-'}，base_url={result.config?.base_url || '-'}。
                    {result.config?.enabled !== undefined ? ` enabled=${result.config.enabled}` : ''}
                </p>
            </div>
        )
    }

    const handleTestLLM = async () => {
        const validationError = validateRuntimeConfig()
        if (validationError) {
            setLlmTestResult({ success: false, service: 'llm', error: validationError })
            return
        }
        try {
            setIsTestingLLM(true)
            setIsSavingLLM(true)
            setLlmTestResult(null)
            await Promise.all(buildLLMConfigUpdates())
            const result = await adminService.testLLMConfig()
            setLlmTestResult(result)
        } catch (error: unknown) {
            console.error('Failed to test LLM config:', error)
            setLlmTestResult({
                success: false,
                service: 'llm',
                error: getErrorMessage(error, '请求测试接口失败')
            })
        } finally {
            setIsTestingLLM(false)
            setIsSavingLLM(false)
        }
    }

    const handleTestEmbedding = async () => {
        try {
            setIsTestingEmbedding(true)
            setIsSavingEmbedding(true)
            setEmbeddingTestResult(null)
            await Promise.all([
                adminService.updateConfig('embedding_provider', configValues.embeddingProvider, 'Embedding provider type for RAG and Wiki retrieval'),
                adminService.updateConfig('embedding_key', configValues.embeddingKey, 'Embedding API Authorization Key'),
                adminService.updateConfig('embedding_base_url', configValues.embeddingBaseUrl, 'Embedding API base URL'),
                adminService.updateConfig('embedding_model', configValues.embeddingModel, 'Embedding model ID'),
                adminService.updateConfig('embedding_type', configValues.embeddingType, 'Embedding request type or purpose'),
                adminService.updateConfig('embedding_group_id', configValues.embeddingGroupId, 'MiniMax embedding group id'),
                adminService.updateConfig('embedding_dimensions', configValues.embeddingDimensions, 'Embedding vector dimensions'),
            ])
            const result = await adminService.testEmbeddingConfig()
            setEmbeddingTestResult(result)
        } catch (error: unknown) {
            console.error('Failed to test embedding config:', error)
            setEmbeddingTestResult({
                success: false,
                service: 'embedding',
                error: getErrorMessage(error, '请求测试接口失败')
            })
        } finally {
            setIsTestingEmbedding(false)
            setIsSavingEmbedding(false)
        }
    }

    const handleTestWebSearch = async () => {
        try {
            setIsTestingWebSearch(true)
            setIsSavingWebSearch(true)
            setWebSearchTestResult(null)
            await Promise.all([
                adminService.updateConfig('web_search_enabled', configValues.webSearchEnabled, 'Whether RAG may use web search fallback'),
                adminService.updateConfig('web_search_provider', configValues.webSearchProvider, 'Web search provider adapter'),
                adminService.updateConfig('web_search_key', configValues.webSearchKey, 'Web search API key'),
                adminService.updateConfig('web_search_base_url', configValues.webSearchBaseUrl, 'Web search API base URL'),
                adminService.updateConfig('web_search_max_results', configValues.webSearchMaxResults, 'Maximum web results per AI request'),
            ])
            const result = await adminService.testWebSearchConfig()
            setWebSearchTestResult(result)
        } catch (error: unknown) {
            console.error('Failed to test web search config:', error)
            setWebSearchTestResult({
                success: false,
                service: 'web_search',
                error: getErrorMessage(error, '请求测试接口失败')
            })
        } finally {
            setIsTestingWebSearch(false)
            setIsSavingWebSearch(false)
        }
    }

    const handleTestDocumentParse = async () => {
        try {
            setIsTestingDocumentParse(true)
            setIsSavingDocumentParse(true)
            setDocumentParseTestResult(null)
            await Promise.all([
                adminService.updateConfig('document_parse_provider', configValues.documentParseProvider, 'Document parser provider'),
                adminService.updateConfig('mineru_api_token', configValues.mineruApiToken, 'MinerU API token'),
                adminService.updateConfig('mineru_base_url', configValues.mineruBaseUrl, 'MinerU API base URL'),
                adminService.updateConfig('mineru_model_version', configValues.mineruModelVersion, 'MinerU model version'),
                adminService.updateConfig('mineru_enable_table', configValues.mineruEnableTable, 'MinerU table parsing switch'),
                adminService.updateConfig('mineru_enable_formula', configValues.mineruEnableFormula, 'MinerU formula parsing switch'),
                adminService.updateConfig('mineru_is_ocr', configValues.mineruIsOcr, 'MinerU OCR switch'),
                adminService.updateConfig('mineru_language', configValues.mineruLanguage, 'MinerU language'),
            ])
            const result = await adminService.testDocumentParseConfig()
            setDocumentParseTestResult(result)
        } catch (error: unknown) {
            console.error('Failed to test document parser config:', error)
            setDocumentParseTestResult({
                success: false,
                service: 'document_parse',
                error: getErrorMessage(error, '请求测试接口失败')
            })
        } finally {
            setIsTestingDocumentParse(false)
            setIsSavingDocumentParse(false)
        }
    }

    const handleSave = async () => {
        const validationError = validateRuntimeConfig()
        if (validationError) {
            setNotice({
                isOpen: true,
                title: '配置校验未通过',
                message: validationError,
                type: 'error'
            })
            return
        }
        const collaborationValidationError = validateCollaborationOptimizationConfig()
        if (collaborationValidationError) {
            setNotice({
                isOpen: true,
                title: '协作优化配置校验未通过',
                message: collaborationValidationError,
                type: 'error'
            })
            return
        }
        try {
            setIsSaving(true)
            await Promise.all([
                ...buildLLMConfigUpdates(),
                adminService.updateConfig('embedding_provider', configValues.embeddingProvider, 'Embedding provider type for RAG and Wiki retrieval'),
                adminService.updateConfig('embedding_key', configValues.embeddingKey, 'Embedding API Authorization Key'),
                adminService.updateConfig('embedding_base_url', configValues.embeddingBaseUrl, 'Embedding API base URL'),
                adminService.updateConfig('embedding_model', configValues.embeddingModel, 'Embedding model ID'),
                adminService.updateConfig('embedding_type', configValues.embeddingType, 'Embedding request type or purpose'),
                adminService.updateConfig('embedding_group_id', configValues.embeddingGroupId, 'MiniMax embedding group id'),
                adminService.updateConfig('embedding_dimensions', configValues.embeddingDimensions, 'Embedding vector dimensions'),
                adminService.updateConfig('web_search_enabled', configValues.webSearchEnabled, 'Whether RAG may use web search fallback'),
                adminService.updateConfig('web_search_provider', configValues.webSearchProvider, 'Web search provider adapter'),
                adminService.updateConfig('web_search_key', configValues.webSearchKey, 'Web search API key'),
                adminService.updateConfig('web_search_base_url', configValues.webSearchBaseUrl, 'Web search API base URL'),
                adminService.updateConfig('web_search_max_results', configValues.webSearchMaxResults, 'Maximum web results per AI request'),
                adminService.updateConfig('document_parse_provider', configValues.documentParseProvider, 'Document parser provider'),
                adminService.updateConfig('mineru_api_token', configValues.mineruApiToken, 'MinerU API token'),
                adminService.updateConfig('mineru_base_url', configValues.mineruBaseUrl, 'MinerU API base URL'),
                adminService.updateConfig('mineru_model_version', configValues.mineruModelVersion, 'MinerU model version'),
                adminService.updateConfig('mineru_enable_table', configValues.mineruEnableTable, 'MinerU table parsing switch'),
                adminService.updateConfig('mineru_enable_formula', configValues.mineruEnableFormula, 'MinerU formula parsing switch'),
                adminService.updateConfig('mineru_is_ocr', configValues.mineruIsOcr, 'MinerU OCR switch'),
                adminService.updateConfig('mineru_language', configValues.mineruLanguage, 'MinerU language'),
                adminService.updateConfig('storage_quota', String(configValues.storageQuota), 'Storage quota per project in GB'),
                adminService.updateConfig('file_limit', String(configValues.fileLimit), 'Single file size limit in MB'),
                adminService.updateConfig('member_limit', String(configValues.memberLimit), 'Max members per project'),
                adminService.updateConfig('data_retention', String(configValues.dataRetention), 'Data retention period in days'),
                adminService.updateConfig('model_pricing', configValues.modelPricing, 'Model input/output token pricing map'),
                ...buildCollaborationOptimizationUpdates(),
            ])
            setNotice({
                isOpen: true,
                title: '配置同步成功',
                message: '系统核心参数已成功保存并立即生效。',
                type: 'success'
            })
        } catch (error) {
            console.error('Failed to save configs:', error)
            setNotice({
                isOpen: true,
                title: '同步失败',
                message: '无法将配置写入数据库，请检查网络连接或管理员权限。',
                type: 'error'
            })
        } finally {
            setIsSaving(false)
        }
    }

    const handleSaveLLM = async () => {
        const validationError = validateRuntimeConfig()
        if (validationError) {
            setNotice({
                isOpen: true,
                title: '模型配置校验未通过',
                message: validationError,
                type: 'error'
            })
            return
        }
        try {
            setIsSavingLLM(true)
            await Promise.all(buildLLMConfigUpdates())
            setNotice({
                isOpen: true,
                title: '模型参数已同步',
                message: '模型池、角色绑定、API Key 池和运行时策略已保存。后端启用数据库配置模式后会立即按新配置调用。',
                type: 'success'
            })
        } catch (error) {
            console.error('Failed to save LLM configs:', error)
            setNotice({
                isOpen: true,
                title: '同步失败',
                message: '无法更新大模型配置，请确认管理员权限或 API 状态。',
                type: 'error'
            })
        } finally {
            setIsSavingLLM(false)
        }
    }

    const handleSaveEmbedding = async () => {
        try {
            setIsSavingEmbedding(true)
            await Promise.all([
                adminService.updateConfig('embedding_provider', configValues.embeddingProvider, 'Embedding provider type for RAG and Wiki retrieval'),
                adminService.updateConfig('embedding_key', configValues.embeddingKey, 'Embedding API Authorization Key'),
                adminService.updateConfig('embedding_base_url', configValues.embeddingBaseUrl, 'Embedding API base URL'),
                adminService.updateConfig('embedding_model', configValues.embeddingModel, 'Embedding model ID'),
                adminService.updateConfig('embedding_type', configValues.embeddingType, 'Embedding request type or purpose'),
                adminService.updateConfig('embedding_group_id', configValues.embeddingGroupId, 'MiniMax embedding group id'),
                adminService.updateConfig('embedding_dimensions', configValues.embeddingDimensions, 'Embedding vector dimensions'),
            ])
            setNotice({
                isOpen: true,
                title: 'Embedding 参数已同步',
                message: 'RAG、项目 Wiki 和资源语义检索将使用新的向量模型配置。',
                type: 'success'
            })
        } catch (error) {
            console.error('Failed to save embedding configs:', error)
            setNotice({
                isOpen: true,
                title: '同步失败',
                message: '无法更新 Embedding 配置，请确认管理员权限或 API 状态。',
                type: 'error'
            })
        } finally {
            setIsSavingEmbedding(false)
        }
    }

    const handleSaveWebSearch = async () => {
        try {
            setIsSavingWebSearch(true)
            await Promise.all([
                adminService.updateConfig('web_search_enabled', configValues.webSearchEnabled, 'Whether RAG may use web search fallback'),
                adminService.updateConfig('web_search_provider', configValues.webSearchProvider, 'Web search provider adapter'),
                adminService.updateConfig('web_search_key', configValues.webSearchKey, 'Web search API key'),
                adminService.updateConfig('web_search_base_url', configValues.webSearchBaseUrl, 'Web search API base URL'),
                adminService.updateConfig('web_search_max_results', configValues.webSearchMaxResults, 'Maximum web results per AI request'),
            ])
            setNotice({
                isOpen: true,
                title: '联网搜索配置已同步',
                message: 'RAG 将在本地资料和 Wiki 无命中时按该配置进行受控搜索兜底。',
                type: 'success'
            })
        } catch (error) {
            console.error('Failed to save web search configs:', error)
            setNotice({
                isOpen: true,
                title: '同步失败',
                message: '无法更新联网搜索配置，请确认管理员权限或服务状态。',
                type: 'error'
            })
        } finally {
            setIsSavingWebSearch(false)
        }
    }

    const handleSaveDocumentParse = async () => {
        try {
            setIsSavingDocumentParse(true)
            await Promise.all([
                adminService.updateConfig('document_parse_provider', configValues.documentParseProvider, 'Document parser provider'),
                adminService.updateConfig('mineru_api_token', configValues.mineruApiToken, 'MinerU API token'),
                adminService.updateConfig('mineru_base_url', configValues.mineruBaseUrl, 'MinerU API base URL'),
                adminService.updateConfig('mineru_model_version', configValues.mineruModelVersion, 'MinerU model version'),
                adminService.updateConfig('mineru_enable_table', configValues.mineruEnableTable, 'MinerU table parsing switch'),
                adminService.updateConfig('mineru_enable_formula', configValues.mineruEnableFormula, 'MinerU formula parsing switch'),
                adminService.updateConfig('mineru_is_ocr', configValues.mineruIsOcr, 'MinerU OCR switch'),
                adminService.updateConfig('mineru_language', configValues.mineruLanguage, 'MinerU language'),
            ])
            setNotice({
                isOpen: true,
                title: '文档解析配置已同步',
                message: 'PDF、PPT、Word 等复杂资源上传后将按该配置解析并进入 RAG。',
                type: 'success'
            })
        } catch (error) {
            console.error('Failed to save document parser configs:', error)
            setNotice({
                isOpen: true,
                title: '同步失败',
                message: '无法更新文档解析配置，请确认管理员权限或服务状态。',
                type: 'error'
            })
        } finally {
            setIsSavingDocumentParse(false)
        }
    }

    const handleSaveCollaborationOptimization = async () => {
        const validationError = validateCollaborationOptimizationConfig()
        if (validationError) {
            setNotice({
                isOpen: true,
                title: '协作优化配置校验未通过',
                message: validationError,
                type: 'error'
            })
            return
        }
        try {
            setIsSavingCollaborationOptimization(true)
            await Promise.all(buildCollaborationOptimizationUpdates())
            setNotice({
                isOpen: true,
                title: '协作优化策略已同步',
                message: '实验组记忆读取、策略版本、过期规则和支架跟进窗口已保存。对照组仍保持隔离。',
                type: 'success'
            })
        } catch (error) {
            console.error('Failed to save collaboration optimization configs:', error)
            setNotice({
                isOpen: true,
                title: '同步失败',
                message: '无法更新协作优化配置，请确认管理员权限或稍后重试。',
                type: 'error'
            })
        } finally {
            setIsSavingCollaborationOptimization(false)
        }
    }

    const handleTestTempModel = async () => {
        if (!tempModel.id.trim() || !tempModel.name.trim() || (tempModel.provider !== 'ollama' && (!tempModel.url.trim() || !tempModel.key.trim()))) {
            const result: ModelConfigTestResult = {
                success: false,
                service: 'llm',
                error: '请完整填写模型名称、模型 ID、Base URL 和 API Key',
            }
            setTempModelTestResult(result)
            return result
        }
        if (customModels.some((model) => model.id === tempModel.id.trim())) {
            const result: ModelConfigTestResult = {
                success: false,
                service: 'llm',
                error: '模型 ID 已存在，请使用唯一 ID',
            }
            setTempModelTestResult(result)
            return result
        }
        try {
            setIsTestingTempModel(true)
            setTempModelTestResult(null)
            const result = await adminService.testLLMModelConfig({
                id: tempModel.id.trim(),
                provider: tempModel.provider.trim() || 'openai_compatible',
                base_url: tempModel.url.trim(),
                api_key: tempModel.key,
            })
            setTempModelTestResult(result)
            return result
        } catch (error: unknown) {
            const result: ModelConfigTestResult = {
                success: false,
                service: 'llm',
                error: getErrorMessage(error, '候选模型测试失败'),
            }
            setTempModelTestResult(result)
            return result
        } finally {
            setIsTestingTempModel(false)
        }
    }

    const handleAddCustomModel = async () => {
        const result = await handleTestTempModel()
        if (!result?.success) return
        setCustomModels([...customModels, { ...tempModel, id: tempModel.id.trim(), name: tempModel.name.trim(), url: tempModel.url.trim() }])
        setTempModel({ id: '', name: '', provider: 'openai_compatible', url: '', key: '', usage: 'general' })
        setTempModelTestResult(null)
        setIsModelModalOpen(false)
    }

    const removeCustomModel = (id: string) => {
        setCustomModels(customModels.filter(m => m.id !== id))
        setRoleModelAssignments((previous) => {
            const next = { ...previous }
            Object.entries(next).forEach(([roleKey, modelId]) => {
                if (modelId === id) delete next[roleKey]
            })
            return next
        })
    }

    if (isLoading) {
        return (
            <div className="h-[400px] flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
                    <p className="text-sm text-slate-500 font-medium">正在拉取系统当前参数...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                        <Settings className="w-6 h-6 text-indigo-600" />
                        系统配置
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">配置核心服务参数、资源配额及系统安全首选项</p>
                </div>
                <div className="flex gap-3">
                    <Button variant="outline" className="gap-2" onClick={fetchConfigs} disabled={isSaving}>
                        <RotateCcw className="w-4 h-4" />
                        重置
                    </Button>
                    <Button
                        className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2 shadow-lg shadow-indigo-100"
                        onClick={handleSave}
                        disabled={isSaving}
                    >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {isSaving ? '正在同步...' : '保存更改'}
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Dialogue LLM Config Group */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-6">
                    <div className="flex justify-between items-center border-b border-gray-50 pb-4">
                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <ShieldCheck className="w-5 h-5 text-indigo-600" />
                            对话模型服务 (Chat LLM)
                        </h3>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 text-slate-600 border-slate-200 hover:bg-slate-50 gap-1.5 font-bold"
                                onClick={handleTestLLM}
                                disabled={isTestingLLM || isSavingLLM}
                            >
                                {isTestingLLM ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                保存并测试
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 gap-1.5 font-bold"
                                onClick={handleSaveLLM}
                                disabled={isSavingLLM}
                            >
                                {isSavingLLM ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                同步配置
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                <Globe className="w-4 h-4 text-slate-400" />
                                服务提供方 / 调用格式
                            </label>
                            <Input
                                value={configValues.llmProvider}
                                onChange={(e) => handleChange('llmProvider', e.target.value)}
                                placeholder="如：openai_compatible、openai、deepseek、ollama"
                            />
                            <p className="text-xs text-slate-400 leading-relaxed">
                                SiliconFlow、MiniMax、OpenRouter、通义、智谱等兼容接口建议填写 `openai_compatible`；DeepSeek 官方接口可填写 `deepseek`。
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                <Key className="w-4 h-4 text-slate-400" />
                                API Key
                            </label>
                            <Input
                                type="password"
                                value={configValues.llmKey}
                                onChange={(e) => handleChange('llmKey', e.target.value)}
                                placeholder="如：sk-...；已配置时输入框会显示为密码点"
                            />
                            <p className="text-xs text-slate-400 leading-relaxed">
                                用于 AI 导师、多智能体编排和自动化分析服务。当前状态：
                                <span className={hasConfiguredValue(configValues.llmKey) ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}>
                                    {hasConfiguredValue(configValues.llmKey) ? ' 已填写配置' : ' 尚未填写'}
                                </span>
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                <Key className="w-4 h-4 text-slate-400" />
                                API Key 池（可选）
                            </label>
                            <textarea
                                className="min-h-[86px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                                value={configValues.llmKeyPool}
                                onChange={(e) => handleChange('llmKeyPool', e.target.value)}
                                placeholder="多个 Key 用英文逗号或换行分隔；已配置时会显示为遮罩"
                            />
                            <p className="text-xs text-slate-400 leading-relaxed">
                                后端会按 Key 轮询调用；遇到限流、超时或 5xx 时，该 Key 会短暂冷却后再使用。
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                <Globe className="w-4 h-4 text-slate-400" />
                                API Base URL
                            </label>
                            <Input
                                value={configValues.llmBaseUrl}
                                onChange={(e) => handleChange('llmBaseUrl', e.target.value)}
                                placeholder="如：https://api.siliconflow.cn/v1 或 https://api.minimaxi.com/v1"
                            />
                            <p className="text-xs text-slate-400 leading-relaxed">
                                OpenAI 官方接口可留空；OpenAI 兼容接口请填写服务商 `/v1` 根地址。
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                <Cpu className="w-4 h-4 text-slate-400" />
                                默认模型 ID
                            </label>
                            <Input
                                value={configValues.llmModel}
                                onChange={(e) => handleChange('llmModel', e.target.value)}
                                placeholder="如：Qwen/Qwen3-235B-A22B-Instruct-2507、MiniMax-M2.7、deepseek-chat"
                            />
                            <p className="text-xs text-slate-400 leading-relaxed">
                                按服务商控制台显示的模型 ID 原样填写。已配置时输入框会加载当前模型 ID。
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                    <Cpu className="w-4 h-4 text-slate-400" />
                                    全局 LLM 并发
                                </label>
                                <Input
                                    type="number"
                                    min="1"
                                    max="64"
                                    value={configValues.llmMaxConcurrentRequests}
                                    onChange={(e) => handleChange('llmMaxConcurrentRequests', e.target.value)}
                                />
                                <p className="text-xs text-slate-400 leading-relaxed">
                                    每个后端进程同时调用模型的上限。2 个班建议先用 8-12，配置多个 Key 后可再提高。
                                </p>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                    <History className="w-4 h-4 text-slate-400" />
                                    Key 冷却秒数
                                </label>
                                <Input
                                    type="number"
                                    min="1"
                                    max="3600"
                                    value={configValues.llmKeyCooldownSeconds}
                                    onChange={(e) => handleChange('llmKeyCooldownSeconds', e.target.value)}
                                />
                                <p className="text-xs text-slate-400 leading-relaxed">
                                    某个 Key 限流或超时后暂停使用的时间，默认 60 秒。
                                </p>
                            </div>
                        </div>

                        <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
                            <div>
                                <p className="text-sm font-bold text-slate-800">角色模型分配</p>
                                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                                    先在下方模型池添加并通过测试，再按角色选择。未选择的角色跟随系统默认模型。
                                </p>
                            </div>
                            <div className="rounded-xl border border-amber-100 bg-amber-50/80 p-3 text-xs leading-relaxed text-amber-900">
                                <p className="font-bold">配置建议</p>
                                <div className="mt-1 space-y-1">
                                    {ROLE_GROUP_RECOMMENDATIONS.map((item) => (
                                        <p key={item}>- {item}</p>
                                    ))}
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3">
                                {ROLE_BINDINGS.map((role) => (
                                    <div key={role.key} className="grid grid-cols-[168px_1fr] items-center gap-3">
                                        <div>
                                            <p className="text-xs font-bold text-slate-700">{role.label}</p>
                                            <p className="text-[11px] leading-4 text-slate-400">{role.hint}</p>
                                        </div>
                                        <select
                                            className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                                            value={roleModelAssignments[role.key] || 'follow_system_default'}
                                            onChange={(event) => setRoleModelAssignments((previous) => ({
                                                ...previous,
                                                [role.key]: event.target.value,
                                            }))}
                                        >
                                            {getModelOptions().map((model) => (
                                                <option key={`${role.key}-${model.id}`} value={model.id}>
                                                    {model.name}
                                                </option>
                                            ))}
                                        </select>
                                        <p className="col-start-2 text-[11px] leading-4 text-slate-400">
                                            {ROLE_RECOMMENDATIONS[role.key]}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 text-xs text-indigo-900 space-y-2">
                            <p className="font-bold">填写示例</p>
                            <p>SiliconFlow：provider=openai_compatible，Base URL=https://api.siliconflow.cn/v1，model=Qwen/Qwen3-235B-A22B-Instruct-2507。</p>
                            <p>MiniMax：provider=openai_compatible，Base URL=https://api.minimaxi.com/v1，model=MiniMax-M2.7。</p>
                            <p>DeepSeek：provider=deepseek，Base URL=https://api.deepseek.com，model=deepseek-chat 或 deepseek-reasoner。</p>
                            <p className="text-indigo-800/80">如果服务商使用 OpenAI Chat Completions 兼容协议，通常都填写 `openai_compatible`。</p>
                        </div>
                        {renderTestResult(llmTestResult)}
                    </div>
                </div>

                {/* Embedding Config Group */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-6">
                    <div className="flex justify-between items-center border-b border-gray-50 pb-4">
                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <Cpu className="w-5 h-5 text-emerald-600" />
                            向量模型服务 (Embedding)
                        </h3>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 text-slate-600 border-slate-200 hover:bg-slate-50 gap-1.5 font-bold"
                                onClick={handleTestEmbedding}
                                disabled={isTestingEmbedding || isSavingEmbedding}
                            >
                                {isTestingEmbedding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                保存并测试
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 gap-1.5 font-bold"
                                onClick={handleSaveEmbedding}
                                disabled={isSavingEmbedding}
                            >
                                {isSavingEmbedding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                同步配置
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                <Globe className="w-4 h-4 text-slate-400" />
                                服务提供方 / 调用格式
                            </label>
                            <Input
                                value={configValues.embeddingProvider}
                                onChange={(e) => handleChange('embeddingProvider', e.target.value)}
                                placeholder="如：minimax、openai_compatible、openai"
                            />
                            <p className="text-xs text-slate-400 leading-relaxed">
                                用于决定后端请求格式。当前支持 MiniMax 格式和 OpenAI 兼容 Embedding 格式；不要受下拉选项限制，按服务商文档填写。
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                <Key className="w-4 h-4 text-slate-400" />
                                Embedding API Key
                            </label>
                            <Input
                                type="password"
                                value={configValues.embeddingKey}
                                onChange={(e) => handleChange('embeddingKey', e.target.value)}
                                placeholder="如：sk-...；可填写独立 Embedding Key，留空则回退到 .env 配置"
                            />
                            <p className="text-xs text-slate-400 leading-relaxed">
                                建议与对话模型分开配置，便于分别控制 RAG 检索成本与对话生成成本。
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                <Globe className="w-4 h-4 text-slate-400" />
                                Embedding Base URL
                            </label>
                            <Input
                                value={configValues.embeddingBaseUrl}
                                onChange={(e) => handleChange('embeddingBaseUrl', e.target.value)}
                                placeholder="如：https://api.minimax.chat/v1/embeddings 或 https://api.openai.com/v1"
                            />
                            <p className="text-xs text-slate-400 leading-relaxed">
                                可填写完整 `/embeddings` 地址，也可填写 OpenAI 兼容服务的 `/v1` 根地址，后端会自动补齐 `/embeddings`。
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                    <Cpu className="w-4 h-4 text-slate-400" />
                                    Embedding 模型 ID
                                </label>
                                <Input
                                    value={configValues.embeddingModel}
                                    onChange={(e) => handleChange('embeddingModel', e.target.value)}
                                    placeholder="如：embo-01、text-embedding-3-small"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-slate-400" />
                                    请求类型 / 用途
                                </label>
                                <Input
                                    value={configValues.embeddingType}
                                    onChange={(e) => handleChange('embeddingType', e.target.value)}
                                    placeholder="MiniMax 常用：db；查询时后端会使用 query"
                                />
                                <p className="text-xs text-slate-400 leading-relaxed">
                                    MiniMax 需要区分 `db` 与 `query`；OpenAI 兼容接口通常可留空或保留默认值。
                                </p>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                <HardDrive className="w-4 h-4 text-slate-400" />
                                向量维度（可选）
                            </label>
                            <Input
                                type="number"
                                min="1"
                                value={configValues.embeddingDimensions}
                                onChange={(e) => handleChange('embeddingDimensions', e.target.value)}
                                placeholder="如：1024、1536；不确定可先留空"
                            />
                            <p className="text-xs text-slate-400 leading-relaxed">
                                OpenAI 兼容接口会把该值作为 `dimensions` 参数发送；Qdrant 新建集合时也会优先使用该维度。已有集合维度不会自动改变，换模型后如维度不同需重建集合。
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                <Key className="w-4 h-4 text-slate-400" />
                                Group ID（可选）
                            </label>
                            <Input
                                value={configValues.embeddingGroupId}
                                onChange={(e) => handleChange('embeddingGroupId', e.target.value)}
                                placeholder="MiniMax 需要填写 Group ID；OpenAI 兼容接口通常留空"
                            />
                        </div>

                        <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 text-xs text-emerald-900 space-y-2">
                            <p className="font-bold">填写示例</p>
                            <p>MiniMax：provider=minimax，Base URL=https://api.minimax.chat/v1/embeddings，model=embo-01，type=db，Group ID=你的 MiniMax Group ID。</p>
                            <p>OpenAI 兼容：provider=openai_compatible，Base URL=https://api.openai.com/v1，model=text-embedding-3-small，type 可留空，Group ID 留空。</p>
                            <p>SiliconFlow Qwen3 示例：provider=openai_compatible，Base URL=https://api.siliconflow.cn/v1，model=Qwen/Qwen3-Embedding-4B，dimensions=1024 或 1536。</p>
                            <p className="text-emerald-800/80">注意：更换向量模型时，向量维度必须与 Qdrant collection 的维度一致；如维度不同，需要重建向量集合。</p>
                        </div>
                        {renderTestResult(embeddingTestResult)}
                    </div>
                </div>

                {/* Web Search Config Group */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-6">
                    <div className="flex justify-between items-center border-b border-gray-50 pb-4">
                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <Globe className="w-5 h-5 text-sky-600" />
                            联网搜索兜底（可选）
                        </h3>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 text-slate-600 border-slate-200 hover:bg-slate-50 gap-1.5 font-bold"
                                onClick={handleTestWebSearch}
                                disabled={isTestingWebSearch || isSavingWebSearch}
                            >
                                {isTestingWebSearch ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                保存并测试
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-sky-600 hover:text-sky-700 hover:bg-sky-50 gap-1.5 font-bold"
                                onClick={handleSaveWebSearch}
                                disabled={isSavingWebSearch}
                            >
                                {isSavingWebSearch ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                同步配置
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                    <ShieldCheck className="w-4 h-4 text-slate-400" />
                                    是否启用
                                </label>
                                <Input
                                    value={configValues.webSearchEnabled}
                                    onChange={(e) => handleChange('webSearchEnabled', e.target.value)}
                                    placeholder="true 或 false"
                                />
                                <p className="text-xs text-slate-400 leading-relaxed">
                                    默认 false。启用后，仅在本地资料/Wiki 无命中且不是平台操作问题时使用。
                                </p>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                    <Globe className="w-4 h-4 text-slate-400" />
                                    Provider
                                </label>
                                <Input
                                    value={configValues.webSearchProvider}
                                    onChange={(e) => handleChange('webSearchProvider', e.target.value)}
                                    placeholder="如：searxng、tavily、brave、bing、serpapi"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                <Key className="w-4 h-4 text-slate-400" />
                                Search API Key（可选）
                            </label>
                            <Input
                                type="password"
                                value={configValues.webSearchKey}
                                onChange={(e) => handleChange('webSearchKey', e.target.value)}
                                placeholder="Tavily/Brave/Bing/SerpAPI 需要；自建 SearXNG 通常可留空"
                            />
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                            <div className="col-span-2 space-y-2">
                                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                    <Globe className="w-4 h-4 text-slate-400" />
                                    Search Base URL
                                </label>
                                <Input
                                    value={configValues.webSearchBaseUrl}
                                    onChange={(e) => handleChange('webSearchBaseUrl', e.target.value)}
                                    placeholder="如：https://your-searxng.example.com 或 https://api.tavily.com/search"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-slate-400" />
                                    最大结果数
                                </label>
                                <Input
                                    type="number"
                                    min="1"
                                    max="5"
                                    value={configValues.webSearchMaxResults}
                                    onChange={(e) => handleChange('webSearchMaxResults', e.target.value)}
                                    placeholder="3"
                                />
                            </div>
                        </div>

                        <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-4 text-xs text-sky-900 space-y-2">
                            <p className="font-bold">设计约束</p>
                            <p>联网搜索只作为 RAG 兜底，不替代项目资源库、Wiki 和任务记忆。</p>
                            <p>学习者询问“如何上传、如何提交、Wiki 怎么用”等平台操作问题时，后端会优先使用平台功能知识，不触发搜索。</p>
                            <p>示例：provider=searxng，Base URL=https://your-searxng.example.com；provider=tavily，Base URL=https://api.tavily.com/search。</p>
                        </div>
                        {renderTestResult(webSearchTestResult)}
                    </div>
                </div>

                {/* Document Parse Config Group */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-6">
                    <div className="flex justify-between items-center border-b border-gray-50 pb-4">
                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <FileSearch className="w-5 h-5 text-violet-600" />
                            文档解析服务 (MinerU)
                        </h3>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-8 text-slate-600 border-slate-200 hover:bg-slate-50 gap-1.5 font-bold"
                                onClick={handleTestDocumentParse}
                                disabled={isTestingDocumentParse || isSavingDocumentParse}
                            >
                                {isTestingDocumentParse ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                                保存并测试
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-violet-600 hover:text-violet-700 hover:bg-violet-50 gap-1.5 font-bold"
                                onClick={handleSaveDocumentParse}
                                disabled={isSavingDocumentParse}
                            >
                                {isSavingDocumentParse ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                                同步配置
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                    <FileSearch className="w-4 h-4 text-slate-400" />
                                    解析 Provider
                                </label>
                                <Input
                                    value={configValues.documentParseProvider}
                                    onChange={(e) => handleChange('documentParseProvider', e.target.value)}
                                    placeholder="mineru 或 none"
                                />
                                <p className="text-xs text-slate-400 leading-relaxed">
                                    填写 `mineru` 后，PDF、PPT、Word、Excel 等复杂资源上传后会自动解析并写入 RAG。
                                </p>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                    <Cpu className="w-4 h-4 text-slate-400" />
                                    MinerU 模型版本
                                </label>
                                <Input
                                    value={configValues.mineruModelVersion}
                                    onChange={(e) => handleChange('mineruModelVersion', e.target.value)}
                                    placeholder="vlm 或 pipeline"
                                />
                                <p className="text-xs text-slate-400 leading-relaxed">
                                    复杂版式 PDF 推荐 `vlm`；普通文本型 PDF 可使用 `pipeline`。
                                </p>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                <Key className="w-4 h-4 text-slate-400" />
                                MinerU API Token
                            </label>
                            <Input
                                type="password"
                                value={configValues.mineruApiToken}
                                onChange={(e) => handleChange('mineruApiToken', e.target.value)}
                                placeholder="Bearer Token；已配置时会显示为密码点"
                            />
                            <p className="text-xs text-slate-400 leading-relaxed">
                                Token 仅保存在后端系统配置中，不会返回给学生端或教师端。
                            </p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                <Globe className="w-4 h-4 text-slate-400" />
                                MinerU Base URL
                            </label>
                            <Input
                                value={configValues.mineruBaseUrl}
                                onChange={(e) => handleChange('mineruBaseUrl', e.target.value)}
                                placeholder="https://mineru.net"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700">表格识别</label>
                                <Input value={configValues.mineruEnableTable} onChange={(e) => handleChange('mineruEnableTable', e.target.value)} placeholder="true 或 false" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700">公式识别</label>
                                <Input value={configValues.mineruEnableFormula} onChange={(e) => handleChange('mineruEnableFormula', e.target.value)} placeholder="true 或 false" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700">OCR</label>
                                <Input value={configValues.mineruIsOcr} onChange={(e) => handleChange('mineruIsOcr', e.target.value)} placeholder="扫描件可填 true" />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700">语言</label>
                                <Input value={configValues.mineruLanguage} onChange={(e) => handleChange('mineruLanguage', e.target.value)} placeholder="ch" />
                            </div>
                        </div>

                        <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-4 text-xs text-violet-900 space-y-2">
                            <p className="font-bold">运行方式</p>
                            <p>教师端课程资源和学生端小组资料共用同一解析管线：上传到 MinIO 后，后端生成临时下载 URL 交给 MinerU，完成后保存 Markdown 并写入 Qdrant。</p>
                            <p>资源卡片上的小图标会显示解析状态：等待、解析中、已入库、失败或不支持。</p>
                        </div>
                        {renderTestResult(documentParseTestResult)}
                    </div>
                </div>

                {/* Collaboration Optimization Config Group */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-6">
                    <div className="flex justify-between items-center border-b border-gray-50 pb-4">
                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <ShieldCheck className="w-5 h-5 text-fuchsia-600" />
                            协作优化与记忆策略
                        </h3>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 text-fuchsia-600 hover:text-fuchsia-700 hover:bg-fuchsia-50 gap-1.5 font-bold"
                            onClick={handleSaveCollaborationOptimization}
                            disabled={isSavingCollaborationOptimization}
                        >
                            {isSavingCollaborationOptimization ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            同步配置
                        </Button>
                    </div>

                    <div className="space-y-4">
                        <div className="rounded-xl border border-fuchsia-100 bg-fuchsia-50/60 p-4 text-xs text-fuchsia-900 space-y-2">
                            <p className="font-bold">作用范围</p>
                            <p>仅作用于实验组的多智能体支架。对照组仍保持直接 LLM 回复，不读取共同学习对象记忆、支架回合记忆或协作优化提示。</p>
                            <p>策略版本会写入支架回合和学习对象记忆，便于后续比较不同优化版本的效果。</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                    <ShieldCheck className="w-4 h-4 text-slate-400" />
                                    优化模式
                                </label>
                                <select
                                    className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                                    value={configValues.collaborationOptimizationMode}
                                    onChange={(event) => handleChange('collaborationOptimizationMode', event.target.value)}
                                >
                                    <option value="active">启用：提示进入 AI 上下文</option>
                                    <option value="shadow">影子观察：只记录不影响回复</option>
                                    <option value="review">人工评审：保留策略版本但暂不注入</option>
                                    <option value="off">关闭：不生成优化提示</option>
                                </select>
                                <p className="text-xs text-slate-400 leading-relaxed">
                                    首次上线新策略可先用影子观察，确认触发合理后再切到启用。
                                </p>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                    <History className="w-4 h-4 text-slate-400" />
                                    策略版本号
                                </label>
                                <Input
                                    value={configValues.collaborationOptimizationVersion}
                                    onChange={(e) => handleChange('collaborationOptimizationVersion', e.target.value)}
                                    placeholder="如：opt-v1、opt-v2"
                                />
                                <p className="text-xs text-slate-400 leading-relaxed">
                                    建议每次明显改动触发规则或记忆读取方式时更新版本号。
                                </p>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700">记忆过期天数</label>
                                <Input
                                    type="number"
                                    min="1"
                                    max="90"
                                    value={configValues.memoryStaleAfterDays}
                                    onChange={(e) => handleChange('memoryStaleAfterDays', e.target.value)}
                                />
                                <p className="text-xs text-slate-400 leading-relaxed">
                                    超期的待确认/讨论中记忆会标记为过期，不删除原始证据。
                                </p>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700">每次读取对象数</label>
                                <Input
                                    type="number"
                                    min="1"
                                    max="20"
                                    value={configValues.memoryPromptObjectLimit}
                                    onChange={(e) => handleChange('memoryPromptObjectLimit', e.target.value)}
                                />
                                <p className="text-xs text-slate-400 leading-relaxed">
                                    控制进入一次 AI 回复的共同学习对象数量，避免上下文膨胀。
                                </p>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700">跟进窗口（分钟）</label>
                                <Input
                                    type="number"
                                    min="5"
                                    max="120"
                                    value={configValues.scaffoldFollowupWindowMinutes}
                                    onChange={(e) => handleChange('scaffoldFollowupWindowMinutes', e.target.value)}
                                />
                                <p className="text-xs text-slate-400 leading-relaxed">
                                    AI 支架后在该时间内记录学生讨论、修订、上传等回应。
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Custom Models Management */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-6">
                    <div className="flex justify-between items-center border-b border-gray-50 pb-4">
                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <ModelIcon className="w-5 h-5 text-indigo-600" />
                            LLM 模型池
                        </h3>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1 text-indigo-600 border-indigo-100 hover:bg-indigo-50"
                            onClick={() => setIsModelModalOpen(true)}
                        >
                            <Plus className="w-3 h-3" />
                            添加模型
                        </Button>
                    </div>

                    <div className="space-y-3 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                        {customModels.length === 0 ? (
                            <div className="py-8 text-center border-2 border-dashed border-slate-50 rounded-xl">
                                <p className="text-xs text-slate-400 font-medium">暂无模型池配置，点击上方按钮添加</p>
                            </div>
                        ) : (
                            customModels.map((m) => (
                                <div key={m.id} className="group p-3 bg-slate-50 hover:bg-white hover:ring-1 hover:ring-indigo-100 rounded-xl transition-all flex items-center justify-between border border-transparent">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm text-indigo-500">
                                            <Globe className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-bold text-slate-700">{m.name}</p>
                                            <p className="text-[10px] text-slate-400 font-mono truncate max-w-[220px]">ID: {m.id}</p>
                                            <p className="text-[10px] text-slate-400 truncate max-w-[220px]">
                                                {m.provider || 'openai_compatible'} · {m.usage || 'general'} · {m.url || '本地/默认地址'}
                                            </p>
                                        </div>
                                    </div>
                                    <button
                                        className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                        onClick={() => removeCustomModel(m.id)}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 border-b border-gray-50 pb-4">
                        <Key className="w-5 h-5 text-indigo-600" />
                        模型价格配置
                    </h3>
                    <textarea
                        className="min-h-[160px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                        value={configValues.modelPricing}
                        onChange={(e) => handleChange('modelPricing', e.target.value)}
                        placeholder='{"MiniMax-M2.7":{"input_per_1k":0.001,"output_per_1k":0.002}}'
                    />
                    <p className="text-xs leading-relaxed text-slate-400">
                        该字段用于后续 AI 成本统计。当前仅保存配置，不影响模型调用。
                    </p>
                </div>

                {/* Resource Limits Group */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-6">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2 border-b border-gray-50 pb-4">
                        <HardDrive className="w-5 h-5 text-indigo-600" />
                        资源与限额 (Quota)
                    </h3>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                <HardDrive className="w-4 h-4 text-slate-400" />
                                项目存储配额 (GB)
                            </label>
                            <Input
                                type="number"
                                value={configValues.storageQuota}
                                onChange={(e) => handleChange('storageQuota', Number(e.target.value))}
                            />
                            <p className="text-xs text-slate-400 uppercase tracking-widest font-bold opacity-60">默认为每个项目分配的云端存储空间容量</p>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                <FileText className="w-4 h-4 text-slate-400" />
                                单个文件限制 (MB)
                            </label>
                            <Input
                                type="number"
                                value={configValues.fileLimit}
                                onChange={(e) => handleChange('fileLimit', Number(e.target.value))}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                    <Users className="w-4 h-4 text-slate-400" />
                                    成员数上限
                                </label>
                                <Input
                                    type="number"
                                    value={configValues.memberLimit}
                                    onChange={(e) => handleChange('memberLimit', Number(e.target.value))}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                                    <History className="w-4 h-4 text-slate-400" />
                                    数据保留 (天)
                                </label>
                                <Input
                                    type="number"
                                    value={configValues.dataRetention}
                                    onChange={(e) => handleChange('dataRetention', Number(e.target.value))}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Additional Info */}
            <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl flex items-start gap-4">
                <div className="p-2 bg-white rounded-lg text-indigo-600 shadow-sm">
                    <RotateCcw className="w-5 h-5" />
                </div>
                <div>
                    <h4 className="text-sm font-bold text-indigo-900">系统维护模式说明</h4>
                    <p className="text-xs text-indigo-700 mt-1 leading-relaxed">
                        修改以上配置可能导致现行服务重启或短暂不可用。在大流量时段（如考试或集中协作课）请谨慎修改存储配额及模型选项。
                    </p>
                </div>
            </div>

            {/* Global Notice Modal */}
            <Dialog open={notice.isOpen} onOpenChange={(open) => setNotice(prev => ({ ...prev, isOpen: open }))}>
                <DialogContent className="max-w-md p-0 overflow-hidden bg-white border-none shadow-2xl rounded-3xl">
                    <div className="p-8 flex flex-col items-center text-center">
                        <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 shadow-xl ${notice.type === 'success' ? 'bg-indigo-600 text-white shadow-indigo-100' : 'bg-rose-500 text-white shadow-rose-100'
                            }`}>
                            {notice.type === 'success' ? <CheckCircle2 className="w-8 h-8" /> : <AlertCircle className="w-8 h-8" />}
                        </div>

                        <DialogHeader className="p-0 text-center sm:text-center space-y-2">
                            <DialogTitle className="text-xl font-bold text-slate-800">
                                {notice.title}
                            </DialogTitle>
                            <DialogDescription className="text-slate-500 text-sm leading-relaxed max-w-[280px] mx-auto">
                                {notice.message}
                            </DialogDescription>
                        </DialogHeader>
                    </div>

                    <DialogFooter className="p-4 bg-slate-50/50 flex justify-center border-t border-slate-100/50">
                        <Button
                            className={`w-full h-11 font-bold text-xs rounded-xl shadow-lg ${notice.type === 'success' ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-100' : 'bg-rose-600 hover:bg-rose-700 shadow-rose-100'
                                }`}
                            onClick={() => setNotice(prev => ({ ...prev, isOpen: false }))}
                        >
                            我知道了
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Add Model Modal */}
            <Dialog open={isModelModalOpen} onOpenChange={setIsModelModalOpen}>
                <DialogContent className="max-w-md p-6 bg-white border-none shadow-2xl rounded-3xl">
                    <DialogHeader className="space-y-1 mb-4 text-left sm:text-left">
                        <DialogTitle className="text-xl font-bold text-slate-800">添加自定义模型</DialogTitle>
                        <DialogDescription className="text-slate-500">输入模型池配置。系统会先做连通性测试，通过后才加入模型池。</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">显示名称</label>
                            <Input
                                placeholder="如：智谱 GLM-4"
                                value={tempModel.name}
                                onChange={(e) => updateTempModel({ name: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">模型标识符 (ID)</label>
                            <Input
                                placeholder="如：deepseek-chat、MiniMax-M2.7、Qwen/Qwen3-235B-A22B-Instruct-2507"
                                value={tempModel.id}
                                onChange={(e) => updateTempModel({ id: e.target.value })}
                            />
                            <p className="text-[11px] text-slate-400">这里填写服务商真实模型 ID，角色分配时也使用这个 ID。</p>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Provider</label>
                            <Input
                                placeholder="openai_compatible、deepseek、openai、ollama"
                                value={tempModel.provider}
                                onChange={(e) => updateTempModel({ provider: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">API Base URL</label>
                            <Input
                                placeholder="https://api.example.com/v1"
                                value={tempModel.url}
                                onChange={(e) => updateTempModel({ url: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">API Key</label>
                            <Input
                                type="password"
                                placeholder="sk-..."
                                value={tempModel.key}
                                onChange={(e) => updateTempModel({ key: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">用途标签</label>
                            <Input
                                placeholder="fast、reasoning、long-context、stable"
                                value={tempModel.usage || ''}
                                onChange={(e) => updateTempModel({ usage: e.target.value })}
                            />
                        </div>
                        {renderTestResult(tempModelTestResult)}
                    </div>

                    <DialogFooter className="mt-8 gap-3 sm:justify-start">
                        <Button
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-11 px-6 rounded-xl shadow-lg shadow-indigo-100 flex-1"
                            onClick={handleAddCustomModel}
                            disabled={isTestingTempModel}
                        >
                            {isTestingTempModel ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                            {isTestingTempModel ? '正在测试...' : '测试通过并添加'}
                        </Button>
                        <Button
                            variant="outline"
                            className="h-11 px-6 rounded-xl flex-1"
                            onClick={() => {
                                setIsModelModalOpen(false)
                                setTempModelTestResult(null)
                            }}
                        >
                            取消
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
