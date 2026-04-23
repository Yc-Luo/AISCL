import { useEffect, useState } from 'react'
import { taskService } from '../../../../services/api/task'
import { Task } from '../../../../types'
import { trackingService } from '../../../../services/tracking/TrackingService'
import { CheckCircle, Circle, PlayCircle, Plus, AlertCircle, ChevronDown, ListTodo, Clock, Trash2, ChevronRight, ChevronLeft } from 'lucide-react'

interface TaskKanbanProps {
  projectId: string
}

export default function TaskKanban({ projectId }: TaskKanbanProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    todo: true,
    doing: true,
    done: false
  })
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const data = await taskService.getTasks(projectId)
        setTasks(data.tasks)
        trackingService.track({
          module: 'task',
          action: 'task_view',
          metadata: { projectId, taskCount: data.tasks.length }
        })
      } catch (error) {
        console.error('Failed to fetch tasks:', error)
      } finally {
        setLoading(false)
      }
    }

    if (projectId) {
      fetchTasks()
    }
  }, [projectId])

  const getTasksByColumn = (column: 'todo' | 'doing' | 'done') => {
    return tasks
      .filter((task: Task) => task.column === column)
      .sort((a: Task, b: Task) => a.order - b.order)
  }



  const handleAddTask = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!newTaskTitle.trim() || isSubmitting) return
    if (!projectId) {
      alert('未找到小组 ID，无法添加任务')
      return
    }

    const title = newTaskTitle.trim()
    setIsSubmitting(true)
    try {
      const newTask = await taskService.createTask(projectId, {
        title,
        column: 'todo',
        priority: 'medium'
      })
      trackingService.track({
        module: 'task',
        action: 'task_create',
        metadata: { projectId, taskId: newTask.id, title }
      })
      setNewTaskTitle('')
      // Update state locally first
      setTasks(prev => [...prev, newTask])
    } catch (error: any) {
      console.error('Failed to add task:', error)
      alert(`添加任务失败: ${error.response?.data?.detail || error.message}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    setDraggedTaskId(taskId)
    e.dataTransfer.setData('taskId', taskId)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }

  const handleDrop = async (e: React.DragEvent, targetColumn: 'todo' | 'doing' | 'done') => {
    e.preventDefault()
    const taskId = e.dataTransfer.getData('taskId') || draggedTaskId
    if (!taskId) return

    const task = tasks.find(t => t.id === taskId)
    if (!task || task.column === targetColumn) {
      setDraggedTaskId(null)
      return
    }

    try {
      await taskService.updateTaskColumn(taskId, targetColumn)
      trackingService.track({
        module: 'task',
        action: 'task_move',
        metadata: { taskId, from: task.column, to: targetColumn, method: 'drag' }
      })
      const data = await taskService.getTasks(projectId)
      setTasks(data.tasks)
    } catch (error) {
      console.error('Failed to update task:', error)
    } finally {
      setDraggedTaskId(null)
    }
  }

  const handleDeleteTask = async (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation()

    // Save current state for potential rollback
    const previousTasks = [...tasks]

    try {
      // Optimistic update: remove immediately from UI
      setTasks(prev => prev.filter(t => t.id !== taskId))
      await taskService.deleteTask(taskId)
      trackingService.track({
        module: 'task',
        action: 'task_delete',
        metadata: { taskId }
      })
    } catch (error: any) {
      console.error('Failed to delete task:', error)
      // Rollback on failure
      setTasks(previousTasks)
      alert(`无法删除任务: ${error.response?.data?.detail || error.message}`)
    }
  }

  const handleCyclePriority = async (task: Task) => {
    const priorities: Task['priority'][] = ['low', 'medium', 'high']
    const currentIndex = priorities.indexOf(task.priority)
    const nextPriority = priorities[(currentIndex + 1) % priorities.length]

    try {
      // Optimistic update
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, priority: nextPriority } : t))
      await taskService.updateTask(task.id, { priority: nextPriority })
      trackingService.track({
        module: 'task',
        action: 'task_priority_change',
        metadata: { taskId: task.id, from: task.priority, to: nextPriority }
      })
    } catch (error) {
      console.error('Failed to update priority:', error)
      // Rollback on error
      const data = await taskService.getTasks(projectId)
      setTasks(data.tasks)
    }
  }

  const handleStartEdit = (task: Task) => {
    setEditingTaskId(task.id)
    setEditingTitle(task.title)
  }

  const handleSaveTitle = async (taskId: string) => {
    if (!editingTitle.trim()) {
      setEditingTaskId(null)
      return
    }

    try {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, title: editingTitle } : t))
      await taskService.updateTask(taskId, { title: editingTitle })
      trackingService.track({
        module: 'task',
        action: 'task_update',
        metadata: { taskId, title: editingTitle }
      })
    } catch (error) {
      console.error('Failed to update title:', error)
      const data = await taskService.getTasks(projectId)
      setTasks(data.tasks)
    } finally {
      setEditingTaskId(null)
    }
  }

  const handleMoveColumn = async (taskId: string, direction: 'next' | 'prev') => {
    const task = tasks.find(t => t.id === taskId)
    if (!task) return

    const columns: Task['column'][] = ['todo', 'doing', 'done']
    const currentIndex = columns.indexOf(task.column)
    let nextIndex = direction === 'next' ? currentIndex + 1 : currentIndex - 1

    if (nextIndex < 0 || nextIndex >= columns.length) return
    const nextColumn = columns[nextIndex]

    try {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, column: nextColumn } : t))
      await taskService.updateTaskColumn(taskId, nextColumn)
      trackingService.track({
        module: 'task',
        action: 'task_move',
        metadata: { taskId, from: task.column, to: nextColumn, method: 'click' }
      })
    } catch (error) {
      console.error('Failed to move task:', error)
      const data = await taskService.getTasks(projectId)
      setTasks(data.tasks)
    }
  }

  const toggleSection = (section: 'todo' | 'doing' | 'done') => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  if (loading) {
    return <div className="p-4">加载中...</div>
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Task Header */}
      <div className="p-4 flex items-center justify-between border-b border-gray-50 bg-gray-50/30">
        <div className="flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-indigo-600" />
          <h3 className="text-sm font-bold text-gray-900">任务清单</h3>
        </div>
        <div className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
          {tasks.filter(t => t.column !== 'done').length} 进行中
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {/* Quick Add */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleAddTask()
          }}
          className="relative group"
        >
          <input
            type="text"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAddTask()
              }
            }}
            disabled={isSubmitting}
            placeholder="按下回车快速添加任务..."
            className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:bg-white transition-all shadow-sm"
          />
          <button
            type="submit"
            disabled={isSubmitting || !newTaskTitle.trim()}
            className="absolute left-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-indigo-600 transition-colors disabled:opacity-30"
          >
            <Plus className={`w-4 h-4 ${isSubmitting ? 'animate-spin' : ''}`} />
          </button>
        </form>

        {/* Task Flow Sections */}
        {(['todo', 'doing', 'done'] as const).map((col) => {
          const colTasks = getTasksByColumn(col)
          const isExpanded = expandedSections[col]

          return (
            <div
              key={col}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, col)}
              className={`rounded-2xl border transition-all duration-300 ${col === 'doing' ? 'bg-indigo-50/30 border-indigo-100' :
                col === 'todo' ? 'bg-blue-50/30 border-blue-100' : 'bg-gray-50/30 border-gray-100'
                }`}
            >
              <button
                onClick={() => toggleSection(col)}
                className="w-full flex items-center justify-between p-3"
              >
                <div className="flex items-center gap-2">
                  {col === 'todo' ? <Circle className="w-3.5 h-3.5 text-blue-500" /> :
                    col === 'doing' ? <PlayCircle className="w-3.5 h-3.5 text-indigo-500" /> :
                      <CheckCircle className="w-3.5 h-3.5 text-gray-400" />}
                  <span className="text-xs font-bold text-gray-700 capitalize">
                    {col === 'todo' ? '待办' : col === 'doing' ? '进行中' : '已完成'}
                  </span>
                  <span className="text-[10px] font-bold text-gray-400 px-1.5 py-0.5 bg-white/50 rounded-full">
                    {colTasks.length}
                  </span>
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
              </button>

              {isExpanded && (
                <div className="px-2 pb-3 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                  {colTasks.length === 0 ? (
                    <div className="py-6 text-center text-[10px] text-gray-400 font-medium italic">暂无内容</div>
                  ) : (
                    colTasks.map((task) => (
                      <div
                        key={task.id}
                        draggable
                        onDragStart={(e) => handleDragStart(e, task.id)}
                        className={`group relative p-3 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all cursor-move pl-4 ${task.priority === 'high' && col !== 'done' ? 'ring-1 ring-red-100' : ''
                          }`}
                      >
                        {/* Priority Indicator - Click to cycle */}
                        <div
                          className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl cursor-pointer hover:w-2 transition-all ${task.priority === 'high' ? 'bg-red-500' :
                            task.priority === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
                            }`}
                          onClick={() => handleCyclePriority(task)}
                          title="点击切换优先级"
                        />

                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-start justify-between gap-2">
                            {editingTaskId === task.id ? (
                              <input
                                autoFocus
                                className="text-xs font-bold text-gray-900 w-full bg-gray-50 border-none focus:ring-1 focus:ring-indigo-500 rounded px-1 -ml-1"
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                onBlur={() => handleSaveTitle(task.id)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle(task.id)}
                              />
                            ) : (
                              <div
                                className={`text-xs font-bold text-gray-900 leading-tight flex-1 ${col === 'done' ? 'line-through text-gray-400' : ''}`}
                                onClick={() => handleStartEdit(task)}
                              >
                                {task.title}
                              </div>
                            )}

                            <button
                              onClick={(e) => handleDeleteTask(e, task.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
                              title="删除任务"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>

                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {task.priority === 'high' && col !== 'done' && (
                                <span className="flex items-center gap-0.5 text-[9px] font-black text-red-600 bg-red-50 px-1.5 py-0.5 rounded-full uppercase italic animate-pulse">
                                  <AlertCircle className="w-2.5 h-2.5" /> High
                                </span>
                              )}
                              {task.due_date && (
                                <span className="text-[9px] font-bold text-gray-400 flex items-center gap-1">
                                  <Clock className="w-2.5 h-2.5" />
                                  {new Date(task.due_date).toLocaleDateString()}
                                </span>
                              )}
                            </div>

                            {/* Quick Move Controls */}
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {col !== 'todo' && (
                                <button
                                  onClick={() => handleMoveColumn(task.id, 'prev')}
                                  className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                                >
                                  <ChevronLeft className="w-3 h-3" />
                                </button>
                              )}
                              {col !== 'done' && (
                                <button
                                  onClick={() => handleMoveColumn(task.id, 'next')}
                                  className="p-1 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
                                >
                                  <ChevronRight className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
