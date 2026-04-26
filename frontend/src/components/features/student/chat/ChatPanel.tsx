import { useEffect, useRef, useState } from 'react'
import {
  SendHorizontal,
  Bot,
  AtSign,
  Smile,
  Image as ImageIcon,
  Loader2,
  X,
  RotateCw,
  ZoomIn,
  ZoomOut,
  Download,
  Reply,
  Undo2
} from 'lucide-react'
import { storageService } from '../../../../services/api/storage'
import { syncService } from '../../../../services/sync/SyncService'

import { useAuthStore } from '../../../../stores/authStore'
import { projectService } from '../../../../services/api/project'
import { userService } from '../../../../services/api/user'
import api from '../../../../services/api/client'
import { ExperimentVersion, User } from '../../../../types'
import { useChatSync } from '../../../../hooks/chat/useChatSync'
import { ChatMessage, getChatTimestampMs, normalizeChatTimestamp } from '../../../../modules/chat/ChatPersistence' // Use shared type
import { trackingService } from '../../../../services/tracking/TrackingService'
import { useContextStore } from '../../../../stores/contextStore'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface ChatPanelProps {
  projectId: string
}

const getMessageKey = (message: ChatMessage): string => message.client_message_id || message.id
const AI_TYPING_LABEL = 'AISCL智能助手'
const AI_TYPING_ALIASES = ['AISCL智能助手', '智能助手', 'AI智能助手']

export default function ChatPanel({ projectId }: ChatPanelProps) {
  const [inputValue, setInputValue] = useState('')
  const [showMentionMenu, setShowMentionMenu] = useState(false)
  const [showAIMenu, setShowAIMenu] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [members, setMembers] = useState<User[]>([])
  const [experimentVersion, setExperimentVersion] = useState<ExperimentVersion | null>(null)
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set())

  // New States for Lightbox, Context Menu, and Reply
  const [lightboxImage, setLightboxImage] = useState<{ url: string, name: string } | null>(null)
  const [lightboxZoom, setLightboxZoom] = useState(1)
  const [lightboxRotation, setLightboxRotation] = useState(0)
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, message: ChatMessage } | null>(null)
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { user } = useAuthStore()
  const currentStage = useContextStore((state) => state.currentStage)
  const experimentVersionId = useContextStore((state) => state.experimentVersionId)

  // Use new Chat Sync Hook
  const { messages, setMessages, sendMessage, connected } = useChatSync({
    projectId,
  })

  // Fetch project members for mention list
  useEffect(() => {
    const fetchMembers = async () => {
      try {
        const project = await projectService.getProject(projectId)
        const memberIds = project.members.map((m: any) => m.user_id)
        if (memberIds.length > 0) {
          const memberUsers = await userService.getUsers(memberIds)
          setMembers(memberUsers)
        }
        const version = await projectService.getExperimentVersion(projectId)
        setExperimentVersion(version)
      } catch (error) {
        console.error('Failed to fetch members:', error)
      }
    }

    if (projectId) {
      fetchMembers()
    }
  }, [projectId])

  // Removed direct socket event listeners (user_joined, user_left) for now
  // These should be handled by observing Room Store or via SyncService events in the future

  // Fetch historical messages from API
  useEffect(() => {
    let isMounted = true;
    if (!projectId) return

    const fetchMessages = async () => {
      try {
        const response = await api.get(`/chat/projects/${projectId}/messages?limit=50`)
        if (response.data && response.data.messages && isMounted) {
          // Convert API response to ChatMessage format
          const history: ChatMessage[] = response.data.messages.map((m: any) => ({
            id: m.id,
            client_message_id: m.client_message_id,
            user_id: m.user_id,
            username: m.username,
            avatar_url: m.avatar_url,
            content: m.content,
            message_type: m.message_type,
            mentions: m.mentions || [],
            timestamp: normalizeChatTimestamp(m.created_at), // Map created_at to timestamp
            ai_meta: m.ai_meta,
            teacher_support: m.teacher_support,
            teacher_help_request: m.teacher_help_request,
            file_info: m.file_info,
            isPending: false
          })).reverse() // API returns newest first

          setMessages(currentMessages => {
            // Deduplicate using Map
            const msgMap = new Map<string, ChatMessage>();

            // 1. Add history first
            history.forEach((m: ChatMessage) => msgMap.set(getMessageKey(m), m));

            // 2. Add current messages, but do not overwrite persisted history with pending optimistic copies
            currentMessages.forEach((m: ChatMessage) => {
              const key = getMessageKey(m)
              const existing = msgMap.get(key)
              if (existing && !existing.isPending && m.isPending) {
                return
              }
              msgMap.set(key, existing ? { ...existing, ...m } : m)
            })

            // 3. Convert back to array and sort by timestamp
            return Array.from(msgMap.values()).sort((a, b) =>
              getChatTimestampMs(a.timestamp) - getChatTimestampMs(b.timestamp)
            );
          })
        }
      } catch (error) {
        console.error('Failed to fetch chat history:', error)
      }
    }

    fetchMessages()

    return () => { isMounted = false; }
  }, [projectId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])



  const isSingleAIMode = experimentVersion?.ai_scaffold_mode === 'single_agent'
  const AI_AGENTS = isSingleAIMode
    ? [
      { id: 'ai-single', name: 'AI智能助手', description: '直接调用通用 AI 回复' },
    ]
    : [
      { id: 'ai-research', name: '资料研究员', description: '提供资料线索与出处支持' },
      { id: 'ai-challenge', name: '观点挑战者', description: '暴露反驳与替代解释' },
      { id: 'ai-feedback', name: '反馈追问者', description: '追问证据与修订依据' },
      { id: 'ai-progress', name: '问题推进者', description: '推进任务澄清与下一步' }
    ]

  const EMOJIS = ['😊', '😂', '🥰', '😍', '🤔', '😎', '😭', '😮', '👍', '🔥', '🙌', '✨', '🎉', '💡', '✅', '❌']
  const [expandedRouting, setExpandedRouting] = useState<Record<string, boolean>>({})

  const handleSelectAI = (agent: any) => {
    setInputValue(prev => prev.endsWith(' ') || prev === '' ? `${prev}@${agent.name} ` : `${prev} @${agent.name} `)
    setShowAIMenu(false)
    inputRef.current?.focus()
  }

  const handleEmojiSelect = (emoji: string) => {
    setInputValue(prev => prev + emoji)
    setShowEmojiPicker(false)
    inputRef.current?.focus()
  }

  const toggleRoutingSummary = (messageId: string) => {
    setExpandedRouting(prev => ({
      ...prev,
      [messageId]: !prev[messageId],
    }))
  }

  // Handle image selection
  const handleImageClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.accept = 'image/*'
      fileInputRef.current.click()
    }
  }

  // Lightbox Handlers
  const handleDownload = (url: string, name: string) => {
    const link = document.createElement('a')
    link.href = url
    link.download = name
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Context Menu Handlers
  const handleContextMenu = (e: React.MouseEvent, msg: ChatMessage) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, message: msg })
  }

  const handleReplyMessage = (msg: ChatMessage) => {
    setReplyingTo(msg)
    setContextMenu(null)
    inputRef.current?.focus()
  }

  const handleRecallMessage = async (msg: ChatMessage) => {
    if (msg.user_id !== user?.id) return
    // Optimistically update or just trigger sync
    try {
      await sendMessage(msg.id, [], undefined, undefined, true) // Pass msg.id as content for recall
      setContextMenu(null)
    } catch (err) {
      console.error('Failed to recall:', err)
      alert('撤回失败')
    }
  }

  // Close menus on click anywhere
  useEffect(() => {
    const handleClick = () => setContextMenu(null)
    window.addEventListener('click', handleClick)
    return () => window.removeEventListener('click', handleClick)
  }, [])

  // Listen for typing events
  useEffect(() => {
    const onTyping = (data: any) => {
      if (data.roomId !== `project:${projectId}`) return
      setTypingUsers(prev => {
        const next = new Set(prev)
        next.add(data.userId === 'ai_assistant' ? AI_TYPING_LABEL : (data.username || 'Someone'))
        return next
      })
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    const onStopTyping = (data: any) => {
      if (data.roomId !== `project:${projectId}`) return
      setTypingUsers(prev => {
        const next = new Set(prev)
        if (data.userId === 'ai_assistant') {
          AI_TYPING_ALIASES.forEach(label => next.delete(label))
          if (data.username) next.delete(data.username)
        } else {
          const user = members.find(m => m.id === data.userId)
          if (user) next.delete(user.username)
          if (data.username) next.delete(data.username)
        }
        return next
      })
    }

    syncService.on('typing', onTyping)
    syncService.on('stop_typing', onStopTyping)

    return () => {
      syncService.off('typing', onTyping)
      syncService.off('stop_typing', onStopTyping)
    }
  }, [projectId, members])


  const handleImageUpload = async (fileInput: React.ChangeEvent<HTMLInputElement> | File) => {
    const file = fileInput instanceof File ? fileInput : fileInput.target.files?.[0]
    if (!file || !projectId) return
    if (!file.type.startsWith('image/')) {
      alert('请选择图片文件')
      return
    }

    setIsUploading(true)
    try {
      const { upload_url, file_key } = await storageService.getPresignedUploadUrl(
        projectId,
        file.name,
        file.type,
        file.size
      )

      await storageService.uploadFile(upload_url, file)

      const resource = await storageService.createResource({
        file_key,
        filename: file.name,
        size: file.size,
        project_id: projectId,
        mime_type: file.type,
        source_type: 'chat_attachment',
      })
      const imageUrl = storageService.getResourceViewUrl(resource.id)

      await sendMessage('', [], {
        name: file.name,
        size: file.size,
        url: imageUrl,
        mimeType: file.type,
        resourceId: resource.id,
      })

      trackingService.track({
        module: 'chat',
        action: 'chat_message_send',
        metadata: {
          projectId,
          type: 'image',
          size: file.size,
          resourceId: resource.id,
        }
      })

      trackingService.trackResearchEvent({
        project_id: projectId,
        experiment_version_id: experimentVersionId || undefined,
        actor_type: 'student',
        event_domain: 'dialogue',
        event_type: 'peer_image_send',
        stage_id: currentStage || undefined,
        payload: {
          mime_type: file.type,
          file_size: file.size,
          resource_id: resource.id,
          has_reply_context: !!replyingTo,
        }
      })

    } catch (error) {
      console.error('Image upload failed:', error)
      alert('图片发送失败')
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile()
        if (file) {
          handleImageUpload(file)
        }
      }
    }
  }

  // Handle member selection from mention list
  const handleSelectMention = (member: User) => {
    const cursorPos = inputRef.current?.selectionStart || inputValue.length
    const before = inputValue.substring(0, cursorPos)
    const after = inputValue.substring(cursorPos)

    // Add space before @ if needed
    const prefix = before === '' || before.endsWith(' ') ? '' : ' '
    const newMention = `${prefix}@${member.username} `

    setInputValue(before + newMention + after)
    setShowMentionMenu(false)

    // Set focus back and move cursor
    setTimeout(() => {
      inputRef.current?.focus()
      const newPos = cursorPos + newMention.length
      inputRef.current?.setSelectionRange(newPos, newPos)
    }, 0)
  }



  const handleSend = () => {
    if (!inputValue.trim() && !replyingTo) return
    if (!connected) return

    // Extract mentions...
    const mentionRegex = /@(\w+)/g
    const mentionedUsernames: string[] = []
    let match
    while ((match = mentionRegex.exec(inputValue)) !== null) {
      mentionedUsernames.push(match[1])
    }

    const mentions: string[] = []
    mentionedUsernames.forEach(username => {
      const member = members.find(m => m.username === username)
      if (member) mentions.push(member.id)
    })

    sendMessage(inputValue, mentions, undefined, replyingTo?.id)

    trackingService.track({
      module: 'chat',
      action: 'chat_message_send',
      metadata: {
        projectId,
        type: 'text',
        length: inputValue.length,
        hasMentions: mentions.length > 0,
        isReply: !!replyingTo
      }
    })

    setInputValue('')
    setReplyingTo(null)
    setShowMentionMenu(false)
    setShowAIMenu(false)
    setShowEmojiPicker(false)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    } else if (e.key === 'Escape') {
      setShowMentionMenu(false)
      setShowAIMenu(false)
      setShowEmojiPicker(false)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setInputValue(value)
  }

  // Members excluding current user for mentions
  const otherMembers = members.filter(m => m.id !== user?.id)

  return (
    <div className="flex flex-col h-full relative overflow-hidden bg-gray-50/50">
      <style>{`
        @keyframes msgSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .message-animate {
          animation: msgSlideUp 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
        }
      `}</style>

      {/* Lightbox Overlay */}
      {lightboxImage && (
        <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in duration-200">
          {/* Controls */}
          <div className="absolute top-0 inset-x-0 p-6 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent">
            <span className="text-white font-medium text-sm truncate max-w-sm">{lightboxImage.name}</span>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setLightboxZoom(prev => Math.min(prev + 0.5, 4))}
                className="p-2 text-white/70 hover:text-white transition-colors"
                title="Zoom In"
              >
                <ZoomIn className="w-5 h-5" />
              </button>
              <button
                onClick={() => setLightboxZoom(prev => Math.max(prev - 0.5, 0.5))}
                className="p-2 text-white/70 hover:text-white transition-colors"
                title="Zoom Out"
              >
                <ZoomOut className="w-5 h-5" />
              </button>
              <button
                onClick={() => setLightboxRotation(prev => prev + 90)}
                className="p-2 text-white/70 hover:text-white transition-colors"
                title="Rotate"
              >
                <RotateCw className="w-5 h-5" />
              </button>
              <button
                onClick={() => handleDownload(lightboxImage.url, lightboxImage.name)}
                className="p-2 text-white/70 hover:text-white transition-colors"
                title="Download"
              >
                <Download className="w-5 h-5" />
              </button>
              <button
                onClick={() => setLightboxImage(null)}
                className="p-2 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all"
                title="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="flex-1 w-full flex items-center justify-center p-12 overflow-hidden">
            <img
              src={lightboxImage.url}
              className="max-w-full max-h-full transition-transform duration-300 shadow-2xl"
              style={{ transform: `scale(${lightboxZoom}) rotate(${lightboxRotation}deg)` }}
              alt="Preview"
            />
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-[110] w-48 bg-white border border-gray-100 rounded-xl shadow-[0_10px_40px_-10px_rgba(0,0,0,0.1)] py-2 animate-in zoom-in-95 duration-100"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleReplyMessage(contextMenu.message)}
            className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-indigo-50 flex items-center gap-3 transition-colors"
          >
            <Reply className="w-4 h-4 text-indigo-500" />
            <span>引用回复</span>
          </button>
          {contextMenu.message.user_id === user?.id && (
            <button
              onClick={() => handleRecallMessage(contextMenu.message)}
              className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-3 transition-colors"
            >
              <Undo2 className="w-4 h-4" />
              <span>撤回消息</span>
            </button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.map((msg: ChatMessage, index: number) => {
          const isMentioned = msg.mentions.includes(user?.id || '')
          const prevMsg = index > 0 ? messages[index - 1] : null

          // Grouping logic: hide name/time if same user and within 5 mins
          const isSameUser = prevMsg && prevMsg.user_id === msg.user_id
          const isRecent = prevMsg && (getChatTimestampMs(msg.timestamp) - getChatTimestampMs(prevMsg.timestamp) < 300000)
          const shouldShowHeader = !isSameUser || !isRecent || msg.message_type === 'system'

          return (
            <div
              key={getMessageKey(msg)}
              id={`message-${msg.id}`}
              data-chat-message-key={getMessageKey(msg)}
              data-chat-sender-id={msg.user_id}
              data-chat-message-type={msg.message_type}
              className={`flex ${msg.user_id === user?.id ? 'justify-end' : 'justify-start'} ${shouldShowHeader ? 'mt-4' : 'mt-1'} message-animate`}
              onContextMenu={(e) => handleContextMenu(e, msg)}
            >
              <div
                className={`max-w-[92%] lg:max-w-[84%] px-3 py-2 rounded-xl transition-all ${msg.user_id === user?.id
                  ? 'bg-indigo-600 text-white rounded-tr-none shadow-indigo-100 shadow-md'
                  : msg.message_type === 'system'
                    ? 'bg-gray-100 text-gray-600 text-center mx-auto text-xs py-1 px-4 rounded-full'
                    : 'bg-white border border-gray-200 text-gray-900 rounded-tl-none shadow-sm'
                  } ${isMentioned ? 'ring-2 ring-yellow-400' : ''}`}
              >
                {msg.is_recalled ? (
                  <div className="text-[11px] italic opacity-60 flex items-center gap-1.5 py-0.5">
                    <Undo2 className="w-3 h-3" />
                    <span>消息已撤回</span>
                  </div>
                ) : (
                  <>
                    {/* Reply Context */}
                    {msg.reply_to && (
                      <div className={`mb-2 p-2 rounded-lg text-xs border-l-2 bg-black/5 flex flex-col gap-0.5 max-w-full overflow-hidden ${msg.user_id === user?.id ? 'border-white/30 text-white/70' : 'border-indigo-400 text-gray-500'
                        }`}>
                        <div className="font-semibold">{messages.find(m => m.id === msg.reply_to)?.username || '已删除消息'}</div>
                        <div className="truncate">{messages.find(m => m.id === msg.reply_to)?.content || (messages.find(m => m.id === msg.reply_to)?.message_type === 'file' ? '[图片]' : '消息不可读')}</div>
                      </div>
                    )}

                    {msg.message_type !== 'system' && shouldShowHeader && (
                      <div className="flex items-center justify-between gap-3 mb-1 opacity-70">
                        <span className="text-xs font-semibold truncate max-w-[120px]">
                          {msg.user_id === user?.id ? user.username : msg.username}
                        </span>
                        <span className="text-[10px] whitespace-nowrap">
                          {new Date(normalizeChatTimestamp(msg.timestamp)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    )}

                    {msg.ai_meta && (
                      <div className="mb-2 rounded-lg border border-indigo-100 bg-indigo-50/80 px-3 py-2 text-xs text-indigo-800">
                        <div className="font-semibold">{msg.ai_meta.primary_agent || 'AISCL智能助手'}</div>
                        {msg.ai_meta.rationale_summary && (
                          <div className="mt-1 text-[11px] leading-5 text-indigo-700">
                            {msg.ai_meta.rationale_summary}
                          </div>
                        )}
                        {msg.ai_meta.routing_summary && msg.ai_meta.routing_summary.length > 0 && (
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={() => toggleRoutingSummary(msg.id)}
                              className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700"
                            >
                              {expandedRouting[msg.id] ? '收起本轮编排摘要' : '查看本轮编排摘要'}
                            </button>
                            {expandedRouting[msg.id] && (
                              <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-indigo-700">
                                {msg.ai_meta.routing_summary.map((item, idx) => (
                                  <li key={`${msg.id}-routing-${idx}`}>{item}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {msg.teacher_support && (
                      <div className="mb-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                        <div className="font-semibold">教师支持</div>
                        <div className="mt-1 text-[11px] text-emerald-700">
                          {msg.teacher_support.support_type || '同伴式支持'} · 已发送到小组
                        </div>
                      </div>
                    )}

                    {msg.message_type !== 'file' && msg.content && (
                      <div className={`text-sm ${msg.user_id === 'ai_assistant' ? 'overflow-x-auto prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-li:my-0.5 text-gray-800 break-words' : ''}`}>
                        {msg.user_id === 'ai_assistant' ? (
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              code({ node, className, children, ...props }) {
                                return (
                                  <code className={`${className} bg-gray-100 rounded px-1 py-0.5 text-xs text-red-500 font-mono`} {...props}>
                                    {children}
                                  </code>
                                )
                              },
                              pre({ node, children, ...props }) {
                                return (
                                  <pre className="bg-gray-100/50 p-2 rounded-lg overflow-x-auto text-xs my-2 border border-gray-100" {...props}>
                                    {children}
                                  </pre>
                                )
                              }
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        ) : (
                          msg.content.split(/(@\w+)/g).map((part: string, index: number) => {
                            if (part.startsWith('@')) {
                              return (
                                <span
                                  key={index}
                                  className="font-semibold"
                                  style={{
                                    color: msg.user_id === user?.id ? '#E0E7FF' : '#4F46E5'
                                  }}
                                >
                                  {part}
                                </span>
                              )
                            }
                            return <span key={index}>{part}</span>
                          })
                        )}
                      </div>
                    )}

                    {/* Image Rendering */}
                    {msg.message_type === 'file' && msg.file_info && (
                      <div className="mt-1">
                        <img
                          src={msg.file_info.url}
                          alt={msg.file_info.name}
                          className="max-w-full rounded-lg border border-gray-100 shadow-sm cursor-zoom-in hover:brightness-95 transition-all"
                          onLoad={() => {
                            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
                          }}
                          onClick={() => {
                            setLightboxImage({ url: msg.file_info!.url, name: msg.file_info!.name })
                            setLightboxZoom(1)
                            setLightboxRotation(0)
                          }}
                        />
                      </div>
                    )}
                  </>
                )}

                {msg.isPending && (
                  <div className="text-[10px] mt-1 opacity-50 flex justify-end">
                    发送中...
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {/* Typing Indicator */}
        {typingUsers.size > 0 && (
          <div
            data-chat-typing-indicator="true"
            className="flex items-center gap-2 mt-2 ml-2 animate-in fade-in slide-in-from-bottom-2"
          >
            <div className="bg-gray-100 rounded-full px-4 py-2 flex items-center gap-2 shadow-sm border border-gray-200">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></span>
              </div>
              <span className="text-xs text-gray-500 font-medium ml-1">
                {Array.from(typingUsers).join(', ')} 正在思考...
              </span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="p-4 border-t border-gray-100 bg-white relative">
        {/* Emoji Picker */}
        {showEmojiPicker && (
          <div className="absolute bottom-[calc(100%-8px)] left-4 w-64 bg-white border border-gray-200 rounded-xl shadow-xl z-20 p-3 animate-in fade-in slide-in-from-bottom-2">
            <div className="grid grid-cols-4 gap-2">
              {EMOJIS.map(emoji => (
                <button
                  key={emoji}
                  onClick={() => handleEmojiSelect(emoji)}
                  className="text-2xl p-2 hover:bg-gray-100 rounded-lg transition-colors text-center"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* AI Agents Menu */}
        {showAIMenu && (
          <div className="absolute bottom-[calc(100%-8px)] left-16 w-60 bg-white border border-gray-200 rounded-xl shadow-xl z-20 overflow-hidden animate-in fade-in slide-in-from-bottom-2">
            <div className="px-4 py-2 border-b border-gray-100 bg-gray-50/50 text-xs font-semibold text-gray-500">
              {isSingleAIMode ? '选择 AI 助手' : '选择智能体助手'}
            </div>
            {AI_AGENTS.map((agent) => (
              <button
                key={agent.id}
                onClick={() => handleSelectAI(agent)}
                className="w-full px-4 py-3 text-left hover:bg-indigo-50 flex items-center gap-3 transition-colors border-b border-gray-50 last:border-0"
              >
                <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600">
                  <Bot className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-900">{agent.name}</div>
                  <div className="text-[11px] text-gray-500">{agent.description}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Member Mentions Menu */}
        {showMentionMenu && (
          <div className="absolute bottom-[calc(100%-8px)] left-28 w-60 bg-white border border-gray-200 rounded-xl shadow-xl z-20 overflow-hidden animate-in fade-in slide-in-from-bottom-2">
            <div className="px-4 py-2 border-b border-gray-100 bg-gray-50/50 text-xs font-semibold text-gray-500">提及小组成员</div>
            {otherMembers.length > 0 ? (
              otherMembers.map((member) => (
                <button
                  key={member.id}
                  onClick={() => handleSelectMention(member)}
                  className="w-full px-4 py-3 text-left hover:bg-blue-50 flex items-center gap-3 transition-colors border-b border-gray-50 last:border-0"
                >
                  {member.avatar_url ? (
                    <img src={member.avatar_url} className="w-8 h-8 rounded-full border border-gray-100" alt={member.username} />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xs font-bold">
                      {member.username[0]?.toUpperCase()}
                    </div>
                  )}
                  <div className="text-sm font-medium text-gray-900">{member.username}</div>
                </button>
              ))
            ) : (
              <div className="px-4 py-6 text-center text-sm text-gray-500">暂无其他成员</div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3">
          {/* Reply Preview */}
          {replyingTo && (
            <div className="flex items-center justify-between p-3 bg-indigo-50 border border-indigo-100 rounded-xl mb-2 animate-in slide-in-from-bottom-2">
              <div className="flex items-center gap-3 overflow-hidden">
                <Reply className="w-4 h-4 text-indigo-500 shrink-0" />
                <div className="flex flex-col text-xs overflow-hidden">
                  <span className="font-bold text-indigo-600">{replyingTo.username}</span>
                  <span className="text-gray-500 truncate">{replyingTo.content || '[图片]'}</span>
                </div>
              </div>
              <button
                onClick={() => setReplyingTo(null)}
                className="p-1 hover:bg-indigo-100 rounded-full text-indigo-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Top Row: Input and Send Button */}
          <div className="flex items-center gap-2">
            <div className="flex-1 relative">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyPress}
                onPaste={handlePaste}
                placeholder="Type a message... (@mention to tag someone)"
                className="w-full px-4 py-3 bg-[#f3f4f6] border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all text-sm"
                disabled={!connected}
              />
            </div>
            <button
              onClick={handleSend}
              disabled={!connected || !inputValue.trim()}
              className="p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:bg-gray-300 transition-all shadow-sm"
            >
              <SendHorizontal className="w-5 h-5" />
            </button>
          </div>

          {/* Bottom Row: Actions */}
          <div className="flex items-center gap-2">
            <button
              className={`p-2 rounded-xl transition-all shadow-sm flex items-center justify-center ${showEmojiPicker ? 'bg-yellow-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              onClick={() => {
                setShowEmojiPicker(!showEmojiPicker)
                setShowAIMenu(false)
                setShowMentionMenu(false)
              }}
              title="Emoji"
            >
              <Smile className="w-5 h-5" />
            </button>
            <button
              className={`p-2 rounded-xl transition-all shadow-sm flex items-center justify-center ${showAIMenu ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              onClick={() => {
                setShowAIMenu(!showAIMenu)
                setShowMentionMenu(false)
                setShowEmojiPicker(false)
              }}
              title="Call AI"
            >
              <Bot className="w-5 h-5" />
            </button>
            <button
              className={`p-2 rounded-xl transition-all shadow-sm flex items-center justify-center ${showMentionMenu ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              onClick={() => {
                setShowMentionMenu(!showMentionMenu)
                setShowAIMenu(false)
                setShowEmojiPicker(false)
              }}
              title="Mention"
            >
              <AtSign className="w-5 h-5" />
            </button>

            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) handleImageUpload(file)
              }}
            />

            <button
              disabled={isUploading}
              className={`p-2 rounded-xl transition-all shadow-sm flex items-center justify-center ${isUploading ? 'bg-gray-100 text-gray-400' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}
              onClick={handleImageClick}
              title="Send Image"
            >
              {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ImageIcon className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
