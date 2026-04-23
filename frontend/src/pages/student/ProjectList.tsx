import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { projectService, ProjectListResponse } from '../../services/api/project'
import { useAuthStore } from '../../stores/authStore'

export default function ProjectList() {
  const [projects, setProjects] = useState<ProjectListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const { user } = useAuthStore()

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        // Fetch both active and archived projects
        const [activeData, archivedData] = await Promise.all([
          projectService.getProjects(false),
          projectService.getProjects(true)
        ])

        setProjects({
          projects: [...activeData.projects, ...archivedData.projects],
          total: activeData.total + archivedData.total
        })
      } catch (error) {
        console.error('Failed to fetch projects:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchProjects()
  }, [])

  const handleCreateProject = async () => {
    try {
      const newProject = await projectService.createProject({
        name: '新小组',
        description: '',
      })
      navigate(`/project/${newProject.id}`)
    } catch (error) {
      console.error('Failed to create project:', error)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div>加载中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">我的小组</h1>
          {user?.role === 'student' && (
            <button
              onClick={handleCreateProject}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              创建小组
            </button>
          )}
        </div>

        {projects && projects.projects.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-600 mb-4">还没有小组</p>
            {user?.role === 'student' && (
              <button
                onClick={handleCreateProject}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
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
                <div className="flex items-center justify-between">
                  <div className="text-sm text-gray-500">
                    {project.members.length} 名成员
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
    </div>
  )
}
