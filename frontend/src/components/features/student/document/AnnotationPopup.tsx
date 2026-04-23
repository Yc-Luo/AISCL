import { useState, useCallback, useEffect, useRef } from 'react'
import { Check, Edit2, Trash2 } from 'lucide-react'
import { AnnotationAttributes } from '../../../../extensions/Annotation'
import { trackingService } from '../../../../services/tracking/TrackingService'

interface AnnotationPopupProps {
    annotation: AnnotationAttributes
    onResolve: () => void
    onEdit: (content: string) => void
    onDelete: () => void
    onClose: () => void
    onAddReply: (content: string) => void
    position?: { top: number; left: number }
}

export default function AnnotationPopup({
    annotation,
    onResolve,
    onEdit,
    onDelete,
    onClose,
    onAddReply,
    position,
}: AnnotationPopupProps) {
    const [isEditing, setIsEditing] = useState(false)
    const [editContent, setEditContent] = useState(annotation.content)
    const [replyContent, setReplyContent] = useState('')
    const popupRef = useRef<HTMLDivElement>(null)

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
                onClose()
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [onClose])

    const handleSaveEdit = useCallback(() => {
        if (editContent.trim()) {
            onEdit(editContent.trim())
            setIsEditing(false)
        }
    }, [editContent, onEdit])

    const handleCancelEdit = useCallback(() => {
        setEditContent(annotation.content)
        setIsEditing(false)
    }, [annotation.content])

    const handleSubmitReply = useCallback(() => {
        if (replyContent.trim()) {
            onAddReply(replyContent.trim())
            trackingService.track({
                module: 'document',
                action: 'document_annotation_reply',
                metadata: { annotationId: annotation.id, length: replyContent.length }
            })
            setReplyContent('')
        }
    }, [replyContent, onAddReply, annotation.id])

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
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-semibold text-indigo-600">
                        {annotation.author.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div className="text-sm font-medium text-gray-900">{annotation.author}</div>
                        <div className="text-xs text-gray-500">
                            {new Date(annotation.timestamp).toLocaleString()}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-1">
                    {!annotation.resolved && (
                        <button
                            onClick={onResolve}
                            className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                            title="标记为已解决"
                        >
                            <Check className="w-4 h-4 text-green-400" />
                        </button>
                    )}
                    <button
                        onClick={() => setIsEditing(!isEditing)}
                        className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                        title="编辑批注"
                    >
                        <Edit2 className="w-4 h-4 text-gray-400" />
                    </button>
                    <button
                        onClick={onDelete}
                        className="p-1.5 hover:bg-gray-100 rounded transition-colors"
                        title="删除批注"
                    >
                        <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                </div>
            </div>

            {/* Content */}
            {isEditing ? (
                <div>
                    <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                        rows={3}
                        autoFocus
                    />
                    <div className="flex gap-2 mt-2">
                        <button
                            onClick={handleSaveEdit}
                            className="px-3 py-1.5 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600"
                        >
                            保存
                        </button>
                        <button
                            onClick={handleCancelEdit}
                            className="px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-md"
                        >
                            取消
                        </button>
                    </div>
                </div>
            ) : (
                <div
                    className={`text-sm text-gray-700 ${annotation.resolved ? 'opacity-60 line-through' : ''
                        }`}
                >
                    {annotation.content}
                </div>
            )}

            {annotation.resolved && (
                <div className="mt-2 text-xs text-green-600 font-medium">
                    ✓ 已解决
                </div>
            )}

            {/* Replies Section */}
            {!isEditing && annotation.replies && annotation.replies.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200 space-y-3 max-h-60 overflow-y-auto">
                    {annotation.replies.map((reply: any) => (
                        <div key={reply.id} className="flex gap-2">
                            <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-600 flex-shrink-0">
                                {reply.author.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-xs font-medium text-gray-900">{reply.author}</span>
                                    <span className="text-xs text-gray-500">
                                        {new Date(reply.timestamp).toLocaleString()}
                                    </span>
                                </div>
                                <div className="text-sm text-gray-700 mt-0.5">
                                    {reply.content}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Add Reply/Thread */}
            {!isEditing && (
                <div className="mt-3 pt-3 border-t border-gray-200">
                    <textarea
                        value={replyContent}
                        onChange={(e) => setReplyContent(e.target.value)}
                        placeholder="添加评论..."
                        className="w-full p-2 border border-gray-300 rounded-md text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                        rows={2}
                    />
                    <div className="flex justify-end gap-2 mt-2">
                        <button className="p-1.5 hover:bg-gray-100 rounded transition-colors" title="提到某人">
                            @
                        </button>
                        <button
                            onClick={handleSubmitReply}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                            title="提交"
                        >
                            ✓
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
