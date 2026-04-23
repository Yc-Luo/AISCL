import { Editor } from '@tiptap/react'
import { MessageSquare } from 'lucide-react'

interface AnnotationButtonProps {
    editor: Editor
    onClick: () => void
}

export default function AnnotationButton({ editor, onClick }: AnnotationButtonProps) {
    const hasSelection = () => {
        const { from, to } = editor.state.selection
        return from !== to
    }

    const isActive = editor.isActive('annotation')

    return (
        <button
            onClick={onClick}
            disabled={!hasSelection()}
            title="添加批注 (⌘+Shift+M)"
            className={`
        p-2 rounded transition-colors flex items-center justify-center
        ${isActive ? 'bg-yellow-100 text-yellow-700' : 'hover:bg-gray-100 text-gray-700'}
        ${!hasSelection() ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
        >
            <MessageSquare className="w-4 h-4" />
        </button>
    )
}
