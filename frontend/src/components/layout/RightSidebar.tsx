import type React from 'react'
import { useState } from 'react'
import NotificationCenter from '../feedback/NotificationCenter'
import ChatPanel from '../features/student/chat/ChatPanel'
import TeacherSupportPanel from '../features/student/support/TeacherSupportPanel'
import { User } from '../../types'
import { Toast } from '../ui/Toast'
import { Bell, LifeBuoy, MessageSquare, Settings } from 'lucide-react'

export type RightPanel = 'chat' | 'teacher-support'

export interface RightSidebarBadges {
  chatUnread: number
  chatMentions: number
  teacherSupport: boolean
}

interface RightSidebarProps {
  projectId?: string
  expanded: boolean
  activePanel: RightPanel
  badges: RightSidebarBadges
  currentUser?: User | null
  onActivePanelChange: (panel: RightPanel) => void
  onOpenSettings: () => void
  onToggleExpanded: (expanded: boolean) => void
  onBadgesChange: (badges: Partial<RightSidebarBadges>) => void
}

export default function RightSidebar({
  projectId,
  expanded,
  activePanel,
  badges,
  currentUser,
  onActivePanelChange,
  onOpenSettings,
  onToggleExpanded,
  onBadgesChange,
}: RightSidebarProps) {
  const [notice, setNotice] = useState<string | null>(null)
  const openPanel = (panel: RightPanel) => {
    onActivePanelChange(panel)
    onToggleExpanded(true)
    if (panel === 'chat') {
      onBadgesChange({ chatUnread: 0, chatMentions: 0 })
    }
    if (panel === 'teacher-support') {
      onBadgesChange({ teacherSupport: false })
    }
  }

  if (!expanded) {
    return (
      <div className="relative flex h-full w-12 flex-col items-center gap-3 border-l border-slate-200 bg-white py-3">
        <IconButton label="通知中心" onClick={() => onToggleExpanded(true)}>
          <Bell className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="群组聊天"
          badge={badges.chatMentions || badges.chatUnread}
          onClick={() => openPanel('chat')}
        >
          <MessageSquare className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="教师支持"
          dot={badges.teacherSupport}
          onClick={() => openPanel('teacher-support')}
        >
          <LifeBuoy className="h-4 w-4" />
        </IconButton>
        <IconButton label="个人设置" onClick={onOpenSettings}>
          <Settings className="h-4 w-4" />
        </IconButton>
        <div className="hidden">
          {projectId && (
            <>
              <ChatPanel
                projectId={projectId}
                isActive={false}
                onUnreadChange={(next) => onBadgesChange(next)}
                onMentionNotification={setNotice}
              />
              <TeacherSupportPanel
                projectId={projectId}
                isActive={false}
                onUnreadChange={(hasUnread) => onBadgesChange({ teacherSupport: hasUnread })}
              />
            </>
          )}
        </div>
        {notice && (
          <Toast message={notice} type="success" onClose={() => setNotice(null)} />
        )}
      </div>
    )
  }

  return (
    <div className="w-full bg-white border-l border-gray-200 h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-3 py-2.5">
        <div className="flex items-center gap-2">
          <NotificationCenter />
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex h-8 min-w-0 items-center gap-2 rounded-xl px-2 text-sm font-semibold text-slate-700 transition hover:bg-indigo-50"
            title={currentUser?.username || '个人设置'}
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 text-xs font-bold text-white">
              {currentUser?.avatar_url ? (
                <img src={currentUser.avatar_url} alt="User" className="h-full w-full object-cover" />
              ) : (
                (currentUser?.username || 'U')[0].toUpperCase()
              )}
            </span>
            <span className="max-w-[9rem] truncate">{currentUser?.username || '个人设置'}</span>
          </button>
        </div>
        <button
          type="button"
          onClick={() => onToggleExpanded(false)}
          className="rounded-xl px-2 py-1 text-xs font-semibold text-slate-400 transition hover:bg-slate-50 hover:text-indigo-600"
          title="折叠侧栏"
        >
          收起
        </button>
      </div>
      <div className="border-b border-gray-200 flex">
        <button
          onClick={() => openPanel('chat')}
          className={`flex-1 py-3 text-sm font-medium transition-colors relative ${activePanel === 'chat'
            ? 'text-indigo-600'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
        >
          群组聊天
          {(badges.chatUnread > 0 || badges.chatMentions > 0) && (
            <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
              {badges.chatMentions || badges.chatUnread}
            </span>
          )}
          {activePanel === 'chat' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
          )}
        </button>
        <button
          onClick={() => openPanel('teacher-support')}
          className={`flex-1 py-3 text-sm font-medium transition-colors relative ${activePanel === 'teacher-support'
            ? 'text-indigo-600'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
        >
          教师支持
          {badges.teacherSupport && (
            <span className="ml-1 inline-flex h-2 w-2 rounded-full bg-amber-500" />
          )}
          {activePanel === 'teacher-support' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
          )}
        </button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        {projectId && (
          <>
            <div className={`absolute inset-0 ${activePanel === 'chat' ? 'block' : 'hidden'}`}>
              <ChatPanel
                projectId={projectId}
                isActive={activePanel === 'chat'}
                onUnreadChange={(next) => onBadgesChange(next)}
                onMentionNotification={setNotice}
              />
            </div>
            <div className={`absolute inset-0 ${activePanel === 'teacher-support' ? 'block' : 'hidden'}`}>
              <TeacherSupportPanel
                projectId={projectId}
                isActive={activePanel === 'teacher-support'}
                onUnreadChange={(hasUnread) => onBadgesChange({ teacherSupport: hasUnread })}
              />
            </div>
          </>
        )}
      </div>
      {notice && (
        <Toast message={notice} type="success" onClose={() => setNotice(null)} />
      )}
    </div>
  )
}

function IconButton({
  children,
  label,
  badge,
  dot,
  onClick,
}: {
  children: React.ReactNode
  label: string
  badge?: number
  dot?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className="relative rounded-xl p-2 text-slate-500 transition hover:bg-indigo-50 hover:text-indigo-600"
    >
      {children}
      {badge ? (
        <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-black leading-none text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : dot ? (
        <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-white" />
      ) : null}
    </button>
  )
}
