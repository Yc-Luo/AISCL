import { useState, useEffect } from 'react'
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
    Cpu as ModelIcon
} from 'lucide-react'
import { Button, Input } from '../../../ui'
import { adminService } from '../../../../services/api/admin'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter
} from '../../../ui/dialog'

export default function SystemConfig() {
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [isSavingLLM, setIsSavingLLM] = useState(false)
    const [isSavingEmbedding, setIsSavingEmbedding] = useState(false)

    // Mapping keys to local state for easier UI handling
    const [configValues, setConfigValues] = useState({
        llmProvider: 'openai_compatible',
        llmKey: '',
        llmBaseUrl: 'https://api.minimaxi.com/v1',
        llmModel: 'gpt-4o',
        embeddingProvider: 'minimax',
        embeddingKey: '',
        embeddingBaseUrl: 'https://api.minimax.chat/v1/embeddings',
        embeddingModel: 'embo-01',
        embeddingType: 'db',
        embeddingGroupId: '',
        embeddingDimensions: '',
        storageQuota: 5,
        fileLimit: 50,
        memberLimit: 5,
        dataRetention: 365
    })

    const [customModels, setCustomModels] = useState<any[]>([])
    const [isModelModalOpen, setIsModelModalOpen] = useState(false)
    const [tempModel, setTempModel] = useState({
        id: '',
        name: '',
        url: '',
        key: ''
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

    useEffect(() => {
        fetchConfigs()
    }, [])

    const fetchConfigs = async () => {
        try {
            setIsLoading(true)
            const data = await adminService.getConfigs()

            // Sync data to state
            const newValues = { ...configValues }
            data.forEach(c => {
                if (c.key === 'llm_provider') newValues.llmProvider = c.value
                if (c.key === 'llm_key') newValues.llmKey = c.value
                if (c.key === 'llm_base_url') newValues.llmBaseUrl = c.value
                if (c.key === 'llm_model') newValues.llmModel = c.value
                if (c.key === 'embedding_provider') newValues.embeddingProvider = c.value
                if (c.key === 'embedding_key') newValues.embeddingKey = c.value
                if (c.key === 'embedding_base_url') newValues.embeddingBaseUrl = c.value
                if (c.key === 'embedding_model') newValues.embeddingModel = c.value
                if (c.key === 'embedding_type') newValues.embeddingType = c.value
                if (c.key === 'embedding_group_id') newValues.embeddingGroupId = c.value
                if (c.key === 'embedding_dimensions') newValues.embeddingDimensions = c.value
                if (c.key === 'storage_quota') newValues.storageQuota = Number(c.value)
                if (c.key === 'file_limit') newValues.fileLimit = Number(c.value)
                if (c.key === 'member_limit') newValues.memberLimit = Number(c.value)
                if (c.key === 'data_retention') newValues.dataRetention = Number(c.value)
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
    }

    const handleChange = (field: string, value: any) => {
        setConfigValues(prev => ({ ...prev, [field]: value }))
    }

    const hasConfiguredValue = (value: unknown) => {
        return typeof value === 'string' && value.trim().length > 0
    }

    const handleSave = async () => {
        try {
            setIsSaving(true)
            await Promise.all([
                adminService.updateConfig('llm_provider', configValues.llmProvider, 'LLM provider type'),
                adminService.updateConfig('llm_key', configValues.llmKey, 'LLM API Authorization Key'),
                adminService.updateConfig('llm_base_url', configValues.llmBaseUrl, 'LLM API base URL'),
                adminService.updateConfig('llm_model', configValues.llmModel, 'Default LLM model'),
                adminService.updateConfig('embedding_provider', configValues.embeddingProvider, 'Embedding provider type for RAG and Wiki retrieval'),
                adminService.updateConfig('embedding_key', configValues.embeddingKey, 'Embedding API Authorization Key'),
                adminService.updateConfig('embedding_base_url', configValues.embeddingBaseUrl, 'Embedding API base URL'),
                adminService.updateConfig('embedding_model', configValues.embeddingModel, 'Embedding model ID'),
                adminService.updateConfig('embedding_type', configValues.embeddingType, 'Embedding request type or purpose'),
                adminService.updateConfig('embedding_group_id', configValues.embeddingGroupId, 'MiniMax embedding group id'),
                adminService.updateConfig('embedding_dimensions', configValues.embeddingDimensions, 'Embedding vector dimensions'),
                adminService.updateConfig('storage_quota', String(configValues.storageQuota), 'Storage quota per project in GB'),
                adminService.updateConfig('file_limit', String(configValues.fileLimit), 'Single file size limit in MB'),
                adminService.updateConfig('member_limit', String(configValues.memberLimit), 'Max members per project'),
                adminService.updateConfig('data_retention', String(configValues.dataRetention), 'Data retention period in days'),
                adminService.updateConfig('user_custom_models', JSON.stringify(customModels), 'User defined LLM models')
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
        try {
            setIsSavingLLM(true)
            await Promise.all([
                adminService.updateConfig('llm_provider', configValues.llmProvider, 'LLM provider type'),
                adminService.updateConfig('llm_key', configValues.llmKey, 'LLM API Authorization Key'),
                adminService.updateConfig('llm_base_url', configValues.llmBaseUrl, 'LLM API base URL'),
                adminService.updateConfig('llm_model', configValues.llmModel, 'Default LLM model'),
                adminService.updateConfig('user_custom_models', JSON.stringify(customModels), 'User defined LLM models'),
            ])
            setNotice({
                isOpen: true,
                title: '模型参数已同步',
                message: '大模型 Provider、Base URL、模型 ID 与 API Key 已保存。后端启用数据库配置模式后会立即按新配置调用。',
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

    const handleAddCustomModel = () => {
        if (!tempModel.id || !tempModel.name || !tempModel.url || !tempModel.key) {
            alert('请完整填写所有必填字段')
            return
        }
        setCustomModels([...customModels, { ...tempModel }])
        setTempModel({ id: '', name: '', url: '', key: '' })
        setIsModelModalOpen(false)
    }

    const removeCustomModel = (id: string) => {
        setCustomModels(customModels.filter(m => m.id !== id))
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

                        <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 text-xs text-indigo-900 space-y-2">
                            <p className="font-bold">填写示例</p>
                            <p>SiliconFlow：provider=openai_compatible，Base URL=https://api.siliconflow.cn/v1，model=Qwen/Qwen3-235B-A22B-Instruct-2507。</p>
                            <p>MiniMax：provider=openai_compatible，Base URL=https://api.minimaxi.com/v1，model=MiniMax-M2.7。</p>
                            <p>DeepSeek：provider=deepseek，Base URL=https://api.deepseek.com，model=deepseek-chat 或 deepseek-reasoner。</p>
                            <p className="text-indigo-800/80">如果服务商使用 OpenAI Chat Completions 兼容协议，通常都填写 `openai_compatible`。</p>
                        </div>
                    </div>
                </div>

                {/* Embedding Config Group */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-6">
                    <div className="flex justify-between items-center border-b border-gray-50 pb-4">
                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <Cpu className="w-5 h-5 text-emerald-600" />
                            向量模型服务 (Embedding)
                        </h3>
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
                    </div>
                </div>

                {/* Custom Models Management */}
                <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-6">
                    <div className="flex justify-between items-center border-b border-gray-50 pb-4">
                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <ModelIcon className="w-5 h-5 text-indigo-600" />
                            自定义模型广场
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
                                <p className="text-xs text-slate-400 font-medium">暂无自定义模型，点击上方按钮添加</p>
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
                                            <p className="text-[10px] text-slate-400 font-mono truncate max-w-[150px] uppercase">ID: {m.id}</p>
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
                        <DialogDescription className="text-slate-500">输入 OpenAI 兼容接口的模型配置</DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">显示名称</label>
                            <Input
                                placeholder="如：智谱 GLM-4"
                                value={tempModel.name}
                                onChange={(e) => setTempModel({ ...tempModel, name: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">模型标识符 (ID)</label>
                            <Input
                                placeholder="如：glm-4"
                                value={tempModel.id}
                                onChange={(e) => setTempModel({ ...tempModel, id: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">API Base URL</label>
                            <Input
                                placeholder="https://api.example.com/v1"
                                value={tempModel.url}
                                onChange={(e) => setTempModel({ ...tempModel, url: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">API Key</label>
                            <Input
                                type="password"
                                placeholder="sk-..."
                                value={tempModel.key}
                                onChange={(e) => setTempModel({ ...tempModel, key: e.target.value })}
                            />
                        </div>
                    </div>

                    <DialogFooter className="mt-8 gap-3 sm:justify-start">
                        <Button
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-11 px-6 rounded-xl shadow-lg shadow-indigo-100 flex-1"
                            onClick={handleAddCustomModel}
                        >
                            <Plus className="w-4 h-4 mr-2" />
                            添加到库
                        </Button>
                        <Button
                            variant="outline"
                            className="h-11 px-6 rounded-xl flex-1"
                            onClick={() => setIsModelModalOpen(false)}
                        >
                            取消
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
