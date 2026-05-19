import ProjectInfo from '../features/student/project/ProjectInfo'
import TaskKanban from '../features/student/project/TaskKanban'
import { PanelLeftClose } from 'lucide-react'

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
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {projectId ? (
          <div className="space-y-3 pb-4">
            <ProjectInfo projectId={projectId} compact />
            <div className="mx-3 h-[30rem] min-h-[24rem] overflow-hidden rounded-2xl border border-slate-100 shadow-sm">
              <TaskKanban projectId={projectId} canSubmitCourseTask={canSubmitCourseTask} />
            </div>
          </div>
        ) : (
          <div className="p-4 text-center text-sm text-slate-400">
            暂无可进入的小组空间。
          </div>
        )}
      </div>
    </div>
  )
}
