import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
    AlertTriangle,
    ArrowLeftRight,
    CheckCircle2,
    Circle,
    FileText,
    HelpCircle,
    Lightbulb,
    MessageCircle,
    Puzzle,
    RefreshCw,
    Scale,
    Search,
    ShieldCheck,
    Smile,
    Target,
    Users,
    type LucideIcon,
} from 'lucide-react'
import { analyticsService, StudentProcessDashboard } from '../../../../services/api/analytics'

type StageStatus = StudentProcessDashboard['stages'][number]['status']
type GoalLevel = StudentProcessDashboard['criticalThinkingGoals'][number]['level']
type KnowledgeStructure = StudentProcessDashboard['knowledgeStructure']
type EvidenceContent = KnowledgeStructure['evidence']['content']
type StructureRow = {
    key: keyof KnowledgeStructure
    icon: LucideIcon
    label: string
    content: string | string[] | EvidenceContent
    status: string
}

const stageIcons = [HelpCircle, Search, Puzzle, Target]

const statusStyle: Record<StageStatus, { label: string; badge: string; icon: string; line: string }> = {
    completed: {
        label: '已完成',
        badge: 'bg-blue-50 text-blue-700',
        icon: 'bg-blue-600 text-white',
        line: 'bg-blue-500',
    },
    in_progress: {
        label: '进行中',
        badge: 'bg-emerald-50 text-emerald-700',
        icon: 'bg-emerald-600 text-white',
        line: 'bg-emerald-500',
    },
    needs_more: {
        label: '需补充',
        badge: 'bg-orange-50 text-orange-700',
        icon: 'bg-orange-500 text-white',
        line: 'bg-orange-400',
    },
    pending: {
        label: '待开始',
        badge: 'bg-slate-100 text-slate-500',
        icon: 'bg-slate-400 text-white',
        line: 'bg-slate-200',
    },
}

const goalIcons = {
    problem_clarity: HelpCircle,
    evidence_reliability: ShieldCheck,
    viewpoint_comparison: Scale,
    explanation_revision: FileText,
    transfer_application: ArrowLeftRight,
}

const levelStyle: Record<GoalLevel, { ring: string; badge: string; text: string }> = {
    良好: {
        ring: '#16a34a',
        badge: 'bg-emerald-50 text-emerald-700',
        text: 'text-emerald-700',
    },
    发展中: {
        ring: '#2563eb',
        badge: 'bg-blue-50 text-blue-700',
        text: 'text-blue-700',
    },
    需加强: {
        ring: '#f97316',
        badge: 'bg-orange-50 text-orange-700',
        text: 'text-orange-700',
    },
    待开始: {
        ring: '#94a3b8',
        badge: 'bg-slate-100 text-slate-500',
        text: 'text-slate-500',
    },
}

const regulationStyle: Record<string, { icon: typeof Target; color: string; bg: string }> = {
    目标调节: { icon: Target, color: 'text-blue-700', bg: 'bg-blue-50' },
    过程监控: { icon: Search, color: 'text-emerald-700', bg: 'bg-emerald-50' },
    策略协同: { icon: Puzzle, color: 'text-violet-700', bg: 'bg-violet-50' },
    情绪协调: { icon: Smile, color: 'text-orange-700', bg: 'bg-orange-50' },
}

function isEvidenceContent(value: StructureRow['content']): value is EvidenceContent {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function structureStatusClass(status: string) {
    if (status.includes('暂缺')) {
        return 'bg-slate-100 text-slate-500 ring-1 ring-slate-200'
    }
    if (status.includes('待核查') || status.includes('需聚焦')) {
        return 'bg-orange-50 text-orange-700 ring-1 ring-orange-100'
    }
    if (status.includes('部分') || status.includes('已有线索') || status.includes('已有草稿')) {
        return 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'
    }
    return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
}

function formatUpdatedAt(value?: string) {
    if (!value) return '暂无'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    })
}

function CircularProgress({
    score,
    label,
    color,
}: {
    score: number
    label: string
    color: string
}) {
    const radius = 31
    const circumference = 2 * Math.PI * radius
    const offset = circumference - (Math.max(0, Math.min(score, 100)) / 100) * circumference

    return (
        <svg viewBox="0 0 82 82" className="h-16 w-16 shrink-0">
            <circle cx="41" cy="41" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="8" />
            <circle
                cx="41"
                cy="41"
                r={radius}
                fill="none"
                stroke={color}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                transform="rotate(-90 41 41)"
            />
            <text x="41" y="38" textAnchor="middle" className="fill-slate-900 text-[12px] font-bold">
                {label.length > 3 ? label.slice(0, 3) : label}
            </text>
            <text x="41" y="53" textAnchor="middle" className="fill-slate-500 text-[9px]">
                {score}
            </text>
        </svg>
    )
}

export default function LearningDashboard() {
    const { projectId } = useParams<{ projectId?: string }>()
    const [dashboardData, setDashboardData] = useState<StudentProcessDashboard | null>(null)
    const [loading, setLoading] = useState(true)
    const [refreshing, setRefreshing] = useState(false)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    const fetchDashboardData = useCallback(async (showLoading = false) => {
        if (!projectId) return
        try {
            if (showLoading) setLoading(true)
            setRefreshing(true)
            setErrorMessage(null)
            const data = await analyticsService.getStudentProcessDashboard(projectId)
            setDashboardData(data)
        } catch (error) {
            console.error('Failed to fetch student process dashboard:', error)
            setErrorMessage('学习分析数据暂时无法加载，请稍后重试。')
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }, [projectId])

    useEffect(() => {
        fetchDashboardData(true)
        const intervalId = window.setInterval(() => fetchDashboardData(false), 5 * 60 * 1000)
        return () => window.clearInterval(intervalId)
    }, [fetchDashboardData])

    const structureRows = useMemo<StructureRow[]>(() => {
        if (!dashboardData) return []
        const structure = dashboardData.knowledgeStructure
        return [
            { key: 'coreQuestion', icon: HelpCircle, ...structure.coreQuestion },
            { key: 'mainViewpoints', icon: Users, ...structure.mainViewpoints },
            { key: 'evidence', icon: FileText, ...structure.evidence },
            { key: 'currentExplanation', icon: Lightbulb, ...structure.currentExplanation },
            { key: 'transferApplication', icon: Target, ...structure.transferApplication },
        ]
    }, [dashboardData])

    if (loading) {
        return <div className="p-6 text-sm text-slate-500">加载中...</div>
    }

    if (!dashboardData) {
        return <div className="p-6 text-sm text-slate-500">{errorMessage || '无法加载仪表盘数据'}</div>
    }

    const currentStage = dashboardData.stages.find((stage) => stage.key === dashboardData.currentStage)
    const suggestionStyle = regulationStyle[dashboardData.nextSuggestion.regulationType] || regulationStyle['过程监控']
    const SuggestionIcon = suggestionStyle.icon

    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-3 text-slate-900 sm:p-5">
            <div className="mx-auto flex max-w-[1360px] flex-col gap-4">
                <header className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white">
                            <Users className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-baseline gap-3">
                                <h1 className="text-xl font-bold tracking-normal text-slate-950 sm:text-2xl">{dashboardData.dashboardTitle}</h1>
                                <span className="text-xs text-slate-500 sm:text-sm">{dashboardData.subtitle}</span>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500 sm:text-sm">
                        <span>更新时间：{formatUpdatedAt(dashboardData.updatedAt)}</span>
                        <button
                            type="button"
                            onClick={() => fetchDashboardData(false)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-blue-100 bg-white text-blue-600 shadow-sm transition hover:bg-blue-50 disabled:opacity-60"
                            disabled={refreshing}
                            title="刷新学习分析结果"
                        >
                            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </header>

                <section className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
                    <div className="mb-4 flex flex-wrap items-center gap-3">
                        <h2 className="text-lg font-bold text-blue-700 sm:text-xl">1. 学习进程</h2>
                        <span className="text-sm text-slate-500">
                            当前处于：<span className="font-semibold text-emerald-700">{currentStage?.name || '问题建构'}阶段</span>
                        </span>
                    </div>
                    <div className="grid gap-4 2xl:grid-cols-[1fr_270px]">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            {dashboardData.stages.map((stage, index) => {
                                const Icon = stageIcons[index] || Circle
                                const style = statusStyle[stage.status]
                                return (
                                    <div key={stage.key} className="relative min-h-[116px] rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                                        <div className="flex items-start gap-2.5">
                                            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${style.icon}`}>
                                                <Icon className="h-[18px] w-[18px]" />
                                            </div>
                                            <div className="min-w-0">
                                                <h3 className="text-sm font-bold leading-5 text-slate-900">{stage.name}</h3>
                                                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{stage.description}</p>
                                                <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${style.badge}`}>
                                                    {style.label}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="absolute bottom-3 left-3 right-3 h-1.5 rounded-full bg-slate-200">
                                            <div className={`h-full rounded-full ${style.line}`} style={{ width: stage.status === 'pending' ? '18%' : stage.status === 'needs_more' ? '45%' : '100%' }} />
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                        <aside className="rounded-xl bg-blue-50 p-4">
                            <div className="mb-3 flex items-center justify-between">
                                <h3 className="font-bold text-blue-700">{dashboardData.stageTip.title}</h3>
                                <Lightbulb className="h-6 w-6 text-blue-500" />
                            </div>
                            <p className="text-sm leading-7 text-slate-700">{dashboardData.stageTip.content}</p>
                        </aside>
                    </div>
                </section>

                <div className="grid gap-4 2xl:grid-cols-[minmax(0,0.95fr)_minmax(540px,1.05fr)]">
                    <section className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
                        <div className="mb-4 flex flex-wrap items-baseline gap-3">
                            <h2 className="text-lg font-bold text-blue-700 sm:text-xl">2. 批判性思维目标表现</h2>
                            <span className="text-sm text-slate-500">五个关键目标达成度</span>
                        </div>
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
                            {dashboardData.criticalThinkingGoals.map((goal) => {
                                const Icon = goalIcons[goal.key as keyof typeof goalIcons] || HelpCircle
                                const style = levelStyle[goal.level]
                                return (
                                    <article
                                        key={goal.key}
                                        className="min-w-0 rounded-xl border border-slate-100 bg-white p-3 shadow-sm"
                                        title={goal.description}
                                    >
                                        <div className="flex items-start gap-2">
                                            <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${style.text}`} />
                                            <h3 className="text-sm font-bold leading-5 text-slate-900">{goal.name}</h3>
                                        </div>
                                        <div className="mt-3 flex items-center gap-3">
                                            <CircularProgress score={goal.score} label={goal.level} color={style.ring} />
                                            <div className="min-w-0">
                                                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${style.badge}`}>{goal.level}</span>
                                                <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-600">{goal.description}</p>
                                            </div>
                                        </div>
                                    </article>
                                )
                            })}
                        </div>
                        <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
                            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-600" />良好</span>
                            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-600" />发展中</span>
                            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-orange-500" />需加强</span>
                            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-slate-400" />待开始</span>
                        </div>
                    </section>

                    <section className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
                        <div className="mb-4 flex flex-wrap items-baseline gap-3">
                            <h2 className="text-lg font-bold text-blue-700 sm:text-xl">3. 证据与观点结构</h2>
                            <span className="text-sm text-slate-500">知识建构线索</span>
                        </div>
                        <div className="space-y-3">
                            {structureRows.map((row) => {
                                const Icon = row.icon
                                return (
                                    <div key={row.key} className="grid gap-2 rounded-xl border border-slate-100 bg-slate-50/70 p-3 sm:grid-cols-[112px_minmax(0,1fr)] lg:grid-cols-[112px_minmax(0,1fr)_112px]">
                                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                                            <Icon className="h-[18px] w-[18px] shrink-0 text-blue-600" />
                                            <span>{row.label}</span>
                                        </div>
                                        <div className="min-w-0 text-sm leading-6 text-slate-700">
                                            {isEvidenceContent(row.content) ? (
                                                <div className="flex flex-wrap gap-2">
                                                    <span className="rounded-lg bg-white px-2.5 py-1 text-xs">支持证据 {row.content.supportingEvidence} 条</span>
                                                    <span className="rounded-lg bg-white px-2.5 py-1 text-xs">反对证据 {row.content.counterEvidence} 条</span>
                                                    <span className="rounded-lg bg-white px-2.5 py-1 text-xs">待核查证据 {row.content.uncheckedEvidence} 条</span>
                                                </div>
                                            ) : Array.isArray(row.content) ? (
                                                <div className="flex flex-wrap gap-2">
                                                    {row.content.map((item) => (
                                                        <span key={item} className="max-w-full rounded-lg bg-white px-2.5 py-1 text-xs leading-5">{item}</span>
                                                    ))}
                                                </div>
                                            ) : (
                                                <p className="line-clamp-3">{String(row.content || '')}</p>
                                            )}
                                        </div>
                                        <div className="flex items-center sm:col-start-2 lg:col-start-auto lg:justify-end">
                                            <span className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold shadow-sm ${structureStatusClass(row.status)}`}>
                                                {row.status}
                                            </span>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </section>
                </div>

                <div className="grid gap-4 2xl:grid-cols-[1.25fr_0.9fr]">
                    <section className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
                        <div className="mb-4 flex flex-wrap items-baseline gap-3">
                            <h2 className="text-lg font-bold text-blue-700 sm:text-xl">4. 下一步协作建议</h2>
                            <span className="text-sm text-slate-500">基于当前学习状态，从共享调节维度提供建议</span>
                        </div>
                        <div className="flex flex-wrap items-start gap-4">
                            <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full ${suggestionStyle.bg} sm:h-20 sm:w-20`}>
                                <SuggestionIcon className={`h-8 w-8 sm:h-10 sm:w-10 ${suggestionStyle.color}`} />
                            </div>
                            <div className="min-w-0 flex-1 basis-[260px]">
                                <h3 className={`text-base font-bold sm:text-lg ${suggestionStyle.color}`}>
                                    重点建议方向：{dashboardData.nextSuggestion.regulationType}
                                </h3>
                                <p className="mt-2 text-sm leading-6 text-slate-700">{dashboardData.nextSuggestion.currentObservation}</p>
                                <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3.5 py-3 text-sm leading-6 text-slate-800">
                                    <span className="font-semibold text-emerald-700">建议行动：</span>
                                    {dashboardData.nextSuggestion.suggestedAction}
                                </div>
                            </div>
                            <aside className="min-w-0 flex-1 basis-[220px] rounded-xl bg-slate-50 p-4 xl:max-w-[280px]">
                                <h4 className="mb-3 font-bold text-slate-800">建议依据</h4>
                                <ul className="space-y-2 text-sm leading-6 text-slate-700">
                                    {dashboardData.nextSuggestion.basis.map((item) => (
                                        <li key={item} className="flex gap-2">
                                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
                                            <span>{item}</span>
                                        </li>
                                    ))}
                                </ul>
                            </aside>
                        </div>
                    </section>

                    <section className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm sm:p-5">
                        <h2 className="mb-4 text-lg font-bold text-blue-700 sm:text-xl">5. 小组协作温度</h2>
                        <div className="grid gap-4 md:grid-cols-[160px_1fr]">
                            <div className="flex items-center gap-4">
                                <CircularProgress
                                    score={dashboardData.collaborationTemperature.score}
                                    label=""
                                    color="#2563eb"
                                />
                                <div>
                                    <div className="text-4xl font-bold text-slate-950">
                                        {dashboardData.collaborationTemperature.score}
                                        <span className="text-lg font-medium text-slate-500">/100</span>
                                    </div>
                                    <div className="mt-1 text-lg text-slate-700">{dashboardData.collaborationTemperature.level}</div>
                                </div>
                            </div>
                            <div className="space-y-2">
                                {dashboardData.collaborationTemperature.indicators.map((item, index) => {
                                    const icons = [FileText, Lightbulb, MessageCircle, Smile]
                                    const Icon = icons[index] || AlertTriangle
                                    return (
                                        <div key={item.name} className="flex items-center gap-3 text-sm text-slate-700">
                                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                                                <Icon className="h-4 w-4" />
                                            </span>
                                            <span>{item.name}：{item.value}</span>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                        <div className="mt-4 flex items-start gap-2 rounded-xl bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-700">
                            <MessageCircle className="mt-0.5 h-5 w-5 shrink-0" />
                            <span>小提示：{dashboardData.collaborationTemperature.tip}</span>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    )
}
