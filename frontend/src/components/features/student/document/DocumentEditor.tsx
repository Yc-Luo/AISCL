import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useEditor, EditorContent, Editor as TiptapEditor } from '@tiptap/react'
import { trackingService } from '../../../../services/tracking/TrackingService'
import Underline from '@tiptap/extension-underline'
import StarterKit from '@tiptap/starter-kit'
import CodeBlock from '@tiptap/extension-code-block'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import { Color } from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { Table } from '@tiptap/extension-table'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableRow } from '@tiptap/extension-table-row'
import { Collaboration } from '@tiptap/extension-collaboration'
import { useAuthStore } from '../../../../stores/authStore'
import { documentService, Document } from '../../../../services/api/document'
import { storageService } from '../../../../services/api/storage'
import { wikiService } from '../../../../services/api/wiki'
import { Annotation, AnnotationAttributes } from '../../../../extensions/Annotation'
import EditorToolbar from './EditorToolbar'
import RemoteCursors from './RemoteCursors'
import AnnotationInput from './AnnotationInput'
import AnnotationPopup from './AnnotationPopup'
import { useDocumentSync } from '../../../../hooks/document/useDocumentSync'
import { useContextStore } from '../../../../stores/contextStore'
import { useScrapbookActions } from '../../../../modules/inquiry/hooks/useScrapbookActions'
import { Toast } from '../../../ui/Toast'
import * as Y from 'yjs'
import { Plus, FileText, Loader2, X, Trash2, AlertTriangle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "../../../ui/dialog"
import { Button } from "../../../ui/button"
import { ExperimentVersion } from '../../../../types'

interface DocumentEditorProps {
  documentId?: string
  projectId?: string
  experimentVersion?: ExperimentVersion | null
  initialTaskDocumentId?: string
  onDocumentChange?: (id: string) => void
}

export default function DocumentEditor({
  documentId,
  projectId,
  experimentVersion,
  initialTaskDocumentId,
  onDocumentChange,
}: DocumentEditorProps) {
  const { user } = useAuthStore()
  const currentStage = useContextStore((state) => state.currentStage)
  const [document, setDocument] = useState<Document | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [remoteUsers] = useState<any[]>([])
  const [showAnnotationInput, setShowAnnotationInput] = useState(false)
  const [showAnnotationPopup, setShowAnnotationPopup] = useState(false)
  const [activeAnnotation, setActiveAnnotation] = useState<AnnotationAttributes | null>(null)
  const [annotationInputPosition, setAnnotationInputPosition] = useState<{ top: number; left: number } | undefined>()

  const [showToast, setShowToast] = useState(false)
  const [toastMessage, setToastMessage] = useState('')

  const [showDocumentList, setShowDocumentList] = useState(false)
  const [documents, setDocuments] = useState<Document[]>([])
  const [isCreating, setIsCreating] = useState(false)
  const [isListLoading, setIsListLoading] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isImageUploading, setIsImageUploading] = useState(false)
  const experimentVersionId = experimentVersion?.version_name || undefined
  const lastCommittedTextRef = useRef('')
  const imageInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<TiptapEditor | null>(null)

  const orderedDocuments = useMemo(() => {
    if (!documents.length || !initialTaskDocumentId) return documents
    const projectDescriptionDoc = documents.find((doc) => doc.id === initialTaskDocumentId)
    if (!projectDescriptionDoc) return documents
    return [
      projectDescriptionDoc,
      ...documents.filter((doc) => doc.id !== initialTaskDocumentId),
    ]
  }, [documents, initialTaskDocumentId])

  const { addMaterial } = useScrapbookActions(projectId || '')

  const handleInsertImageFile = useCallback(async (file: File, targetEditor?: TiptapEditor | null) => {
    if (!projectId) {
      setToastMessage('当前文档未关联项目，暂时无法上传图片')
      setShowToast(true)
      return
    }

    if (!file.type.startsWith('image/')) {
      setToastMessage('请选择图片文件')
      setShowToast(true)
      return
    }

    setIsImageUploading(true)
    try {
      const { upload_url, file_key } = await storageService.getPresignedUploadUrl(
        projectId,
        file.name,
        file.type,
        file.size,
      )

      await storageService.uploadFile(upload_url, file)

      const resource = await storageService.createResource({
        file_key,
        filename: file.name,
        size: file.size,
        project_id: projectId,
        mime_type: file.type,
      })

      const imageUrl = storageService.getResourceViewUrl(resource.id)
      const activeEditor = targetEditor || editorRef.current
      if (!activeEditor) {
        throw new Error('Editor instance unavailable')
      }

      ; (activeEditor.chain().focus() as any).setImage({
        src: imageUrl,
        alt: file.name,
        title: file.name,
      }).run()

      trackingService.track({
        module: 'document',
        action: 'document_image_insert',
        metadata: {
          projectId,
          documentId,
          resourceId: resource.id,
          filename: file.name,
          mimeType: file.type,
          size: file.size,
        },
      })

      trackingService.trackResearchEvent({
        project_id: projectId,
        experiment_version_id: experimentVersionId,
        actor_type: 'student',
        event_domain: 'shared_record',
        event_type: 'shared_record_image_insert',
        stage_id: currentStage || undefined,
        payload: {
          document_id: documentId,
          resource_id: resource.id,
          filename: file.name,
          mime_type: file.type,
          file_size: file.size,
        },
      })

      setToastMessage('图片已插入文档')
      setShowToast(true)
    } catch (error) {
      console.error('Failed to insert image into document:', error)
      setToastMessage('图片插入失败')
      setShowToast(true)
    } finally {
      setIsImageUploading(false)
      if (imageInputRef.current) imageInputRef.current.value = ''
    }
  }, [currentStage, documentId, experimentVersionId, projectId])

  const handleOpenImagePicker = useCallback(() => {
    imageInputRef.current?.click()
  }, [])

  const handleImageInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    void handleInsertImageFile(file)
  }, [handleInsertImageFile])

  // Load document list when sidebar opens
  useEffect(() => {
    if (showDocumentList && projectId) {
      const loadDocuments = async () => {
        setIsListLoading(true)
        try {
          const res = await documentService.getDocuments(projectId)
          setDocuments(res.documents)
        } catch (error) {
          console.error('Failed to load documents:', error)
        } finally {
          setIsListLoading(false)
        }
      }
      loadDocuments()
    }
  }, [showDocumentList, projectId])

  // Load document metadata
  useEffect(() => {
    const loadDocument = async () => {
      if (documentId) {
        try {
          const doc = await documentService.getDocument(documentId)
          setDocument(doc)
        } catch (error) {
          console.error('Failed to load document:', error)
        } finally {
          setIsLoading(false)
          trackingService.track({
            module: 'document',
            action: 'document_open',
            metadata: { documentId, projectId }
          })
          if (projectId && documentId) {
            trackingService.trackResearchEvent({
              project_id: projectId,
              experiment_version_id: experimentVersionId,
              actor_type: 'student',
              event_domain: 'shared_record',
              event_type: 'shared_record_open',
              stage_id: currentStage || undefined,
              payload: {
                document_id: documentId,
              }
            })
          }
        }
      } else {
        setIsLoading(false)
      }
    }

    loadDocument()
  }, [documentId, projectId])

  const { provider, ydoc } = useDocumentSync({
    documentId: documentId || document?.id || '',
  })

  const isConnected = !!provider

  const extensions = useMemo(() => {
    return [
      StarterKit.configure({
        history: false,
        codeBlock: false,
      } as any),
      CodeBlock.configure({
        languageClassPrefix: 'language-',
      }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({
        multicolor: true,
      }),
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Table.configure({
        resizable: true,
        HTMLAttributes: {
          class: 'w-full border-collapse table-fixed',
        },
      }),
      TableRow,
      TableHeader.configure({
        HTMLAttributes: {
          class: 'border border-slate-300 bg-slate-50 px-3 py-2 text-left font-semibold align-top',
        },
      }),
      TableCell.configure({
        HTMLAttributes: {
          class: 'border border-slate-300 px-3 py-2 align-top',
        },
      }),
      Image.configure({
        HTMLAttributes: {
          class: 'max-w-full h-auto rounded-lg border border-slate-200 shadow-sm my-4',
        },
      }),
      Placeholder.configure({
        placeholder: '提出问题或开始写作...',
      }),
      ...(ydoc ? [Collaboration.configure({
        document: ydoc,
      })] : []),
      Annotation,
    ]
  }, [ydoc])

  const setContextDocumentContent = useContextStore(state => state.setDocumentContent)

  const handleTitleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value
    if (!document) return

    // 1. Update local state immediately for UI responsiveness
    setDocument({ ...document, title: newTitle })

    // 2. Sync to sidebar list if open
    setDocuments(prev => prev.map(d => d.id === document.id ? { ...d, title: newTitle } : d))

    // 3. Debounce sync to backend would be better, but for now simple sync
    try {
      await documentService.updateDocument(document.id, newTitle)
      if (projectId) {
        trackingService.trackResearchEvent({
          project_id: projectId,
          experiment_version_id: experimentVersionId,
          actor_type: 'student',
          event_domain: 'shared_record',
          event_type: 'shared_record_title_update',
          stage_id: currentStage || undefined,
          payload: {
            document_id: document.id,
            title_length: newTitle.length,
          }
        })
      }
    } catch (error) {
      console.error('Failed to update title:', error)
    }
  }

  const editor = useEditor({
    extensions,
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-[900px] mx-auto min-h-full p-4 focus:outline-none prose-img:my-4 prose-img:rounded-lg prose-table:my-4 prose-table:w-full prose-table:border-collapse prose-th:border prose-th:border-slate-300 prose-th:bg-slate-50 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-td:border prose-td:border-slate-300 prose-td:px-3 prose-td:py-2',
      },
      handlePaste: (_view, event) => {
        const items = Array.from(event.clipboardData?.items || [])
        const imageItem = items.find((item) => item.type.startsWith('image/'))
        const imageFile = imageItem?.getAsFile()
        if (!imageFile) return false

        void handleInsertImageFile(imageFile, editorRef.current)
        return true
      },
      handleDrop: (_view, event, _slice, moved) => {
        if (moved) return false
        const files = Array.from(event.dataTransfer?.files || [])
        const imageFile = files.find((file) => file.type.startsWith('image/'))
        if (!imageFile) return false

        void handleInsertImageFile(imageFile, editorRef.current)
        return true
      },
    },
    onUpdate: ({ editor }) => {
      setContextDocumentContent(editor.getText())
    },
    onBlur: ({ editor }) => {
      if (!projectId || !documentId) return
      const currentText = editor.getText()
      if (currentText === lastCommittedTextRef.current) return

      trackingService.trackResearchEvent({
        project_id: projectId,
        experiment_version_id: experimentVersionId,
        actor_type: 'student',
        event_domain: 'shared_record',
        event_type: 'shared_record_content_commit',
        stage_id: currentStage || undefined,
        payload: {
          document_id: documentId,
          content_length: currentText.length,
          previous_content_length: lastCommittedTextRef.current.length,
          commit_basis: 'editor_blur',
        }
      })
      lastCommittedTextRef.current = currentText
    }
  }, [extensions, handleInsertImageFile])

  useEffect(() => {
    editorRef.current = editor
    return () => {
      editorRef.current = null
    }
  }, [editor])

  useEffect(() => {
    if (!editor) return
    lastCommittedTextRef.current = editor.getText()
  }, [editor, documentId])

  const handleSaveToScrapbook = useCallback(async () => {
    if (!editor || !projectId) return
    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to, ' ')

    if (!selectedText.trim()) {
      setToastMessage('请先选中一些文字')
      setShowToast(true)
      return
    }

    try {
      await addMaterial(
        selectedText,
        `引自文档: ${document?.title || '未命名文件'}`,
        window.location.href
      )
      if (projectId && document?.id) {
        trackingService.trackResearchEvent({
          project_id: projectId,
          experiment_version_id: experimentVersionId,
          actor_type: 'student',
          event_domain: 'shared_record',
          event_type: 'shared_record_extract_to_scrapbook',
          payload: {
            document_id: document.id,
            selection_length: selectedText.length,
          }
        })
      }
      setToastMessage('已存入灵感池')
      setShowToast(true)
    } catch (e) {
      setToastMessage('保存失败')
      setShowToast(true)
    }
  }, [editor, projectId, document, addMaterial])

  const handleAddSelectionToWiki = useCallback(async () => {
    if (!editor || !projectId || !document) return
    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to, ' ')

    if (!selectedText.trim()) {
      setToastMessage('请先选中要沉淀到 Wiki 的文字')
      setShowToast(true)
      return
    }

    try {
      await wikiService.createItem({
        project_id: projectId,
        item_type: 'note',
        title: `文档摘录：${document.title || '未命名文档'}`,
        content: selectedText.trim(),
        summary: selectedText.trim().slice(0, 300),
        source_type: 'document',
        source_id: document.id,
        stage_id: currentStage || undefined,
        confidence_level: 'working',
      })

      trackingService.trackResearchEvent({
        project_id: projectId,
        experiment_version_id: experimentVersionId,
        actor_type: 'student',
        event_domain: 'wiki',
        event_type: 'wiki_item_quoted',
        stage_id: currentStage || undefined,
        payload: {
          document_id: document.id,
          selection_length: selectedText.length,
          source_type: 'document_selection',
        },
      })

      setToastMessage('已加入项目 Wiki')
      setShowToast(true)
    } catch (error) {
      console.error('Failed to add selection to wiki:', error)
      setToastMessage('加入 Wiki 失败')
      setShowToast(true)
    }
  }, [currentStage, document, editor, experimentVersionId, projectId])

  const handleSave = useCallback(async () => {
    if (!documentId || !editor) return
    try {
      // 1. Sync HTML to database
      await documentService.updateDocument(documentId, undefined, editor.getHTML())

      // 2. Force snapshot Yjs to backend
      if (ydoc) {
        const update = Y.encodeStateAsUpdate(ydoc)
        await documentService.saveSnapshot(documentId, update)
      }

      if (projectId) {
        trackingService.trackResearchEvent({
          project_id: projectId,
          experiment_version_id: experimentVersionId,
          actor_type: 'student',
          event_domain: 'shared_record',
          event_type: 'shared_record_save',
          stage_id: currentStage || undefined,
          payload: {
            document_id: documentId,
            content_length: editor.getText().length,
          }
        })
      }

      setToastMessage('文档已保存')
      setShowToast(true)
    } catch (error) {
      console.error('Failed to save document:', error)
      setToastMessage('保存失败')
      setShowToast(true)
    }
  }, [documentId, editor, ydoc])

  const handleCreateNewDocument = async () => {
    if (!projectId || !onDocumentChange) return
    setIsCreating(true)
    try {
      const newDoc = await documentService.createDocument(projectId, '新文档', '')
      trackingService.trackResearchEvent({
        project_id: projectId,
        experiment_version_id: experimentVersionId,
        actor_type: 'student',
        event_domain: 'shared_record',
        event_type: 'shared_record_create',
        payload: {
          document_id: newDoc.id,
          title: newDoc.title,
        }
      })
      onDocumentChange(newDoc.id)
      setShowDocumentList(false)
      setToastMessage('新文档已创建')
      setShowToast(true)
    } catch (error) {
      console.error('Failed to create document:', error)
      setToastMessage('创建失败')
      setShowToast(true)
    } finally {
      setIsCreating(false)
    }
  }

  const handleSelectDocument = (id: string) => {
    if (projectId) {
      trackingService.trackResearchEvent({
        project_id: projectId,
        experiment_version_id: experimentVersionId,
        actor_type: 'student',
        event_domain: 'shared_record',
        event_type: 'shared_record_switch',
        payload: {
          from_document_id: documentId,
          to_document_id: id,
        }
      })
    }
    if (onDocumentChange) {
      onDocumentChange(id)
      setShowDocumentList(false)
    }
  }

  const handleDeleteDocument = (id: string) => {
    setDeleteConfirmId(id)
  }

  const confirmDelete = async () => {
    if (!deleteConfirmId) return
    setIsDeleting(true)
    try {
      await documentService.deleteDocument(deleteConfirmId)
      if (projectId) {
        trackingService.trackResearchEvent({
          project_id: projectId,
          experiment_version_id: experimentVersionId,
          actor_type: 'student',
          event_domain: 'shared_record',
          event_type: 'shared_record_delete',
          payload: {
            document_id: deleteConfirmId,
          }
        })
      }
      setDocuments(prev => prev.filter(d => d.id !== deleteConfirmId))
      setToastMessage('文档已删除')
      setShowToast(true)

      // If current document is deleted, switch to another
      if (deleteConfirmId === documentId && onDocumentChange) {
        const remaining = orderedDocuments.filter(d => d.id !== deleteConfirmId)
        if (remaining.length > 0) {
          onDocumentChange(remaining[0].id)
        } else {
          handleCreateNewDocument()
        }
      }
      setDeleteConfirmId(null)
    } catch (error) {
      console.error('Failed to delete document:', error)
      setToastMessage('删除失败')
      setShowToast(true)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleCreateAnnotation = useCallback((content: string) => {
    if (!editor || !user) return
    const annotationId = `ann-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const annotationData: AnnotationAttributes = {
      id: annotationId,
      content,
      author: user.username || user.email,
      authorId: user.id,
      timestamp: new Date().toISOString(),
      resolved: false,
    }
      ; (editor.chain().focus() as any).setAnnotation(annotationData).run()
    if (projectId && document?.id) {
      trackingService.trackResearchEvent({
        project_id: projectId,
        experiment_version_id: experimentVersionId,
        actor_type: 'student',
        event_domain: 'shared_record',
        event_type: 'shared_record_annotation_create',
        payload: {
          document_id: document.id,
          annotation_id: annotationId,
          annotation_length: content.length,
        }
      })
    }
    setShowAnnotationInput(false)
  }, [document?.id, editor, experimentVersionId, projectId, user])

  const handleEditAnnotation = useCallback((content: string) => {
    if (!editor || !activeAnnotation) return
    const updatedAnnotation = { ...activeAnnotation, content }
      ; (editor.chain().focus() as any).extendMarkRange('annotation', { id: activeAnnotation.id }).setAnnotation(updatedAnnotation).run()
    if (projectId && document?.id) {
      trackingService.trackResearchEvent({
        project_id: projectId,
        experiment_version_id: experimentVersionId,
        actor_type: 'student',
        event_domain: 'shared_record',
        event_type: 'shared_record_annotation_edit',
        payload: {
          document_id: document.id,
          annotation_id: activeAnnotation.id,
          annotation_length: content.length,
          previous_annotation_length: activeAnnotation.content.length,
        }
      })
    }
    setActiveAnnotation(updatedAnnotation)
  }, [activeAnnotation, document?.id, editor, experimentVersionId, projectId])

  const handleResolveAnnotation = useCallback(() => {
    if (!editor || !activeAnnotation) return
    const resolvedAnnotation = { ...activeAnnotation, resolved: true }
      ; (editor.chain().focus() as any).extendMarkRange('annotation', { id: activeAnnotation.id }).setAnnotation(resolvedAnnotation).run()
    if (projectId && document?.id) {
      trackingService.trackResearchEvent({
        project_id: projectId,
        experiment_version_id: experimentVersionId,
        actor_type: 'student',
        event_domain: 'shared_record',
        event_type: 'shared_record_annotation_resolve',
        payload: {
          document_id: document.id,
          annotation_id: activeAnnotation.id,
        }
      })
    }
    setShowAnnotationPopup(false)
  }, [activeAnnotation, document?.id, editor, experimentVersionId, projectId])

  const handleDeleteAnnotation = useCallback(() => {
    if (!editor || !activeAnnotation) return
      ; (editor.chain().focus() as any).extendMarkRange('annotation', { id: activeAnnotation.id }).unsetAnnotation().run()
    if (projectId && document?.id) {
      trackingService.trackResearchEvent({
        project_id: projectId,
        experiment_version_id: experimentVersionId,
        actor_type: 'student',
        event_domain: 'shared_record',
        event_type: 'shared_record_annotation_delete',
        payload: {
          document_id: document.id,
          annotation_id: activeAnnotation.id,
        }
      })
    }
    setShowAnnotationPopup(false)
  }, [activeAnnotation, document?.id, editor, experimentVersionId, projectId])

  const handleAddReply = useCallback((content: string) => {
    if (!editor || !activeAnnotation || !user) return
    const newReply = {
      id: `reply-${Date.now()}`,
      content,
      author: user.username || user.email,
      authorId: user.id,
      timestamp: new Date().toISOString(),
    }
    const updatedAnnotation = {
      ...activeAnnotation,
      replies: [...(activeAnnotation.replies || []), newReply],
    }
      ; (editor.chain().focus() as any).extendMarkRange('annotation', { id: activeAnnotation.id }).setAnnotation(updatedAnnotation).run()
    if (projectId && document?.id) {
      trackingService.trackResearchEvent({
        project_id: projectId,
        experiment_version_id: experimentVersionId,
        actor_type: 'student',
        event_domain: 'shared_record',
        event_type: 'shared_record_annotation_reply',
        payload: {
          document_id: document.id,
          annotation_id: activeAnnotation.id,
          reply_id: newReply.id,
          reply_length: content.length,
        }
      })
    }
    setActiveAnnotation(updatedAnnotation)
  }, [activeAnnotation, document?.id, editor, experimentVersionId, projectId, user])

  const handleOpenAnnotationInput = useCallback(() => {
    if (!editor) return
    const { from } = editor.state.selection
    const coords = editor.view.coordsAtPos(from)
    setAnnotationInputPosition({
      top: coords.bottom + window.scrollY + 8,
      left: coords.left + window.scrollX,
    })
    setShowAnnotationInput(true)
  }, [editor])

  useEffect(() => {
    if (!editor) return
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      const annotationMark = target.closest('.annotation-mark')
      if (annotationMark) {
        const annotationId = annotationMark.getAttribute('data-annotation-id')
        const content = annotationMark.getAttribute('data-annotation-content')
        if (annotationId && content) {
          setActiveAnnotation({
            id: annotationId,
            content,
            author: annotationMark.getAttribute('data-annotation-author') || '',
            authorId: annotationMark.getAttribute('data-annotation-author-id') || '',
            timestamp: annotationMark.getAttribute('data-annotation-timestamp') || '',
            resolved: annotationMark.getAttribute('data-annotation-resolved') === 'true',
          })
          const rect = annotationMark.getBoundingClientRect()
          setAnnotationInputPosition({ top: rect.bottom + window.scrollY + 8, left: rect.left + window.scrollX })
          setShowAnnotationPopup(true)
        }
      }
    }
    editor.view.dom.addEventListener('click', handleClick)
    return () => editor.view.dom.removeEventListener('click', handleClick)
  }, [editor])

  if (isLoading || !document) return <div className="flex items-center justify-center h-full text-gray-400">Loading...</div>

  return (
    <div className="flex h-full relative overflow-hidden">
      {/* History Sidebar */}
      {showDocumentList && (
        <div className="w-64 border-r bg-gray-50/50 flex flex-col shrink-0 animate-in slide-in-from-left duration-300">
          <div className="p-4 border-b bg-white flex items-center justify-between">
            <h3 className="font-semibold text-sm text-gray-700">小组文档</h3>
            <div className="flex items-center gap-1">
              <button
                onClick={handleCreateNewDocument}
                disabled={isCreating}
                className="p-1 hover:bg-gray-100 rounded text-indigo-600 transition-colors disabled:opacity-50"
                title="新建文档"
              >
                {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setShowDocumentList(false)}
                className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-gray-600 transition-colors"
                title="关闭侧边栏"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {isListLoading ? (
              <div className="flex flex-col items-center py-12 text-gray-400 gap-2">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span className="text-xs">加载中...</span>
              </div>
            ) : orderedDocuments.length === 0 ? (
              <div className="text-center py-12 text-gray-400 text-xs text-pretty italic">
                暂无文档，点击上方 + 号新建
              </div>
            ) : (
              orderedDocuments.map((doc) => {
                const isProjectDescription = doc.id === initialTaskDocumentId
                return (
                <div
                  key={doc.id}
                  onClick={() => handleSelectDocument(doc.id)}
                  className={`w-full flex flex-col items-start p-2.5 rounded-lg border text-left transition-all group cursor-pointer ${doc.id === documentId
                    ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-sm ring-1 ring-indigo-100'
                    : 'bg-white border-transparent hover:border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2 truncate flex-1 min-w-0">
                      <FileText className={`w-3.5 h-3.5 shrink-0 ${doc.id === documentId ? 'text-indigo-600' : 'text-gray-400 group-hover:text-gray-500'}`} />
                      <span className="truncate text-sm font-medium">{doc.title || '未命名文档'}</span>
                      {isProjectDescription ? (
                        <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600 border border-indigo-100">
                          项目说明
                        </span>
                      ) : null}
                    </div>
                    {isProjectDescription ? null : (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteDocument(doc.id)
                        }}
                        className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-50 text-gray-400 hover:text-red-500 rounded transition-all"
                        title="删除文档"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className="mt-1 pl-5.5 flex items-center justify-between w-full opacity-60 text-[10px]">
                    <span>{new Date(doc.updated_at).toLocaleDateString()}</span>
                  </div>
                </div>
              )})
            )}
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        {editor && (
          <EditorToolbar
            editor={editor}
            isConnected={isConnected}
            onAnnotationClick={handleOpenAnnotationInput}
            onInsertImageClick={handleOpenImagePicker}
            onSaveToScrapbook={handleSaveToScrapbook}
            onSave={handleSave}
            onHistoryClick={() => setShowDocumentList(!showDocumentList)}
            isImageUploading={isImageUploading}
          />
        )}
        <div className="flex-1 overflow-auto bg-white flex flex-col items-center">
          {/* Document Title Input - Ultra-Compact Styling */}
          <div className="w-full bg-slate-50/50 border-b border-slate-100/50 flex justify-center">
            <div className="w-full max-w-[900px] px-8 py-2">
              <div className="flex items-center gap-2">
                <div className="p-1 bg-indigo-100 rounded">
                  <FileText className="w-4 h-4 text-indigo-600" />
                </div>
                <input
                  type="text"
                  value={document?.title || ''}
                  onChange={handleTitleChange}
                  placeholder="未命名文档"
                  className="w-full text-lg font-bold border-none focus:outline-none focus:ring-0 placeholder:text-slate-300 text-indigo-950 bg-transparent tracking-tight leading-none"
                />
                {document?.id === initialTaskDocumentId ? (
                  <span className="shrink-0 rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-600 border border-indigo-100">
                    项目说明
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={handleAddSelectionToWiki}
                  className="shrink-0 rounded-full border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100"
                  title="将当前选中文字沉淀到项目 Wiki"
                >
                  加入 Wiki
                </button>
              </div>
            </div>
          </div>

          <div className="w-full max-w-[900px] px-8 overflow-x-auto">
            <EditorContent editor={editor} />
          </div>
        </div>
        <RemoteCursors users={remoteUsers} />
      </div>

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageInputChange}
      />

      {showAnnotationInput && (
        <AnnotationInput
          onSubmit={handleCreateAnnotation}
          onCancel={() => setShowAnnotationInput(false)}
          position={annotationInputPosition}
        />
      )}

      {showAnnotationPopup && activeAnnotation && (
        <AnnotationPopup
          annotation={activeAnnotation}
          onResolve={handleResolveAnnotation}
          onEdit={handleEditAnnotation}
          onDelete={handleDeleteAnnotation}
          onAddReply={handleAddReply}
          onClose={() => setShowAnnotationPopup(false)}
          position={annotationInputPosition}
        />
      )}

      {showToast && (
        <Toast message={toastMessage} onClose={() => setShowToast(false)} />
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <div className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              <DialogTitle>删除文档</DialogTitle>
            </div>
          </DialogHeader>
          <div className="py-2 text-sm text-gray-500">
            确定要删除这个文档吗？此操作将永久移除该文档，不可撤销。
          </div>
          <DialogFooter className="flex gap-2 sm:justify-end mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteConfirmId(null)}
              disabled={isDeleting}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={confirmDelete}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isDeleting ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
              确定删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
