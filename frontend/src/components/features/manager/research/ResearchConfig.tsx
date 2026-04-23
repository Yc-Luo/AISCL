import { useEffect, useState } from 'react'
import {
    Bot,
    GitBranch,
    Save,
    RotateCcw,
    Loader2,
    CheckCircle2,
    AlertCircle,
    Plus,
    Trash2,
    SlidersHorizontal,
    BookOpen,
    RadioTower,
    Cpu,
    History,
    Upload,
} from 'lucide-react'
import { Button, Input, Badge } from '../../../ui'
import { adminService, Config } from '../../../../services/api/admin'
import { useAuthStore } from '../../../../stores/authStore'

interface ExperimentTemplateConfig {
    id: string
    label: string
    groupCondition: string
    aiMode: 'single_agent' | 'multi_agent'
    processMode: 'on' | 'off'
    ruleSet: string
    stageSequence: string[]
    teacherSummary: string
    published: boolean
}

interface AgentRoleConfig {
    id: string
    name: string
    focus: string
    interventionUse: string
    summary: string
}

interface RuleProfileConfig {
    id: string
    label: string
    baseRuleSet: string
    observationWindows: number
    consecutiveHits: number
    cooldownMinutes: number
    deliveryMode: 'shadow' | 'group_chat_live'
    summary: string
}

interface OrchestrationProfileConfig {
    graphVersion: string
    preferredSubagentPolicy: string
    groupChatRouting: string
    tutorRouting: string
    ragStrategy: string
    retrievalSource: string
    groupChatModel: string
    tutorModel: string
}

interface ResolvedExperimentVersionSnapshot {
    mode: 'research'
    version_name: string
    stage_control_mode: 'soft_guidance'
    process_scaffold_mode: 'on' | 'off'
    ai_scaffold_mode: 'single_agent' | 'multi_agent'
    broadcast_stage_updates: boolean
    group_condition?: string | null
    enabled_scaffold_layers: string[]
    enabled_scaffold_roles: string[]
    enabled_rule_set?: string | null
    export_profile: string
    stage_sequence: string[]
    current_stage?: string | null
    template_key: string
    template_label: string
    template_source: string
    graph_version: string
}

interface ReleasedTemplateSnapshot extends ExperimentTemplateConfig {
    resolvedExperimentVersion: ResolvedExperimentVersionSnapshot
}

interface ResearchReleaseRecord {
    id: string
    releasedAt: string
    releasedById?: string
    releasedByName: string
    note: string
    graphVersion: string
    publishedTemplateIds: string[]
    publishedTemplateCount: number
    ruleProfileIds: string[]
    groupChatModel: string
    tutorModel: string
    templates?: ReleasedTemplateSnapshot[]
    roles?: AgentRoleConfig[]
    ruleProfiles?: RuleProfileConfig[]
    orchestration?: OrchestrationProfileConfig
}

const DEFAULT_TEMPLATES: ExperimentTemplateConfig[] = [
    {
        id: 'exp-single-process-v1',
        label: '模板A：单AI + 过程支架',
        groupCondition: 'single_agent_process_on',
        aiMode: 'single_agent',
        processMode: 'on',
        ruleSet: 'research-default',
        stageSequence: ['orientation', 'planning', 'inquiry', 'argumentation', 'revision'],
        teacherSummary: '单AI条件下保留过程支架，用于基础实验组。',
        published: true,
    },
    {
        id: 'exp-multi-process-v1',
        label: '模板B：多智能体 + 过程支架',
        groupCondition: 'multi_agent_process_on',
        aiMode: 'multi_agent',
        processMode: 'on',
        ruleSet: 'research-default+group-chat-live',
        stageSequence: ['orientation', 'planning', 'inquiry', 'argumentation', 'revision'],
        teacherSummary: '多智能体与过程支架同时开启，用于核心实验组。',
        published: true,
    },
    {
        id: 'exp-single-process-off-v1',
        label: '模板C：单AI + 无过程支架',
        groupCondition: 'single_agent_process_off',
        aiMode: 'single_agent',
        processMode: 'off',
        ruleSet: 'research-default',
        stageSequence: ['orientation', 'planning', 'inquiry', 'argumentation', 'revision'],
        teacherSummary: '用于较弱支架条件对照，不启用过程支架。',
        published: false,
    },
]

const DEFAULT_ROLES: AgentRoleConfig[] = [
    {
        id: 'resource_researcher',
        name: '资料研究员',
        focus: '补充背景资料、证据来源与概念线索',
        interventionUse: '在信息不足、证据缺口或资料检索请求时优先调用',
        summary: '负责证据入口与资料补强',
    },
    {
        id: 'viewpoint_challenger',
        name: '观点挑战者',
        focus: '提出反例、质疑论证跳跃、推动观点对照',
        interventionUse: '在论证单一、反驳不足或结论过早收束时优先调用',
        summary: '负责提出异议与替代视角',
    },
    {
        id: 'feedback_prompter',
        name: '反馈追问者',
        focus: '追问依据、澄清表达、逼近未说明的逻辑链',
        interventionUse: '在表述含混、论据未展开或需要追问时优先调用',
        summary: '负责追问与表达澄清',
    },
    {
        id: 'problem_advancer',
        name: '问题推进者',
        focus: '整理当前卡点、推进下一步任务、明确协作方向',
        interventionUse: '在任务停滞、责任不清或需要下一步建议时优先调用',
        summary: '负责推进任务与阶段衔接',
    },
]

const DEFAULT_RULE_PROFILES: RuleProfileConfig[] = [
    {
        id: 'research-default',
        label: '研究默认规则集',
        baseRuleSet: 'research-default',
        observationWindows: 2,
        consecutiveHits: 2,
        cooldownMinutes: 10,
        deliveryMode: 'shadow',
        summary: '影子模式，仅记录候选提示，不向群聊自动发送。',
    },
    {
        id: 'research-default+group-chat-live',
        label: '研究默认规则集 + 群聊短提示',
        baseRuleSet: 'research-default',
        observationWindows: 2,
        consecutiveHits: 2,
        cooldownMinutes: 10,
        deliveryMode: 'group_chat_live',
        summary: '命中后向小组群聊发送 1 条短提示，不弹窗、不连续轰炸。',
    },
]

const DEFAULT_ORCHESTRATION: OrchestrationProfileConfig = {
    graphVersion: 'research-graph-v2',
    preferredSubagentPolicy: '命中 preferred_subagent 时采用明确路由约束，不再仅作优先参考。',
    groupChatRouting: '小组群聊先做 graph 路由与子代理选择，再决定是否进入角色内 RAG。',
    tutorRouting: 'AI 导师根据学习者提问意图选择主要视角，并生成可折叠处理摘要。',
    ragStrategy: '采用子代理内按需检索；未命中资料型任务时不强制检索。',
    retrievalSource: '项目文档、资源库、探究空间上下文、研究规则提示。',
    groupChatModel: 'follow_system_default',
    tutorModel: 'follow_system_default',
}

type NoticeState = {
    type: 'success' | 'error'
    message: string
} | null

type ResearchConfigKey =
    | 'research_experiment_templates'
    | 'research_agent_roles'
    | 'research_rule_profiles'
    | 'research_orchestration_profile'
    | 'research_release_history'

type ConfigMeta = Partial<Record<ResearchConfigKey, Pick<Config, 'updated_at' | 'updated_by' | 'description'>>>

const textareaClassName =
    'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100'

export default function ResearchConfig() {
    const user = useAuthStore((state) => state.user)
    const [isLoading, setIsLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [notice, setNotice] = useState<NoticeState>(null)
    const [templates, setTemplates] = useState<ExperimentTemplateConfig[]>(DEFAULT_TEMPLATES)
    const [roles, setRoles] = useState<AgentRoleConfig[]>(DEFAULT_ROLES)
    const [ruleProfiles, setRuleProfiles] = useState<RuleProfileConfig[]>(DEFAULT_RULE_PROFILES)
    const [orchestration, setOrchestration] = useState<OrchestrationProfileConfig>(DEFAULT_ORCHESTRATION)
    const [releaseHistory, setReleaseHistory] = useState<ResearchReleaseRecord[]>([])
    const [releaseNote, setReleaseNote] = useState('')
    const [configMeta, setConfigMeta] = useState<ConfigMeta>({})
    const validationIssues = collectValidationIssues(templates, roles, ruleProfiles, orchestration)

    useEffect(() => {
        void fetchConfigs()
    }, [])

    const fetchConfigs = async () => {
        try {
            setIsLoading(true)
            setNotice(null)
            const configs = await adminService.getConfigs()
            const templateConfig = configs.find((item) => item.key === 'research_experiment_templates')
            const roleConfig = configs.find((item) => item.key === 'research_agent_roles')
            const ruleConfig = configs.find((item) => item.key === 'research_rule_profiles')
            const orchestrationConfig = configs.find((item) => item.key === 'research_orchestration_profile')
            const releaseHistoryConfig = configs.find((item) => item.key === 'research_release_history')

            setConfigMeta(extractConfigMeta(configs))
            setTemplates(parseConfigValue(templateConfig?.value, DEFAULT_TEMPLATES))
            setRoles(parseConfigValue(roleConfig?.value, DEFAULT_ROLES))
            setRuleProfiles(parseConfigValue(ruleConfig?.value, DEFAULT_RULE_PROFILES))
            setOrchestration(parseConfigValue(orchestrationConfig?.value, DEFAULT_ORCHESTRATION))
            setReleaseHistory(parseConfigValue(releaseHistoryConfig?.value, [] as ResearchReleaseRecord[]))
        } catch (error) {
            console.error('Failed to fetch research configs:', error)
            setNotice({ type: 'error', message: '读取研究配置失败，已回退到默认模板。' })
            setTemplates(DEFAULT_TEMPLATES)
            setRoles(DEFAULT_ROLES)
            setRuleProfiles(DEFAULT_RULE_PROFILES)
            setOrchestration(DEFAULT_ORCHESTRATION)
            setReleaseHistory([])
        } finally {
            setIsLoading(false)
        }
    }

    const saveWorkingConfigs = async () => {
        const savedConfigs = await Promise.all([
            adminService.updateConfig(
                'research_experiment_templates',
                JSON.stringify(templates, null, 2),
                'Published research experiment templates for AISCL'
            ),
            adminService.updateConfig(
                'research_agent_roles',
                JSON.stringify(roles, null, 2),
                'Research role registry for multi-agent orchestration'
            ),
            adminService.updateConfig(
                'research_rule_profiles',
                JSON.stringify(ruleProfiles, null, 2),
                'Rule profiles and intervention thresholds for research scaffolds'
            ),
            adminService.updateConfig(
                'research_orchestration_profile',
                JSON.stringify(orchestration, null, 2),
                'Graph orchestration, routing, RAG, and model strategy for research mode'
            ),
        ])

        setConfigMeta((previous) => ({ ...previous, ...extractConfigMeta(savedConfigs) }))
        return savedConfigs
    }

    const handleSave = async () => {
        if (validationIssues.length > 0) {
            setNotice({ type: 'error', message: `当前有 ${validationIssues.length} 项配置校验未通过，请先修正后再保存。` })
            return
        }

        try {
            setIsSaving(true)
            setNotice(null)
            await saveWorkingConfigs()
            setNotice({ type: 'success', message: '研究配置已保存到管理员端配置库。教师端未做任何改动。' })
        } catch (error) {
            console.error('Failed to save research configs:', error)
            setNotice({ type: 'error', message: '研究配置保存失败，请检查网络或管理员权限。' })
        } finally {
            setIsSaving(false)
        }
    }

    const handlePublishRelease = async () => {
        if (validationIssues.length > 0) {
            setNotice({ type: 'error', message: `当前有 ${validationIssues.length} 项配置校验未通过，请先修正后再发布。` })
            return
        }

        const publishedTemplateIds = templates.filter((template) => template.published).map((template) => template.id.trim())
        if (publishedTemplateIds.length === 0) {
            setNotice({ type: 'error', message: '至少需要 1 个已发布模板，才能生成研究配置快照。' })
            return
        }

        try {
            setIsSaving(true)
            setNotice(null)

            const savedConfigs = await saveWorkingConfigs()
            const now = new Date()
            const releasedTemplates = templates
                .filter((template) => template.published)
                .map((template) => ({
                    ...template,
                    resolvedExperimentVersion: buildResolvedExperimentVersionSnapshot(template, orchestration),
                }))
            const releaseRecord: ResearchReleaseRecord = {
                id: buildReleaseId(now),
                releasedAt: now.toISOString(),
                releasedById: user?.id,
                releasedByName: user?.username || user?.email || '管理员',
                note: releaseNote.trim() || '未填写发布说明',
                graphVersion: orchestration.graphVersion.trim(),
                publishedTemplateIds,
                publishedTemplateCount: publishedTemplateIds.length,
                ruleProfileIds: ruleProfiles.map((rule) => rule.id.trim()).filter(Boolean),
                groupChatModel: orchestration.groupChatModel.trim(),
                tutorModel: orchestration.tutorModel.trim(),
                templates: releasedTemplates,
                roles: roles.map((role) => ({ ...role })),
                ruleProfiles: ruleProfiles.map((rule) => ({ ...rule })),
                orchestration: { ...orchestration },
            }
            const nextReleaseHistory = [releaseRecord, ...releaseHistory].slice(0, 30)
            const releaseHistoryConfig = await adminService.updateConfig(
                'research_release_history',
                JSON.stringify(nextReleaseHistory, null, 2),
                'Versioned release history for research configuration snapshots'
            )

            setReleaseHistory(nextReleaseHistory)
            setReleaseNote('')
            setConfigMeta((previous) => ({
                ...previous,
                ...extractConfigMeta([...savedConfigs, releaseHistoryConfig]),
            }))
            setNotice({ type: 'success', message: `研究配置快照 ${releaseRecord.id} 已发布并写入版本记录。` })
        } catch (error) {
            console.error('Failed to publish research release:', error)
            setNotice({ type: 'error', message: '研究配置快照发布失败，请检查网络或管理员权限。' })
        } finally {
            setIsSaving(false)
        }
    }

    const handleReset = () => {
        void fetchConfigs()
    }

    const updateTemplate = <K extends keyof ExperimentTemplateConfig>(
        index: number,
        key: K,
        value: ExperimentTemplateConfig[K]
    ) => {
        setTemplates((previous) =>
            previous.map((template, currentIndex) =>
                currentIndex === index ? { ...template, [key]: value } : template
            )
        )
    }

    const updateRole = <K extends keyof AgentRoleConfig>(index: number, key: K, value: AgentRoleConfig[K]) => {
        setRoles((previous) =>
            previous.map((role, currentIndex) => (currentIndex === index ? { ...role, [key]: value } : role))
        )
    }

    const updateRule = <K extends keyof RuleProfileConfig>(index: number, key: K, value: RuleProfileConfig[K]) => {
        setRuleProfiles((previous) =>
            previous.map((rule, currentIndex) => (currentIndex === index ? { ...rule, [key]: value } : rule))
        )
    }

    const updateOrchestration = <K extends keyof OrchestrationProfileConfig>(
        key: K,
        value: OrchestrationProfileConfig[K]
    ) => {
        setOrchestration((previous) => ({ ...previous, [key]: value }))
    }

    const addTemplate = () => {
        const nextIndex = templates.length + 1
        setTemplates((previous) => [
            ...previous,
            {
                id: `template-${Date.now()}`,
                label: `新增模板 ${nextIndex}`,
                groupCondition: 'custom_condition',
                aiMode: 'single_agent',
                processMode: 'on',
                ruleSet: 'research-default',
                stageSequence: ['orientation', 'planning', 'inquiry', 'argumentation', 'revision'],
                teacherSummary: '请补充该模板的实验用途与适用班级。',
                published: false,
            },
        ])
    }

    const removeTemplate = (index: number) => {
        setTemplates((previous) => previous.filter((_, currentIndex) => currentIndex !== index))
    }

    const addRuleProfile = () => {
        const nextIndex = ruleProfiles.length + 1
        setRuleProfiles((previous) => [
            ...previous,
            {
                id: `rule-profile-${Date.now()}`,
                label: `新增规则集 ${nextIndex}`,
                baseRuleSet: 'research-default',
                observationWindows: 2,
                consecutiveHits: 2,
                cooldownMinutes: 10,
                deliveryMode: 'shadow',
                summary: '请补充命中逻辑与投放策略。',
            },
        ])
    }

    const removeRuleProfile = (index: number) => {
        setRuleProfiles((previous) => previous.filter((_, currentIndex) => currentIndex !== index))
    }

    if (isLoading) {
        return (
            <div className="h-[420px] flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                    <p className="text-sm font-medium text-slate-500">正在加载研究配置...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm xl:flex-row xl:items-start xl:justify-between">
                <div className="space-y-2">
                    <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-800">
                        <GitBranch className="h-6 w-6 text-indigo-600" />
                        研究配置
                    </h2>
                    <p className="max-w-3xl text-sm leading-6 text-slate-500">
                        管理实验模板、多智能体角色、规则阈值与 graph 编排摘要。此处配置直接写入管理员端配置库，不改动教师端界面。
                    </p>
                    <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                            管理员端独立维护
                        </Badge>
                        <Badge variant="secondary" className="bg-emerald-50 text-emerald-700">
                            教师端暂不改动
                        </Badge>
                    </div>
                </div>

                <div className="flex gap-3">
                    <Button variant="outline" className="gap-2" onClick={handleReset} disabled={isSaving}>
                        <RotateCcw className="h-4 w-4" />
                        重新加载
                    </Button>
                    <Button
                        variant="outline"
                        className="gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800"
                        onClick={handlePublishRelease}
                        disabled={isSaving || validationIssues.length > 0}
                    >
                        <Upload className="h-4 w-4" />
                        发布版本快照
                    </Button>
                    <Button
                        className="gap-2 bg-indigo-600 text-white hover:bg-indigo-700"
                        onClick={handleSave}
                        disabled={isSaving || validationIssues.length > 0}
                    >
                        {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        {isSaving ? '正在保存...' : '保存研究配置'}
                    </Button>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
                <SummaryCard label="模板数" value={templates.length} hint="已维护的实验模板" />
                <SummaryCard label="角色数" value={roles.length} hint="研究型多智能体角色" />
                <SummaryCard label="规则集数" value={ruleProfiles.length} hint="干预规则与阈值档案" />
                <SummaryCard
                    label="发布快照"
                    value={releaseHistory.length}
                    hint={
                        releaseHistory[0]
                            ? `最近一次：${formatConfigTime(releaseHistory[0].releasedAt)}`
                            : '尚未发布版本快照'
                    }
                />
                <SummaryCard
                    label="校验状态"
                    value={validationIssues.length === 0 ? '通过' : `${validationIssues.length} 项待修正`}
                    hint={validationIssues.length === 0 ? '当前研究配置可保存' : '需先修正结构问题'}
                    tone={validationIssues.length === 0 ? 'success' : 'warning'}
                />
            </div>

            {notice ? (
                <div
                    className={`flex items-start gap-3 rounded-2xl border p-4 ${
                        notice.type === 'success'
                            ? 'border-emerald-100 bg-emerald-50 text-emerald-900'
                            : 'border-rose-100 bg-rose-50 text-rose-900'
                    }`}
                >
                    <div className="mt-0.5">
                        {notice.type === 'success' ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
                    </div>
                    <p className="text-sm font-medium leading-6">{notice.message}</p>
                </div>
            ) : null}

            {validationIssues.length > 0 ? (
                <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                    <div className="flex items-center gap-2 text-amber-900">
                        <AlertCircle className="h-5 w-5" />
                        <h3 className="text-sm font-bold">研究配置校验未通过</h3>
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
                        {validationIssues.map((issue) => (
                            <div key={issue} className="rounded-xl bg-white/70 px-3 py-2 text-sm text-amber-900">
                                {issue}
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}

            <section className="space-y-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="border-b border-slate-100 pb-4">
                    <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800">
                        <History className="h-5 w-5 text-indigo-600" />
                        研究配置发布记录
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                        发布快照会先保存当前工作配置，再追加一条可追溯的版本记录，用于后续实验回溯。
                    </p>
                    <SectionMeta meta={configMeta.research_release_history} configKey="research_release_history" />
                </div>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.9fr_1.1fr]">
                    <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                        <Field label="本次发布说明">
                            <textarea
                                className={textareaClassName}
                                rows={4}
                                value={releaseNote}
                                onChange={(event) => setReleaseNote(event.target.value)}
                                placeholder="建议填写：本次调整了哪些模板、规则集或 graph 策略。"
                            />
                        </Field>
                        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-3 text-sm text-slate-500">
                            当前将被纳入快照的内容：
                            <div className="mt-2 grid grid-cols-1 gap-2 text-slate-700">
                                <span>{`已发布模板：${templates.filter((template) => template.published).map((template) => template.id).join(', ') || '无'}`}</span>
                                <span>{`规则集：${ruleProfiles.map((rule) => rule.id).join(', ') || '无'}`}</span>
                                <span>{`Graph 版本：${orchestration.graphVersion || '未填写'}`}</span>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-3">
                        {releaseHistory.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-10 text-center text-sm text-slate-400">
                                尚无研究配置发布记录。建议先完成一次保存，再发布首个版本快照。
                            </div>
                        ) : (
                            releaseHistory.map((release) => (
                                <div key={release.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                        <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                                <Badge variant="default">{release.id}</Badge>
                                                <span className="text-xs text-slate-400">{formatConfigTime(release.releasedAt)}</span>
                                            </div>
                                            <p className="mt-2 text-sm font-semibold text-slate-700">{release.note}</p>
                                        </div>
                                        <div className="text-right text-xs text-slate-400">
                                            <p>{`发布人：${release.releasedByName}`}</p>
                                            <p>{`Graph：${release.graphVersion}`}</p>
                                        </div>
                                    </div>

                                    <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-slate-600 md:grid-cols-2">
                                        <div className="rounded-xl bg-white px-3 py-2">
                                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">模板</p>
                                            <p className="mt-1">{release.publishedTemplateIds.join(', ') || '无'}</p>
                                        </div>
                                        <div className="rounded-xl bg-white px-3 py-2">
                                            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">规则集</p>
                                            <p className="mt-1">{release.ruleProfileIds.join(', ') || '无'}</p>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </section>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                <section className="space-y-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                        <div>
                            <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800">
                                <BookOpen className="h-5 w-5 text-indigo-600" />
                                实验模板管理
                            </h3>
                            <p className="mt-1 text-sm text-slate-500">维护班级级实验模板，供管理员发布和后续班级应用。</p>
                            <SectionMeta meta={configMeta.research_experiment_templates} configKey="research_experiment_templates" />
                        </div>
                        <Button variant="outline" className="gap-2" onClick={addTemplate}>
                            <Plus className="h-4 w-4" />
                            新增模板
                        </Button>
                    </div>

                    <div className="space-y-4">
                        {templates.map((template, index) => (
                            <div key={template.id} className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                    <div className="space-y-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Badge variant={template.published ? 'default' : 'secondary'}>
                                                {template.published ? '已发布' : '草稿'}
                                            </Badge>
                                            <span className="text-xs font-mono text-slate-400">{template.id}</span>
                                        </div>
                                        <Input
                                            value={template.label}
                                            onChange={(event) => updateTemplate(index, 'label', event.target.value)}
                                            className="max-w-xl bg-white"
                                        />
                                    </div>
                                    <Button
                                        variant="outline"
                                        className="gap-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                                        onClick={() => removeTemplate(index)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                        删除模板
                                    </Button>
                                </div>

                                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    <Field label="组别条件">
                                        <Input
                                            value={template.groupCondition}
                                            onChange={(event) => updateTemplate(index, 'groupCondition', event.target.value)}
                                        />
                                    </Field>
                                    <Field label="AI 模式">
                                        <select
                                            className={selectClassName}
                                            value={template.aiMode}
                                            onChange={(event) => updateTemplate(index, 'aiMode', event.target.value as ExperimentTemplateConfig['aiMode'])}
                                        >
                                            <option value="single_agent">single_agent</option>
                                            <option value="multi_agent">multi_agent</option>
                                        </select>
                                    </Field>
                                    <Field label="过程支架">
                                        <select
                                            className={selectClassName}
                                            value={template.processMode}
                                            onChange={(event) =>
                                                updateTemplate(index, 'processMode', event.target.value as ExperimentTemplateConfig['processMode'])
                                            }
                                        >
                                            <option value="on">on</option>
                                            <option value="off">off</option>
                                        </select>
                                    </Field>
                                    <Field label="规则集">
                                        <Input
                                            value={template.ruleSet}
                                            onChange={(event) => updateTemplate(index, 'ruleSet', event.target.value)}
                                        />
                                    </Field>
                                </div>

                                <Field label="阶段序列（逗号分隔）">
                                    <Input
                                        value={template.stageSequence.join(', ')}
                                        onChange={(event) =>
                                            updateTemplate(
                                                index,
                                                'stageSequence',
                                                event.target.value
                                                    .split(',')
                                                    .map((item) => item.trim())
                                                    .filter(Boolean)
                                            )
                                        }
                                    />
                                </Field>

                                <Field label="面向教师的模板摘要">
                                    <textarea
                                        className={textareaClassName}
                                        rows={3}
                                        value={template.teacherSummary}
                                        onChange={(event) => updateTemplate(index, 'teacherSummary', event.target.value)}
                                    />
                                </Field>

                                <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
                                    <input
                                        type="checkbox"
                                        checked={template.published}
                                        onChange={(event) => updateTemplate(index, 'published', event.target.checked)}
                                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    允许作为已发布模板提供给后续班级使用
                                </label>
                            </div>
                        ))}
                    </div>
                </section>

                <div className="space-y-6">
                    <section className="space-y-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                        <div className="border-b border-slate-100 pb-4">
                            <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800">
                                <Bot className="h-5 w-5 text-indigo-600" />
                                多智能体角色
                            </h3>
                            <p className="mt-1 text-sm text-slate-500">保留研究型四角色，但允许管理员维护角色摘要与适用情境。</p>
                            <SectionMeta meta={configMeta.research_agent_roles} configKey="research_agent_roles" />
                        </div>

                        <div className="space-y-4">
                            {roles.map((role, index) => (
                                <div key={role.id} className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <Input
                                                value={role.name}
                                                onChange={(event) => updateRole(index, 'name', event.target.value)}
                                                className="max-w-xs bg-white"
                                            />
                                            <p className="mt-1 text-xs font-mono text-slate-400">{role.id}</p>
                                        </div>
                                        <Badge variant="secondary" className="bg-indigo-50 text-indigo-700">
                                            研究角色
                                        </Badge>
                                    </div>
                                    <Field label="核心焦点">
                                        <Input value={role.focus} onChange={(event) => updateRole(index, 'focus', event.target.value)} />
                                    </Field>
                                    <Field label="优先介入情境">
                                        <textarea
                                            className={textareaClassName}
                                            rows={2}
                                            value={role.interventionUse}
                                            onChange={(event) => updateRole(index, 'interventionUse', event.target.value)}
                                        />
                                    </Field>
                                    <Field label="一句话摘要">
                                        <Input value={role.summary} onChange={(event) => updateRole(index, 'summary', event.target.value)} />
                                    </Field>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="space-y-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                            <div>
                                <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800">
                                    <RadioTower className="h-5 w-5 text-indigo-600" />
                                    规则集与干预阈值
                                </h3>
                                <p className="mt-1 text-sm text-slate-500">维护群聊短提示和影子模式的投放逻辑。</p>
                                <SectionMeta meta={configMeta.research_rule_profiles} configKey="research_rule_profiles" />
                            </div>
                            <Button variant="outline" className="gap-2" onClick={addRuleProfile}>
                                <Plus className="h-4 w-4" />
                                新增规则集
                            </Button>
                        </div>

                        <div className="space-y-4">
                            {ruleProfiles.map((rule, index) => (
                                <div key={rule.id} className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <Input
                                                value={rule.label}
                                                onChange={(event) => updateRule(index, 'label', event.target.value)}
                                                className="max-w-sm bg-white"
                                            />
                                            <p className="mt-1 text-xs font-mono text-slate-400">{rule.id}</p>
                                        </div>
                                        <Button
                                            variant="outline"
                                            className="gap-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                                            onClick={() => removeRuleProfile(index)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                            删除
                                        </Button>
                                    </div>
                                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                        <Field label="基础规则集">
                                            <Input value={rule.baseRuleSet} onChange={(event) => updateRule(index, 'baseRuleSet', event.target.value)} />
                                        </Field>
                                        <Field label="投放模式">
                                            <select
                                                className={selectClassName}
                                                value={rule.deliveryMode}
                                                onChange={(event) =>
                                                    updateRule(index, 'deliveryMode', event.target.value as RuleProfileConfig['deliveryMode'])
                                                }
                                            >
                                                <option value="shadow">shadow</option>
                                                <option value="group_chat_live">group_chat_live</option>
                                            </select>
                                        </Field>
                                        <Field label="观察窗口数">
                                            <Input
                                                type="number"
                                                value={rule.observationWindows}
                                                onChange={(event) => updateRule(index, 'observationWindows', Number(event.target.value))}
                                            />
                                        </Field>
                                        <Field label="连续命中次数">
                                            <Input
                                                type="number"
                                                value={rule.consecutiveHits}
                                                onChange={(event) => updateRule(index, 'consecutiveHits', Number(event.target.value))}
                                            />
                                        </Field>
                                        <Field label="冷却时间（分钟）">
                                            <Input
                                                type="number"
                                                value={rule.cooldownMinutes}
                                                onChange={(event) => updateRule(index, 'cooldownMinutes', Number(event.target.value))}
                                            />
                                        </Field>
                                    </div>
                                    <Field label="规则摘要">
                                        <textarea
                                            className={textareaClassName}
                                            rows={2}
                                            value={rule.summary}
                                            onChange={(event) => updateRule(index, 'summary', event.target.value)}
                                        />
                                    </Field>
                                </div>
                            ))}
                        </div>
                    </section>
                </div>
            </div>

            <section className="space-y-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="border-b border-slate-100 pb-4">
                    <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800">
                        <SlidersHorizontal className="h-5 w-5 text-indigo-600" />
                        编排与模型策略
                    </h3>
                    <p className="mt-1 text-sm text-slate-500">
                        维护 graph 版本、preferred_subagent 约束、RAG 策略和群聊/AI 导师模型分配。
                    </p>
                    <SectionMeta meta={configMeta.research_orchestration_profile} configKey="research_orchestration_profile" />
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <Field label="Graph 版本">
                        <Input value={orchestration.graphVersion} onChange={(event) => updateOrchestration('graphVersion', event.target.value)} />
                    </Field>
                    <Field label="preferred_subagent 约束">
                        <Input
                            value={orchestration.preferredSubagentPolicy}
                            onChange={(event) => updateOrchestration('preferredSubagentPolicy', event.target.value)}
                        />
                    </Field>
                    <Field label="群聊路由策略">
                        <textarea
                            className={textareaClassName}
                            rows={3}
                            value={orchestration.groupChatRouting}
                            onChange={(event) => updateOrchestration('groupChatRouting', event.target.value)}
                        />
                    </Field>
                    <Field label="AI 导师路由策略">
                        <textarea
                            className={textareaClassName}
                            rows={3}
                            value={orchestration.tutorRouting}
                            onChange={(event) => updateOrchestration('tutorRouting', event.target.value)}
                        />
                    </Field>
                    <Field label="RAG 策略">
                        <textarea
                            className={textareaClassName}
                            rows={3}
                            value={orchestration.ragStrategy}
                            onChange={(event) => updateOrchestration('ragStrategy', event.target.value)}
                        />
                    </Field>
                    <Field label="检索源">
                        <textarea
                            className={textareaClassName}
                            rows={3}
                            value={orchestration.retrievalSource}
                            onChange={(event) => updateOrchestration('retrievalSource', event.target.value)}
                        />
                    </Field>
                    <Field label="群聊默认模型">
                        <div className="relative">
                            <Cpu className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                                value={orchestration.groupChatModel}
                                onChange={(event) => updateOrchestration('groupChatModel', event.target.value)}
                                className="pl-9"
                            />
                        </div>
                    </Field>
                    <Field label="AI 导师默认模型">
                        <div className="relative">
                            <Cpu className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                                value={orchestration.tutorModel}
                                onChange={(event) => updateOrchestration('tutorModel', event.target.value)}
                                className="pl-9"
                            />
                        </div>
                    </Field>
                </div>
            </section>
        </div>
    )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="space-y-2">
            <span className="text-sm font-semibold text-slate-700">{label}</span>
            {children}
        </label>
    )
}

function SummaryCard({
    label,
    value,
    hint,
    tone = 'default',
}: {
    label: string
    value: string | number
    hint: string
    tone?: 'default' | 'success' | 'warning'
}) {
    const toneClassName =
        tone === 'success'
            ? 'border-emerald-100 bg-emerald-50 text-emerald-900'
            : tone === 'warning'
              ? 'border-amber-100 bg-amber-50 text-amber-900'
              : 'border-slate-100 bg-white text-slate-900'

    return (
        <div className={`rounded-2xl border p-4 shadow-sm ${toneClassName}`}>
            <p className="text-xs font-bold uppercase tracking-wider opacity-70">{label}</p>
            <p className="mt-2 text-2xl font-black tracking-tight">{value}</p>
            <p className="mt-1 text-xs opacity-80">{hint}</p>
        </div>
    )
}

function SectionMeta({
    meta,
    configKey,
}: {
    meta?: Pick<Config, 'updated_at' | 'updated_by' | 'description'>
    configKey: ResearchConfigKey
}) {
    return (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="rounded-full bg-slate-100 px-2 py-1 font-mono text-[11px]">{configKey}</span>
            <span>{meta?.updated_at ? `最近保存：${formatConfigTime(meta.updated_at)}` : '最近保存：尚无记录'}</span>
            {meta?.updated_by ? <span>{`更新人：${meta.updated_by}`}</span> : null}
        </div>
    )
}

function parseConfigValue<T>(value: string | undefined, fallback: T): T {
    if (!value) {
        return fallback
    }
    try {
        return JSON.parse(value) as T
    } catch (_error) {
        return fallback
    }
}

const selectClassName =
    'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100'

function buildResolvedExperimentVersionSnapshot(
    template: ExperimentTemplateConfig,
    orchestration: OrchestrationProfileConfig
): ResolvedExperimentVersionSnapshot {
    const enabledScaffoldLayers = ['multi_agent_scaffold']
    if (template.processMode === 'on') {
        enabledScaffoldLayers.push('process_scaffold')
    }

    const enabledScaffoldRoles =
        template.aiMode === 'single_agent' && template.processMode === 'off'
            ? ['cognitive_support']
            : ['cognitive_support', 'viewpoint_challenge', 'feedback_prompting', 'problem_progression']

    return {
        mode: 'research',
        version_name: template.id.trim(),
        stage_control_mode: 'soft_guidance',
        process_scaffold_mode: template.processMode,
        ai_scaffold_mode: template.aiMode,
        broadcast_stage_updates: true,
        group_condition: template.groupCondition.trim() || null,
        enabled_scaffold_layers: enabledScaffoldLayers,
        enabled_scaffold_roles: enabledScaffoldRoles,
        enabled_rule_set: template.ruleSet.trim() || null,
        export_profile: 'group-stage-features',
        stage_sequence: [...template.stageSequence],
        current_stage: template.stageSequence[0] || null,
        template_key: template.id.trim(),
        template_label: template.label.trim() || template.id.trim(),
        template_source: 'admin_release',
        graph_version: orchestration.graphVersion.trim() || 'research-graph-v2',
    }
}

function collectValidationIssues(
    templates: ExperimentTemplateConfig[],
    roles: AgentRoleConfig[],
    ruleProfiles: RuleProfileConfig[],
    orchestration: OrchestrationProfileConfig
) {
    const issues: string[] = []
    const templateIds = new Set<string>()
    const roleNames = new Set<string>()
    const ruleIds = new Set<string>()
    const availableRuleIds = new Set(ruleProfiles.map((rule) => rule.id.trim()).filter(Boolean))

    templates.forEach((template, index) => {
        const displayIndex = index + 1
        if (!template.id.trim()) issues.push(`模板 ${displayIndex} 缺少唯一标识符。`)
        if (template.id.trim()) {
            if (templateIds.has(template.id.trim())) {
                issues.push(`模板标识符 ${template.id.trim()} 重复。`)
            }
            templateIds.add(template.id.trim())
        }
        if (!template.label.trim()) issues.push(`模板 ${displayIndex} 缺少显示名称。`)
        if (!template.groupCondition.trim()) issues.push(`模板 ${displayIndex} 缺少组别条件。`)
        if (template.stageSequence.length === 0) issues.push(`模板 ${displayIndex} 至少需要 1 个阶段。`)
        if (!template.teacherSummary.trim()) issues.push(`模板 ${displayIndex} 缺少教师摘要。`)
        if (!availableRuleIds.has(template.ruleSet.trim())) {
            issues.push(`模板 ${displayIndex} 引用了不存在的规则集 ${template.ruleSet || '(空)'}。`)
        }
    })

    roles.forEach((role, index) => {
        const displayIndex = index + 1
        if (!role.name.trim()) issues.push(`角色 ${displayIndex} 缺少名称。`)
        if (role.name.trim()) {
            if (roleNames.has(role.name.trim())) {
                issues.push(`角色名称 ${role.name.trim()} 重复。`)
            }
            roleNames.add(role.name.trim())
        }
        if (!role.focus.trim()) issues.push(`角色 ${displayIndex} 缺少核心焦点说明。`)
        if (!role.interventionUse.trim()) issues.push(`角色 ${displayIndex} 缺少介入情境说明。`)
        if (!role.summary.trim()) issues.push(`角色 ${displayIndex} 缺少一句话摘要。`)
    })

    ruleProfiles.forEach((rule, index) => {
        const displayIndex = index + 1
        if (!rule.id.trim()) issues.push(`规则集 ${displayIndex} 缺少唯一标识符。`)
        if (rule.id.trim()) {
            if (ruleIds.has(rule.id.trim())) {
                issues.push(`规则集标识符 ${rule.id.trim()} 重复。`)
            }
            ruleIds.add(rule.id.trim())
        }
        if (!rule.label.trim()) issues.push(`规则集 ${displayIndex} 缺少显示名称。`)
        if (!rule.baseRuleSet.trim()) issues.push(`规则集 ${displayIndex} 缺少基础规则集。`)
        if (!Number.isFinite(rule.observationWindows) || rule.observationWindows < 1) {
            issues.push(`规则集 ${displayIndex} 的观察窗口数必须大于等于 1。`)
        }
        if (!Number.isFinite(rule.consecutiveHits) || rule.consecutiveHits < 1) {
            issues.push(`规则集 ${displayIndex} 的连续命中次数必须大于等于 1。`)
        }
        if (!Number.isFinite(rule.cooldownMinutes) || rule.cooldownMinutes < 0) {
            issues.push(`规则集 ${displayIndex} 的冷却时间不能小于 0。`)
        }
        if (!rule.summary.trim()) issues.push(`规则集 ${displayIndex} 缺少摘要说明。`)
    })

    if (!orchestration.graphVersion.trim()) issues.push('编排配置缺少 graph 版本。')
    if (!orchestration.preferredSubagentPolicy.trim()) issues.push('编排配置缺少 preferred_subagent 约束说明。')
    if (!orchestration.groupChatRouting.trim()) issues.push('编排配置缺少群聊路由策略。')
    if (!orchestration.tutorRouting.trim()) issues.push('编排配置缺少 AI 导师路由策略。')
    if (!orchestration.ragStrategy.trim()) issues.push('编排配置缺少 RAG 策略。')
    if (!orchestration.retrievalSource.trim()) issues.push('编排配置缺少检索源说明。')
    if (!orchestration.groupChatModel.trim()) issues.push('编排配置缺少群聊默认模型。')
    if (!orchestration.tutorModel.trim()) issues.push('编排配置缺少 AI 导师默认模型。')

    return issues
}

function extractConfigMeta(configs: Config[]): ConfigMeta {
    const metadata: ConfigMeta = {}
    configs.forEach((config) => {
        if (
            config.key === 'research_experiment_templates' ||
            config.key === 'research_agent_roles' ||
            config.key === 'research_rule_profiles' ||
            config.key === 'research_orchestration_profile' ||
            config.key === 'research_release_history'
        ) {
            metadata[config.key] = {
                updated_at: config.updated_at,
                updated_by: config.updated_by,
                description: config.description,
            }
        }
    })
    return metadata
}

function formatConfigTime(value?: string) {
    if (!value) {
        return '尚无记录'
    }
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return value
    }
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    })
}

function buildReleaseId(date: Date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hour = String(date.getHours()).padStart(2, '0')
    const minute = String(date.getMinutes()).padStart(2, '0')
    const second = String(date.getSeconds()).padStart(2, '0')
    return `release-${year}${month}${day}-${hour}${minute}${second}`
}
