import { useEffect, useState, useCallback } from 'react'
import { Eye, Download, Trash2 } from 'lucide-react'
import { storageService } from '../../../../services/api/storage'
import { Resource } from '../../../../types'
import { useAuthStore } from '../../../../stores/authStore'
import api from '../../../../services/api/client'
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

export default function ResourceLibrary({ projectId }: ResourceLibraryProps) {
  const [resources, setResources] = useState<Resource[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const { user } = useAuthStore()

  // Custom dialog state
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState<string>('')
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false })

  useEffect(() => {
    const fetchResources = async () => {
      try {
        const data = await storageService.getResources(projectId)
        setResources(data.resources)
      } catch (error) {
        console.error('Failed to fetch resources:', error)
      } finally {
        setLoading(false)
      }
    }

    if (projectId) {
      fetchResources()
    }
  }, [projectId])

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (!projectId || !user) return

      setUploading(true)

      for (const file of acceptedFiles) {
        try {
          // Get presigned URL
          const { upload_url, file_key } = await storageService.getPresignedUploadUrl(
            projectId,
            file.name,
            file.type,
            file.size
          )

          // Upload file
          await storageService.uploadFile(upload_url, file, (progress) => {
            setUploadProgress((prev) => ({
              ...prev,
              [file.name]: progress,
            }))
          })

          // Create resource record
          await api.post('/storage/resources', {
            file_key,
            filename: file.name,
            size: file.size,
            project_id: projectId,
            mime_type: file.type,
          })

          // Refresh resource list
          const data = await storageService.getResources(projectId)
          setResources(data.resources)

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
          alert(`上传 ${file.name} 失败`)
        }
      }

      setUploading(false)
    },
    [projectId, user]
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
      setToast({ message: '删除失败', visible: true })
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
      alert('下载失败')
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  const getFileIcon = (mimeType: string): string => {
    if (mimeType.startsWith('image/')) return '🖼️'
    if (mimeType.startsWith('video/')) return '🎥'
    if (mimeType.startsWith('audio/')) return '🎵'
    if (mimeType === 'application/pdf') return '📄'
    if (mimeType.includes('word')) return '📝'
    if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return '📊'
    if (mimeType.includes('powerpoint') || mimeType.includes('presentation')) return '📽️'
    return '📎'
  }

  const canPreview = (mimeType: string): boolean => {
    return (
      mimeType.startsWith('image/') ||
      mimeType.startsWith('video/') ||
      mimeType === 'application/pdf'
    )
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
      <div className="flex-1 overflow-y-auto">
        {resources.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            <p>还没有上传任何资源</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {resources.map((resource) => (
              <div
                key={resource.id}
                className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start space-x-3">
                  <div className="text-3xl">{getFileIcon(resource.mime_type)}</div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm truncate" title={resource.filename}>
                      {resource.filename}
                    </h4>
                    <p className="text-xs text-gray-500 mt-1">
                      {formatFileSize(resource.size)}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(resource.uploaded_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-2 mt-3">
                  {canPreview(resource.mime_type) && (
                    <button
                      onClick={() => {
                        window.open(resource.url, '_blank')
                        trackingService.track({
                          module: 'resources',
                          action: 'resource_view',
                          metadata: { projectId, resourceId: resource.id, filename: resource.filename }
                        })
                      }}
                      className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                      title="预览"
                    >
                      <Eye size={16} />
                    </button>
                  )}
                  <button
                    onClick={() => handleDownload(resource)}
                    className="p-1.5 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors"
                    title="下载"
                  >
                    <Download size={16} />
                  </button>
                  {user?.id === resource.uploaded_by && (
                    <button
                      onClick={() => {
                        setDeleteId(resource.id)
                        setDeleteName(resource.filename)
                      }}
                      className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                      title="删除"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
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
          onClose={() => setToast(prev => ({ ...prev, visible: false }))}
        />
      )}
    </div>
  )
}

