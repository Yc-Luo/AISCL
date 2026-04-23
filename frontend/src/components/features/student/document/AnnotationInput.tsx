import { useState, useCallback, useEffect, useRef } from 'react'
import { MessageSquare } from 'lucide-react'

interface AnnotationInputProps {
    onSubmit: (content: string) => void
    onCancel: () => void
    position?: { top: number; left: number }
    initialContent?: string
}

export default function AnnotationInput({
    onSubmit,
    onCancel,
    position,
    initialContent = '',
}: AnnotationInputProps) {
    const [content, setContent] = useState(initialContent)
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const popupRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        // Auto-focus textarea when component mounts
        textareaRef.current?.focus()
    }, [])

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
                onCancel()
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [onCancel])

    const handleSubmit = useCallback(() => {
        if (content.trim()) {
            onSubmit(content.trim())
            setContent('')
        }
    }, [content, onSubmit])

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleSubmit()
            } else if (e.key === 'Escape') {
                e.preventDefault()
                onCancel()
            }
        },
        [handleSubmit, onCancel]
    )

    return (
        <div
            ref={popupRef}
            className="annotation-popup"
            style={
                position
                    ? {
                        position: 'fixed',
                        top: `${position.top}px`,
                        left: `${position.left}px`,
                    }
                    : undefined
            }
        >
            <div className="flex items-center gap-2 mb-2">
                <MessageSquare className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">添加批注</span>
            </div>

            <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入批注内容..."
                className="w-full p-2 border border-gray-300 rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={3}
            />

            <div className="flex items-center justify-end mt-2">
                <div className="flex gap-2">
                    <button
                        onClick={onCancel}
                        className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={!content.trim()}
                        className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        添加批注
                    </button>
                </div>
            </div>
        </div>
    )
}
