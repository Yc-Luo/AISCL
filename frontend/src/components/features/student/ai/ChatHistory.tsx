import { useState } from 'react'

interface ChatSession {
    id: string
    title: string
    date: string
    preview: string
}

export default function ChatHistory() {
    const [sessions] = useState<ChatSession[]>([
        {
            id: '1',
            title: 'Database Schema Design',
            date: '2025-12-24',
            preview: 'Looking at the relationship between users and...'
        },
        {
            id: '2',
            title: 'React Performance',
            date: '2025-12-23',
            preview: 'How to optimize re-renders in...'
        },
        {
            id: '3',
            title: 'API Authentication',
            date: '2025-12-22',
            preview: 'Implementing JWT refresh token flow...'
        }
    ])

    return (
        <div className="h-full bg-gray-50 border-r border-gray-200 flex flex-col w-64">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between bg-white">
                <h3 className="font-semibold text-gray-700">历史对话</h3>
                <button className="text-gray-400 hover:text-indigo-600">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                </button>
            </div>
            <div className="overflow-y-auto flex-1 p-2 space-y-2">
                {sessions.map((session) => (
                    <div
                        key={session.id}
                        className="group p-3 hover:bg-white rounded-lg cursor-pointer transition-all border border-transparent hover:border-gray-200 hover:shadow-sm"
                    >
                        <div className="flex justify-between items-start mb-1">
                            <span className="text-sm font-medium text-gray-800 truncate flex-1">{session.title}</span>
                            <span className="text-[10px] text-gray-400 mt-0.5 ml-2">{session.date}</span>
                        </div>
                        <p className="text-xs text-gray-500 line-clamp-2">{session.preview}</p>
                    </div>
                ))}
            </div>
        </div>
    )
}
