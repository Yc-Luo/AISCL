import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
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
import {
  Bold,
  Heading2,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  Plus,
  Redo,
  Rows3,
  Table2,
  Trash2,
  Underline as UnderlineIcon,
  Undo,
} from 'lucide-react'

const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024

type TaskBriefEditorProps = {
  value: string
  onChange: (html: string, text: string) => void
}

const extensions = [
  StarterKit.configure({
    codeBlock: false,
  }),
  Underline,
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Image.configure({
    inline: false,
    allowBase64: true,
    HTMLAttributes: {
      class: 'rounded-lg border border-slate-100',
    },
  }),
  Table.configure({
    resizable: true,
  }),
  TableRow,
  TableHeader,
  TableCell,
  Placeholder.configure({
    placeholder: '在这里完整编写项目说明，可包含任务背景、核心问题、协作要求、提交成果、评价要点，也可以插入表格和图片。',
  }),
]

export default function TaskBriefEditor({ value, onChange }: TaskBriefEditorProps) {
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [errorMessage, setErrorMessage] = useState('')

  const insertImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return
    if (file.size > MAX_INLINE_IMAGE_BYTES) {
      setErrorMessage('图片过大，请先压缩到 2MB 以内再插入任务说明。')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const src = String(reader.result || '')
      if (!src) return
      editor?.chain().focus().setImage({ src, alt: file.name }).run()
      setErrorMessage('')
    }
    reader.readAsDataURL(file)
  }

  const editor = useEditor({
    extensions,
    content: value || '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none min-h-[360px] p-5 focus:outline-none prose-headings:text-slate-900 prose-p:leading-7 prose-img:my-4 prose-img:max-h-[420px] prose-img:object-contain prose-table:my-4 prose-table:w-full prose-table:border-collapse prose-th:border prose-th:border-slate-300 prose-th:bg-slate-50 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-td:border prose-td:border-slate-300 prose-td:px-3 prose-td:py-2',
      },
      handlePaste: (_view, event) => {
        const imageFile = Array.from(event.clipboardData?.items || [])
          .find((item) => item.type.startsWith('image/'))
          ?.getAsFile()
        if (!imageFile) return false
        void insertImageFile(imageFile)
        return true
      },
      handleDrop: (_view, event, _slice, moved) => {
        if (moved) return false
        const imageFile = Array.from(event.dataTransfer?.files || []).find((file) => file.type.startsWith('image/'))
        if (!imageFile) return false
        void insertImageFile(imageFile)
        return true
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML(), editor.getText().trim())
    },
  })

  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    if (!value && current !== '<p></p>') {
      editor.commands.clearContent()
      return
    }
    if (value && value !== current) {
      editor.commands.setContent(value)
    }
  }, [editor, value])

  if (!editor) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
        正在加载项目说明编辑器...
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-100 bg-slate-50/80 p-2">
        <ToolButton label="撤销" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
          <Undo className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="重做" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
          <Redo className="h-4 w-4" />
        </ToolButton>
        <Divider />
        <ToolButton label="小标题" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="加粗" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="斜体" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="下划线" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon className="h-4 w-4" />
        </ToolButton>
        <Divider />
        <ToolButton label="项目列表" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="编号列表" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered className="h-4 w-4" />
        </ToolButton>
        <Divider />
        <ToolButton label="插入表格" onClick={() => (editor.chain().focus() as any).insertTable({ rows: 4, cols: 3, withHeaderRow: true }).run()}>
          <Table2 className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="添加行" disabled={!editor.isActive('table')} onClick={() => (editor.chain().focus() as any).addRowAfter().run()}>
          <Rows3 className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="添加列" disabled={!editor.isActive('table')} onClick={() => (editor.chain().focus() as any).addColumnAfter().run()}>
          <Plus className="h-4 w-4" />
        </ToolButton>
        <ToolButton label="删除表格" disabled={!editor.isActive('table')} onClick={() => (editor.chain().focus() as any).deleteTable().run()}>
          <Trash2 className="h-4 w-4" />
        </ToolButton>
        <Divider />
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void insertImageFile(file)
            event.target.value = ''
          }}
        />
        <ToolButton label="插入图片" onClick={() => imageInputRef.current?.click()}>
          <ImagePlus className="h-4 w-4" />
        </ToolButton>
      </div>
      <EditorContent editor={editor} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 bg-slate-50/70 px-4 py-2 text-xs text-slate-500">
        <span>支持粘贴图片、拖入图片、插入表格。建议把任务要求写成一份完整说明，而不是拆成多个小项。</span>
        {errorMessage && <span className="font-semibold text-rose-600">{errorMessage}</span>}
      </div>
    </div>
  )
}

function ToolButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-xl transition ${
        active ? 'bg-indigo-100 text-indigo-700' : 'text-slate-600 hover:bg-white hover:text-indigo-700'
      } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <span className="mx-1 h-6 w-px bg-slate-200" />
}
