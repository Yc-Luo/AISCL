import { useEffect, useState } from 'react'
import { taskService } from '../../../../services/api/task'
import { documentService, Document } from '../../../../services/api/document'
import { inquiryService, SnapshotResponse } from '../../../../services/api/inquiry'
import { wikiService, WikiItem } from '../../../../services/api/wiki'
import { Task, TaskSubmissionArtifact } from '../../../../types'
import { trackingService } from '../../../../services/tracking/TrackingService'
import { CheckCircle, Circle, PlayCircle, Plus, AlertCircle, ChevronDown, ListTodo, Clock, Trash2, ChevronRight, ChevronLeft, Paperclip, UploadCloud, X } from 'lucide-react'
import { Toast } from '../../../ui/Toast'
import { ConfirmDialog } from '../../../ui'
import { useAuthStore } from '../../../../stores/authStore'

interface TaskKanbanProps {
  projectId: string
  canSubmitCourseTask?: boolean
}

const MAX_ARTIFACT_SIZE_MB = 300
const MAX_ARTIFACT_SIZE = MAX_ARTIFACT_SIZE_MB * 1024 * 1024
const ARTIFACT_ACCEPT = [
  '.pdf',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.txt',
  '.md',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.mp4',
  '.webm',
  '.mov',
  '.zip',
  '.rar',
  '.7z',
].join(',')

export default function TaskKanban({ projectId, canSubmitCourseTask = true }: TaskKanbanProps) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskDescription, setNewTaskDescription] = useState('')
  const [newTaskDueDate, setNewTaskDueDate] = useState('')
  const [newTaskPriority, setNewTaskPriority] = useState<Task['priority']>('medium')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [expandedSections, setExpandedSections] = useState({
    todo: true,
    doing: true,
    done: false
  })
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [submittingTaskId, setSubmittingTaskId] = useState<string | null>(null)
  const [pendingDeleteTask, setPendingDeleteTask] = useState<Task | null>(null)
  const [pendingSubmitTask, setPendingSubmitTask] = useState<Task | null>(null)
  const [submissionNote, setSubmissionNote] = useState('')
  const [submissionFiles, setSubmissionFiles] = useState<File[]>([])
  const [existingArtifacts, setExistingArtifacts] = useState<TaskSubmissionArtifact[]>([])
  const [availableDocuments, setAvailableDocuments] = useState<Document[]>([])
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([])
  const [availableWikiItems, setAvailableWikiItems] = useState<WikiItem[]>([])
  const [selectedWikiItemIds, setSelectedWikiItemIds] = useState<string[]>([])
  const [inquirySnapshot, setInquirySnapshot] = useState<SnapshotResponse | null>(null)
  const [includeInquirySnapshot, setIncludeInquirySnapshot] = useState(false)
  const [artifactLoading, setArtifactLoading] = useState(false)
  const { user } = useAuthStore()

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

  useEffect(() => {
    if (!pendingSubmitTask) {
      setSubmissionFiles([])
      setExistingArtifacts([])
      setAvailableDocuments([])
      setSelectedDocumentIds([])
      setAvailableWikiItems([])
      setSelectedWikiItemIds([])
      setInquirySnapshot(null)
      setIncludeInquirySnapshot(false)
      setArtifactLoading(false)
      return
    }
    let mounted = true
    setArtifactLoading(true)
    Promise.all([
      taskService.getTaskArtifacts(pendingSubmitTask.id),
      documentService.getDocuments(projectId, 0, 50, false).then((response) => response.documents).catch(() => []),
      wikiService.listItems(projectId, { limit: 50 }).then((response) => response.items).catch(() => []),
      inquiryService.getSnapshot(projectId).catch(() => null),
    ])
      .then(([artifacts, documents, wikiItems, snapshot]) => {
        if (!mounted) return
        setExistingArtifacts(artifacts)
        setAvailableDocuments(documents)
        setSelectedDocumentIds(pendingSubmitTask.artifact_document_ids || (pendingSubmitTask.artifact_document_id ? [pendingSubmitTask.artifact_document_id] : []))
        setAvailableWikiItems(wikiItems)
        setSelectedWikiItemIds(pendingSubmitTask.artifact_wiki_item_ids || [])
        setInquirySnapshot(snapshot)
        const snapshotId = pendingSubmitTask.artifact_inquiry_snapshot_id || pendingSubmitTask.artifact_snapshot_id
        setIncludeInquirySnapshot(Boolean(snapshot && snapshotId && snapshot.snapshot_id === snapshotId))
      })
      .catch(() => {
        if (mounted) setToast({ message: '成果文件记录加载失败，请稍后重试。', type: 'error' })
      })
      .finally(() => {
        if (mounted) setArtifactLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [pendingSubmitTask, projectId])

  useEffect(() => {
    if (!projectId || tasks.length === 0) return
    const now = Date.now()
    const nextDueTime = tasks
      .filter(task => task.source_type === 'course_task_release' && !task.submission_status && task.due_date)
      .map(task => new Date(task.due_date as string).getTime())
      .filter(time => Number.isFinite(time) && time >= now)
      .sort((a, b) => a - b)[0]

    if (!nextDueTime) return
    const delay = Math.min(Math.max(nextDueTime - now + 1200, 1200), 2_147_483_647)
    const timer = window.setTimeout(async () => {
      try {
        const data = await taskService.getTasks(projectId)
        setTasks(data.tasks)
        setToast({ message: '有任务已到截止时间，系统已更新提交状态。', type: 'success' })
      } catch (error) {
        console.error('Failed to refresh due task status:', error)
      }
    }, delay)

    return () => window.clearTimeout(timer)
  }, [projectId, tasks])

  const getTasksByColumn = (column: 'todo' | 'doing' | 'done') => {
    return tasks
      .filter((task: Task) => task.column === column)
      .sort((a: Task, b: Task) => a.order - b.order)
  }



  const resetCreateTaskForm = () => {
    setNewTaskTitle('')
    setNewTaskDescription('')
    setNewTaskDueDate('')
    setNewTaskPriority('medium')
  }

  const handleAddTask = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!newTaskTitle.trim()) {
      setToast({ message: '请先填写任务标题。', type: 'error' })
      return
    }
    if (isSubmitting) return
    if (!projectId) {
      setToast({ message: '未找到小组 ID，无法添加任务。', type: 'error' })
      return
    }

    const title = newTaskTitle.trim()
    setIsSubmitting(true)
    try {
      const newTask = await taskService.createTask(projectId, {
        title,
        column: 'todo',
        priority: newTaskPriority,
        assignees: user?.id ? [user.id] : [],
        description: newTaskDescription.trim() || undefined,
        due_date: newTaskDueDate ? new Date(newTaskDueDate).toISOString() : undefined,
      })
      trackingService.track({
        module: 'task',
        action: 'task_create',
        metadata: { projectId, taskId: newTask.id, title }
      })
      resetCreateTaskForm()
      setCreateDialogOpen(false)
      // Update state locally first
      setTasks(prev => [...prev, newTask])
    } catch (error: any) {
      console.error('Failed to add task:', error)
      setToast({ message: `添加任务失败：${error.response?.data?.detail || error.message}`, type: 'error' })
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

  const deleteTask = async (taskId: string) => {

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
      setToast({ message: `无法删除任务：${error.response?.data?.detail || error.message}`, type: 'error' })
    }
  }

  const handleDeleteTask = async (e: React.MouseEvent, task: Task) => {
    e.stopPropagation()
    const primaryAssignee = task.assignees?.[0]
    if (primaryAssignee && primaryAssignee !== user?.id) {
      setPendingDeleteTask(task)
      return
    }
    await deleteTask(task.id)
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

  const getSubmissionLabel = (task: Task) => {
    if (task.submission_status === 'submitted') return '已提交'
    if (task.submission_status === 'late_submitted') return '逾期提交'
    if (task.submission_status === 'auto_submitted') return '已自动提交'
    if (task.due_date && new Date(task.due_date).getTime() <= Date.now()) return '已到截止时间'
    return '待提交'
  }

  const getSubmissionBadgeClass = (task: Task) => {
    if (task.submission_status === 'submitted') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
    if (task.submission_status === 'late_submitted') return 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'
    if (task.submission_status === 'auto_submitted') return 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
    return 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100'
  }

  const formatFileSize = (size: number) => {
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / 1024 / 1024).toFixed(1)} MB`
  }

  const handleSelectSubmissionFiles = (files: FileList | null) => {
    if (!files) return
    const nextFiles = Array.from(files)
    const oversized = nextFiles.find(file => file.size > MAX_ARTIFACT_SIZE)
    if (oversized) {
      setToast({ message: `“${oversized.name}”超过 ${MAX_ARTIFACT_SIZE_MB}MB，请压缩后再上传。`, type: 'error' })
      return
    }
    setSubmissionFiles(prev => [...prev, ...nextFiles].slice(0, 20))
  }

  const toggleSelection = (items: string[], id: string) => (
    items.includes(id) ? items.filter(item => item !== id) : [...items, id]
  )

  const handleSubmitTask = async (
    task: Task,
    note?: string,
    files: File[] = [],
    existingArtifactIds: string[] = [],
    documentIds: string[] = [],
    wikiItemIds: string[] = [],
    inquirySnapshotId?: string
  ) => {
    if (!task.course_task_release_id || submittingTaskId) return
    try {
      setSubmittingTaskId(task.id)
      const uploadedArtifacts: TaskSubmissionArtifact[] = []
      for (const file of files) {
        uploadedArtifacts.push(await taskService.uploadTaskArtifact(task.id, file))
      }
      const artifactIds = Array.from(new Set([...existingArtifactIds, ...uploadedArtifacts.map(artifact => artifact.id)]))
      const updated = await taskService.submitTask(task.id, {
        note,
        artifact_ids: artifactIds,
        artifact_document_ids: documentIds,
        artifact_document_id: documentIds[0],
        artifact_wiki_item_ids: wikiItemIds,
        artifact_inquiry_snapshot_id: inquirySnapshotId,
        artifact_snapshot_id: inquirySnapshotId,
      })
      setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
      setToast({
        message: updated.submission_status === 'late_submitted' ? '成果已逾期提交。' : '成果已提交。',
        type: 'success'
      })
      trackingService.track({
        module: 'task',
        action: 'task_submit',
        metadata: {
          projectId,
          taskId: task.id,
          courseTaskReleaseId: task.course_task_release_id,
          submissionStatus: updated.submission_status,
          noteLength: note?.trim().length || 0,
          artifactCount: artifactIds.length,
          documentArtifactCount: documentIds.length,
          wikiArtifactCount: wikiItemIds.length,
          hasInquirySnapshot: Boolean(inquirySnapshotId),
        }
      })
    } catch (error: any) {
      console.error('Failed to submit task:', error)
      setToast({ message: error.response?.data?.detail || '任务提交失败，请稍后重试。', type: 'error' })
    } finally {
      setSubmittingTaskId(null)
    }
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

      <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
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
                  {col === 'todo' && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation()
                        setCreateDialogOpen(true)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          event.stopPropagation()
                          setCreateDialogOpen(true)
                        }
                      }}
                      className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm transition hover:bg-indigo-700"
                      title="添加任务"
                    >
                      <Plus className="h-3 w-3" />
                    </span>
                  )}
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`} />
              </button>

              {isExpanded && (
                <div className="px-2 pb-3 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                  {colTasks.length === 0 ? (
                    <div className="py-6 text-center text-[10px] text-gray-400 font-medium">
                      <div className="italic">暂无内容</div>
                      {col === 'todo' && (
                        <button
                          type="button"
                          onClick={() => setCreateDialogOpen(true)}
                          className="mt-2 rounded-full bg-indigo-50 px-3 py-1 text-[10px] font-bold text-indigo-600 transition hover:bg-indigo-100"
                        >
                          添加第一个任务
                        </button>
                      )}
                    </div>
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
                              onClick={(e) => handleDeleteTask(e, task)}
                              className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
                              title="删除任务"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              {task.source_type === 'course_task_release' && (
                                <span className={`max-w-full break-keep rounded-full px-2 py-0.5 text-[9px] font-black leading-4 ${getSubmissionBadgeClass(task)}`}>
                                  全组共同任务 · {getSubmissionLabel(task)}
                                </span>
                              )}
                              {task.source_type !== 'course_task_release' && task.assignees?.[0] && (
                                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[9px] font-black leading-4 text-indigo-600">
                                  {task.assignees[0] === user?.id ? '我负责' : '成员负责'}
                                </span>
                              )}
                              {task.priority === 'high' && col !== 'done' && (
                                <span className="flex items-center gap-0.5 rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-black uppercase italic leading-4 text-red-600">
                                  <AlertCircle className="w-2.5 h-2.5" /> High
                                </span>
                              )}
                              {task.due_date && (
                                <span className="text-[9px] font-bold text-gray-400 flex items-center gap-1">
                                  <Clock className="w-2.5 h-2.5" />
                                  {new Date(task.due_date).toLocaleDateString()}
                                </span>
                              )}
                              {(task.submission_artifact_ids?.length || 0) > 0 && (
                                <span className="text-[9px] font-bold text-slate-500 flex items-center gap-1">
                                  <Paperclip className="w-2.5 h-2.5" />
                                  {task.submission_artifact_ids?.length} 个成果
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
                          {task.source_type === 'course_task_release' && (
                            <div className="mt-2 flex flex-col gap-2 rounded-xl bg-slate-50 px-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0 text-[10px] leading-4 text-slate-500">
                                {task.submitted_at
                                  ? `提交时间：${new Date(task.submitted_at).toLocaleString()}`
                                  : task.due_date
                                    ? `截止：${new Date(task.due_date).toLocaleString()}`
                                    : '未设置截止时间'}
                              </div>
                              <button
                                type="button"
                                disabled={
                                  submittingTaskId === task.id
                                  || task.submission_status === 'submitted'
                                  || !canSubmitCourseTask
                                }
                                onClick={() => {
                                  setPendingSubmitTask(task)
                                  setSubmissionNote('')
                                }}
                                title={canSubmitCourseTask ? '提交小组任务' : '当前仅组长可提交小组任务'}
                                className="w-full shrink-0 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[10px] font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-auto"
                              >
                                {submittingTaskId === task.id
                                  ? '提交中'
                                  : !canSubmitCourseTask
                                    ? '组长提交'
                                  : task.submission_status === 'submitted'
                                    ? '已提交'
                                    : task.submission_status === 'auto_submitted'
                                      ? '补交'
                                      : '提交'}
                              </button>
                            </div>
                          )}
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
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
      <ConfirmDialog
        open={createDialogOpen}
        title="添加小组任务"
        description="为当前小组添加一个待办任务，可设置说明、优先级和完成时间。"
        confirmLabel="添加任务"
        loading={isSubmitting}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) {
            setCreateDialogOpen(false)
            resetCreateTaskForm()
          }
        }}
        onConfirm={async () => {
          await handleAddTask()
        }}
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-2 block text-xs font-bold text-slate-500">任务标题</span>
            <input
              autoFocus
              value={newTaskTitle}
              onChange={(event) => setNewTaskTitle(event.target.value.slice(0, 200))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void handleAddTask()
                }
              }}
              placeholder="例如：整理证据来源"
              className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs font-bold text-slate-500">任务说明（可选）</span>
            <textarea
              value={newTaskDescription}
              onChange={(event) => setNewTaskDescription(event.target.value.slice(0, 1000))}
              rows={3}
              placeholder="补充任务要求、资料范围或成果形式。"
              className="w-full resize-y rounded-2xl border border-slate-200 px-3 py-2 text-sm leading-6 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-xs font-bold text-slate-500">完成时间（可选）</span>
              <input
                type="datetime-local"
                value={newTaskDueDate}
                onChange={(event) => setNewTaskDueDate(event.target.value)}
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-xs font-bold text-slate-500">优先级</span>
              <select
                value={newTaskPriority}
                onChange={(event) => setNewTaskPriority(event.target.value as Task['priority'])}
                className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              >
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </label>
          </div>
        </div>
      </ConfirmDialog>
      <ConfirmDialog
        open={Boolean(pendingDeleteTask)}
        title="删除他人负责的任务"
        description={`“${pendingDeleteTask?.title || ''}”已有其他成员负责。确定删除后，小组成员的分工记录也会被移除。`}
        confirmLabel="确认删除"
        tone="danger"
        onOpenChange={(open) => {
          if (!open) setPendingDeleteTask(null)
        }}
        onConfirm={async () => {
          const taskId = pendingDeleteTask?.id
          setPendingDeleteTask(null)
          if (taskId) await deleteTask(taskId)
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingSubmitTask)}
        title="提交小组任务"
        description={`确认提交“${pendingSubmitTask?.title || ''}”？提交后会记录提交人、提交时间和当前小组任务状态。`}
        confirmLabel="确认提交"
        loading={Boolean(submittingTaskId)}
        contentClassName="max-w-3xl"
        onOpenChange={(open) => {
          if (!open && !submittingTaskId) {
            setPendingSubmitTask(null)
            setSubmissionNote('')
            setSubmissionFiles([])
            setExistingArtifacts([])
            setSelectedDocumentIds([])
            setSelectedWikiItemIds([])
            setIncludeInquirySnapshot(false)
          }
        }}
        onConfirm={async () => {
          const task = pendingSubmitTask
          if (!task) return
          await handleSubmitTask(
            task,
            submissionNote.trim() || undefined,
            submissionFiles,
            existingArtifacts.map(artifact => artifact.id),
            selectedDocumentIds,
            selectedWikiItemIds,
            includeInquirySnapshot ? inquirySnapshot?.snapshot_id : undefined
          )
          setPendingSubmitTask(null)
          setSubmissionNote('')
          setSubmissionFiles([])
          setExistingArtifacts([])
          setSelectedDocumentIds([])
          setSelectedWikiItemIds([])
          setIncludeInquirySnapshot(false)
        }}
      >
        <div className="min-w-0 space-y-4">
          <section className="rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h4 className="text-sm font-bold text-slate-800">协作成果引用</h4>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">可把已有协作文档、论证空间快照和知识沉淀卡片一起提交给教师查看。</p>
              </div>
              {artifactLoading && <span className="text-xs text-slate-400">读取中...</span>}
            </div>

            <div className="grid gap-3 lg:grid-cols-3">
              <div className="min-w-0 rounded-xl bg-white p-3 ring-1 ring-slate-100">
                <div className="mb-2 text-xs font-black text-slate-500">共享文档</div>
                <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
                  {availableDocuments.length === 0 ? (
                    <div className="text-xs leading-5 text-slate-400">暂无可选文档</div>
                  ) : availableDocuments.map((doc) => (
                    <label key={doc.id} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={selectedDocumentIds.includes(doc.id)}
                        onChange={() => setSelectedDocumentIds(prev => toggleSelection(prev, doc.id))}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="min-w-0 flex-1 truncate text-slate-700" title={doc.title}>{doc.title}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="min-w-0 rounded-xl bg-white p-3 ring-1 ring-slate-100">
                <div className="mb-2 text-xs font-black text-slate-500">论证空间</div>
                {inquirySnapshot?.snapshot_id ? (
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={includeInquirySnapshot}
                      onChange={(event) => setIncludeInquirySnapshot(event.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="min-w-0 leading-5 text-slate-700">
                      提交最新论证空间快照
                      {inquirySnapshot.version ? <span className="ml-1 text-slate-400">v{inquirySnapshot.version}</span> : null}
                    </span>
                  </label>
                ) : (
                  <div className="text-xs leading-5 text-slate-400">暂无已保存的论证空间快照</div>
                )}
              </div>

              <div className="min-w-0 rounded-xl bg-white p-3 ring-1 ring-slate-100">
                <div className="mb-2 text-xs font-black text-slate-500">知识沉淀</div>
                <div className="max-h-36 space-y-2 overflow-y-auto pr-1">
                  {availableWikiItems.length === 0 ? (
                    <div className="text-xs leading-5 text-slate-400">暂无可选 Wiki 卡片</div>
                  ) : availableWikiItems.map((item) => (
                    <label key={item.id} className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={selectedWikiItemIds.includes(item.id)}
                        onChange={() => setSelectedWikiItemIds(prev => toggleSelection(prev, item.id))}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="min-w-0 flex-1 truncate text-slate-700" title={item.title}>{item.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <label className="block">
            <span className="mb-2 block text-xs font-bold text-slate-500">成果文件</span>
            <div className="w-full rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 p-4">
              <input
                id="task-artifact-upload"
                type="file"
                multiple
                accept={ARTIFACT_ACCEPT}
                className="hidden"
                onChange={(event) => {
                  handleSelectSubmissionFiles(event.target.files)
                  event.target.value = ''
                }}
              />
              <label
                htmlFor="task-artifact-upload"
                className="flex min-h-[112px] cursor-pointer flex-col items-center justify-center gap-2 text-center text-xs font-bold leading-5 text-indigo-600"
              >
                <UploadCloud className="h-6 w-6" />
                上传文档、PPT、图片、视频或压缩包
                <span className="font-medium text-slate-400">单个文件不超过 50MB，最多 20 个文件</span>
              </label>
            </div>
          </label>

          <div className="space-y-2">
            {artifactLoading && (
              <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">正在读取已有成果文件...</div>
            )}
            {existingArtifacts.map((artifact) => (
              <div key={artifact.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold text-slate-700">{artifact.filename}</div>
                  <div className="text-[10px] text-slate-400">已上传 · {formatFileSize(artifact.size)}</div>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  onClick={async () => {
                    try {
                      await taskService.deleteTaskArtifact(pendingSubmitTask!.id, artifact.id)
                      setExistingArtifacts(prev => prev.filter(item => item.id !== artifact.id))
                    } catch {
                      setToast({ message: '删除成果文件失败。', type: 'error' })
                    }
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {submissionFiles.map((file, index) => (
              <div key={`${file.name}-${file.size}-${index}`} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-bold text-slate-700">{file.name}</div>
                  <div className="text-[10px] text-slate-400">待上传 · {formatFileSize(file.size)}</div>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                  onClick={() => setSubmissionFiles(prev => prev.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <label className="block">
            <span className="mb-2 block text-xs font-bold text-slate-500">提交说明（可选）</span>
            <textarea
              value={submissionNote}
              onChange={(event) => setSubmissionNote(event.target.value.slice(0, 2000))}
              rows={4}
              placeholder="可以说明本次提交对应的成果位置、尚未解决的问题或需要教师关注的地方。"
              className="w-full resize-y rounded-2xl border border-slate-200 px-3 py-2 text-sm leading-6 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            <span className="mt-1 block text-right text-[10px] font-semibold text-slate-400">
              {submissionNote.length}/2000
            </span>
          </label>
        </div>
      </ConfirmDialog>
    </div>
  )
}
