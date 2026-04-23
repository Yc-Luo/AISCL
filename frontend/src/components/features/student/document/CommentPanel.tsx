import { useEffect, useState } from 'react'
import { Editor } from '@tiptap/react'
import { commentService, Comment } from '../../../../services/api/comment'
import { useAuthStore } from '../../../../stores/authStore'

interface CommentPanelProps {
  documentId: string
  editor: Editor
}

export default function CommentPanel({
  documentId,
  editor,
}: CommentPanelProps) {
  const { user } = useAuthStore()
  const [comments, setComments] = useState<Comment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [newComment, setNewComment] = useState('')
  const [selectedText, setSelectedText] = useState<{
    from: number
    to: number
    text: string
  } | null>(null)

  useEffect(() => {
    loadComments()
  }, [documentId])

  // Listen to text selection
  useEffect(() => {
    const handleSelection = () => {
      const { from, to } = editor.state.selection
      const text = editor.state.doc.textBetween(from, to)
      if (text) {
        setSelectedText({ from, to, text })
      } else {
        setSelectedText(null)
      }
    }

    editor.on('selectionUpdate', handleSelection)
    return () => {
      editor.off('selectionUpdate', handleSelection)
    }
  }, [editor])

  const loadComments = async () => {
    try {
      const response = await commentService.getComments(documentId)
      setComments(response.comments)
    } catch (error) {
      console.error('Failed to load comments:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateComment = async () => {
    if (!newComment.trim() || !selectedText) return

    try {
      await commentService.createComment(
        documentId,
        newComment,
        {
          from: selectedText.from,
          to: selectedText.to,
        }
      )
      setNewComment('')
      setSelectedText(null)
      loadComments()
    } catch (error) {
      console.error('Failed to create comment:', error)
    }
  }

  const handleResolveComment = async (commentId: string) => {
    try {
      await commentService.updateComment(commentId, undefined, 'resolved')
      loadComments()
    } catch (error) {
      console.error('Failed to resolve comment:', error)
    }
  }

  const handleDeleteComment = async (commentId: string) => {
    try {
      await commentService.deleteComment(commentId)
      loadComments()
    } catch (error) {
      console.error('Failed to delete comment:', error)
    }
  }

  const handleJumpToComment = (comment: Comment) => {
    if (comment.position) {
      editor.commands.setTextSelection({
        from: comment.position.from,
        to: comment.position.to,
      })
      editor.commands.scrollIntoView()
    }
  }

  if (isLoading) {
    return (
      <div className="w-80 border-l bg-gray-50 p-4">
        <div className="text-gray-500">Loading comments...</div>
      </div>
    )
  }

  return (
    <div className="w-80 border-l bg-gray-50 flex flex-col">
      <div className="p-4 border-b bg-white">
        <h3 className="font-semibold text-lg">Comments</h3>
      </div>

      {/* Selected Text Preview */}
      {selectedText && (
        <div className="p-4 border-b bg-blue-50">
          <div className="text-xs text-gray-600 mb-2">Selected text:</div>
          <div className="text-sm bg-white p-2 rounded border">
            "{selectedText.text}"
          </div>
        </div>
      )}

      {/* New Comment Form */}
      {selectedText && (
        <div className="p-4 border-b bg-white">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add a comment..."
            className="w-full p-2 border rounded text-sm resize-none"
            rows={3}
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={handleCreateComment}
              className="px-3 py-1 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Add Comment
            </button>
            <button
              onClick={() => {
                setNewComment('')
                setSelectedText(null)
              }}
              className="px-3 py-1 text-sm bg-gray-200 rounded hover:bg-gray-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Comments List */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {comments.length === 0 ? (
          <div className="text-gray-500 text-sm text-center py-8">
            No comments yet. Select text to add a comment.
          </div>
        ) : (
          comments.map((comment) => (
            <div
              key={comment.id}
              className="bg-white p-3 rounded border shadow-sm"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="text-sm font-medium">
                  {comment.created_by === user?.id ? 'You' : 'User'}
                </div>
                <div className="flex gap-2">
                  {comment.status === 'open' && (
                    <button
                      onClick={() => handleResolveComment(comment.id)}
                      className="text-xs text-green-600 hover:text-green-700"
                    >
                      Resolve
                    </button>
                  )}
                  {comment.created_by === user?.id && (
                    <button
                      onClick={() => handleDeleteComment(comment.id)}
                      className="text-xs text-red-600 hover:text-red-700"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <div className="text-sm text-gray-700 mb-2">{comment.content}</div>
              {comment.position && (
                <button
                  onClick={() => handleJumpToComment(comment)}
                  className="text-xs text-blue-600 hover:text-blue-700"
                >
                  Jump to text
                </button>
              )}
              <div className="text-xs text-gray-500 mt-2">
                {new Date(comment.created_at).toLocaleString()}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

