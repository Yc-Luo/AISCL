import { useEffect, useMemo, useState } from 'react'
import { ArrowDownToLine, CheckCircle2, Download, FileArchive, FileImage, FileText, Film, Search, XCircle } from 'lucide-react'
import { taskService } from '../../../../services/api/task'
import { TaskSubmissionArtifact, TeacherSubmission } from '../../../../types'
import { Badge, Button } from '../../../ui'
import { Toast } from '../../../ui/Toast'

const statusLabels: Record<string, string> = {
  submitted: '已提交',
  late_submitted: '逾期提交',
  auto_submitted: '自动提交',
  unsubmitted: '未提交',
}

const reviewLabels: Record<string, string> = {
  pending: '待审查',
  reviewed: '已审查',
  revision_requested: '需修改',
}

function artifactIcon(type: TaskSubmissionArtifact['artifact_type']) {
  if (type === 'image') return <FileImage className="h-4 w-4" />
  if (type === 'video') return <Film className="h-4 w-4" />
  if (type === 'archive') return <FileArchive className="h-4 w-4" />
  return <FileText className="h-4 w-4" />
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export default function AssignmentReview() {
  const [submissions, setSubmissions] = useState<TeacherSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selected, setSelected] = useState<TeacherSubmission | null>(null)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewStatus, setReviewStatus] = useState<'reviewed' | 'revision_requested'>('reviewed')
  const [savingReview, setSavingReview] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const loadSubmissions = async () => {
    try {
      setLoading(true)
      const data = await taskService.getTeacherSubmissions({
        status: statusFilter === 'all' ? undefined : statusFilter,
      })
      setSubmissions(data)
    } catch (error) {
      console.error('Failed to fetch submissions:', error)
      setToast({ message: '成果提交记录加载失败，请检查班级权限或网络连接。', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadSubmissions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  useEffect(() => {
    setReviewComment(selected?.task.review_comment || '')
    setReviewStatus(selected?.task.review_status === 'revision_requested' ? 'revision_requested' : 'reviewed')
  }, [selected])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return submissions
    return submissions.filter((item) => {
      const text = [
        item.course_name,
        item.project_name,
        item.release_title,
        item.task.title,
        item.artifacts.map(artifact => artifact.filename).join(' '),
      ].join(' ').toLowerCase()
      return text.includes(keyword)
    })
  }, [query, submissions])

  const submittedCount = submissions.filter(item => item.task.submission_status).length
  const pendingReviewCount = submissions.filter(item => item.task.submission_status && (!item.task.review_status || item.task.review_status === 'pending')).length

  const downloadArtifact = async (artifact: TaskSubmissionArtifact) => {
    try {
      const blob = await taskService.downloadTaskArtifact(artifact.id)
      saveBlob(blob, artifact.filename)
    } catch {
      setToast({ message: '成果文件下载失败。', type: 'error' })
    }
  }

  const exportTable = async () => {
    try {
      const blob = await taskService.exportTeacherSubmissions()
      saveBlob(blob, `成果提交清单-${new Date().toISOString().slice(0, 10)}.csv`)
    } catch {
      setToast({ message: '导出失败，请稍后重试。', type: 'error' })
    }
  }

  const submitReview = async () => {
    if (!selected) return
    try {
      setSavingReview(true)
      const updatedTask = await taskService.reviewSubmission(selected.task.id, {
        review_status: reviewStatus,
        review_comment: reviewComment.trim() || undefined,
      })
      setSubmissions(prev => prev.map(item => item.task.id === updatedTask.id ? { ...item, task: updatedTask } : item))
      setSelected(prev => prev && prev.task.id === updatedTask.id ? { ...prev, task: updatedTask } : prev)
      setToast({ message: '评审记录已保存。', type: 'success' })
    } catch {
      setToast({ message: '评审保存失败。', type: 'error' })
    } finally {
      setSavingReview(false)
    }
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col gap-4 rounded-3xl border border-slate-100 bg-white p-6 shadow-sm lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">成果审查中心</h2>
          <p className="mt-2 text-sm text-slate-500">按班级、小组和任务集中查看成果文件、提交状态与教师反馈。</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="rounded-2xl bg-indigo-50 px-4 py-3">
            <div className="text-xs font-bold text-indigo-500">已提交</div>
            <div className="mt-1 text-2xl font-black text-indigo-900">{submittedCount}</div>
          </div>
          <div className="rounded-2xl bg-amber-50 px-4 py-3">
            <div className="text-xs font-bold text-amber-500">待审查</div>
            <div className="mt-1 text-2xl font-black text-amber-900">{pendingReviewCount}</div>
          </div>
          <Button onClick={exportTable} className="self-center rounded-2xl bg-slate-900 text-white hover:bg-slate-800">
            <ArrowDownToLine className="mr-2 h-4 w-4" />
            导出清单
          </Button>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-100 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索班级、小组、任务或文件名"
              className="w-full rounded-2xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
          >
            <option value="all">全部状态</option>
            <option value="unsubmitted">未提交</option>
            <option value="submitted">已提交</option>
            <option value="late_submitted">逾期提交</option>
            <option value="auto_submitted">自动提交</option>
          </select>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center text-sm text-slate-500">正在加载成果提交记录...</div>
        ) : filtered.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-center">
            <FileText className="mb-3 h-10 w-10 text-slate-300" />
            <h3 className="font-bold text-slate-900">暂无成果提交记录</h3>
            <p className="mt-1 text-sm text-slate-500">学生提交任务成果后，会在这里集中显示。</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-3">班级 / 小组</th>
                  <th className="px-4 py-3">任务</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">成果</th>
                  <th className="px-4 py-3">提交时间</th>
                  <th className="px-4 py-3">评审</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((item) => (
                  <tr key={item.task.id} className="hover:bg-indigo-50/40">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{item.project_name}</div>
                      <div className="text-xs text-slate-400">{item.course_name || '未绑定班级'}</div>
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <div className="truncate font-semibold text-slate-800" title={item.task.title}>{item.task.title}</div>
                      <div className="truncate text-xs text-slate-400">{item.release_title || '课程任务'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary" className="border-slate-200 bg-slate-50 text-slate-600">
                        {statusLabels[item.task.submission_status || 'unsubmitted']}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-700">{item.artifact_count} 个文件</div>
                      <div className="text-xs text-slate-400">{item.artifacts.map(artifact => artifact.artifact_type).slice(0, 3).join(' / ') || '无附件'}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {item.task.submitted_at ? new Date(item.task.submitted_at).toLocaleString() : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-bold text-slate-500">{reviewLabels[item.task.review_status || 'pending']}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button size="sm" variant="outline" className="rounded-xl" onClick={() => setSelected(item)}>
                        查看审查
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selected && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30">
          <div className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 p-5">
              <div>
                <h3 className="text-xl font-black text-slate-900">{selected.task.title}</h3>
                <p className="mt-1 text-sm text-slate-500">{selected.course_name || '未绑定班级'} · {selected.project_name}</p>
              </div>
              <button className="rounded-xl p-2 text-slate-400 hover:bg-slate-100" onClick={() => setSelected(null)}>
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              <section>
                <h4 className="mb-3 text-sm font-black text-slate-900">提交说明</h4>
                <div className="rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                  {selected.task.submission_note || '学生未填写提交说明。'}
                </div>
              </section>
              <section>
                <h4 className="mb-3 text-sm font-black text-slate-900">成果文件</h4>
                <div className="space-y-2">
                  {selected.artifacts.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">暂无上传文件</div>
                  ) : selected.artifacts.map((artifact) => (
                    <div key={artifact.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 p-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="rounded-xl bg-indigo-50 p-2 text-indigo-600">{artifactIcon(artifact.artifact_type)}</div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-bold text-slate-800">{artifact.filename}</div>
                          <div className="text-xs text-slate-400">{(artifact.size / 1024 / 1024).toFixed(2)} MB · {artifact.mime_type}</div>
                        </div>
                      </div>
                      <Button size="sm" variant="outline" className="shrink-0 rounded-xl" onClick={() => downloadArtifact(artifact)}>
                        <Download className="mr-1 h-3.5 w-3.5" />
                        下载
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
              <section>
                <h4 className="mb-3 text-sm font-black text-slate-900">教师评审</h4>
                <div className="space-y-3 rounded-2xl border border-slate-100 p-4">
                  <select
                    value={reviewStatus}
                    onChange={(event) => setReviewStatus(event.target.value as 'reviewed' | 'revision_requested')}
                    className="w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  >
                    <option value="reviewed">已审查</option>
                    <option value="revision_requested">需修改</option>
                  </select>
                  <textarea
                    value={reviewComment}
                    onChange={(event) => setReviewComment(event.target.value.slice(0, 4000))}
                    rows={5}
                    placeholder="填写对小组成果的反馈、修改建议或确认意见。"
                    className="w-full resize-y rounded-2xl border border-slate-200 px-3 py-2 text-sm leading-6 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
              </section>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-slate-100 p-5">
              <Button variant="ghost" className="rounded-xl" onClick={() => setSelected(null)}>关闭</Button>
              <Button disabled={savingReview} onClick={submitReview} className="rounded-xl bg-indigo-600 text-white hover:bg-indigo-700">
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {savingReview ? '保存中...' : '保存评审'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
