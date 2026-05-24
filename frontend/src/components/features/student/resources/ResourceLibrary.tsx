import { useEffect, useState, useCallback } from 'react'
import {
  Archive,
  BookOpen,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  File,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Loader2,
  MinusCircle,
  Music,
  Presentation,
  Trash2,
  TriangleAlert,
  Video,
} from 'lucide-react'
import { storageService } from '../../../../services/api/storage'
import { wikiService } from '../../../../services/api/wiki'
import { Resource } from '../../../../types'
import { useAuthStore } from '../../../../stores/authStore'
import SimpleDropzone from './SimpleDropzone'
import { trackingService } from '../../../../services/tracking/TrackingService'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../ui/dialog"
import { Button } from "../../../ui/button"
import { Toast } from "../../../ui/Toast"

interface ResourceLibraryProps {
  projectId: string
}

const MAX_RESOURCE_BYTES = 50 * 1024 * 1024

type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'office' | 'text' | 'unsupported'

interface PreviewState {
  resource: Resource
  kind: PreviewKind
  url?: string
  text?: string
  loading: boolean
  error?: string
}

export default function ResourceLibrary({ projectId }: ResourceLibraryProps) {
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const { user } = useAuthStore()

  // Custom dialog state
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState<string>('')
  const [toast, setToast] = useState<{ message: string; visible: boolean; type?: 'success' | 'error' }>({
    message: '',
    visible: false,
    type: 'success',
  })

  const fetchResources = useCallback(async () => {
    try {
      const data = await storageService.getResources(projectId, { includeCourseResources: true })
      setResources(data.resources)
    } catch (error) {
      console.error('Failed to fetch resources:', error)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    if (projectId) {
      void fetchResources()
    }
  }, [projectId, fetchResources])

  useEffect(() => {
    const hasUnfinishedParsing = resources.some((resource) =>
      ['pending', 'parsing'].includes(resource.parse_status || 'pending')
    )
    if (!projectId || !hasUnfinishedParsing) return
    const timer = window.setInterval(() => {
      void fetchResources()
    }, 10000)
    return () => window.clearInterval(timer)
  }, [projectId, resources, fetchResources])

  useEffect(() => {
    return () => {
      if (preview?.url) window.URL.revokeObjectURL(preview.url)
    }
  }, [preview?.url])

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!projectId || !user) return

      setUploading(true)

      for (const file of acceptedFiles) {
        if (file.size > MAX_RESOURCE_BYTES) {
          setToast({ message: `${file.name} 超过 50MB，请压缩后再上传。`, visible: true, type: 'error' })
          continue
        }
        try {
          setUploadProgress((prev) => ({ ...prev, [file.name]: 15 }))

          await storageService.uploadResourceFile({
            file,
            project_id: projectId,
            source_type: 'library',
          })

          setUploadProgress((prev) => ({ ...prev, [file.name]: 100 }))

          // Refresh resource list
          await fetchResources()

          trackingService.track({
            module: 'resources',
            action: 'resource_upload',
            metadata: { projectId, filename: file.name, size: file.size, mimeType: file.type }
          })

          // Clear progress
          setUploadProgress((prev) => {
            const newProgress = { ...prev }
            delete newProgress[file.name]
            return newProgress
          })
        } catch (error) {
          console.error(`Failed to upload ${file.name}:`, error)
          setToast({ message: `上传 ${file.name} 失败，请稍后重试。`, visible: true, type: 'error' })
        }
      }

      setUploading(false)
    },
    [projectId, user, fetchResources]
  )


  const handleDelete = async () => {
    if (!deleteId) return

    try {
      await storageService.deleteResource(projectId, deleteId)
      setResources((prev) => prev.filter((r) => r.id !== deleteId))
      trackingService.track({
        module: 'resources',
        action: 'resource_delete',
        metadata: { projectId, resourceId: deleteId, filename: deleteName }
      })
      setToast({ message: '资源已删除', visible: true })
    } catch (error) {
      console.error('Failed to delete resource:', error)
      setToast({ message: '删除失败', visible: true, type: 'error' })
    } finally {
      setDeleteId(null)
    }
  }

  const handleDownload = async (resource: Resource) => {
    try {
      const blob = await storageService.downloadResource(resource.id)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = resource.filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)
      trackingService.track({
        module: 'resources',
        action: 'resource_download',
        metadata: { projectId, resourceId: resource.id, filename: resource.filename }
      })
    } catch (error) {
      console.error('Failed to download resource:', error)
      setToast({ message: '下载失败，请稍后重试。', visible: true, type: 'error' })
    }
  }

  const handlePreview = async (resource: Resource) => {
    const kind = getPreviewKind(resource)
    if (preview?.url) window.URL.revokeObjectURL(preview.url)
    setPreview({ resource, kind, loading: kind !== 'unsupported' })

    trackingService.track({
      module: 'resources',
      action: 'resource_view',
      metadata: { projectId, resourceId: resource.id, filename: resource.filename, previewKind: kind }
    })

    if (kind === 'unsupported') return

    try {
      const blob = kind === 'office'
        ? await storageService.previewResourcePdf(resource.id)
        : await storageService.downloadResource(resource.id)
      if (kind === 'text') {
        const text = await blob.text()
        setPreview({ resource, kind, text, loading: false })
        return
      }

      const url = window.URL.createObjectURL(blob)
      setPreview({ resource, kind, url, loading: false })
    } catch (error) {
      console.error('Failed to preview resource:', error)
      setPreview({ resource, kind, loading: false, error: '预览加载失败，请下载后查看。' })
    }
  }

  const closePreview = () => {
    if (preview?.url) window.URL.revokeObjectURL(preview.url)
    setPreview(null)
  }

  const handleAddResourceToWiki = async (resource: Resource) => {
    try {
      await wikiService.createItem({
        project_id: projectId,
        item_type: resource.mime_type.startsWith('image/') ? 'evidence' : 'note',
        title: `资源：${resource.filename}`,
        content: `资源文件：${resource.filename}\n类型：${resource.mime_type}\n大小：${formatFileSize(resource.size)}\n可在资源库中打开或下载后进一步核验。`,
        summary: `资源库文件：${resource.filename}`,
        source_type: 'resource',
        source_id: resource.id,
        confidence_level: 'working',
      })
      trackingService.track({
        module: 'wiki',
        action: 'resource_add_to_wiki',
        metadata: { projectId, resourceId: resource.id, filename: resource.filename }
      })
      setToast({ message: '资源已加入项目 Wiki', visible: true })
    } catch (error) {
      console.error('Failed to add resource to wiki:', error)
      setToast({ message: '加入 Wiki 失败', visible: true, type: 'error' })
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  const getExtension = (filename: string) => {
    const ext = filename.split('.').pop()
    return ext ? ext.toLowerCase() : ''
  }

  const getResourceKind = (resource: Resource) => {
    const mimeType = (resource.mime_type || '').toLowerCase()
    const ext = getExtension(resource.filename)
    if (mimeType.startsWith('image/')) return 'image'
    if (mimeType.startsWith('video/')) return 'video'
    if (mimeType.startsWith('audio/')) return 'audio'
    if (mimeType === 'application/pdf' || ext === 'pdf') return 'pdf'
    if (mimeType.includes('word') || ['doc', 'docx'].includes(ext)) return 'word'
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || ['xls', 'xlsx', 'csv'].includes(ext)) return ext === 'csv' ? 'csv' : 'sheet'
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint') || ['ppt', 'pptx'].includes(ext)) return 'slides'
    if (mimeType.includes('zip') || ['zip', 'rar', '7z'].includes(ext)) return 'archive'
    if (mimeType.startsWith('text/') || ['txt', 'md', 'json'].includes(ext)) return 'text'
    return 'file'
  }

  const getPreviewKind = (resource: Resource): PreviewKind => {
    const kind = getResourceKind(resource)
    if (kind === 'image') return 'image'
    if (kind === 'video') return 'video'
    if (kind === 'audio') return 'audio'
    if (kind === 'pdf') return 'pdf'
    if (kind === 'word' || kind === 'sheet' || kind === 'slides') return 'office'
    if (kind === 'text' || kind === 'csv') return 'text'
    return 'unsupported'
  }

  const getFileIcon = (resource: Resource) => {
    const kind = getResourceKind(resource)
    const className = 'h-5 w-5'
    if (kind === 'image') return <ImageIcon className={className} />
    if (kind === 'video') return <Video className={className} />
    if (kind === 'audio') return <Music className={className} />
    if (kind === 'pdf' || kind === 'word' || kind === 'text') return <FileText className={className} />
    if (kind === 'sheet' || kind === 'csv') return <FileSpreadsheet className={className} />
    if (kind === 'slides') return <Presentation className={className} />
    if (kind === 'archive') return <Archive className={className} />
    return <File className={className} />
  }

  const getIconClassName = (resource: Resource) => {
    const kind = getResourceKind(resource)
    if (kind === 'word') return 'bg-blue-600 text-white'
    if (kind === 'sheet' || kind === 'csv') return 'bg-emerald-600 text-white'
    if (kind === 'slides') return 'bg-orange-600 text-white'
    if (kind === 'pdf') return 'bg-rose-600 text-white'
    if (kind === 'video') return 'bg-violet-600 text-white'
    if (kind === 'audio') return 'bg-fuchsia-600 text-white'
    if (kind === 'image') return 'bg-sky-600 text-white'
    if (kind === 'archive') return 'bg-amber-600 text-white'
    return 'bg-slate-500 text-white'
  }

  const formatResourceTime = (value: string) => {
    const time = new Date(value)
    if (!Number.isFinite(time.getTime())) return '-'
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startOfTime = new Date(time.getFullYear(), time.getMonth(), time.getDate()).getTime()
    const label = startOfTime === startOfToday
      ? '今天'
      : startOfTime === startOfToday - 24 * 60 * 60 * 1000
        ? '昨天'
        : time.toLocaleDateString()
    return `${label} ${time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  }

  const getResourceDateGroup = (resource: Resource) => {
    const time = new Date(resource.uploaded_at)
    if (!Number.isFinite(time.getTime())) return '更早'
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const startOfTime = new Date(time.getFullYear(), time.getMonth(), time.getDate()).getTime()
    if (startOfTime === startOfToday) return '今天'
    if (startOfTime === startOfToday - 24 * 60 * 60 * 1000) return '昨天'
    return '更早'
  }

  const getCreatorLabel = (resource: Resource) => {
    if (resource.uploaded_by === user?.id) return '我'
    if (resource.scope === 'course') return '教师'
    return '小组成员'
  }

  const groupedResources = resources.reduce<Record<string, Resource[]>>((groups, resource) => {
    const group = getResourceDateGroup(resource)
    groups[group] = groups[group] || []
    groups[group].push(resource)
    return groups
  }, {})

  const orderedGroups = ['今天', '昨天', '更早'].filter(group => groupedResources[group]?.length)

  const getParseStatus = (resource: Resource) => {
    const status = resource.parse_status || 'pending'
    if (status === 'indexed') {
      return { title: '已完成解析并进入 AI 检索', icon: <CheckCircle2 size={14} />, className: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100' }
    }
    if (status === 'parsing') {
      return { title: '资源正在解析入库', icon: <Loader2 size={14} className="animate-spin" />, className: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100' }
    }
    if (status === 'failed') {
      return { title: resource.parse_error || '解析失败，可稍后重试或联系教师', icon: <TriangleAlert size={14} />, className: 'bg-rose-50 text-rose-700 ring-1 ring-rose-100' }
    }
    if (status === 'unsupported') {
      return { title: '该资源仅作为文件保存，暂未进入 AI 检索', icon: <MinusCircle size={14} />, className: 'bg-slate-50 text-slate-500 ring-1 ring-slate-100' }
    }
    return { title: '等待解析入库', icon: <Clock3 size={14} />, className: 'bg-amber-50 text-amber-700 ring-1 ring-amber-100' }
  }

  if (loading) {
    return <div className="p-4">加载中...</div>
  }

  return (
    <div className="h-full flex flex-col p-4">
      {/* Upload Area */}
      <SimpleDropzone onDrop={onDrop} disabled={uploading}>
        <div
          className={`
            border-2 border-dashed rounded-lg p-8 text-center
            transition-colors mb-4
            border-gray-300 hover:border-gray-400
            ${uploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          <div className="space-y-2">
            <div className="text-4xl">📁</div>
            <p className="text-gray-600">
              拖拽文件到这里，或点击选择文件
            </p>
            <p className="text-sm text-gray-500">
              支持图片、视频、PDF、文档等格式
            </p>
          </div>
        </div>
      </SimpleDropzone>

      {/* Upload Progress */}
      {Object.keys(uploadProgress).length > 0 && (
        <div className="mb-4 space-y-2">
          {Object.entries(uploadProgress).map(([filename, progress]) => (
            <div key={filename} className="bg-gray-100 rounded p-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm text-gray-700">{filename}</span>
                <span className="text-sm text-gray-600">{Math.round(progress)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Resource List */}
      <div className="flex-1 overflow-auto rounded-2xl border border-slate-100 bg-white">
        {resources.length === 0 ? (
          <div className="m-4 rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 px-6 py-10 text-center text-slate-500">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-2xl shadow-sm">
              📁
            </div>
            <p className="text-sm font-bold text-slate-700">暂无小组资源</p>
            <p className="mt-2 text-xs leading-5">
              可以把资料、图片或任务成果拖到上方上传区，上传后可加入 Wiki 作为证据或素材。
            </p>
          </div>
        ) : (
          <div className="min-w-[760px]">
            <div className="sticky top-0 z-10 grid grid-cols-[minmax(280px,1.6fr)_minmax(110px,0.7fr)_minmax(88px,0.45fr)_minmax(120px,0.65fr)_80px_132px] items-center gap-3 border-b border-slate-100 bg-white px-4 py-3 text-xs font-bold text-slate-500">
              <div>全部类型</div>
              <div>文件位置</div>
              <div>创建者</div>
              <div>最近修改</div>
              <div className="text-right">大小</div>
              <div className="text-right">操作</div>
            </div>
            {orderedGroups.map((group) => (
              <div key={group}>
                <div className="px-4 pb-2 pt-5 text-sm font-black text-slate-800">{group}</div>
                {groupedResources[group].map((resource) => {
                  const parse = getParseStatus(resource)
                  const location = resource.scope === 'course' ? '教师资源' : '小组资源'
                  return (
                    <div
                      key={resource.id}
                      className="grid grid-cols-[minmax(280px,1.6fr)_minmax(110px,0.7fr)_minmax(88px,0.45fr)_minmax(120px,0.65fr)_80px_132px] items-center gap-3 border-b border-slate-100 px-4 py-3 text-sm transition-colors hover:bg-slate-50/70"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${getIconClassName(resource)}`}>
                          {getFileIcon(resource)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => handlePreview(resource)}
                              className="truncate text-left font-medium text-slate-900 hover:text-indigo-700"
                              title={resource.filename}
                            >
                              {resource.filename}
                            </button>
                            <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
                              {getExtension(resource.filename).toUpperCase() || 'FILE'}
                            </span>
                            <span
                              className={`inline-flex shrink-0 items-center justify-center rounded-full p-1 ${parse.className}`}
                              title={parse.title}
                            >
                              {parse.icon}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="truncate text-slate-500" title={location}>{location}</div>
                      <div className="truncate text-slate-500" title={getCreatorLabel(resource)}>{getCreatorLabel(resource)}</div>
                      <div className="truncate text-slate-500">{formatResourceTime(resource.uploaded_at)}</div>
                      <div className="text-right text-slate-500">{formatFileSize(resource.size)}</div>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handlePreview(resource)}
                          className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
                          title="预览"
                        >
                          <Eye size={16} />
                        </button>
                        <button
                          onClick={() => handleAddResourceToWiki(resource)}
                          className="rounded-lg p-1.5 text-emerald-600 transition-colors hover:bg-emerald-50 hover:text-emerald-700"
                          title="加入 Wiki"
                        >
                          <BookOpen size={16} />
                        </button>
                        <button
                          onClick={() => handleDownload(resource)}
                          className="rounded-lg p-1.5 text-indigo-500 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
                          title="下载"
                        >
                          <Download size={16} />
                        </button>
                        {resource.scope !== 'course' && user?.id === resource.uploaded_by && (
                          <button
                            onClick={() => {
                              setDeleteId(resource.id)
                              setDeleteName(resource.filename)
                            }}
                            className="rounded-lg p-1.5 text-red-500 transition-colors hover:bg-red-50 hover:text-red-700"
                            title="删除"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      <Dialog open={!!preview} onOpenChange={(open) => !open && closePreview()}>
        <DialogContent className="max-h-[92vh] max-w-[min(96vw,64rem)] overflow-hidden rounded-2xl p-0">
          {preview && (
            <div className="flex max-h-[92vh] flex-col">
              <DialogHeader className="border-b border-slate-100 px-5 py-4">
                <DialogTitle className="truncate text-base font-bold text-slate-900" title={preview.resource.filename}>
                  {preview.resource.filename}
                </DialogTitle>
                <DialogDescription>
                  {preview.kind === 'unsupported'
                    ? '该格式暂不支持直接在线渲染。'
                    : preview.kind === 'office'
                      ? '已转换为 PDF 预览，尽量保持原版式。'
                    : '在线预览'}
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-[28rem] flex-1 overflow-auto bg-slate-50 p-4">
                {preview.loading && (
                  <div className="flex h-[28rem] items-center justify-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {preview.kind === 'office' ? '正在转换并加载原版式预览...' : '正在加载预览...'}
                  </div>
                )}
                {!preview.loading && preview.error && (
                  <div className="flex h-[28rem] items-center justify-center text-sm text-rose-600">
                    {preview.error}
                  </div>
                )}
                {!preview.loading && !preview.error && preview.kind === 'image' && preview.url && (
                  <div className="flex min-h-[28rem] items-center justify-center">
                    <img src={preview.url} alt={preview.resource.filename} className="max-h-[72vh] max-w-full rounded-lg object-contain shadow-sm" />
                  </div>
                )}
                {!preview.loading && !preview.error && preview.kind === 'video' && preview.url && (
                  <video src={preview.url} controls className="mx-auto max-h-[72vh] w-full rounded-lg bg-black" />
                )}
                {!preview.loading && !preview.error && preview.kind === 'audio' && preview.url && (
                  <div className="flex min-h-[28rem] items-center justify-center">
                    <audio src={preview.url} controls className="w-full max-w-xl" />
                  </div>
                )}
                {!preview.loading && !preview.error && (preview.kind === 'pdf' || preview.kind === 'office') && preview.url && (
                  <iframe src={preview.url} title={preview.resource.filename} className="h-[72vh] w-full rounded-lg border border-slate-200 bg-white" />
                )}
                {!preview.loading && !preview.error && preview.kind === 'text' && (
                  <pre className="min-h-[28rem] whitespace-pre-wrap rounded-lg bg-white p-4 text-sm leading-6 text-slate-700 shadow-sm">
                    {preview.text || ''}
                  </pre>
                )}
                {!preview.loading && !preview.error && preview.kind === 'unsupported' && (
                  <div className="flex min-h-[28rem] flex-col items-center justify-center rounded-lg bg-white px-8 text-center shadow-sm">
                    <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl ${getIconClassName(preview.resource)}`}>
                      {getFileIcon(preview.resource)}
                    </div>
                    <div className="text-base font-bold text-slate-900">暂不支持在线渲染此格式</div>
                    <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                      该格式当前无法在浏览器中安全预览，可以先下载后查看。
                    </p>
                    {preview.resource.parse_status === 'indexed' && (
                      <p className="mt-2 max-w-md text-xs leading-5 text-slate-400">
                        该文件已进入 AI 检索索引，但原版式预览仍需要文档转换服务。
                      </p>
                    )}
                  </div>
                )}
              </div>
              <DialogFooter className="border-t border-slate-100 px-5 py-3">
                <Button variant="ghost" onClick={closePreview} className="rounded-xl">关闭</Button>
                <Button onClick={() => handleDownload(preview.resource)} className="rounded-xl bg-indigo-600 text-white hover:bg-indigo-700">
                  下载
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>确认删除资源</DialogTitle>
            <DialogDescription className="py-2 text-slate-600">
              确定要删除 <span className="font-bold text-slate-900">{deleteName}</span> 吗？<br />
              该操作无法撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setDeleteId(null)} className="rounded-xl">取消</Button>
            <Button variant="destructive" onClick={handleDelete} className="rounded-xl px-6">确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toast Notification */}
      {toast.visible && (
        <Toast
          message={toast.message}
          type={toast.type || 'success'}
          onClose={() => setToast(prev => ({ ...prev, visible: false }))}
        />
      )}
    </div>
  )
}
