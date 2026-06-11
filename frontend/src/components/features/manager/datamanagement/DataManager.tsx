import { useCallback, useEffect, useState } from 'react'
import { Archive, BarChart3, Database, Download, FileArchive, Loader2, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react'
import { Button, Input, Badge } from '../../../ui'
import { adminService, type DataProject, type DataRetentionPreview, type DataStorageOverview, type DataStorageProject, type ExportJob } from '../../../../services/api/admin'
import { courseService, type Course } from '../../../../services/api/course'

export default function DataManager() {
    const [overview, setOverview] = useState<DataStorageOverview | null>(null)
    const [storageRows, setStorageRows] = useState<DataStorageProject[]>([])
    const [projects, setProjects] = useState<DataProject[]>([])
    const [courses, setCourses] = useState<Course[]>([])
    const [selectedCourseId, setSelectedCourseId] = useState('')
    const [includeFiles, setIncludeFiles] = useState(false)
    const [includeRawHeartbeat, setIncludeRawHeartbeat] = useState(false)
    const [retention, setRetention] = useState<DataRetentionPreview | null>(null)
    const [search, setSearch] = useState('')
    const [olderThanDays, setOlderThanDays] = useState(90)
    const [notice, setNotice] = useState('')
    const [exportJob, setExportJob] = useState<ExportJob | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [isBusy, setIsBusy] = useState(false)
    const [isExportingCourse, setIsExportingCourse] = useState(false)
    const [isDownloadingExport, setIsDownloadingExport] = useState(false)

    const fetchAll = useCallback(async () => {
        try {
            setIsLoading(true)
            const [overviewData, storageData, retentionData, projectData, courseData] = await Promise.all([
                adminService.getDataStorageOverview(),
                adminService.getDataStorageByProject(50),
                adminService.getDataRetentionPreview(olderThanDays),
                adminService.getDataProjects({ page: 1, limit: 20 }),
                courseService.getCourses(),
            ])
            setOverview(overviewData)
            setStorageRows(storageData.items || [])
            setRetention(retentionData)
            setProjects(projectData.items || [])
            setCourses(courseData)
            setSelectedCourseId((current) => current || courseData[0]?.id || '')
        } catch (error) {
            console.error('Failed to load data manager:', error)
            setNotice('数据管理信息加载失败，请检查管理员权限或后端状态。')
        } finally {
            setIsLoading(false)
        }
    }, [olderThanDays])

    const fetchProjects = useCallback(async () => {
        try {
            const projectData = await adminService.getDataProjects({ page: 1, limit: 20, search: search.trim() || undefined })
            setProjects(projectData.items || [])
        } catch (error) {
            console.error('Failed to fetch data projects:', error)
        }
    }, [search])

    useEffect(() => {
        void fetchAll()
    }, [fetchAll])

    useEffect(() => {
        const timer = window.setTimeout(() => void fetchProjects(), 250)
        return () => window.clearTimeout(timer)
    }, [fetchProjects])

    const refreshRetention = async () => {
        const data = await adminService.getDataRetentionPreview(olderThanDays)
        setRetention(data)
    }

    const cleanupOperational = async () => {
        try {
            setIsBusy(true)
            const result = await adminService.runDataRetentionCleanup({
                collections: ['behavior_stream', 'heartbeat_stream'],
                older_than_days: olderThanDays,
                confirm_operational_only: true,
            })
            setNotice(`已清理运维数据：${JSON.stringify(result.deleted)}`)
            await Promise.all([refreshRetention(), fetchAll()])
        } catch (error) {
            console.error('Failed to cleanup retention data:', error)
            setNotice(getErrorDetail(error, '清理失败。研究核心数据默认不会被清理。'))
        } finally {
            setIsBusy(false)
        }
    }

    const toggleArchive = async (project: DataProject) => {
        try {
            setIsBusy(true)
            if (project.is_archived) {
                await adminService.unarchiveDataProject(project.id)
                setNotice(`已取消归档：${project.name}`)
            } else {
                await adminService.archiveDataProject(project.id)
                setNotice(`已归档：${project.name}`)
            }
            await fetchProjects()
        } catch (error) {
            console.error('Failed to update project archive state:', error)
            setNotice('项目归档状态更新失败。')
        } finally {
            setIsBusy(false)
        }
    }

    const downloadConfigBackup = async () => {
        const data = await adminService.backupConfigs()
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = window.URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `aiscl_config_backup_${new Date().toISOString().slice(0, 10)}.json`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        window.URL.revokeObjectURL(url)
    }

    const downloadCourseResearchPackage = async () => {
        if (!selectedCourseId) {
            setNotice('请先选择要导出的班级。')
            return
        }
        try {
            setIsExportingCourse(true)
            const job = await adminService.createCourseResearchPackageJob(selectedCourseId, {
                include_files: includeFiles,
                include_raw_heartbeat: includeRawHeartbeat,
            })
            setExportJob(job)
            const course = courses.find((item) => item.id === selectedCourseId)
            setNotice(`已创建班级研究数据包导出任务：${course?.name || selectedCourseId}`)
        } catch (error) {
            console.error('Failed to export course research package:', error)
            setNotice(await getDownloadErrorDetail(error, '班级研究数据包导出任务创建失败，请检查后端日志或稍后重试。'))
        } finally {
            setIsExportingCourse(false)
        }
    }

    useEffect(() => {
        if (!exportJob?.id || !['queued', 'running'].includes(exportJob.status)) return
        const timer = window.setInterval(async () => {
            try {
                const latest = await adminService.getExportJob(exportJob.id)
                setExportJob(latest)
                if (latest.status === 'completed') {
                    setNotice('班级研究数据包已生成，可以下载。')
                }
                if (latest.status === 'failed') {
                    setNotice(`班级研究数据包生成失败：${latest.error || latest.message || '未知错误'}`)
                }
            } catch (error) {
                console.error('Failed to refresh export job:', error)
            }
        }, 2500)
        return () => window.clearInterval(timer)
    }, [exportJob?.id, exportJob?.status])

    const downloadCompletedExportJob = async () => {
        if (!exportJob || exportJob.status !== 'completed' || isDownloadingExport) return
        try {
            setIsDownloadingExport(true)
            setNotice('正在下载班级研究数据包，请稍候。文件较大时浏览器可能需要等待几秒。')
            await adminService.downloadExportJob(exportJob)
            setNotice('已触发下载。如果浏览器没有弹出下载，请检查是否拦截了下载，或稍后重试。')
        } catch (error) {
            console.error('Failed to download export job:', error)
            setNotice(await getDownloadErrorDetail(error, '下载导出文件失败，请稍后重试。'))
        } finally {
            setIsDownloadingExport(false)
        }
    }

    if (isLoading) {
        return (
            <div className="flex h-[420px] items-center justify-center text-slate-400">
                <Loader2 className="mr-2 h-6 w-6 animate-spin text-indigo-600" />
                正在加载研究数据管理信息...
            </div>
        )
    }

    return (
        <div className="space-y-6 animate-fadeIn">
            <div className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm xl:flex-row xl:items-start xl:justify-between">
                <div>
                    <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-800">
                        <Database className="h-6 w-6 text-indigo-600" />
                        数据管理
                    </h2>
                    <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                        面向研究数据的存储统计、保留策略、项目归档、统一导出与配置备份。研究核心数据默认保护，不参与一键清理。
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" className="gap-2" onClick={fetchAll}>
                        <RotateCcw className="h-4 w-4" />
                        刷新
                    </Button>
                    <Button variant="outline" className="gap-2" onClick={downloadConfigBackup}>
                        <FileArchive className="h-4 w-4" />
                        配置备份
                    </Button>
                    <Button className="gap-2 bg-indigo-600 text-white hover:bg-indigo-700" onClick={() => adminService.exportResearchData({ format: 'csv' })}>
                        <Download className="h-4 w-4" />
                        导出研究数据
                    </Button>
                </div>
            </div>

            {notice ? <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-medium text-indigo-800">{notice}</div> : null}

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <MetricCard label="资源文件" value={overview?.resource_count || 0} hint={formatBytes(overview?.total_resource_size || 0)} />
                <MetricCard label="项目数" value={overview?.project_count || 0} hint={`归档 ${overview?.archived_project_count || 0} 个`} />
                <MetricCard label="研究事件" value={overview?.research_event_count || 0} hint="结构化研究日志" />
                <MetricCard label="聊天/AI记录" value={(overview?.group_chat_count || 0) + (overview?.ai_message_count || 0)} hint="群聊与 AI 对话" />
            </div>

            <section className="rounded-2xl border border-indigo-100 bg-white p-6 shadow-sm">
                <div className="mb-5 flex flex-col gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800">
                            <FileArchive className="h-5 w-5 text-indigo-600" />
                            班级研究数据包
                        </h3>
                        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                            默认生成轻量研究包：以小组为主要分析单位，按小组隔离 process/content 数据，并通过 event_id、content_ref 对齐行为与对话、文档、AI 回复等内容。资料文件和原始心跳只在复核时按需附带。
                        </p>
                    </div>
                    <Button
                        disabled={isExportingCourse || !selectedCourseId}
                        onClick={downloadCourseResearchPackage}
                        className="gap-2 bg-indigo-600 text-white hover:bg-indigo-700"
                    >
                        {isExportingCourse ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        导出班级数据包
                    </Button>
                </div>
                <div className="grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_1fr]">
                    <label className="space-y-2">
                        <span className="text-sm font-semibold text-slate-700">选择班级</span>
                        <select
                            value={selectedCourseId}
                            onChange={(event) => setSelectedCourseId(event.target.value)}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                        >
                            {courses.length === 0 ? <option value="">暂无班级</option> : null}
                            {courses.map((course) => (
                                <option key={course.id} value={course.id}>
                                    {course.name}{course.semester ? ` · ${course.semester}` : ''}
                                </option>
                            ))}
                        </select>
                    </label>
                    <div className="grid gap-3 md:grid-cols-2">
                        <label className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                            <input
                                type="checkbox"
                                checked={includeFiles}
                                onChange={(event) => setIncludeFiles(event.target.checked)}
                                className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span>
                                <span className="block text-sm font-bold text-slate-800">附带资料文件</span>
                                <span className="mt-1 block text-xs leading-5 text-slate-500">额外打包资源、任务成果附件和文档 HTML；文件多时会显著延长导出时间，默认不勾选。</span>
                            </span>
                        </label>
                        <label className="flex items-start gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                            <input
                                type="checkbox"
                                checked={includeRawHeartbeat}
                                onChange={(event) => setIncludeRawHeartbeat(event.target.checked)}
                                className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span>
                                <span className="block text-sm font-bold text-slate-800">附带原始心跳</span>
                                <span className="mt-1 block text-xs leading-5 text-slate-500">默认只导出会话化心跳；原始心跳量大，通常只在复核时使用。</span>
                            </span>
                        </label>
                    </div>
                </div>
                {exportJob ? (
                    <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-800">
                                    <span>导出任务</span>
                                    <Badge variant={exportJob.status === 'completed' ? 'default' : exportJob.status === 'failed' ? 'destructive' : 'secondary'}>
                                        {exportJob.status === 'completed' ? '已完成' : exportJob.status === 'failed' ? '失败' : exportJob.status === 'running' ? '生成中' : '排队中'}
                                    </Badge>
                                    <span className="text-xs font-mono text-slate-400">{exportJob.id}</span>
                                </div>
                                <p className="mt-1 text-xs leading-5 text-slate-500">
                                    {exportJob.message || '正在处理导出任务。'}{exportJob.error ? ` ${exportJob.error}` : ''}
                                </p>
                            </div>
                            <Button
                                variant={exportJob.status === 'completed' ? 'default' : 'outline'}
                                disabled={exportJob.status !== 'completed' || isDownloadingExport}
                                onClick={downloadCompletedExportJob}
                                className={exportJob.status === 'completed' ? 'gap-2 bg-indigo-600 text-white hover:bg-indigo-700' : 'gap-2'}
                            >
                                {exportJob.status === 'running' || exportJob.status === 'queued' || isDownloadingExport ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                {isDownloadingExport ? '下载中...' : exportJob.status === 'completed' ? '下载数据包' : `${exportJob.progress || 0}%`}
                            </Button>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white">
                            <div
                                className={`h-full rounded-full ${exportJob.status === 'failed' ? 'bg-red-500' : 'bg-indigo-600'}`}
                                style={{ width: `${Math.max(4, Math.min(100, exportJob.progress || 0))}%` }}
                            />
                        </div>
                    </div>
                ) : null}
            </section>

            <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
                <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                    <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-4">
                        <div>
                            <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800"><BarChart3 className="h-5 w-5 text-indigo-600" />项目存储排行</h3>
                            <p className="mt-1 text-sm text-slate-500">按已上传资源体积排序，用于发现异常占用。</p>
                        </div>
                    </div>
                    <div className="space-y-3">
                        {storageRows.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-sm text-slate-400">暂无资源文件</div>
                        ) : storageRows.map((row) => (
                            <div key={row.project_id} className="grid grid-cols-[1fr_100px_100px] items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-3 text-sm">
                                <div className="min-w-0">
                                    <div className="truncate font-bold text-slate-800">{row.project_name}</div>
                                    <div className="mt-1 truncate text-xs font-mono text-slate-400">{row.project_id}</div>
                                </div>
                                <span className="text-slate-500">{row.file_count} 个文件</span>
                                <span className="text-right font-bold text-slate-700">{formatBytes(row.total_size)}</span>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                    <div className="mb-4 border-b border-slate-100 pb-4">
                        <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800"><ShieldAlert className="h-5 w-5 text-amber-600" />数据保留与清理</h3>
                        <p className="mt-1 text-sm text-slate-500">默认只清理行为流和心跳等运维数据。</p>
                    </div>
                    <div className="space-y-4">
                        <label className="space-y-2">
                            <span className="text-sm font-semibold text-slate-700">清理阈值（天）</span>
                            <Input type="number" value={olderThanDays} onChange={(event) => setOlderThanDays(Number(event.target.value))} onBlur={refreshRetention} />
                        </label>
                        <DataMap title="可清理运维数据" data={retention?.operational_cleanup_candidates} />
                        <DataMap title="受保护研究数据" data={retention?.protected_research_data} protectedData />
                        <Button onClick={cleanupOperational} disabled={isBusy} className="w-full gap-2 bg-amber-600 text-white hover:bg-amber-700">
                            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            只清理过期运维数据
                        </Button>
                    </div>
                </section>
            </div>

            <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
                <div className="mb-4 flex flex-col gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h3 className="flex items-center gap-2 text-lg font-bold text-slate-800"><Archive className="h-5 w-5 text-indigo-600" />项目归档管理</h3>
                        <p className="mt-1 text-sm text-slate-500">这里只做归档/取消归档，不直接硬删除研究项目。</p>
                    </div>
                    <Input className="max-w-sm" placeholder="搜索项目名称" value={search} onChange={(event) => setSearch(event.target.value)} />
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="text-xs uppercase tracking-wider text-slate-400">
                            <tr>
                                <th className="px-3 py-3">项目</th>
                                <th className="px-3 py-3">成员</th>
                                <th className="px-3 py-3">状态</th>
                                <th className="px-3 py-3">更新时间</th>
                                <th className="px-3 py-3 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {projects.length === 0 ? (
                                <tr><td colSpan={5} className="py-12 text-center text-slate-400">暂无项目</td></tr>
                            ) : projects.map((project) => (
                                <tr key={project.id} className="hover:bg-slate-50">
                                    <td className="px-3 py-3">
                                        <div className="font-bold text-slate-800">{project.name}</div>
                                        <div className="mt-1 text-xs font-mono text-slate-400">{project.id}</div>
                                    </td>
                                    <td className="px-3 py-3 text-slate-500">{project.member_count}</td>
                                    <td className="px-3 py-3">
                                        <Badge variant={project.is_archived ? 'secondary' : 'default'}>{project.is_archived ? '已归档' : '进行中'}</Badge>
                                    </td>
                                    <td className="px-3 py-3 text-slate-500">{formatTime(project.updated_at)}</td>
                                    <td className="px-3 py-3 text-right">
                                        <Button variant="outline" size="sm" disabled={isBusy} onClick={() => toggleArchive(project)}>
                                            {project.is_archived ? '取消归档' : '归档'}
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </section>
        </div>
    )
}

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
    return (
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p>
            <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
            <p className="mt-1 text-xs text-slate-500">{hint}</p>
        </div>
    )
}

function DataMap({ title, data, protectedData = false }: { title: string; data?: Record<string, number>; protectedData?: boolean }) {
    return (
        <div className={`rounded-2xl border p-4 ${protectedData ? 'border-rose-100 bg-rose-50' : 'border-slate-100 bg-slate-50'}`}>
            <div className={`mb-2 text-sm font-bold ${protectedData ? 'text-rose-800' : 'text-slate-800'}`}>{title}</div>
            <div className="space-y-2">
                {Object.entries(data || {}).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between text-sm">
                        <span className="font-mono text-xs text-slate-500">{key}</span>
                        <span className="font-bold text-slate-700">{value}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

function formatBytes(bytes: number) {
    if (!bytes) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB']
    let value = bytes
    let index = 0
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024
        index += 1
    }
    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function formatTime(value?: string) {
    if (!value) return '-'
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function getErrorDetail(error: unknown, fallback: string) {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const response = (error as { response?: { data?: { detail?: unknown } } }).response
        if (typeof response?.data?.detail === 'string') {
            return response.data.detail
        }
    }
    return fallback
}

async function getDownloadErrorDetail(error: unknown, fallback: string) {
    if (typeof error === 'object' && error !== null && 'response' in error) {
        const response = (error as { response?: { data?: unknown } }).response
        if (response?.data instanceof Blob) {
            try {
                const text = await response.data.text()
                const payload = JSON.parse(text) as { detail?: unknown }
                if (typeof payload.detail === 'string') {
                    return payload.detail
                }
            } catch {
                return fallback
            }
        }
    }
    return getErrorDetail(error, fallback)
}
