import { useEffect, useState } from 'react'
import { BookOpen, CheckCircle2, ChevronDown, ChevronUp, FileText, Plus, Search, Sparkles, Trash2 } from 'lucide-react'
import { wikiService, WikiItem, WikiItemType } from '../../../../services/api/wiki'
import { useAuthStore } from '../../../../stores/authStore'
import { useContextStore } from '../../../../stores/contextStore'
import { Toast } from '../../../ui/Toast'

interface ProjectWikiProps {
  projectId: string
}

const ITEM_TYPE_LABELS: Record<WikiItemType, string> = {
  task_brief: '项目说明',
  concept: '概念页',
  evidence: '证据卡片',
  claim: '观点页',
  controversy: '争议页',
  stage_summary: '阶段结论',
  note: '补充记录',
}

const ITEM_TYPES: WikiItemType[] = [
  'task_brief',
  'concept',
  'evidence',
  'claim',
  'controversy',
  'stage_summary',
  'note',
]

export default function ProjectWiki({ projectId }: ProjectWikiProps) {
  const user = useAuthStore((state) => state.user)
  const currentStage = useContextStore((state) => state.currentStage)
  const [items, setItems] = useState<WikiItem[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedType, setSelectedType] = useState<WikiItemType | ''>('')
  const [isCreating, setIsCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expandedItemIds, setExpandedItemIds] = useState<Set<string>>(new Set())
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [draftType, setDraftType] = useState<WikiItemType>('note')
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false })

  const loadItems = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const response = query.trim()
        ? await wikiService.searchItems(projectId, query.trim(), {
          item_type: selectedType || undefined,
          limit: 50,
        })
        : await wikiService.listItems(projectId, {
          item_type: selectedType || undefined,
          limit: 50,
        })
      setItems(response.items)
    } catch (error) {
      console.error('Failed to load wiki items:', error)
      setToast({ message: '项目 Wiki 加载失败', visible: true })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadItems()
  }, [projectId, selectedType])

  const handleSearch = () => {
    void loadItems()
  }

  const handleCreate = async () => {
    if (!draftTitle.trim() || !draftContent.trim()) {
      setToast({ message: '请填写标题和内容', visible: true })
      return
    }

    setIsCreating(true)
    try {
      await wikiService.createItem({
        project_id: projectId,
        item_type: draftType,
        title: draftTitle.trim(),
        content: draftContent.trim(),
        summary: draftContent.trim().slice(0, 300),
        source_type: 'manual',
        stage_id: currentStage || undefined,
        confidence_level: 'working',
      })
      setDraftTitle('')
      setDraftContent('')
      setDraftType('note')
      setToast({ message: '已加入项目 Wiki', visible: true })
      await loadItems()
    } catch (error) {
      console.error('Failed to create wiki item:', error)
      setToast({ message: '创建 Wiki 条目失败', visible: true })
    } finally {
      setIsCreating(false)
    }
  }

  const canDeleteWikiItem = (item: WikiItem) => {
    if (!user) return false
    if (user.role === 'teacher' || user.role === 'admin') return true
    return item.created_by === user.id && item.source_type !== 'teacher_brief'
  }

  const toggleExpanded = (itemId: string) => {
    setExpandedItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }

  const handleDelete = async (item: WikiItem) => {
    if (!canDeleteWikiItem(item)) {
      setToast({ message: '该 Wiki 条目不能由当前账号删除', visible: true })
      return
    }

    const confirmed = window.confirm(`确认删除 Wiki 条目“${item.title}”吗？删除后 AI 将不再检索该条目。`)
    if (!confirmed) return

    setDeletingId(item.id)
    try {
      await wikiService.deleteItem(item.id)
      setItems((prev) => prev.filter((entry) => entry.id !== item.id))
      setExpandedItemIds((prev) => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
      setToast({ message: 'Wiki 条目已删除', visible: true })
    } catch (error) {
      console.error('Failed to delete wiki item:', error)
      setToast({ message: '删除 Wiki 条目失败', visible: true })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="flex h-full flex-col bg-gradient-to-br from-slate-50 via-white to-indigo-50/40">
      <div className="border-b border-slate-200 bg-white/85 px-5 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <div className="rounded-2xl bg-indigo-600 p-2 text-white shadow-sm">
                <BookOpen className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900">项目 Wiki</h2>
                <p className="text-xs text-slate-500">沉淀任务说明、证据、观点、争议和阶段结论，供 AI 检索引用。</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
            <Sparkles className="h-3.5 w-3.5" />
            RAG 优先检索 Wiki
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex min-w-[260px] flex-1 items-center rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <Search className="mr-2 h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleSearch()
              }}
              placeholder="搜索 Wiki 条目..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
          </div>
          <select
            value={selectedType}
            onChange={(event) => setSelectedType(event.target.value as WikiItemType | '')}
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm outline-none"
          >
            <option value="">全部类型</option>
            {ITEM_TYPES.map((type) => (
              <option key={type} value={type}>{ITEM_TYPE_LABELS[type]}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleSearch}
            className="rounded-2xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          >
            搜索
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-h-0 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">加载中...</div>
          ) : items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white/70 text-slate-400">
              <BookOpen className="mb-3 h-10 w-10" />
              <p className="text-sm">暂无 Wiki 条目</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
              {items.map((item) => {
                const isExpanded = expandedItemIds.has(item.id)
                const collapsedText = item.summary || item.content
                const shownText = isExpanded ? item.content : collapsedText
                const canExpand = Boolean(item.summary && item.summary.trim() !== item.content.trim()) || item.content.length > 220
                const canDelete = canDeleteWikiItem(item)

                return (
                  <article
                    key={item.id}
                    className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-semibold text-indigo-700 ring-1 ring-indigo-100">
                            {ITEM_TYPE_LABELS[item.item_type] || item.item_type}
                          </span>
                          {item.confidence_level === 'verified' ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                              <CheckCircle2 className="h-3 w-3" />
                              已确认
                            </span>
                          ) : null}
                        </div>
                        <h3 className="truncate text-base font-bold text-slate-900" title={item.title}>{item.title}</h3>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {canDelete ? (
                          <button
                            type="button"
                            onClick={() => handleDelete(item)}
                            disabled={deletingId === item.id}
                            className="rounded-xl p-2 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                            title="删除 Wiki 条目"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                        <FileText className="h-5 w-5 text-slate-300" />
                      </div>
                    </div>
                    <p className={`mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600 ${isExpanded ? '' : 'line-clamp-3'}`}>
                      {shownText}
                    </p>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                        <span>来源：{item.source_type}</span>
                        {item.stage_id ? <span>阶段：{item.stage_id}</span> : null}
                        <span>{new Date(item.updated_at).toLocaleString()}</span>
                      </div>
                      {canExpand ? (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(item.id)}
                          className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500 transition hover:bg-indigo-50 hover:text-indigo-700"
                        >
                          {isExpanded ? (
                            <>
                              收起
                              <ChevronUp className="h-3.5 w-3.5" />
                            </>
                          ) : (
                            <>
                              展开
                              <ChevronDown className="h-3.5 w-3.5" />
                            </>
                          )}
                        </button>
                      ) : null}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </div>

        <aside className="rounded-3xl border border-indigo-100 bg-white p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600">
              <Plus className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">手动加入 Wiki</h3>
              <p className="text-xs text-slate-500">适合记录阶段结论、补充证据或争议问题。</p>
            </div>
          </div>
          <div className="space-y-3">
            <select
              value={draftType}
              onChange={(event) => setDraftType(event.target.value as WikiItemType)}
              className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300"
            >
              {ITEM_TYPES.map((type) => (
                <option key={type} value={type}>{ITEM_TYPE_LABELS[type]}</option>
              ))}
            </select>
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              placeholder="标题"
              className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-300"
            />
            <textarea
              value={draftContent}
              onChange={(event) => setDraftContent(event.target.value)}
              placeholder="内容"
              className="h-40 w-full resize-none rounded-2xl border border-slate-200 px-3 py-2 text-sm leading-6 outline-none focus:border-indigo-300"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={isCreating}
              className="w-full rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCreating ? '正在写入...' : '加入项目 Wiki'}
            </button>
          </div>
        </aside>
      </div>

      {toast.visible && (
        <Toast
          message={toast.message}
          onClose={() => setToast((prev) => ({ ...prev, visible: false }))}
        />
      )}
    </div>
  )
}
