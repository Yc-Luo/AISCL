import { useEffect, useState, useRef } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isSameMonth } from 'date-fns'
import { calendarService } from '../../../../services/api/calendar'
import { taskService } from '../../../../services/api/task'
import { CalendarEvent, Task } from '../../../../types'
import { trackingService } from '../../../../services/tracking/TrackingService'
import { useAuthStore } from '../../../../stores/authStore'
import { Calendar, ChevronLeft, ChevronRight, Clock, MapPin, Target } from 'lucide-react'

interface CalendarViewProps {
  projectId: string
}

export default function CalendarView({ projectId }: CalendarViewProps) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [loading, setLoading] = useState(true)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [newEventTitle, setNewEventTitle] = useState('')
  const [newEventType, setNewEventType] = useState<'meeting' | 'deadline' | 'personal'>('meeting')
  const [newEventIsPrivate, setNewEventIsPrivate] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const { user } = useAuthStore()

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        const startDate = startOfMonth(currentMonth).toISOString()
        const endDate = endOfMonth(currentMonth).toISOString()

        const [eventData, taskData] = await Promise.all([
          calendarService.getEvents(projectId, startDate, endDate),
          taskService.getTasks(projectId)
        ])

        setEvents(eventData.events)
        setTasks(taskData.tasks.filter((t: Task) => t.due_date))
      } catch (error) {
        console.error('Failed to fetch calendar data:', error)
      } finally {
        setLoading(false)
      }
    }

    if (projectId) {
      fetchData()
    }
  }, [projectId, currentMonth])

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd })

  // Get items for a specific date
  const getItemsForDate = (date: Date) => {
    const dayEvents = events.filter(event => isSameDay(new Date(event.start_time), date))
    const dayTasks = tasks.filter(task => task.due_date && isSameDay(new Date(task.due_date), date))
    return { events: dayEvents, tasks: dayTasks }
  }



  const handlePrevMonth = () => {
    const nextDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1)
    setCurrentMonth(nextDate)
    trackingService.track({
      module: 'calendar',
      action: 'calendar_view_change',
      metadata: { projectId, view: 'month', date: nextDate.toISOString() }
    })
  }

  const handleNextMonth = () => {
    const nextDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1)
    setCurrentMonth(nextDate)
    trackingService.track({
      module: 'calendar',
      action: 'calendar_view_change',
      metadata: { projectId, view: 'month', date: nextDate.toISOString() }
    })
  }

  const handleToday = () => {
    const today = new Date()
    setCurrentMonth(today)
    setSelectedDate(today)
    trackingService.track({
      module: 'calendar',
      action: 'calendar_view_change',
      metadata: { projectId, view: 'today', date: today.toISOString() }
    })
  }

  const { events: selectedDateEvents, tasks: selectedDateTasks } = getItemsForDate(selectedDate)

  const handleDateClick = (date: Date) => {
    setSelectedDate(date)
    setShowCreateDialog(true)
    trackingService.track({
      module: 'calendar',
      action: 'calendar_date_select',
      metadata: { projectId, date: date.toISOString() }
    })
  }

  const handleCreateEvent = async () => {
    if (!selectedDate || !newEventTitle.trim() || !user) return

    try {
      const startTime = new Date(selectedDate)
      startTime.setHours(9, 0, 0, 0)
      const endTime = new Date(selectedDate)
      endTime.setHours(17, 0, 0, 0)

      await calendarService.createEvent(projectId, {
        title: newEventTitle,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        type: newEventType,
        is_private: newEventIsPrivate,
      })

      trackingService.track({
        module: 'calendar',
        action: 'calendar_event_create',
        metadata: { projectId, title: newEventTitle, type: newEventType }
      })

      // Refresh events
      const startDate = startOfMonth(currentMonth).toISOString()
      const endDate = endOfMonth(currentMonth).toISOString()
      const data = await calendarService.getEvents(projectId, startDate, endDate)
      setEvents(data.events)

      // Reset form
      setNewEventTitle('')
      setNewEventType('meeting')
      setNewEventIsPrivate(false)
      setShowCreateDialog(false)
    } catch (error) {
      console.error('Failed to create event:', error)
      alert('创建事件失败')
    }
  }

  // Close dialog on click outside
  useEffect(() => {
    if (!showCreateDialog) return

    const handleClickOutside = (event: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) {
        setShowCreateDialog(false)
        setNewEventTitle('')
        setNewEventType('meeting')
        setNewEventIsPrivate(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showCreateDialog])

  if (loading) {
    return <div className="p-4">加载中...</div>
  }

  return (
    <div className="flex flex-col h-full bg-white overflow-hidden">
      {/* Calendar Header */}
      <div className="p-4 flex items-center justify-between border-b border-gray-50 bg-gray-50/30">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-indigo-600" />
          <h3 className="text-sm font-bold text-gray-900">
            {format(currentMonth, 'MMMM yyyy')}
          </h3>
        </div>
        <div className="flex items-center bg-gray-100 p-1 rounded-lg">
          <button onClick={handlePrevMonth} className="p-1 hover:bg-white hover:shadow-sm rounded-md transition-all">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleToday} className="px-2 py-0.5 text-[10px] font-bold text-gray-600 hover:text-indigo-600 transition-colors">今日</button>
          <button onClick={handleNextMonth} className="p-1 hover:bg-white hover:shadow-sm rounded-md transition-all">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
        {/* Calendar Grid */}
        <div className="bg-gray-50/50 p-2 rounded-2xl border border-gray-100">
          <div className="grid grid-cols-7 mb-2">
            {['日', '一', '二', '三', '四', '五', '六'].map((day) => (
              <div key={day} className="text-center text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {daysInMonth.map((day) => {
              const { events: dayEvents, tasks: dayTasks } = getItemsForDate(day)
              const isSelected = isSameDay(day, selectedDate)
              const isCurrentMonth = isSameMonth(day, currentMonth)
              const isToday = isSameDay(day, new Date())

              return (
                <button
                  key={day.toISOString()}
                  onClick={() => handleDateClick(day)}
                  className={`
                    relative aspect-square flex flex-col items-center justify-center rounded-xl transition-all duration-200
                    ${isCurrentMonth ? 'text-gray-900' : 'text-gray-300'}
                    ${isSelected ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 scale-110 z-10' : 'hover:bg-white hover:shadow-sm'}
                    ${isToday && !isSelected ? 'ring-2 ring-indigo-100 font-bold' : ''}
                  `}
                >
                  <span className="text-xs">{format(day, 'd')}</span>
                  <div className="absolute bottom-1.5 flex gap-0.5">
                    {dayEvents.slice(0, 2).map(e => (
                      <div key={e.id} className={`w-1 h-1 rounded-full ${isSelected ? 'bg-white/60' :
                        e.type === 'meeting' ? 'bg-blue-500' :
                          e.type === 'deadline' ? 'bg-red-500' : 'bg-purple-500'}`} />
                    ))}
                    {dayTasks.length > 0 && (
                      <div className={`w-1 h-1 rounded-full ${isSelected ? 'bg-white/60' : 'bg-orange-500'}`} />
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Timeline List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h4 className="text-xs font-bold text-gray-900">
              {isSameDay(selectedDate, new Date()) ? '今日日程' : format(selectedDate, 'MMM d, yyyy')}
            </h4>
            <span className="text-[10px] text-gray-400 font-medium">
              {selectedDateEvents.length + selectedDateTasks.length} 个安排
            </span>
          </div>

          <div className="space-y-3">
            {[...selectedDateEvents, ...selectedDateTasks].length === 0 ? (
              <div className="py-8 text-center bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                <Target className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-[10px] text-gray-400 font-medium tracking-wide">暂无日程安排</p>
              </div>
            ) : (
              <>
                {selectedDateEvents.map((event) => (
                  <div key={event.id} className="group relative bg-white p-3 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200 pl-4 overflow-hidden">
                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${event.type === 'meeting' ? 'bg-blue-500' :
                      event.type === 'deadline' ? 'bg-red-500' : 'bg-purple-500'
                      }`} />
                    <div className="flex justify-between items-start mb-1.5">
                      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full uppercase tracking-tighter">
                        {event.type === 'meeting' ? '会议' : event.type === 'deadline' ? '截止' : '个人'}
                      </span>
                      <div className="flex items-center gap-1 text-[10px] font-bold text-gray-900">
                        <Clock className="w-3 h-3 text-gray-400" />
                        {format(new Date(event.start_time), 'HH:mm')}
                      </div>
                    </div>
                    <div className="text-sm font-bold text-gray-900 mb-1 leading-tight group-hover:text-indigo-600 transition-colors">
                      {event.title}
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-gray-400 font-medium">
                      <MapPin className="w-3 h-3" />
                      在线协作室
                    </div>
                  </div>
                ))}
                {selectedDateTasks.map((task) => (
                  <div key={task.id} className="group relative bg-white p-3 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-200 pl-4 overflow-hidden">
                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-orange-500" />
                    <div className="flex justify-between items-start mb-1.5">
                      <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full uppercase tracking-tighter">
                        任务截止
                      </span>
                      <div className="flex items-center gap-1 text-[10px] font-bold text-gray-900">
                        <Clock className="w-3 h-3 text-gray-400" />
                        全天
                      </div>
                    </div>
                    <div className="text-sm font-bold text-gray-900 leading-tight group-hover:text-orange-600 transition-colors">
                      {task.title}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Create Event Dialog */}
      {showCreateDialog && selectedDate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div ref={dialogRef} className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">
              创建事件 - {format(selectedDate, 'yyyy年MM月dd日')}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  事件标题
                </label>
                <input
                  type="text"
                  value={newEventTitle}
                  onChange={(e) => setNewEventTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="输入事件标题"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  事件类型
                </label>
                <select
                  value={newEventType}
                  onChange={(e) => setNewEventType(e.target.value as 'meeting' | 'deadline' | 'personal')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="meeting">会议</option>
                  <option value="deadline">截止日期</option>
                  <option value="personal">个人</option>
                </select>
              </div>
              <div>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={newEventIsPrivate}
                    onChange={(e) => setNewEventIsPrivate(e.target.checked)}
                    className="rounded"
                  />
                  <span className="text-sm text-gray-700">私密事件</span>
                </label>
              </div>
              <div className="flex justify-end space-x-2">
                <button
                  onClick={() => {
                    setShowCreateDialog(false)
                    setNewEventTitle('')
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateEvent}
                  disabled={!newEventTitle.trim()}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  创建
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
