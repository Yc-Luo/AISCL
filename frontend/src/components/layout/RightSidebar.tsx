import { useState } from 'react'
import ChatPanel from '../features/student/chat/ChatPanel'
import MemberList from '../features/student/chat/MemberList'

interface RightSidebarProps {
  projectId?: string
}

export default function RightSidebar({ projectId }: RightSidebarProps) {
  const [activeTab, setActiveTab] = useState<'members' | 'chat'>('chat')

  return (
    <div className="w-full bg-white border-l border-gray-200 h-full flex flex-col">
      <div className="border-b border-gray-200 flex">
        <button
          onClick={() => setActiveTab('members')}
          className={`flex-1 py-3 text-sm font-medium transition-colors relative ${activeTab === 'members'
            ? 'text-indigo-600'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
        >
          成员列表
          {activeTab === 'members' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
          )}
        </button>
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex-1 py-3 text-sm font-medium transition-colors relative ${activeTab === 'chat'
            ? 'text-indigo-600'
            : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
        >
          群组聊天
          {activeTab === 'chat' && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
          )}
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        {activeTab === 'members' && projectId && (
          <MemberList projectId={projectId} />
        )}
        {activeTab === 'chat' && projectId && (
          <ChatPanel projectId={projectId} />
        )}
      </div>
    </div>
  )
}

