import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { projectService } from '../../services/api/project'
import { Project } from '../../types'

export default function ProjectSettings() {
    const { projectId } = useParams<{ projectId: string }>()
    const navigate = useNavigate()
    const [project, setProject] = useState<Project | null>(null)
    const [loading, setLoading] = useState(true)
    const [inviteInput, setInviteInput] = useState('')
    const [inviting, setInviting] = useState(false)

    const handleInvite = async () => {
        if (!project || !inviteInput.trim()) return
        setInviting(true)
        try {
            const isEmail = inviteInput.includes('@')
            await projectService.addMember(project.id, {
                email: isEmail ? inviteInput : undefined,
                userId: !isEmail ? inviteInput : undefined,
                role: 'editor'
            })
            const p = await projectService.getProject(project.id)
            setProject(p)
            setInviteInput('')
            alert('邀请成功')
        } catch (error: any) {
            console.error('Invite failed:', error)
            alert(error.response?.data?.detail || '邀请失败')
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
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="mb-8 flex items-center justify-between">
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

                        <div className="border-t border-gray-200 pt-6">
                            <h3 className="text-lg font-medium text-gray-900 mb-4">成员管理</h3>

                            <div className="mb-4 flex gap-2">
                                <input
                                    type="text"
                                    placeholder="输入用户邮箱或ID..."
                                    className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md bg-white px-3 py-2"
                                    value={inviteInput}
                                    onChange={(e) => setInviteInput(e.target.value)}
                                />
                                <button
                                    onClick={handleInvite}
                                    disabled={inviting || !inviteInput.trim()}
                                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                                >
                                    {inviting ? '邀请中...' : '邀请成员'}
                                </button>
                            </div>

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
        </div>
    )
}
