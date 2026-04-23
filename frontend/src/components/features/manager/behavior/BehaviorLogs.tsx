import { useState, useEffect } from 'react'
import { adminService, ActivityLog } from '../../../../services/api/admin'
import { projectService } from '../../../../services/api/project'
import { userService } from '../../../../services/api/user'
import { Project, User } from '../../../../types'
import {
    Activity,
    Download,
    Box,
    Loader2,
    Search,
    ChevronRight
} from 'lucide-react'
import { Button, Input, Badge } from '../../../ui'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from '../../../ui/dialog'

export default function BehaviorLogs() {
    const [projects, setProjects] = useState<Project[]>([])
    const [usersMap, setUsersMap] = useState<Record<string, User>>({})
    const [isLoading, setIsLoading] = useState(true)
    const [isExporting, setIsExporting] = useState(false)

    // Modal state
    const [selectedUser, setSelectedUser] = useState<{ id: string, username: string } | null>(null)
    const [userLogs, setUserLogs] = useState<ActivityLog[]>([])
    const [isUserLogsLoading, setIsUserLogsLoading] = useState(false)

    // Global filters
    const [searchQuery, setSearchQuery] = useState('')

    useEffect(() => {
        fetchInitialData()
    }, [])

    const fetchInitialData = async () => {
        try {
            setIsLoading(true)
            // 1. Fetch all projects
            const projectData = await projectService.getProjects()
            setProjects(projectData.projects)

            // 2. Collect all unique user IDs from projects to fetch user details
            const allUserIds = new Set<string>()
            projectData.projects.forEach(p => {
                allUserIds.add(p.owner_id)
                p.members.forEach(m => allUserIds.add(m.user_id))
            })

            // 3. Fetch user details in batch
            const userDetails = await userService.getUsers(Array.from(allUserIds))
            const uMap: Record<string, User> = {}
            userDetails.forEach(u => {
                uMap[u.id] = u
            })
            setUsersMap(uMap)
        } catch (error) {
            console.error('Failed to fetch initial data:', error)
        } finally {
            setIsLoading(false)
        }
    }

    const fetchUserLogs = async (user_id: string, username: string, projectId: string) => {
        try {
            setSelectedUser({ id: user_id, username })
            setIsUserLogsLoading(true)

            // Use the new getBehaviorStream method for high-fidelity data
            // We filter client-side for the specific user since the stream is project-wide
            const data = await adminService.getBehaviorStream(projectId)

            const userStream = data.behaviors.filter((b: any) => b.user_id === user_id)

            // Map to ActivityLog interface for display compatibility
            const mappedLogs: ActivityLog[] = userStream.map((b: any, index: number) => ({
                id: `stream-${index}`,
                project_id: projectId,
                user_id: user_id,
                module: b.module || 'unknown',
                action: b.action || 'unknown',
                duration: 0,
                timestamp: b.timestamp,
                metadata: b.metadata
            }))

            setUserLogs(mappedLogs)
        } catch (error) {
            console.error('Failed to fetch user behavior stream:', error)
        } finally {
            setIsUserLogsLoading(false)
        }
    }

    const handleExportAll = async () => {
        try {
            setIsExporting(true)
            await adminService.exportBehaviorLogs({
                format: 'csv'
            })
        } catch (error) {
            console.error('Export failed:', error)
            alert('导出失败')
        } finally {
            setIsExporting(false)
        }
    }

    const getModuleColor = (module: string) => {
        const colors: Record<string, string> = {
            whiteboard: 'bg-orange-50 text-orange-600 border-orange-100',
            document: 'bg-blue-50 text-blue-600 border-blue-100',
            chat: 'bg-emerald-50 text-emerald-600 border-emerald-100',
            resources: 'bg-purple-50 text-purple-600 border-purple-100',
            ai: 'bg-indigo-50 text-indigo-600 border-indigo-100',
            task: 'bg-pink-50 text-pink-600 border-pink-100',
            analytics: 'bg-slate-50 text-slate-600 border-slate-100'
        }
        return colors[module] || 'bg-gray-50 text-gray-600 border-gray-100'
    }

    const filteredProjects = projects.filter(p =>
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.members.some(m => usersMap[m.user_id]?.username?.toLowerCase().includes(searchQuery.toLowerCase()))
    )

    return (
        <div className="space-y-6 animate-fadeIn">
            {/* Header */}
            <div className="flex justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                        <Activity className="w-6 h-6 text-indigo-600" />
                        协作审计与行为分析
                    </h2>
                    <p className="text-sm text-slate-500 mt-1">按协作项目分区查看成员行为流，深入洞察小组动态</p>
                </div>
                <div className="flex gap-3">
                    <div className="relative w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <Input
                            placeholder="搜索项目或成员..."
                            className="pl-10"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <Button
                        onClick={handleExportAll}
                        disabled={isExporting}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 shadow-lg shadow-emerald-100"
                    >
                        {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        导出全部 (CSV)
                    </Button>
                </div>
            </div>

            {isLoading ? (
                <div className="h-[400px] flex flex-col items-center justify-center gap-4 bg-white rounded-3xl border border-dashed border-slate-200 text-slate-400">
                    <Loader2 className="w-10 h-10 animate-spin text-indigo-600" />
                    <p className="font-medium">正在整合小组协作数据...</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {filteredProjects.map((project) => (
                        <div key={project.id} className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col group hover:shadow-md transition-shadow">
                            <div className="p-5 border-b border-slate-50 bg-slate-50/30 flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-xl bg-white shadow-sm flex items-center justify-center border border-slate-100">
                                        <Box className="w-5 h-5 text-indigo-600" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-800">{project.name}</h3>
                                        <p className="text-[10px] text-slate-400 font-mono">ID: {project.id}</p>
                                    </div>
                                </div>
                                <Badge variant="outline" className="text-[10px] uppercase font-bold tracking-wider">
                                    {project.members.length} 位成员
                                </Badge>
                            </div>

                            <div className="p-2 space-y-1">
                                {project.members.map((member) => {
                                    const user = usersMap[member.user_id]
                                    return (
                                        <div
                                            key={member.user_id}
                                            onClick={() => fetchUserLogs(member.user_id, user?.username || '未知用户', project.id)}
                                            className="flex items-center justify-between p-3 rounded-2xl hover:bg-indigo-50/50 transition-colors cursor-pointer group/item"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center text-[10px] font-bold text-indigo-600 border border-indigo-100">
                                                    {user?.username?.charAt(0).toUpperCase() || 'U'}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-semibold text-slate-700">{user?.username || '加载中...'}</p>
                                                    <p className="text-[10px] text-slate-400">{member.role === 'owner' ? '组长 (Owner)' : '组员 (Member)'}</p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 opacity-0 group-hover/item:opacity-100 transition-opacity">
                                                <span className="text-[10px] font-bold text-indigo-500 bg-indigo-50 px-2 py-1 rounded-lg">查看高频行为流</span>
                                                <ChevronRight className="w-4 h-4 text-indigo-400" />
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* User Logs Modal */}
            <Dialog open={!!selectedUser} onOpenChange={(open) => !open && setSelectedUser(null)}>
                <DialogContent className="max-w-4xl p-0 overflow-hidden bg-white">
                    <DialogHeader className="p-6 bg-slate-50 border-b border-slate-100">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-100">
                                    <Activity className="w-6 h-6" />
                                </div>
                                <div>
                                    <DialogTitle className="text-xl font-bold text-slate-800">
                                        {selectedUser?.username} 的高频行为流
                                    </DialogTitle>
                                    <DialogDescription className="text-slate-500 mt-1">
                                        展示该用户在项目中的原始行为数据（Behavior Stream），包含点击、视口停留等微交互。
                                    </DialogDescription>
                                </div>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                className="gap-2"
                                onClick={() => {
                                    if (selectedUser) {
                                        adminService.exportBehaviorLogs({ user_id: selectedUser.id, format: 'csv' })
                                    }
                                }}
                            >
                                <Download className="w-4 h-4" />
                                导出此用户
                            </Button>
                        </div>
                    </DialogHeader>

                    <div className="max-h-[60vh] overflow-y-auto">
                        {isUserLogsLoading ? (
                            <div className="py-20 flex flex-col items-center gap-3">
                                <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                                <p className="text-sm text-slate-400">正在回溯行为历史...</p>
                            </div>
                        ) : userLogs.length === 0 ? (
                            <div className="py-20 text-center text-slate-400">该用户近期没有可记录的协作行为</div>
                        ) : (
                            <table className="w-full text-left border-collapse">
                                <thead className="sticky top-0 bg-white shadow-sm z-10">
                                    <tr className="border-b border-slate-50">
                                        <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-wider">发生时间</th>
                                        <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-wider">模块区域</th>
                                        <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-wider">微交互动作</th>
                                        <th className="px-6 py-4 text-[10px] font-black uppercase text-slate-400 tracking-wider text-right">元数据</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {userLogs.map((log) => (
                                        <tr key={log.id} className="hover:bg-slate-50/50 transition-colors group">
                                            <td className="px-6 py-4 text-xs text-slate-500 font-mono">
                                                {new Date(log.timestamp).toLocaleString('zh-CN', {
                                                    month: '2-digit',
                                                    day: '2-digit',
                                                    hour: '2-digit',
                                                    minute: '2-digit',
                                                    second: '2-digit'
                                                })}
                                            </td>
                                            <td className="px-6 py-4">
                                                <Badge className={`${getModuleColor(log.module)} shadow-none text-[10px]`}>
                                                    {log.module}
                                                </Badge>
                                            </td>
                                            <td className="px-6 py-4 text-xs font-semibold text-slate-700 font-mono">
                                                {log.action}
                                            </td>
                                            <td className="px-6 py-4 text-[10px] text-slate-400 font-mono text-right truncate max-w-[200px]">
                                                {JSON.stringify(log.metadata || {})}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                    <div className="p-4 bg-slate-50/50 border-t border-slate-100 flex justify-center">
                        <p className="text-[10px] text-slate-400">当前仅展示最近 100 条数据，建议通过导出功能获取完整审计日志</p>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
