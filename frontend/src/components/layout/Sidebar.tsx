import { useEffect, useState } from 'react'
import ProjectInfo from '../features/student/project/ProjectInfo'
import TaskKanban from '../features/student/project/TaskKanban'
import { CheckSquare, PanelLeftClose, RotateCcw, Upload } from 'lucide-react'
import { projectService } from '../../services/api/project'
import { Project } from '../../types'
import { ConfirmDialog } from '../ui'

interface SidebarProps {
  projectId?: string
  canSubmitCourseTask?: boolean
  onCollapse?: () => void
}

export default function Sidebar({ projectId, canSubmitCourseTask = true, onCollapse }: SidebarProps) {
  return (
    <div className="h-full w-full bg-white border-r border-gray-200 flex flex-col transition-all duration-300 relative lg:w-72">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <div>
          <div className="text-sm font-black tracking-tight text-indigo-700">AISCL</div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">协作学习空间</div>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          className="hidden rounded-xl p-2 text-slate-400 transition hover:bg-indigo-50 hover:text-indigo-600 lg:inline-flex"
          title="折叠左侧栏"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {projectId ? (
          <div className="space-y-3 pb-3">
            <ProjectInfo projectId={projectId} compact showArchiveAction={false} />
            <div className="mx-3 h-[calc(100vh-17rem)] min-h-[30rem] overflow-hidden rounded-2xl border border-slate-100 shadow-sm">
              <TaskKanban projectId={projectId} canSubmitCourseTask={canSubmitCourseTask} />
            </div>
          </div>
        ) : (
          <div className="p-4 text-center text-sm text-slate-400">
            暂无可进入的小组空间。
          </div>
        )}
      </div>
      {projectId && (
        <ProjectArchiveAction projectId={projectId} canArchive={canSubmitCourseTask} />
      )}
    </div>
  )
}

function ProjectArchiveAction({ projectId, canArchive }: { projectId: string; canArchive: boolean }) {
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [confirmUnarchive, setConfirmUnarchive] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    projectService.getProject(projectId)
      .then((nextProject) => {
        if (mounted) setProject(nextProject)
      })
      .catch(() => {
        if (mounted) setNotice('无法读取小组归档状态。')
      })
    return () => {
      mounted = false
    }
  }, [projectId])

  if (!canArchive || !project) return null

  const archive = async () => {
    try {
      setLoading(true)
      const updated = await projectService.archiveProject(projectId)
      setProject(updated)
      setNotice('小组空间已提交归档。')
    } catch {
      setNotice('提交归档失败，请稍后重试。')
    } finally {
      setLoading(false)
      setConfirmArchive(false)
    }
  }

  const unarchive = async () => {
    try {
      setLoading(true)
      const updated = await projectService.unarchiveProject(projectId)
      setProject(updated)
      setNotice('小组空间已撤回归档。')
    } catch {
      setNotice('撤回归档失败，请稍后重试。')
    } finally {
      setLoading(false)
      setConfirmUnarchive(false)
    }
  }

  return (
    <div className="border-t border-slate-100 bg-white px-3 py-2">
      {notice && (
        <div className="mb-2 rounded-xl bg-slate-50 px-2 py-1.5 text-center text-[10px] font-medium text-slate-500">
          {notice}
        </div>
      )}
      {project.is_archived ? (
        <div className="flex items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-50 px-2 py-2 text-[11px] font-bold text-emerald-700">
            <CheckSquare className="h-3.5 w-3.5" />
            已归档
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => setConfirmUnarchive(true)}
            className="rounded-xl border border-indigo-100 px-2 py-2 text-[11px] font-bold text-indigo-600 transition hover:bg-indigo-50 disabled:opacity-50"
            title="撤回归档"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={loading}
          onClick={() => setConfirmArchive(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-[11px] font-bold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          提交并归档
        </button>
      )}
      <ConfirmDialog
        open={confirmArchive}
        title="提交并归档小组空间"
        description="提交后小组空间会进入只读归档状态。确认提交当前小组成果？"
        confirmLabel="确认归档"
        loading={loading}
        onOpenChange={setConfirmArchive}
        onConfirm={archive}
      />
      <ConfirmDialog
        open={confirmUnarchive}
        title="撤回归档"
        description="撤回后小组成员可以继续编辑小组空间。确认撤回？"
        confirmLabel="确认撤回"
        loading={loading}
        onOpenChange={setConfirmUnarchive}
        onConfirm={unarchive}
      />
    </div>
  )
}
