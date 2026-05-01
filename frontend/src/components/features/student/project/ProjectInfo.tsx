import { useEffect, useState, useRef } from 'react'


import { Plus, Briefcase, UserPlus, Target, Clock, MessageSquare, FileText, Layout, Share2, Sparkles, Upload, CheckSquare } from 'lucide-react'
import { analyticsService } from '../../../../services/api/analytics'
import { useAuthStore } from '../../../../stores/authStore'
import { userService } from '../../../../services/api/user'
import { projectService } from '../../../../services/api/project'
import { Project, User } from '../../../../types'
import { ConfirmDialog } from '../../../ui'

interface ProjectInfoProps {
  projectId: string
}

export default function ProjectInfo({ projectId }: ProjectInfoProps) {
  const [project, setProject] = useState<Project | null>(null)
  const [members, setMembers] = useState<User[]>([])
  const [activities, setActivities] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const { user: currentUser } = useAuthStore()
  const [userCache, setUserCache] = useState<Record<string, User>>({})

  // Inline editing state
  const [isEditingName, setIsEditingName] = useState(false)
  const [isEditingDesc, setIsEditingDesc] = useState(false) // For Body (Targets)
  const [isEditingHeaderDesc, setIsEditingHeaderDesc] = useState(false) // For Header (Intro)
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editHeaderDesc, setEditHeaderDesc] = useState('')
  const headerInputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isEditingHeaderDesc && headerInputRef.current) {
      headerInputRef.current.style.height = 'auto'
      headerInputRef.current.style.height = headerInputRef.current.scrollHeight + 'px'
    }
  }, [editHeaderDesc, isEditingHeaderDesc])
  const [isUpdating, setIsUpdating] = useState(false)
  const [showInviteDialog, setShowInviteDialog] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
  const [unarchiveConfirmOpen, setUnarchiveConfirmOpen] = useState(false)

  useEffect(() => {
    let isMounted = true;
    const fetchProject = async () => {
      try {
        const data = await projectService.getProject(projectId)
        if (!isMounted) return
        setProject(data)

        // Fetch member details
        const memberIds = data.members.map((m: any) => m.user_id)
        if (memberIds.length > 0) {
          try {
            const memberUsers = await userService.getUsers(memberIds)
            if (!isMounted) return
            setMembers(memberUsers)

            // Initial cache
            const cache: Record<string, User> = {}
            memberUsers.forEach(u => { cache[u.id] = u })
            setUserCache(cache)
          } catch (error) {
            console.error('Failed to fetch members:', error)
          }
        }
      } catch (error) {
        console.error('Failed to fetch project:', error)
      }
    }

    const fetchActivities = async () => {
      try {
        const data = await analyticsService.getActivityLogs(projectId, undefined, undefined)
        if (!isMounted) return
        // Group similar consecutive activities (same user, module, action)
        const rawLogs = data.logs.filter((log: any) => log.action !== 'heartbeat')
        const grouped: any[] = []

        rawLogs.forEach((log: any) => {
          const last = grouped[grouped.length - 1]
          if (last &&
            last.user_id === log.user_id &&
            last.module === log.module &&
            last.action === log.action) {
            last.count = (last.count || 1) + 1
          } else {
            grouped.push({ ...log, count: 1 })
          }
        })

        setActivities(grouped.slice(0, 5))
      } catch (error) {
        console.error('Failed to fetch activities:', error)
      }
    }

    if (projectId) {
      setLoading(true)
      Promise.all([fetchProject(), fetchActivities()]).finally(() => {
        if (isMounted) setLoading(false)
      })

      // Auto-refresh activities every 30 seconds
      const intervalId = setInterval(fetchActivities, 30000)
      return () => {
        isMounted = false
        clearInterval(intervalId)
      }
    }
  }, [projectId])

  if (loading) {
    return <div className="p-4">加载中...</div>
  }

  if (!project) {
    return <div className="p-4 text-center text-gray-400">小组不存在</div>
  }

  const isOwner = currentUser?.id === project.owner_id

  const getMemberUser = (userId: string) => {
    if (currentUser && userId === currentUser.id) return currentUser
    return userCache[userId] || members.find(m => m.id === userId)
  }

  const handleUpdateProject = async (updates: Partial<Project>) => {
    if (!projectId || isUpdating) return
    setIsUpdating(true)
    try {
      const updated = await projectService.updateProject(projectId, updates)
      setProject(updated)
      setIsEditingName(false)
      setIsEditingDesc(false)
      setIsEditingHeaderDesc(false)
    } catch (error) {
      console.error('Failed to update project:', error)
    } finally {
      setIsUpdating(false)
    }
  }

  const startEditName = () => {
    if (!isOwner || !project) return
    setEditName(project.name)
    setIsEditingName(true)
  }

  const startEditDesc = () => {
    if (!isOwner || !project) return
    setEditDesc(project.description || '')
    setIsEditingDesc(true)
  }

  const startEditHeaderDesc = () => {
    if (!isOwner || !project) return
    setEditHeaderDesc(project.subtitle || '')
    setIsEditingHeaderDesc(true)
  }

  const handleInviteMember = async () => {
    if (!inviteEmail.trim() || !projectId) return
    try {
      await projectService.addMember(projectId, {
        email: inviteEmail,
        role: 'editor'
      })
      setNotice({ type: 'success', message: `邀请已发送至：${inviteEmail}` })
      setInviteEmail('')
      setShowInviteDialog(false)
      // Refresh project to show new member
      const updated = await projectService.getProject(projectId)
      setProject(updated)
    } catch (error: any) {
      console.error('Failed to invite member:', error)
      setNotice({ type: 'error', message: error.response?.data?.detail || '邀请失败，请重试。' })
    }
  }

  const handleArchiveProject = async () => {
    if (!projectId) return
    try {
      setIsUpdating(true)
      await projectService.archiveProject(projectId)
      setNotice({ type: 'success', message: '小组提交成功，已进入归档状态。' })
      window.location.reload() // Refresh to reflect archived status
    } catch (error) {
      console.error('Failed to archive project:', error)
      setNotice({ type: 'error', message: '提交失败，请重试。' })
    } finally {
      setIsUpdating(false)
      setArchiveConfirmOpen(false)
    }
  }

  const handleUnarchiveProject = async () => {
    if (!projectId) return
    try {
      setIsUpdating(true)
      await projectService.unarchiveProject(projectId)
      window.location.reload()
    } catch (error) {
      console.error('Failed to unarchive project:', error)
      setNotice({ type: 'error', message: '撤回失败，请重试。' })
    } finally {
      setIsUpdating(false)
      setUnarchiveConfirmOpen(false)
    }
  }

  const getModuleIcon = (module: string) => {
    switch (module) {
      case 'whiteboard': return <Layout className="w-2.5 h-2.5" />
      case 'document': return <FileText className="w-2.5 h-2.5" />
      case 'chat': return <MessageSquare className="w-2.5 h-2.5" />
      case 'ai': return <Sparkles className="w-2.5 h-2.5" />
      case 'resources': return <Share2 className="w-2.5 h-2.5" />
      default: return <Clock className="w-2.5 h-2.5" />
    }
  }

  const getActionText = (module: string, action: string) => {
    const moduleMap: Record<string, string> = {
      'whiteboard': '白板',
      'document': '文档',
      'chat': '消息',
      'ai': 'AI 导师',
      'resources': '资源',
      'task': '任务'
    }
    const actionMap: Record<string, string> = {
      'edit': '编辑了',
      'create': '创建了',
      'update': '更新了',
      'delete': '删除了',
      'view': '查看了',
      'comment': '评论了',
      'upload': '上传了',
      'send': '发送了',
      'join': '加入了',
      'move': '移动了',
      'resolve': '解决了',
      'save': '保存了'
    }

    // Handle prefixed actions like 'document_edit'
    let clearAction = action
    if (action.includes('_')) {
      const parts = action.split('_')
      // If the first part matches the module, uses the second part as action
      if (parts[0] === module) {
        clearAction = parts[1]
      } else {
        clearAction = parts[parts.length - 1]
      }
    }

    return `${actionMap[clearAction] || '操作了'}${moduleMap[module] || '小组空间'}`
  }

  const formatTime = (date: string) => {
    const now = new Date()
    const diff = now.getTime() - new Date(date).getTime()
    const seconds = Math.floor(diff / 1000)
    if (seconds < 30) return '刚刚'
    const minutes = Math.floor(seconds / 60)
    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes}分钟前`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}小时前`
    return new Date(date).toLocaleDateString()
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Header with Settings */}
      <div className="p-4 flex items-center justify-between border-b border-gray-50">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-100 shrink-0">
            <Briefcase className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            {isEditingName ? (
              <input
                autoFocus
                className="text-sm font-bold text-gray-900 w-full bg-gray-50 border-none focus:ring-1 focus:ring-indigo-500 rounded px-1 -ml-1"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => handleUpdateProject({ name: editName })}
                onKeyDown={(e) => e.key === 'Enter' && handleUpdateProject({ name: editName })}
              />
            ) : (
              <h2
                className={`text-sm font-bold text-gray-900 truncate ${isOwner ? 'cursor-edit hover:text-indigo-600' : ''}`}
                onDoubleClick={startEditName}
                title={isOwner ? '双击修改小组名称' : project.name}
              >
                {project.name}
              </h2>
            )}
            {isEditingHeaderDesc ? (
              <textarea
                ref={headerInputRef}
                autoFocus
                rows={1}
                className="text-xs text-gray-500 w-full bg-gray-50 border-none focus:ring-1 focus:ring-indigo-500 rounded px-1 -ml-1 mt-0.5 resize-none overflow-hidden"
                value={editHeaderDesc}
                onChange={(e) => setEditHeaderDesc(e.target.value)}
                onBlur={() => handleUpdateProject({ subtitle: editHeaderDesc })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleUpdateProject({ subtitle: editHeaderDesc })
                  }
                }}
                placeholder="添加小组简介..."
              />
            ) : (
              <div
                className={`text-xs text-gray-500 mt-0.5 truncate ${isOwner ? 'cursor-edit hover:text-indigo-600' : ''}`}
                onDoubleClick={startEditHeaderDesc}
                title={isOwner ? '双击修改小组简介' : project.subtitle}
              >
                {project.subtitle || '暂无简介'}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">


        {/* Project Overview & Targets */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-gray-900 px-1">
            <Target className="w-3 h-3 text-indigo-600" />
            小组目标
          </div>
          {isEditingDesc ? (
            <textarea
              autoFocus
              rows={3}
              className="w-full p-3 bg-white rounded-xl border border-indigo-200 text-xs text-gray-600 leading-relaxed focus:ring-2 focus:ring-indigo-500/20 focus:outline-none resize-none shadow-inner"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              onBlur={() => handleUpdateProject({ description: editDesc })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (e.shiftKey) {
                    // Shift+Enter: manually insert newline
                    e.preventDefault()
                    const textarea = e.currentTarget
                    const start = textarea.selectionStart
                    const end = textarea.selectionEnd
                    const newValue = editDesc.substring(0, start) + '\n' + editDesc.substring(end)
                    setEditDesc(newValue)
                    // Set cursor position after the newline
                    setTimeout(() => {
                      textarea.selectionStart = textarea.selectionEnd = start + 1
                    }, 0)
                  } else {
                    // Enter alone: save
                    e.preventDefault()
                    handleUpdateProject({ description: editDesc })
                  }
                }
              }}
              placeholder="输入小组目标描述..."
            />
          ) : (
            <div
              className={`p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs text-gray-600 leading-relaxed group transition-all hover:shadow-sm ${isOwner ? 'cursor-edit hover:border-indigo-200 hover:bg-white' : ''}`}
              onDoubleClick={startEditDesc}
              title={isOwner ? '双击修改小组目标' : ''}
            >
              {project.description || '暂无小组目标描述，清晰的目标有助于团队达成共识。'}
              {isOwner && <div className="mt-2 text-[10px] text-indigo-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity">双击修改目标</div>}
            </div>
          )}
        </div>

        {/* Members - Avatar Stack */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="text-xs font-bold text-gray-900">小组成员</div>
            <button
              onClick={() => setShowInviteDialog(true)}
              className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
              title="邀请成员"
            >
              <UserPlus className="w-4 h-4" />
        </button>
      </div>

      {notice && (
        <div className={`mx-4 mt-3 rounded-2xl border px-3 py-2 text-xs font-medium ${notice.type === 'success'
          ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
          : 'border-rose-100 bg-rose-50 text-rose-700'
          }`}>
          {notice.message}
        </div>
      )}
          <div className="flex items-center pl-1">
            <div className="flex -space-x-3 overflow-hidden">
              {project.members.map((member: any) => {
                const memberUser = getMemberUser(member.user_id)
                const online = false // TODO: Integration with syncService for real online status
                return (
                  <div key={member.user_id} className="relative group p-[2px] bg-white rounded-full">
                    <div
                      className="w-8 h-8 rounded-full border-2 border-white bg-indigo-100 flex items-center justify-center text-indigo-700 text-xs font-bold overflow-hidden cursor-pointer hover:translate-y-[-2px] transition-transform"
                      title={memberUser?.username || member.user_id}
                    >
                      {memberUser?.avatar_url ? (
                        <img src={memberUser.avatar_url} className="w-full h-full object-cover" alt="" />
                      ) : (
                        <span>{memberUser?.username?.[0]?.toUpperCase() || 'U'}</span>
                      )}
                    </div>
                    {online && (
                      <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 border-2 border-white rounded-full" />
                    )}
                  </div>
                )
              })}
              <button
                onClick={() => setShowInviteDialog(true)}
                className="w-8 h-8 rounded-full border-2 border-white bg-gray-100 border-dashed border-gray-300 flex items-center justify-center text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-all ml-1"
                title="添加成员"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <span className="ml-3 text-[10px] font-medium text-gray-400">{project.members.length} 位成员</span>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="space-y-3">
          <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden divide-y divide-gray-50 shadow-sm">
            {activities.length > 0 ? (
              activities.map(act => {
                const actor = getMemberUser(act.user_id)
                return (
                  <div key={act.id} className="p-3 hover:bg-gray-50 transition-colors flex gap-3">
                    <div className="w-6 h-6 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-400 mt-0.5 shrink-0 overflow-hidden">
                      {actor?.avatar_url ? (
                        <img src={actor.avatar_url} className="w-full h-full object-cover" alt="" />
                      ) : (
                        getModuleIcon(act.module)
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs">
                        <span className="font-bold text-gray-900">{actor?.username || '未知用户'}</span>
                        <span className="text-gray-500 mx-1">
                          {getActionText(act.module, act.action)}
                          {act.count > 1 && (
                            <span className="ml-1 text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded-full text-[10px] font-medium">
                              x{act.count}次
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-400 mt-0.5">{formatTime(act.timestamp)}</div>
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="p-6 text-center text-xs text-gray-400">暂无小组动态</div>
            )}
          </div>
        </div>
      </div>

      {/* Project Submission Action (Only for Owner) */}
      {isOwner && !project.is_archived && (
        <div className="p-4 border-t border-gray-50 bg-white">
          <button
            onClick={() => setArchiveConfirmOpen(true)}
            disabled={isUpdating}
            className="w-full py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-100 transition-all flex items-center justify-center gap-2 group disabled:opacity-50"
          >
            <Upload className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform" />
            提交并归档小组空间
          </button>
          <p className="text-[10px] text-gray-400 text-center mt-2 px-2">
            注意：提交后小组空间内容将锁定为“只读”状态，小组不可继续编辑。
          </p>
        </div>
      )}

      {project.is_archived && (
        <div className="p-4 border-t border-gray-50 bg-white">
          <div className="w-full py-3 bg-slate-50 text-slate-500 rounded-xl text-sm font-bold flex items-center justify-center gap-2">
            <CheckSquare className="w-4 h-4 text-emerald-500" />
            小组空间已提交归档
          </div>
          {isOwner && (
            <button
              onClick={() => setUnarchiveConfirmOpen(true)}
              className="w-full mt-2 py-1 text-[10px] text-indigo-500 hover:text-indigo-700 font-medium"
            >
              撤回提交
            </button>
          )}
        </div>
      )}

      {/* Invite Member Dialog */}
      {showInviteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowInviteDialog(false)}>
          <div className="bg-white rounded-2xl p-6 w-96 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-4">邀请成员</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">邮箱地址</label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleInviteMember()}
                  placeholder="输入成员邮箱..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                  autoFocus
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => {
                    setShowInviteDialog(false)
                    setInviteEmail('')
                  }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleInviteMember}
                  disabled={!inviteEmail.trim()}
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  发送邀请
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={archiveConfirmOpen}
        onOpenChange={setArchiveConfirmOpen}
        title="提交并归档小组空间"
        description="确定要提交整个小组空间吗？提交后内容将进入只读归档状态，建议仅由组长在最终成果确认后执行。"
        confirmLabel="确认提交"
        loading={isUpdating}
        onConfirm={handleArchiveProject}
      />

      <ConfirmDialog
        open={unarchiveConfirmOpen}
        onOpenChange={setUnarchiveConfirmOpen}
        title="撤回小组提交"
        description="确定要撤回提交并恢复编辑吗？撤回后小组成员可以继续修改协作内容。"
        confirmLabel="确认撤回"
        loading={isUpdating}
        onConfirm={handleUnarchiveProject}
      />
    </div>
  )
}
