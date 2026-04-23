import { useEffect, useRef, useState } from 'react'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import CodeBlock from '@tiptap/extension-code-block'
import { Collaboration } from '@tiptap/extension-collaboration'
import { CollaborationCursor } from '@tiptap/extension-collaboration-cursor'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { config } from '../../config/env'
import { useAuthStore } from '../../stores/authStore'

interface UseYjsProseMirrorOptions {
  documentId: string
  projectId: string
  initialContent?: string
  onUpdate?: (content: string) => void
}

interface RemoteUser {
  name: string
  color: string
}

export function useYjsProseMirror({
  documentId,
  initialContent,
  onUpdate,
}: UseYjsProseMirrorOptions) {
  const { user, tokens } = useAuthStore()
  const [isConnected, setIsConnected] = useState(false)
  const [remoteUsers, setRemoteUsers] = useState<RemoteUser[]>([])
  const ydocRef = useRef<Y.Doc | null>(null)
  const providerRef = useRef<WebsocketProvider | null>(null)
  const undoManagerRef = useRef<Y.UndoManager | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // history is disabled by default when using Collaboration, use Y.js UndoManager
      }),
      CodeBlock.configure({
        languageClassPrefix: 'language-',
      }),
      Collaboration.configure({
        document: ydocRef.current || new Y.Doc(),
      }),
      CollaborationCursor.configure({
        provider: providerRef.current as any,
        user: {
          name: user?.username || 'Anonymous',
          color: getColorForUser(user?.id || ''),
        },
      }),
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      if (onUpdate) {
        onUpdate(editor.getHTML())
      }
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none min-h-full p-4',
      },
    },
  })

  useEffect(() => {
    if (!editor || !user || !tokens?.access_token) return

    // Create Y.js document
    const ydoc = new Y.Doc()
    ydocRef.current = ydoc

    // Build WebSocket URL (base only)
    const roomName = `doc:${documentId}`
    const wsUrl = `${config.wsUrl}/ysocket`

    // Create WebSocket provider
    const provider = new WebsocketProvider(wsUrl, roomName, ydoc, {
      connect: true,
      params: {
        token: tokens.access_token
      },
    })
    providerRef.current = provider

    // Create Y.js UndoManager for local undo/redo
    const yXmlFragment = ydoc.getXmlFragment('prosemirror')
    const undoManager = new Y.UndoManager(yXmlFragment)
    undoManagerRef.current = undoManager

    // Update editor with Y.js document
    // Update editor with Y.js document
    editor.setOptions({
      extensions: [
        StarterKit.configure({
          // history is disabled by default when using Collaboration
        }),
        CodeBlock.configure({
          languageClassPrefix: 'language-',
        }),
        Collaboration.configure({
          document: ydoc,
        }),
        CollaborationCursor.configure({
          provider: provider as any,
          user: {
            name: user.username || 'Anonymous',
            color: getColorForUser(user.id || ''),
          },
        }),
      ],
    })
    editor.commands.focus()

    // Load initial content if provided
    if (initialContent) {
      // Note: In a real implementation, you would parse the HTML and convert to Y.js format
      // For now, we'll let Y.js handle the initial sync
    }

    // Listen to connection status
    provider.on('status', (event: { status: string }) => {
      setIsConnected(event.status === 'connected')
    })

    // Listen to awareness changes (remote users)
    provider.awareness.on('change', () => {
      const states = Array.from(provider.awareness.getStates().values())
      const users = states
        .map((state: any) => state.user)
        .filter((u: any) => u && u.name !== user?.username)
      setRemoteUsers(users)
    })

    // Cleanup
    return () => {
      provider.disconnect()
      ydoc.destroy()
    }
  }, [editor, documentId, user, tokens?.access_token])

  // Undo function (local only)
  const undo = () => {
    if (undoManagerRef.current) {
      undoManagerRef.current.undo()
    }
  }

  // Redo function (local only)
  const redo = () => {
    if (undoManagerRef.current) {
      undoManagerRef.current.redo()
    }
  }

  return {
    editor,
    isConnected,
    remoteUsers,
    undo,
    redo,
  }
}

// Generate a color for a user based on their ID
function getColorForUser(userId: string): string {
  const colors = [
    '#958DF1',
    '#F98181',
    '#FBBC88',
    '#FAF594',
    '#70CFF8',
    '#94FADB',
    '#B9F18D',
    '#C3AED6',
  ]
  const hash = userId.split('').reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc)
  }, 0)
  return colors[Math.abs(hash) % colors.length]
}

