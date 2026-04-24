import { Editor } from '@tiptap/react'
import {
    Bold,
    Italic,
    Underline as UnderlineIcon,
    Strikethrough,
    Heading1,
    Heading2,
    Heading3,
    List,
    ListOrdered,
    AlignLeft,
    AlignCenter,
    AlignRight,
    AlignJustify,
    Highlighter,
    Undo,
    Redo,
    ChevronDown,
    MessageSquare,
    Lightbulb,
    Save,
    Menu,
    ImagePlus,
    Table2,
    Rows3,
    Columns3,
    Trash2,
    Loader2
} from 'lucide-react'
import { useEffect, useState } from 'react'

interface EditorToolbarProps {
    editor: Editor
    isConnected?: boolean
    onAnnotationClick?: () => void
    onInsertImageClick?: () => void
    onSaveToScrapbook?: () => void
    onSave?: () => void
    onHistoryClick?: () => void
    isImageUploading?: boolean
}

export default function EditorToolbar({
    editor,
    isConnected,
    onAnnotationClick,
    onInsertImageClick,
    onSaveToScrapbook,
    onSave,
    onHistoryClick,
    isImageUploading,
}: EditorToolbarProps) {
    const [showHeadingMenu, setShowHeadingMenu] = useState(false)
    const [showAlignMenu, setShowAlignMenu] = useState(false)
    const [showColorPicker, setShowColorPicker] = useState(false)
    const [showBgColorPicker, setShowBgColorPicker] = useState(false)
    const [showTableMenu, setShowTableMenu] = useState(false)
    const [, setToolbarVersion] = useState(0)

    useEffect(() => {
        const refreshToolbar = () => setToolbarVersion(version => version + 1)

        editor.on('selectionUpdate', refreshToolbar)
        editor.on('transaction', refreshToolbar)
        editor.on('update', refreshToolbar)

        return () => {
            editor.off('selectionUpdate', refreshToolbar)
            editor.off('transaction', refreshToolbar)
            editor.off('update', refreshToolbar)
        }
    }, [editor])


    const colors = [
        '#000000', '#ef4444', '#f97316', '#f59e0b', '#84cc16',
        '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899'
    ]

    return (
        <div className="border-b bg-white sticky top-0 z-10">
            <div className="flex items-center gap-1 p-2 flex-wrap justify-between">
                {/* Left side - formatting tools */}
                <div className="flex items-center gap-1 flex-wrap">
                    {/* File Management */}
                    <div className="flex items-center gap-1 pr-2 border-r">
                        {onHistoryClick && (
                            <ToolbarButton
                                onClick={onHistoryClick}
                                title="文档列表 (新建/查看)"
                            >
                                <Menu className="w-4 h-4 text-indigo-600" />
                            </ToolbarButton>
                        )}
                        {onSave && (
                            <ToolbarButton
                                onClick={onSave}
                                title="保存当前文档"
                            >
                                <Save className="w-4 h-4 text-indigo-600" />
                            </ToolbarButton>
                        )}
                    </div>

                    {/* Undo/Redo */}
                    <div className="flex items-center gap-1 pr-2 border-r">
                        <ToolbarButton
                            onClick={() => editor.chain().focus().undo().run()}
                            disabled={!editor.can().undo()}
                            title="Undo"
                        >
                            <Undo className="w-4 h-4" />
                        </ToolbarButton>
                        <ToolbarButton
                            onClick={() => editor.chain().focus().redo().run()}
                            disabled={!editor.can().redo()}
                            title="Redo"
                        >
                            <Redo className="w-4 h-4" />
                        </ToolbarButton>
                    </div>

                    {/* Headings Dropdown */}
                    <div className="relative pr-2 border-r">
                        <ToolbarButton
                            onClick={() => setShowHeadingMenu(!showHeadingMenu)}
                            active={editor.isActive('heading')}
                            title="Headings"
                        >
                            {editor.isActive('heading', { level: 1 }) ? <Heading1 className="w-4 h-4" /> :
                                editor.isActive('heading', { level: 2 }) ? <Heading2 className="w-4 h-4" /> :
                                    editor.isActive('heading', { level: 3 }) ? <Heading3 className="w-4 h-4" /> :
                                        <Heading1 className="w-4 h-4" />}
                            <ChevronDown className="w-3 h-3 ml-1" />
                        </ToolbarButton>
                        {showHeadingMenu && (
                            <div className="absolute top-full left-0 mt-1 bg-white border rounded-lg shadow-lg py-1 min-w-[160px] z-20">
                                <DropdownItem
                                    onClick={() => { editor.chain().focus().setParagraph().run(); setShowHeadingMenu(false); }}
                                    active={editor.isActive('paragraph')}
                                >
                                    Paragraph
                                </DropdownItem>
                                <DropdownItem
                                    onClick={() => { editor.chain().focus().toggleHeading({ level: 1 }).run(); setShowHeadingMenu(false); }}
                                    active={editor.isActive('heading', { level: 1 })}
                                >
                                    <Heading1 className="w-4 h-4 mr-2" /> Heading 1
                                </DropdownItem>
                                <DropdownItem
                                    onClick={() => { editor.chain().focus().toggleHeading({ level: 2 }).run(); setShowHeadingMenu(false); }}
                                    active={editor.isActive('heading', { level: 2 })}
                                >
                                    <Heading2 className="w-4 h-4 mr-2" /> Heading 2
                                </DropdownItem>
                                <DropdownItem
                                    onClick={() => { editor.chain().focus().toggleHeading({ level: 3 }).run(); setShowHeadingMenu(false); }}
                                    active={editor.isActive('heading', { level: 3 })}
                                >
                                    <Heading3 className="w-4 h-4 mr-2" /> Heading 3
                                </DropdownItem>
                            </div>
                        )}
                    </div>

                    {/* Text Formatting */}
                    <div className="flex items-center gap-1 pr-2 border-r">
                        <ToolbarButton
                            onClick={() => editor.chain().focus().toggleBold().run()}
                            active={editor.isActive('bold')}
                            title="Bold (Ctrl+B)"
                            commandId="bold"
                        >
                            <Bold className="w-4 h-4" />
                        </ToolbarButton>
                        <ToolbarButton
                            onClick={() => editor.chain().focus().toggleItalic().run()}
                            active={editor.isActive('italic')}
                            title="Italic (Ctrl+I)"
                            commandId="italic"
                        >
                            <Italic className="w-4 h-4" />
                        </ToolbarButton>
                        <ToolbarButton
                            onClick={() => editor.chain().focus().toggleUnderline().run()}
                            active={editor.isActive('underline')}
                            title="Underline (Ctrl+U)"
                            commandId="underline"
                        >
                            <UnderlineIcon className="w-4 h-4" />
                        </ToolbarButton>
                        <ToolbarButton
                            onClick={() => editor.chain().focus().toggleStrike().run()}
                            active={editor.isActive('strike')}
                            title="Strikethrough"
                            commandId="strike"
                        >
                            <Strikethrough className="w-4 h-4" />
                        </ToolbarButton>
                    </div>

                    {/* Text Alignment */}
                    <div className="relative pr-2 border-r">
                        <ToolbarButton
                            onClick={() => setShowAlignMenu(!showAlignMenu)}
                            title="Text Alignment"
                        >
                            {editor.isActive({ textAlign: 'left' }) ? <AlignLeft className="w-4 h-4" /> :
                                editor.isActive({ textAlign: 'center' }) ? <AlignCenter className="w-4 h-4" /> :
                                    editor.isActive({ textAlign: 'right' }) ? <AlignRight className="w-4 h-4" /> :
                                        editor.isActive({ textAlign: 'justify' }) ? <AlignJustify className="w-4 h-4" /> :
                                            <AlignLeft className="w-4 h-4" />}
                            <ChevronDown className="w-3 h-3 ml-1" />
                        </ToolbarButton>
                        {showAlignMenu && (
                            <div className="absolute top-full left-0 mt-1 bg-white border rounded-lg shadow-lg py-1 min-w-[140px] z-20">
                                <DropdownItem
                                    onClick={() => { editor.chain().focus().setTextAlign('left').run(); setShowAlignMenu(false); }}
                                    active={editor.isActive({ textAlign: 'left' })}
                                >
                                    <AlignLeft className="w-4 h-4 mr-2" /> Left
                                </DropdownItem>
                                <DropdownItem
                                    onClick={() => { editor.chain().focus().setTextAlign('center').run(); setShowAlignMenu(false); }}
                                    active={editor.isActive({ textAlign: 'center' })}
                                >
                                    <AlignCenter className="w-4 h-4 mr-2" /> Center
                                </DropdownItem>
                                <DropdownItem
                                    onClick={() => { editor.chain().focus().setTextAlign('right').run(); setShowAlignMenu(false); }}
                                    active={editor.isActive({ textAlign: 'right' })}
                                >
                                    <AlignRight className="w-4 h-4 mr-2" /> Right
                                </DropdownItem>
                                <DropdownItem
                                    onClick={() => { editor.chain().focus().setTextAlign('justify').run(); setShowAlignMenu(false); }}
                                    active={editor.isActive({ textAlign: 'justify' })}
                                >
                                    <AlignJustify className="w-4 h-4 mr-2" /> Justify
                                </DropdownItem>
                            </div>
                        )}
                    </div>

                    {/* Lists */}
                    <div className="flex items-center gap-1 pr-2 border-r">
                        <ToolbarButton
                            onClick={() => editor.chain().focus().toggleBulletList().run()}
                            active={editor.isActive('bulletList')}
                            title="Bullet List"
                        >
                            <List className="w-4 h-4" />
                        </ToolbarButton>
                        <ToolbarButton
                            onClick={() => editor.chain().focus().toggleOrderedList().run()}
                            active={editor.isActive('orderedList')}
                            title="Numbered List"
                        >
                            <ListOrdered className="w-4 h-4" />
                        </ToolbarButton>
                    </div>

                    {/* Images */}
                    {onInsertImageClick && (
                        <div className="flex items-center gap-1 pr-2 border-r">
                            <ToolbarButton
                                onClick={onInsertImageClick}
                                title="插入图片"
                                disabled={isImageUploading}
                            >
                                {isImageUploading ? (
                                    <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                                ) : (
                                    <ImagePlus className="w-4 h-4 text-indigo-600" />
                                )}
                            </ToolbarButton>
                        </div>
                    )}

                    {/* Tables */}
                    <div className="relative pr-2 border-r">
                        <ToolbarButton
                            onClick={() => setShowTableMenu(!showTableMenu)}
                            active={editor.isActive('table')}
                            title="表格"
                        >
                            <Table2 className="w-4 h-4" />
                            <ChevronDown className="w-3 h-3 ml-1" />
                        </ToolbarButton>
                        {showTableMenu && (
                            <div className="absolute top-full left-0 mt-1 bg-white border rounded-lg shadow-lg py-1 min-w-[190px] z-20">
                                <DropdownItem
                                    onClick={() => {
                                        ; (editor.chain().focus() as any).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
                                        setShowTableMenu(false)
                                    }}
                                >
                                    <Table2 className="w-4 h-4 mr-2" /> 插入 3x3 表格
                                </DropdownItem>
                                <DropdownItem
                                    onClick={() => {
                                        ; (editor.chain().focus() as any).addRowAfter().run()
                                        setShowTableMenu(false)
                                    }}
                                    disabled={!editor.isActive('table')}
                                >
                                    <Rows3 className="w-4 h-4 mr-2" /> 在下方添加行
                                </DropdownItem>
                                <DropdownItem
                                    onClick={() => {
                                        ; (editor.chain().focus() as any).addColumnAfter().run()
                                        setShowTableMenu(false)
                                    }}
                                    disabled={!editor.isActive('table')}
                                >
                                    <Columns3 className="w-4 h-4 mr-2" /> 在右侧添加列
                                </DropdownItem>
                                <DropdownItem
                                    onClick={() => {
                                        ; (editor.chain().focus() as any).deleteRow().run()
                                        setShowTableMenu(false)
                                    }}
                                    disabled={!editor.isActive('table')}
                                >
                                    <Rows3 className="w-4 h-4 mr-2" /> 删除当前行
                                </DropdownItem>
                                <DropdownItem
                                    onClick={() => {
                                        ; (editor.chain().focus() as any).deleteColumn().run()
                                        setShowTableMenu(false)
                                    }}
                                    disabled={!editor.isActive('table')}
                                >
                                    <Columns3 className="w-4 h-4 mr-2" /> 删除当前列
                                </DropdownItem>
                                <DropdownItem
                                    onClick={() => {
                                        ; (editor.chain().focus() as any).deleteTable().run()
                                        setShowTableMenu(false)
                                    }}
                                    disabled={!editor.isActive('table')}
                                >
                                    <Trash2 className="w-4 h-4 mr-2" /> 删除表格
                                </DropdownItem>
                            </div>
                        )}
                    </div>



                    {/* Text Color Picker */}
                    <div className="relative border-r pr-1">
                        <ToolbarButton
                            onClick={() => {
                                setShowColorPicker(!showColorPicker)
                                setShowBgColorPicker(false)
                            }}
                            active={showColorPicker}
                            title="Text Color"
                        >
                            <div className="flex flex-col items-center">
                                <span className="text-sm font-bold leading-none">A</span>
                                <div className="w-4 h-0.5 mt-0.5 bg-black" />
                            </div>
                        </ToolbarButton>
                        {showColorPicker && (
                            <div className="absolute top-full left-0 mt-1 bg-white border rounded-lg shadow-lg p-3 z-20 min-w-[180px]">
                                <div className="grid grid-cols-5 gap-2">
                                    {colors.map((color) => (
                                        <button
                                            key={color}
                                            className="w-6 h-6 rounded border border-gray-300 hover:scale-110 transition-transform"
                                            style={{ backgroundColor: color }}
                                            onClick={() => {
                                                editor.chain().focus().setColor(color).run()
                                                setShowColorPicker(false)
                                            }}
                                            title={color}
                                        />
                                    ))}
                                </div>
                                <button
                                    className="w-full mt-2 px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
                                    onClick={() => {
                                        editor.chain().focus().unsetColor().run()
                                        setShowColorPicker(false)
                                    }}
                                >
                                    Clear Color
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Background Color Picker (Highlighter) */}
                    <div className="relative pr-2 border-r">
                        <ToolbarButton
                            onClick={() => {
                                setShowBgColorPicker(!showBgColorPicker)
                                setShowColorPicker(false)
                            }}
                            active={showBgColorPicker}
                            title="Background Color"
                        >
                            <Highlighter className="w-4 h-4" />
                        </ToolbarButton>
                        {showBgColorPicker && (
                            <div className="absolute top-full left-0 mt-1 bg-white border rounded-lg shadow-lg p-3 z-20 min-w-[180px]">
                                <div className="grid grid-cols-5 gap-2">
                                    {colors.map((color) => (
                                        <button
                                            key={color}
                                            className="w-6 h-6 rounded border border-gray-300 hover:scale-110 transition-transform"
                                            style={{ backgroundColor: color }}
                                            onClick={() => {
                                                editor.chain().focus().setHighlight({ color }).run()
                                                setShowBgColorPicker(false)
                                            }}
                                            title={color}
                                        />
                                    ))}
                                </div>
                                <button
                                    className="w-full mt-2 px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
                                    onClick={() => {
                                        editor.chain().focus().unsetHighlight().run()
                                        setShowBgColorPicker(false)
                                    }}
                                >
                                    Clear Background
                                </button>
                            </div>
                        )}
                    </div>



                    {/* Annotation Button */}
                    {onAnnotationClick && (
                        <ToolbarButton
                            onClick={onAnnotationClick}
                            active={editor.isActive('annotation')}
                            title="添加批注"
                        >
                            <MessageSquare className="w-4 h-4" />
                        </ToolbarButton>
                    )}

                    {/* Save to Scrapbook Button */}
                    {onSaveToScrapbook && (
                        <ToolbarButton
                            onClick={onSaveToScrapbook}
                            title="Save selection to Scrapbook"
                        >
                            <Lightbulb className="w-4 h-4 text-amber-500" />
                        </ToolbarButton>
                    )}
                </div>

                {/* Right side - connection status */}
                <div className="flex items-center gap-3 ml-auto">
                    {isConnected !== undefined && (
                        <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                            <span className="text-xs text-gray-500">
                                {isConnected ? 'Connected' : 'Disconnected'}
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

// Toolbar Button Component
function ToolbarButton({
    onClick,
    active = false,
    disabled = false,
    title,
    commandId,
    children,
}: {
    onClick: () => void
    active?: boolean
    disabled?: boolean
    title?: string
    commandId?: string
    children: React.ReactNode
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            title={title}
            data-toolbar-command={commandId}
            aria-pressed={active}
            className={`
        p-2 rounded transition-colors flex items-center justify-center
        ${active ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-gray-100 text-gray-700'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
        >
            {children}
        </button>
    )
}

// Dropdown Item Component
function DropdownItem({
    onClick,
    active = false,
    disabled = false,
    children,
}: {
    onClick: () => void
    active?: boolean
    disabled?: boolean
    children: React.ReactNode
}) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`
        w-full px-3 py-2 text-left text-sm flex items-center transition-colors
        ${active ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-gray-50 text-gray-700'}
        ${disabled ? 'opacity-50 cursor-not-allowed hover:bg-white' : ''}
      `}
        >
            {children}
        </button>
    )
}
