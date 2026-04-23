import { Mark, mergeAttributes } from '@tiptap/core'

export interface Reply {
    id: string
    content: string
    author: string
    authorId: string
    timestamp: string
}

export interface AnnotationAttributes {
    id: string
    content: string
    author: string
    authorId: string
    timestamp: string
    resolved: boolean
    replies?: Reply[]
}

export const Annotation = Mark.create({
    name: 'annotation',

    addAttributes() {
        return {
            id: {
                default: null,
                parseHTML: element => element.getAttribute('data-annotation-id'),
                renderHTML: attributes => {
                    if (!attributes.id) {
                        return {}
                    }
                    return {
                        'data-annotation-id': attributes.id,
                    }
                },
            },
            content: {
                default: '',
                parseHTML: element => element.getAttribute('data-annotation-content'),
                renderHTML: attributes => {
                    if (!attributes.content) {
                        return {}
                    }
                    return {
                        'data-annotation-content': attributes.content,
                    }
                },
            },
            author: {
                default: '',
                parseHTML: element => element.getAttribute('data-annotation-author'),
                renderHTML: attributes => {
                    if (!attributes.author) {
                        return {}
                    }
                    return {
                        'data-annotation-author': attributes.author,
                    }
                },
            },
            authorId: {
                default: '',
                parseHTML: element => element.getAttribute('data-annotation-author-id'),
                renderHTML: attributes => {
                    if (!attributes.authorId) {
                        return {}
                    }
                    return {
                        'data-annotation-author-id': attributes.authorId,
                    }
                },
            },
            timestamp: {
                default: '',
                parseHTML: element => element.getAttribute('data-annotation-timestamp'),
                renderHTML: attributes => {
                    if (!attributes.timestamp) {
                        return {}
                    }
                    return {
                        'data-annotation-timestamp': attributes.timestamp,
                    }
                },
            },
            resolved: {
                default: false,
                parseHTML: element => element.getAttribute('data-annotation-resolved') === 'true',
                renderHTML: attributes => {
                    return {
                        'data-annotation-resolved': String(attributes.resolved),
                    }
                },
            },
            replies: {
                default: [],
                parseHTML: element => {
                    const repliesStr = element.getAttribute('data-annotation-replies')
                    if (!repliesStr) return []
                    try {
                        return JSON.parse(repliesStr)
                    } catch {
                        return []
                    }
                },
                renderHTML: attributes => {
                    if (!attributes.replies || attributes.replies.length === 0) {
                        return {}
                    }
                    return {
                        'data-annotation-replies': JSON.stringify(attributes.replies),
                    }
                },
            },
        }
    },

    parseHTML() {
        return [
            {
                tag: 'span[data-annotation-id]',
            },
        ]
    },

    renderHTML({ HTMLAttributes }) {
        return ['span', mergeAttributes(HTMLAttributes, { class: 'annotation-mark' }), 0]
    },

    addCommands() {
        return {
            setAnnotation: (attributes: AnnotationAttributes) => ({ commands }: any) => {
                return commands.setMark(this.name, attributes)
            },
            toggleAnnotation: (attributes: AnnotationAttributes) => ({ commands }: any) => {
                return commands.toggleMark(this.name, attributes)
            },
            unsetAnnotation: () => ({ commands }: any) => {
                return commands.unsetMark(this.name)
            },
        } as any
    },
})
