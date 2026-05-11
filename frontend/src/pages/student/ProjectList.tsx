import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogIn, Plus, Users, X } from 'lucide-react'
import { projectService, ProjectListResponse } from '../../services/api/project'
import { Course, courseService } from '../../services/api/course'
import { useAuthStore } from '../../stores/authStore'

type GroupAction = 'join-course' | 'create-group' | 'join-group'

export default function ProjectList() {
  const [projects, setProjects] = useState<ProjectListResponse | null>(null)
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [courseInviteCode, setCourseInviteCode] = useState('')
  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [projectName, setProjectName] = useState('新小组')
  const [groupCode, setGroupCode] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [activeAction, setActiveAction] = useState<GroupAction | null>(null)
  const navigate = useNavigate()
  const { user, fetchUser } = useAuthStore()

  const loadData = async () => {
    try {
      // Fetch both active and archived projects
      const [activeData, archivedData, courseData] = await Promise.all([
        projectService.getProjects(false),
        projectService.getProjects(true),
        user?.role === 'student' ? courseService.getCourses() : Promise.resolve([] as Course[])
      ])

      setProjects({
        projects: [...activeData.projects, ...archivedData.projects],
        total: activeData.total + archivedData.total
      })
      setCourses(courseData)
      if (!selectedCourseId && courseData.length > 0) {
        setSelectedCourseId(courseData[0].id)
      }
    } catch (error) {
      console.error('Failed to fetch projects:', error)
      setNotice('数据加载失败，请刷新后重试。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role])

  const handleJoinCourse = async () => {
    if (!courseInviteCode.trim()) return
    setActionLoading(true)
    setNotice(null)
    try {
      await courseService.joinCourse(courseInviteCode)
      setCourseInviteCode('')
      await fetchUser()
      await loadData()
      setActiveAction(null)
      setNotice('已加入课程，可以创建或加入该课程下的小组。')
    } catch (error: any) {
      setNotice(error.response?.data?.detail || '加入课程失败，请检查邀请码。')
    } finally {
      setActionLoading(false)
    }
  }

  const handleCreateProject = async () => {
    if (user?.role === 'student' && !selectedCourseId) {
      setNotice('请先通过课程邀请码加入课程，再创建小组。')
      return
    }
    setActionLoading(true)
    setNotice(null)
    try {
      const newProject = await projectService.createProject({
        name: projectName.trim() || '新小组',
        description: '',
        course_id: selectedCourseId || undefined,
      })
      navigate(`/project/${newProject.id}`)
    } catch (error: any) {
      console.error('Failed to create project:', error)
      setNotice(error.response?.data?.detail || '创建小组失败。')
    } finally {
      setActionLoading(false)
    }
  }

  const handleJoinProject = async () => {
    if (!selectedCourseId || !groupCode.trim()) {
      setNotice('请选择课程并输入小组码。')
      return
    }
    setActionLoading(true)
    setNotice(null)
    try {
      const project = await projectService.joinProject({
        course_id: selectedCourseId,
        group_code: groupCode.trim().toUpperCase(),
      })
      navigate(`/project/${project.id}`)
    } catch (error: any) {
      setNotice(error.response?.data?.detail || '加入小组失败，请检查小组码。')
    } finally {
      setActionLoading(false)
    }
  }

  const getLearningMemberCount = (project: any) =>
    project.members.filter((member: any) => member.user_id !== project.owner_id || member.user_id === user?.id).length

  const actionTitle =
    activeAction === 'join-course'
      ? '加入课程'
      : activeAction === 'create-group'
        ? '创建课程小组'
        : '加入已有小组'

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div>加载中...</div>
      </div>
    )
  }

  return (
    <div className="h-[100dvh] overflow-y-auto bg-gray-50 p-4 sm:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold">我的小组</h1>
          {user?.role === 'student' && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setActiveAction('join-course')}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:border-slate-300 hover:bg-slate-50"
              >
                <LogIn className="h-4 w-4" />
                加入课程
              </button>
              <button
                type="button"
                onClick={() => setActiveAction('create-group')}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
                disabled={courses.length === 0}
              >
                <Plus className="h-4 w-4" />
                创建小组
              </button>
              <button
                type="button"
                onClick={() => setActiveAction('join-group')}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 shadow-sm hover:bg-indigo-100 disabled:opacity-50"
                disabled={courses.length === 0}
              >
                <Users className="h-4 w-4" />
                加入小组
              </button>
            </div>
          )}
        </div>

        {notice && (
          <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
            {notice}
          </div>
        )}

        {projects && projects.projects.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 mb-4">还没有小组</p>
            {user?.role === 'student' && (
              <button
                type="button"
                onClick={() => setActiveAction('create-group')}
                disabled={courses.length === 0}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                创建第一个小组
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects?.projects.map((project) => (
              <div
                key={project.id}
                onClick={() => navigate(`/project/${project.id}`)}
                className="bg-white rounded-lg shadow p-6 cursor-pointer hover:shadow-lg transition-shadow"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-lg font-semibold truncate flex-1 mr-2">{project.name}</h3>
                  {project.is_archived && (
                    <span className="shrink-0 px-2 py-0.5 bg-emerald-50 text-emerald-600 text-[10px] font-bold rounded-md border border-emerald-100 italic">
                      已提交
                    </span>
                  )}
                </div>
                {project.subtitle && (
                  <p className="text-sm text-gray-600 mb-4 line-clamp-2">
                    {project.subtitle}
                  </p>
                )}
                {project.group_code && (
                  <div className="mb-4 inline-flex rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700">
                    小组码：{project.group_code}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-500">
                    {getLearningMemberCount(project)} 名成员
                  </div>
                  <div className="text-sm font-medium text-indigo-600">
                    {project.is_archived ? '已完成' : `进度: ${project.progress}%`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {activeAction && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 px-3 py-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" role="dialog" aria-modal="true" aria-label={actionTitle}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{actionTitle}</h2>
                <p className="mt-1 text-sm leading-5 text-slate-500">
                  {activeAction === 'join-course' && '输入教师提供的课程邀请码，加入后才能创建或加入课程小组。'}
                  {activeAction === 'create-group' && '创建后系统会生成小组码，同班同学可凭小组码加入。'}
                  {activeAction === 'join-group' && '选择课程并输入同学提供的小组码，加入后会显示在列表中。'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveAction(null)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {activeAction === 'join-course' && (
              <div className="space-y-3">
                <input
                  value={courseInviteCode}
                  onChange={(event) => setCourseInviteCode(event.target.value.toUpperCase())}
                  placeholder="课程邀请码"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
                <button
                  type="button"
                  onClick={handleJoinCourse}
                  disabled={actionLoading || !courseInviteCode.trim()}
                  className="w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {actionLoading ? '加入中...' : '加入课程'}
                </button>
              </div>
            )}

            {activeAction === 'create-group' && (
              <div className="space-y-3">
                <select
                  value={selectedCourseId}
                  onChange={(event) => setSelectedCourseId(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                >
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>{course.name}（{course.semester}）</option>
                  ))}
                  {courses.length === 0 && <option value="">请先加入课程</option>}
                </select>
                <input
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                  placeholder="小组名称"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
                <button
                  type="button"
                  onClick={handleCreateProject}
                  disabled={actionLoading || courses.length === 0}
                  className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {actionLoading ? '创建中...' : '创建小组'}
                </button>
              </div>
            )}

            {activeAction === 'join-group' && (
              <div className="space-y-3">
                <select
                  value={selectedCourseId}
                  onChange={(event) => setSelectedCourseId(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                >
                  {courses.map((course) => (
                    <option key={course.id} value={course.id}>{course.name}（{course.semester}）</option>
                  ))}
                  {courses.length === 0 && <option value="">请先加入课程</option>}
                </select>
                <input
                  value={groupCode}
                  onChange={(event) => setGroupCode(event.target.value.toUpperCase())}
                  placeholder="小组码"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                />
                <button
                  type="button"
                  onClick={handleJoinProject}
                  disabled={actionLoading || courses.length === 0 || !groupCode.trim()}
                  className="w-full rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                >
                  {actionLoading ? '加入中...' : '加入小组'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
