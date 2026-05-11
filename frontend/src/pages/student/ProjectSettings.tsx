import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { projectService } from '../../services/api/project'
import { Project, User } from '../../types'
import { userService } from '../../services/api/user'
import { Toast } from '../../components/ui/Toast'

export default function ProjectSettings() {
    const { projectId } = useParams<{ projectId: string }>()
    const navigate = useNavigate()
    const [project, setProject] = useState<Project | null>(null)
    const [loading, setLoading] = useState(true)
    const [inviteInput, setInviteInput] = useState('')
    const [inviting, setInviting] = useState(false)
    const [searching, setSearching] = useState(false)
    const [classmateResults, setClassmateResults] = useState<User[]>([])
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

    const handleInvite = async () => {
        if (!project || !inviteInput.trim()) return
        setInviting(true)
        try {
            await projectService.addMember(project.id, {
                account: inviteInput.trim(),
                role: 'editor'
            })
            const p = await projectService.getProject(project.id)
            setProject(p)
            setInviteInput('')
            setClassmateResults([])
            setToast({ message: '邀请成功。', type: 'success' })
        } catch (error: any) {
            console.error('Invite failed:', error)
            setToast({ message: error.response?.data?.detail || '邀请失败。', type: 'error' })
        } finally {
            setInviting(false)
        }
    }

    const handleSearchClassmates = async () => {
        if (!project?.course_id || !inviteInput.trim()) return
        setSearching(true)
        try {
            const users = await userService.searchUsers({
                class_id: project.course_id,
                role: 'student',
                search: inviteInput.trim(),
            })
            const existingIds = new Set(project.members.map((member) => member.user_id))
            setClassmateResults(users.filter((user) => !existingIds.has(user.id)))
        } catch (error: any) {
            setToast({ message: error.response?.data?.detail || '搜索同班同学失败。', type: 'error' })
        } finally {
            setSearching(false)
        }
    }

    const handleAddClassmate = async (userId: string) => {
        if (!project) return
        setInviting(true)
        try {
            await projectService.addMember(project.id, {
                userId,
                role: 'editor'
            })
            const p = await projectService.getProject(project.id)
            setProject(p)
            setClassmateResults((previous) => previous.filter((user) => user.id !== userId))
            setToast({ message: '已添加同伴。', type: 'success' })
        } catch (error: any) {
            setToast({ message: error.response?.data?.detail || '添加同伴失败。', type: 'error' })
        } finally {
            setInviting(false)
        }
    }

    useEffect(() => {
        if (projectId) {
            projectService.getProject(projectId).then(setProject).finally(() => setLoading(false))
        }
    }, [projectId])

    if (loading) return <div className="p-8 text-center text-gray-500">加载中...</div>
    if (!project) return <div className="p-8 text-center text-gray-500">小组不存在</div>

    return (
        <div className="h-[100dvh] overflow-y-auto bg-gray-50 py-6 sm:py-8">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h1 className="text-2xl font-bold text-gray-900">小组设置</h1>
                    <button
                        onClick={() => navigate(-1)}
                        className="text-sm text-gray-500 hover:text-gray-700"
                    >
                        返回小组
                    </button>
                </div>

                <div className="bg-white shadow rounded-lg overflow-hidden">
                    <div className="p-6 space-y-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700">小组名称</label>
                            <div className="mt-1">
                                <input
                                    type="text"
                                    defaultValue={project.name}
                                    disabled
                                    className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md bg-gray-50"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700">小组描述</label>
                            <div className="mt-1">
                                <textarea
                                    rows={3}
                                    defaultValue={project.description || ''}
                                    disabled
                                    className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md bg-gray-50"
                                />
                            </div>
                        </div>
                        {project.group_code && (
                            <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
                                <div className="text-sm font-medium text-indigo-900">小组码</div>
                                <div className="mt-1 font-mono text-2xl font-bold tracking-widest text-indigo-700">{project.group_code}</div>
                                <p className="mt-1 text-xs text-indigo-600">同班同学可在“我的小组”页面输入该小组码加入。</p>
                            </div>
                        )}

                        <div className="border-t border-gray-200 pt-6">
                            <h3 className="text-lg font-medium text-gray-900 mb-4">成员管理</h3>

                            <div className="mb-4 flex flex-col gap-2 sm:flex-row">
                                <input
                                    type="text"
                                    placeholder="输入同班同学用户名、账号、邮箱或手机号..."
                                    className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md bg-white px-3 py-2"
                                    value={inviteInput}
                                    onChange={(e) => setInviteInput(e.target.value)}
                                />
                                {project.course_id && (
                                    <button
                                        onClick={handleSearchClassmates}
                                        disabled={searching || !inviteInput.trim()}
                                        className="inline-flex items-center justify-center rounded-md border border-indigo-100 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                                    >
                                        {searching ? '搜索中...' : '搜索同学'}
                                    </button>
                                )}
                                <button
                                    onClick={handleInvite}
                                    disabled={inviting || !inviteInput.trim()}
                                    className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                                >
                                    {inviting ? '邀请中...' : '邀请成员'}
                                </button>
                            </div>

                            {classmateResults.length > 0 && (
                                <div className="mb-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
                                    <div className="mb-2 text-xs font-semibold text-slate-500">同班同学搜索结果</div>
                                    <div className="space-y-2">
                                        {classmateResults.map((classmate) => (
                                            <div key={classmate.id} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                                                <div className="min-w-0">
                                                    <div className="truncate text-sm font-semibold text-slate-800">{classmate.username}</div>
                                                    <div className="truncate text-xs text-slate-400">{classmate.email}</div>
                                                </div>
                                                <button
                                                    onClick={() => handleAddClassmate(classmate.id)}
                                                    disabled={inviting}
                                                    className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                                                >
                                                    添加
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">用户ID</th>
                                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">角色</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {project.members.map((member) => (
                                            <tr key={member.user_id}>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{member.user_id}</td>
                                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${member.role === 'owner' ? 'bg-green-100 text-green-800' :
                                                        member.role === 'editor' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                                                        }`}>
                                                        {member.role === 'owner' ? '拥有者' : member.role === 'editor' ? '编辑者' : '观察者'}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    onClose={() => setToast(null)}
                />
            )}
        </div>
    )
}
