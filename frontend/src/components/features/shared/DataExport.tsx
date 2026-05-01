import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Database, Download, FileText, Loader2 } from 'lucide-react'
import { analyticsService } from '../../../services/api/analytics'
import { projectService } from '../../../services/api/project'
import { Project } from '../../../types'

const EXPORT_OPTIONS = [
    {
        key: 'researchHealth',
        label: '研究数据健康快照',
        description: '研究事件数量、关键事件覆盖、最近事件时间。',
    },
    {
        key: 'dashboard',
        label: '学习仪表盘与 4C 摘要',
        description: '学生反馈仪表盘所用的聚合指标与解释字段。',
    },
    {
        key: 'researchEvents',
        label: '结构化研究事件',
        description: 'dialogue、scaffold、inquiry_structure、shared_record、stage_transition 等事件。',
    },
    {
        key: 'groupStageFeatures',
        label: '小组-阶段聚合特征',
        description: '用于阶段比较、K-means、过程特征建模的宽表。',
    },
    {
        key: 'lsaReady',
        label: 'LSA/HMM 序列数据',
        description: '按时间排序的事件符号序列，可直接进入序列分析。',
    },
    {
        key: 'groupChat',
        label: '小组聊天全文',
        description: '同伴消息、AI 提及、多智能体回复、路由摘要与时间戳。',
    },
    {
        key: 'aiTutor',
        label: 'AI 导师个人对话',
        description: '个人问答轮次、主要视角、处理摘要、引用来源。',
    },
    {
        key: 'activityLogs',
        label: '活动日志',
        description: '被提升为业务行为的打开、编辑、上传、发送、删除等记录。',
    },
    {
        key: 'behaviorStream',
        label: '高频行为流',
        description: '页面停留、点击等原始行为流，用于辅助诊断过程数据。',
    },
] as const

type ExportDataKey = typeof EXPORT_OPTIONS[number]['key']
type Notice = { type: 'success' | 'error'; message: string } | null

const DEFAULT_DATA_TYPES = EXPORT_OPTIONS.reduce((acc, option) => {
    acc[option.key] = true
    return acc
}, {} as Record<ExportDataKey, boolean>)

const getDateRange = (dateRange: string) => {
    if (dateRange === 'all') return {}
    const days = Number(dateRange)
    if (!Number.isFinite(days)) return {}

    const end = new Date()
    const start = new Date()
    start.setDate(end.getDate() - days)
    return {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
    }
}

const downloadJson = (payload: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
}

export default function DataExport() {
    const [projects, setProjects] = useState<Project[]>([])
    const [projectId, setProjectId] = useState('')
    const [dateRange, setDateRange] = useState('30')
    const [dataTypes, setDataTypes] = useState<Record<ExportDataKey, boolean>>(DEFAULT_DATA_TYPES)
    const [loadingProjects, setLoadingProjects] = useState(true)
    const [isExporting, setIsExporting] = useState(false)
    const [notice, setNotice] = useState<Notice>(null)

    const selectedProject = useMemo(
        () => projects.find((project) => project.id === projectId) || null,
        [projects, projectId]
    )

    const selectedKeys = useMemo(
        () => EXPORT_OPTIONS.filter((option) => dataTypes[option.key]).map((option) => option.key),
        [dataTypes]
    )

    useEffect(() => {
        let cancelled = false
        const fetchProjects = async () => {
            try {
                setLoadingProjects(true)
                const data = await projectService.getProjects()
                if (cancelled) return
                setProjects(data.projects)
                setProjectId((previous) => {
                    if (previous && data.projects.some((project) => project.id === previous)) return previous
                    return data.projects[0]?.id || ''
                })
            } catch (error) {
                console.error('Failed to fetch projects for export:', error)
                if (!cancelled) {
                    setNotice({ type: 'error', message: '无法读取小组项目列表，请确认当前账号是否有导出权限。' })
                }
            } finally {
                if (!cancelled) setLoadingProjects(false)
            }
        }

        void fetchProjects()
        return () => {
            cancelled = true
        }
    }, [])

    const collectOne = async (key: ExportDataKey, startDate?: string, endDate?: string) => {
        switch (key) {
            case 'researchHealth':
                return analyticsService.getResearchHealth(projectId)
            case 'dashboard':
                return analyticsService.getDashboardData(projectId, undefined, startDate, endDate)
            case 'researchEvents':
                return analyticsService.getResearchEvents(projectId, { start_date: startDate, end_date: endDate, limit: 50000 })
            case 'groupStageFeatures':
                return analyticsService.getGroupStageFeatures(projectId)
            case 'lsaReady':
                return analyticsService.getLSAReady(projectId)
            case 'groupChat':
                return analyticsService.getGroupChatTranscripts(projectId, { start_date: startDate, end_date: endDate, limit: 50000 })
            case 'aiTutor':
                return analyticsService.getAITutorTranscripts(projectId, { start_date: startDate, end_date: endDate, limit: 50000 })
            case 'activityLogs':
                return analyticsService.getActivityLogs(projectId, startDate, endDate)
            case 'behaviorStream':
                return analyticsService.getBehaviorStream(projectId, startDate, endDate)
            default:
                return null
        }
    }

    const handleExport = async () => {
        if (!projectId || selectedKeys.length === 0) {
            setNotice({ type: 'error', message: '请先选择小组项目，并至少勾选一类导出数据。' })
            return
        }

        const { startDate, endDate } = getDateRange(dateRange)
        setIsExporting(true)
        setNotice(null)

        const data: Record<string, unknown> = {}
        const errors: Record<string, string> = {}

        for (const key of selectedKeys) {
            try {
                data[key] = await collectOne(key, startDate, endDate)
            } catch (error: any) {
                console.error(`Export ${key} failed:`, error)
                errors[key] = error?.response?.data?.detail || error?.message || '导出失败'
            }
        }

        const payload = {
            schema_version: 'aiscl-research-export-v1',
            exported_at: new Date().toISOString(),
            project: selectedProject
                ? {
                    id: selectedProject.id,
                    name: selectedProject.name,
                    course_id: selectedProject.course_id || null,
                    experiment_version: selectedProject.experiment_version
                        ? {
                            version_name: selectedProject.experiment_version.version_name,
                            template_key: selectedProject.experiment_version.template_key || null,
                            current_stage: selectedProject.experiment_version.current_stage || null,
                        }
                        : null,
                }
                : { id: projectId },
            range: {
                preset: dateRange,
                start_date: startDate || null,
                end_date: endDate || null,
            },
            included: selectedKeys,
            data,
            errors,
        }

        const safeName = selectedProject?.name?.replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]+/g, '_') || projectId
        downloadJson(payload, `AISCL_${safeName}_research_export_${new Date().toISOString().slice(0, 10)}.json`)

        setNotice(
            Object.keys(errors).length > 0
                ? { type: 'error', message: `数据包已生成，但有 ${Object.keys(errors).length} 类数据导出失败，请查看 JSON 中的 errors 字段。` }
                : { type: 'success', message: '真实研究数据包已生成并开始下载。' }
        )
        setIsExporting(false)
    }

    return (
        <div className="rounded-3xl border border-gray-100 bg-white p-6 text-left shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h3 className="flex items-center gap-2 text-lg font-bold text-gray-900">
                        <Database className="h-5 w-5 text-indigo-600" />
                        共享研究数据导出
                    </h3>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">
                        导出当前教师可管理小组的真实研究数据包，用于预测试、正式实验后续的 4C、LSA/HMM、聚类和过程机制分析。
                    </p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
                    <div className="font-bold text-slate-700">数据口径</div>
                    <div>按项目/小组导出；不会包含 MinIO 文件本体，只包含资源与行为元数据。</div>
                </div>
            </div>

            {notice && (
                <div className={`mt-5 flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm leading-6 ${notice.type === 'success'
                    ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                    : 'border-rose-100 bg-rose-50 text-rose-700'
                    }`}>
                    {notice.type === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <AlertCircle className="mt-0.5 h-4 w-4" />}
                    <span>{notice.message}</span>
                </div>
            )}

            <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <label className="mb-1 block text-sm font-bold text-gray-700">导出小组项目</label>
                            <select
                                value={projectId}
                                onChange={(event) => setProjectId(event.target.value)}
                                disabled={loadingProjects || projects.length === 0}
                                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-400"
                            >
                                {projects.map((project) => (
                                    <option key={project.id} value={project.id}>
                                        {project.name}
                                    </option>
                                ))}
                                {projects.length === 0 && <option value="">暂无可导出小组</option>}
                            </select>
                        </div>

                        <div>
                            <label className="mb-1 block text-sm font-bold text-gray-700">时间范围</label>
                            <select
                                value={dateRange}
                                onChange={(event) => setDateRange(event.target.value)}
                                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                            >
                                <option value="7">最近 7 天</option>
                                <option value="30">最近 30 天</option>
                                <option value="90">最近 3 个月</option>
                                <option value="all">全部时间</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <div className="mb-3 flex items-center justify-between">
                            <label className="text-sm font-bold text-gray-700">导出内容</label>
                            <button
                                type="button"
                                onClick={() => {
                                    const shouldSelectAll = selectedKeys.length !== EXPORT_OPTIONS.length
                                    setDataTypes(EXPORT_OPTIONS.reduce((acc, option) => {
                                        acc[option.key] = shouldSelectAll
                                        return acc
                                    }, {} as Record<ExportDataKey, boolean>))
                                }}
                                className="text-xs font-bold text-indigo-600 hover:text-indigo-700"
                            >
                                {selectedKeys.length === EXPORT_OPTIONS.length ? '取消全选' : '全选'}
                            </button>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                            {EXPORT_OPTIONS.map((option) => (
                                <label
                                    key={option.key}
                                    className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3 transition hover:border-indigo-100 hover:bg-indigo-50/50"
                                >
                                    <input
                                        type="checkbox"
                                        checked={dataTypes[option.key]}
                                        onChange={(event) => setDataTypes({ ...dataTypes, [option.key]: event.target.checked })}
                                        className="mt-1 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <span>
                                        <span className="block text-sm font-bold text-slate-800">{option.label}</span>
                                        <span className="mt-1 block text-xs leading-5 text-slate-500">{option.description}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="rounded-3xl border border-indigo-100 bg-indigo-50/60 p-4">
                    <div className="flex items-center gap-2 text-sm font-bold text-indigo-900">
                        <FileText className="h-4 w-4" />
                        导出说明
                    </div>
                    <div className="mt-3 space-y-2 text-xs leading-5 text-indigo-800">
                        <p>1. 结构化研究事件用于解释“发生了什么”。</p>
                        <p>2. 聊天和 AI 导师全文用于 ONA/LSA、内容编码和质性补充。</p>
                        <p>3. 小组-阶段特征与 LSA/HMM 序列用于第六章过程模式分析。</p>
                        <p>4. 行为流体量较大，正式实验前建议先做一次小范围导出演练。</p>
                    </div>
                    <button
                        onClick={handleExport}
                        disabled={isExporting || loadingProjects || !projectId || selectedKeys.length === 0}
                        className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-100 transition hover:bg-indigo-700 disabled:bg-indigo-300"
                    >
                        {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        {isExporting ? '正在读取真实数据...' : '导出 JSON 数据包'}
                    </button>
                </div>
            </div>
        </div>
    )
}
