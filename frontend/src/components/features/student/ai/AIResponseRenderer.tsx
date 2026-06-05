import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface AIResponseRendererProps {
    content: string
    emptyText?: string
    compact?: boolean
}

function normalizeAIResponseMarkdown(content: string) {
    return (content || '')
        .replace(/\r\n/g, '\n')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/-{3,}\s*(#{1,6})/g, '\n\n---\n\n$1')
        .replace(/([^\n])\s*(#{1,6})(?=[^\s#])/g, '$1\n\n$2 ')
        .replace(/^(#{1,6})(?=\S)/gm, '$1 ')
        .replace(/([。！？；;])\s*(#{1,6})\s*/g, '$1\n\n$2 ')
        .replace(/([：:])\s*((?:[-*+]|\d+[.)、])\s+)/g, '$1\n\n$2')
        .replace(/([：:])\s*([•●○]\s*)/g, '$1\n\n$2')
        .replace(/([^\n])\s*((?:[-*]|\d+[.)、])\s+)/g, '$1\n$2')
        .replace(/([^\n])\s*([一二三四五六七八九十]+[、.．]\s*)/g, '$1\n$2')
        .replace(/([^\n])\s*(```)/g, '$1\n\n$2')
        .replace(/(```[\s\S]*?```)\s*([^\n])/g, '$1\n\n$2')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

export default function AIResponseRenderer({
    content,
    emptyText = '正在生成...',
    compact = false,
}: AIResponseRendererProps) {
    const normalizedContent = normalizeAIResponseMarkdown(content) || emptyText

    return (
        <div
            className={[
                'ai-response-renderer max-w-none break-words text-slate-900',
                compact ? 'text-[13px] leading-5' : 'text-[14px] leading-6',
            ].join(' ')}
        >
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    h1({ children }) {
                        return (
                            <h1 className="mb-1 mt-2 text-[15px] font-black leading-5 text-slate-900">
                                {children}
                            </h1>
                        )
                    },
                    h2({ children }) {
                        return (
                            <h2 className="mb-1 mt-2 text-[15px] font-black leading-5 text-slate-900">
                                {children}
                            </h2>
                        )
                    },
                    h3({ children }) {
                        return (
                            <h3 className="mb-0.5 mt-1.5 text-sm font-black leading-5 text-slate-900">
                                {children}
                            </h3>
                        )
                    },
                    h4({ children }) {
                        return <h4 className="mb-0.5 mt-1.5 text-sm font-black leading-5 text-indigo-800">{children}</h4>
                    },
                    p({ children }) {
                        return <p className="my-1.5 whitespace-pre-wrap text-slate-800">{children}</p>
                    },
                    strong({ children }) {
                        return <strong className="font-black text-slate-950">{children}</strong>
                    },
                    ul({ children }) {
                        return <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>
                    },
                    ol({ children }) {
                        return <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>
                    },
                    li({ children }) {
                        return <li className="pl-0.5 text-slate-800 marker:font-semibold marker:text-slate-500">{children}</li>
                    },
                    blockquote({ children }) {
                        return (
                            <blockquote className="my-1.5 rounded-lg border-l-4 border-amber-300 bg-amber-50 px-3 py-1.5 text-slate-700">
                                {children}
                            </blockquote>
                        )
                    },
                    hr() {
                        return <hr className="my-2 border-slate-200" />
                    },
                    code({ className, children }) {
                        return (
                            <code className={`${className || ''} rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800`}>
                                {children}
                            </code>
                        )
                    },
                    pre({ children }) {
                        return (
                            <pre className="my-2 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs leading-5 text-slate-800 [&>code]:bg-transparent [&>code]:p-0">
                                {children}
                            </pre>
                        )
                    },
                    table({ children }) {
                        return (
                            <div className="my-2 overflow-x-auto rounded-xl border border-slate-200">
                                <table className="min-w-full divide-y divide-slate-200 text-xs">{children}</table>
                            </div>
                        )
                    },
                    th({ children }) {
                        return <th className="bg-slate-50 px-3 py-2 text-left font-bold text-slate-700">{children}</th>
                    },
                    td({ children }) {
                        return <td className="border-t border-slate-100 px-3 py-2 text-slate-700">{children}</td>
                    },
                    a({ children, href }) {
                        return (
                            <a href={href} target="_blank" rel="noreferrer" className="font-semibold text-indigo-600 underline underline-offset-2">
                                {children}
                            </a>
                        )
                    },
                }}
            >
                {normalizedContent}
            </ReactMarkdown>
        </div>
    )
}
