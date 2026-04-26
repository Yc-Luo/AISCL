import { useEffect, useState } from 'react'
import { CheckCircle2, HelpCircle, Loader2, MessageSquareText, RefreshCw, SendHorizontal } from 'lucide-react'
import { chatService, TeacherHelpRequest } from '../../../../services/api/chat'
import { useContextStore } from '../../../../stores/contextStore'

interface TeacherSupportPanelProps {
  projectId: string
}

const HELP_TYPES = ['任务不清楚', '协作卡住', '需要反馈', '成果提交', '其他']

const STATUS_LABEL: Record<TeacherHelpRequest['status'], string> = {
  pending: '待教师回复',
  replied: '教师已回复',
  resolved: '已解决',
}

const SOURCE_LABEL: Record<string, string> = {
  document: '文档',
  inquiry: '深度探究',
  resources: '资源库',
  wiki: '项目 Wiki',
  ai: 'AI 导师',
  dashboard: '学习仪表盘',
  chat: '群组聊天',
}

function formatTime(value?: string) {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function TeacherSupportPanel({ projectId }: TeacherSupportPanelProps) {
  const currentStage = useContextStore((state) => state.currentStage)
  const activeTab = useContextStore((state) => state.activeTab)
  const [requests, setRequests] = useState<TeacherHelpRequest[]>([])
  const [helpType, setHelpType] = useState(HELP_TYPES[0])
  const [content, setContent] = useState('')
  const [allowPublicReply, setAllowPublicReply] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const loadRequests = async (silent = false) => {
    if (!projectId) return
    try {
      if (!silent) setLoading(true)
      const response = await chatService.getTeacherHelpRequests(projectId)
      setRequests(response.requests)
    } catch (error) {
      console.error('Failed to load teacher help requests:', error)
      setFeedback('求助记录加载失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadRequests()
    const intervalId = window.setInterval(() => {
      void loadRequests(true)
    }, 15000)
    return () => window.clearInterval(intervalId)
  }, [projectId])

  const handleSubmit = async () => {
    const trimmed = content.trim()
    if (!trimmed || sending) return

    try {
      setSending(true)
      setFeedback(null)
      await chatService.createTeacherHelpRequest(projectId, {
        content: trimmed,
        help_type: helpType,
        allow_public_reply: allowPublicReply,
        stage_id: currentStage,
        page_source: activeTab,
      })
      setContent('')
      setAllowPublicReply(false)
      setFeedback('已提交给教师。该求助不会自动进入小组聊天。')
      await loadRequests()
    } catch (error) {
      console.error('Failed to submit teacher help request:', error)
      setFeedback('提交失败，请稍后重试。')
    } finally {
      setSending(false)
    }
  }

  const handleResolve = async (requestId: string) => {
    try {
      setResolvingId(requestId)
      await chatService.updateTeacherHelpRequestStatus(requestId, 'resolved')
      setRequests((previous) =>
        previous.map((request) =>
          request.id === requestId ? { ...request, status: 'resolved' } : request
        )
      )
    } catch (error) {
      console.error('Failed to resolve teacher help request:', error)
      setFeedback('状态更新失败，请稍后重试。')
    } finally {
      setResolvingId(null)
    }
  }

  return (
    <div className="flex h-full flex-col bg-slate-50/60">
      <div className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">教师支持</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              低频求助入口。教师可私下回复，也可在你允许时公开回应到小组。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadRequests()}
            className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50"
            title="刷新"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section className="rounded-2xl border border-amber-100 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
            <HelpCircle className="h-4 w-4 text-amber-500" />
            提交求助
          </div>
          <div className="flex flex-wrap gap-2">
            {HELP_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setHelpType(type)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${helpType === type
                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                  }`}
              >
                {type}
              </button>
            ))}
          </div>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={4}
            maxLength={1000}
            className="mt-3 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-100"
            placeholder="简要说明小组当前遇到的困难，建议写清楚已经尝试过什么、还需要教师提供什么支持。"
          />
          <label className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            <input
              type="checkbox"
              checked={allowPublicReply}
              onChange={(event) => setAllowPublicReply(event.target.checked)}
              className="mt-1"
            />
            <span>允许教师将回应公开发送到小组聊天。未勾选时，教师回复只在本页显示。</span>
          </label>
          <div className="mt-3 rounded-xl bg-indigo-50 px-3 py-2 text-[11px] leading-5 text-indigo-700">
            当前来源：{SOURCE_LABEL[activeTab || ''] || activeTab || '未知页面'}；当前阶段：{currentStage || '未配置'}
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!content.trim() || sending}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:bg-slate-300"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
            提交给教师
          </button>
          {feedback ? <p className="mt-2 text-xs leading-5 text-slate-500">{feedback}</p> : null}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">我的求助记录</h3>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-500">
              {requests.length} 条
            </span>
          </div>

          {loading ? (
            <div className="flex items-center justify-center rounded-2xl border border-slate-100 bg-white p-6 text-sm text-slate-400">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              加载中...
            </div>
          ) : requests.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm leading-6 text-slate-500">
              暂无求助记录。只有当小组确实卡住或需要教师确认时再提交。
            </div>
          ) : (
            requests.map((request) => (
              <div key={request.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-slate-900">{request.help_type || '一般求助'}</div>
                    <div className="mt-1 text-[11px] text-slate-400">
                      {formatTime(request.created_at)} · {SOURCE_LABEL[request.page_source || ''] || request.page_source || '未知页面'} · {request.stage_id || '未配置阶段'}
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${request.status === 'resolved'
                    ? 'bg-emerald-50 text-emerald-700'
                    : request.status === 'replied'
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'bg-amber-50 text-amber-700'
                    }`}>
                    {STATUS_LABEL[request.status]}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{request.content}</p>
                <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">
                  {request.allow_public_reply ? '已允许教师公开回应到小组聊天。' : '教师回复默认仅在本页显示。'}
                </div>

                {request.replies.length > 0 && (
                  <div className="mt-3 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                      <MessageSquareText className="h-3.5 w-3.5 text-indigo-500" />
                      教师回复
                    </div>
                    {request.replies.map((reply) => (
                      <div key={reply.id} className="rounded-xl border border-indigo-100 bg-indigo-50/70 p-3">
                        <div className="flex items-center justify-between gap-2 text-[11px] text-indigo-700">
                          <span className="font-bold">{reply.username} · {reply.support_type || '教师支持'}</span>
                          <span>{formatTime(reply.created_at)}</span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{reply.content}</p>
                        <p className="mt-2 text-[11px] text-indigo-600">
                          {reply.public_reply ? '该回复已同步到小组聊天。' : '该回复仅在本页显示。'}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {request.status !== 'resolved' && (
                  <button
                    type="button"
                    onClick={() => handleResolve(request.id)}
                    disabled={resolvingId === request.id}
                    className="mt-3 inline-flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                  >
                    {resolvingId === request.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                    标记已解决
                  </button>
                )}
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  )
}
