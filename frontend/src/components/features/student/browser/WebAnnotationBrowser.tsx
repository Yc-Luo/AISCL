import { useState, useEffect, useCallback } from 'react'
import { webAnnotationService } from '../../../../services/api/webAnnotation'
import { trackingService } from '../../../../services/tracking/TrackingService'
import { useContextStore } from '../../../../stores/contextStore'
import { useScrapbookActions } from '../../../../modules/inquiry/hooks/useScrapbookActions'
import { Lightbulb } from 'lucide-react'
import { Toast } from '../../../ui/Toast'

interface WebAnnotation {
    id: string
    url: string
    title: string
    content: string
    created_at: string
    user_id: string
}

interface WebAnnotationBrowserProps {
    projectId?: string
}

export default function WebAnnotationBrowser({ projectId }: WebAnnotationBrowserProps) {
    const [annotations, setAnnotations] = useState<WebAnnotation[]>([])
    const [loading, setLoading] = useState(true)
    const [currentUrl, setCurrentUrl] = useState('https://www.wikipedia.org')
    const [urlInput, setUrlInput] = useState('https://www.wikipedia.org')
    const [showAnnotations, setShowAnnotations] = useState(false)
    const [isAnnotating, setIsAnnotating] = useState(false)

    // Annotation form state
    const [annotationTitle, setAnnotationTitle] = useState('')
    const [annotationContent, setAnnotationContent] = useState('')

    const { addMaterial } = useScrapbookActions(projectId || '')
    const [showToast, setShowToast] = useState(false)
    const [toastMessage, setToastMessage] = useState('')

    const setBrowserUrl = useContextStore(state => state.setBrowserUrl)
    const setBrowserContent = useContextStore(state => state.setBrowserContent)

    useEffect(() => {
        setBrowserUrl(currentUrl)
        if (annotations.length > 0) {
            const annotationsSummary = annotations
                .map(a => `Title: ${a.title}\nContent: ${a.content}`)
                .join('\n---\n')
            setBrowserContent(annotationsSummary)
        }
    }, [currentUrl, annotations, setBrowserUrl, setBrowserContent])

    useEffect(() => {
        loadAnnotations()
    }, [])

    const loadAnnotations = async () => {
        try {
            setLoading(true)
            const response = await webAnnotationService.getAnnotations()
            setAnnotations(response.annotations || [])
        } catch (error) {
            console.error('Failed to load annotations:', error)
            setAnnotations([])
        } finally {
            setLoading(false)
        }
    }

    const handleNavigate = () => {
        let url = urlInput
        if (!url.startsWith('http')) {
            url = 'https://' + url
        }
        setCurrentUrl(url)
        setUrlInput(url)
        trackingService.track({
            module: 'browser',
            action: 'browser_navigate',
            metadata: { url }
        })
    }

    const handleCreateAnnotation = async () => {
        if (!annotationTitle.trim()) return
        try {
            await webAnnotationService.createAnnotation(currentUrl, annotationTitle, annotationContent)
            setAnnotationTitle('')
            setAnnotationContent('')
            setIsAnnotating(false)
            loadAnnotations()
        } catch (error) {
            console.error('Failed to create annotation:', error)
        }
    }

    const handleSaveToScrapbook = useCallback(async (content: string, title?: string) => {
        if (!projectId) return;
        try {
            await addMaterial(content, title || '网页剪藏', currentUrl);
            setToastMessage('已提取到素材池');
            setShowToast(true);
        } catch (error) {
            setToastMessage('保存失败');
            setShowToast(true);
        }
    }, [projectId, currentUrl, addMaterial])

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleNavigate()
    }

    return (
        <div className="h-full flex flex-col bg-gray-50 max-h-screen overflow-hidden">
            <div className="p-3 bg-white border-b border-gray-200 flex items-center gap-4 shrink-0">
                <div className="flex gap-2">
                    <button className="p-1 hover:bg-gray-100 rounded text-gray-500" onClick={() => { }}>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                    <button className="p-1 hover:bg-gray-100 rounded text-gray-500">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    </button>
                </div>
                <div className="flex-1 flex gap-2">
                    <input
                        type="text"
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="flex-1 px-4 py-2 bg-gray-100 border-none rounded-full focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                    />
                    <button onClick={handleNavigate} className="px-4 py-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 text-sm font-medium">前往</button>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => setIsAnnotating(true)} className="px-3 py-2 text-indigo-600 hover:bg-indigo-50 rounded-lg text-sm font-medium flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        添加标注
                    </button>
                    <button onClick={() => setShowAnnotations(!showAnnotations)} className={`p-2 rounded-lg text-gray-600 ${showAnnotations ? 'bg-gray-200' : 'hover:bg-gray-100'}`}>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                    </button>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                <div className="flex-1 relative bg-white">
                    <iframe src={currentUrl} className="w-full h-full border-none" title="内嵌浏览器" sandbox="allow-same-origin allow-scripts allow-popups allow-forms" />
                </div>
                {(showAnnotations || isAnnotating) && (
                    <div className="w-80 border-l border-gray-200 bg-white flex flex-col shrink-0">
                        <div className="p-4 border-b border-gray-200 bg-gray-50 font-medium text-gray-700 flex justify-between items-center">
                            <span>{isAnnotating ? '新建标注' : '页面标注'}</span>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4">
                            {isAnnotating ? (
                                <div className="space-y-4">
                                    <input type="text" value={annotationTitle} onChange={e => setAnnotationTitle(e.target.value)} className="w-full px-3 py-2 border rounded-md" placeholder="标题" />
                                    <textarea value={annotationContent} onChange={e => setAnnotationContent(e.target.value)} rows={4} className="w-full px-3 py-2 border rounded-md" placeholder="笔记" />
                                    <div className="flex gap-2">
                                        <button onClick={handleCreateAnnotation} className="flex-1 py-2 bg-indigo-600 text-white rounded-md font-medium text-sm">保存标注</button>
                                        <button onClick={() => handleSaveToScrapbook(annotationContent, annotationTitle)} className="p-2 bg-amber-50 text-amber-600 rounded-md border border-amber-200" title="存入探究空间素材池">
                                            <Lightbulb className="w-4 h-4" />
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {loading ? <p className="text-center text-gray-500">加载中...</p> : annotations.map(ant => (
                                        <div key={ant.id} className="p-3 bg-gray-50 rounded-lg border border-gray-100 group">
                                            <div className="flex justify-between items-start mb-1">
                                                <h4 className="font-medium text-gray-900 line-clamp-1">{ant.title}</h4>
                                                <button onClick={() => { setCurrentUrl(ant.url); setUrlInput(ant.url) }} className="text-indigo-600 hover:text-indigo-800 text-xs opacity-0 group-hover:opacity-100">访问</button>
                                            </div>
                                            <p className="text-xs text-gray-400 mb-2 truncate">{ant.url}</p>
                                            {ant.content && <p className="text-sm text-gray-700 line-clamp-3 mb-2">{ant.content}</p>}
                                            <div className="flex justify-end">
                                                <button onClick={() => handleSaveToScrapbook(ant.content, ant.title)} className="text-[10px] text-amber-600 flex items-center gap-1 hover:underline">
                                                    <Lightbulb className="w-3 h-3" /> 提取到素材池
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
            {showToast && <Toast message={toastMessage} onClose={() => setShowToast(false)} />}
        </div>
    )
}
