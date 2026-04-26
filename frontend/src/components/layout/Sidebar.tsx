import { useState } from 'react'
import ProjectInfo from '../features/student/project/ProjectInfo'
import CalendarView from '../features/student/project/CalendarView'
import TaskKanban from '../features/student/project/TaskKanban'
import { trackingService } from '../../services/tracking/TrackingService'
import { Folder, CheckSquare, Calendar } from 'lucide-react'

interface SidebarProps {
  projectId?: string
}

export default function Sidebar({ projectId }: SidebarProps) {
  const [activeSection, setActiveSection] = useState<'info' | 'tasks' | 'calendar'>('info')

  const handleSectionChange = (section: 'info' | 'tasks' | 'calendar') => {
    trackingService.track({
      module: 'dashboard',
      action: 'sidebar_section_change',
      metadata: { from: activeSection, to: section }
    })
    setActiveSection(section)
  }

  return (
    <div className="h-full w-full bg-white border-r border-gray-200 flex flex-col transition-all duration-300 relative lg:w-64">
      <div className="border-b border-gray-200 flex">
        <button
          onClick={() => handleSectionChange('info')}
          title="小组详情"
          className={`flex-1 py-3 text-sm font-medium transition-colors relative flex items-center justify-center gap-2 ${activeSection === 'info'
            ? 'text-indigo-600'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
        >
          <Folder className="w-4 h-4" />
          <span>小组</span>
          {activeSection === 'info' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
          )}
        </button>
        <button
          onClick={() => handleSectionChange('tasks')}
          title="任务看板"
          className={`flex-1 py-3 text-sm font-medium transition-colors relative flex items-center justify-center gap-2 ${activeSection === 'tasks'
            ? 'text-indigo-600'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
        >
          <CheckSquare className="w-4 h-4" />
          <span>任务</span>
          {activeSection === 'tasks' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
          )}
        </button>
        <button
          onClick={() => handleSectionChange('calendar')}
          title="小组日历"
          className={`flex-1 py-3 text-sm font-medium transition-colors relative flex items-center justify-center gap-2 ${activeSection === 'calendar'
            ? 'text-indigo-600'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
        >
          <Calendar className="w-4 h-4" />
          <span>日历</span>
          {activeSection === 'calendar' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
          )}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto block">
        {activeSection === 'info' && projectId && (
          <ProjectInfo projectId={projectId} />
        )}
        {activeSection === 'calendar' && projectId && (
          <CalendarView projectId={projectId} />
        )}
        {activeSection === 'tasks' && projectId && (
          <TaskKanban projectId={projectId} />
        )}
      </div>
    </div>
  )
}
