

interface Suggestion {
    id: string
    title: string
    content: string
    type: 'critical' | 'important' | 'normal' | 'info'
    suggestion_category?: string
    target_construct?: string
    evidence_items?: Array<{ label: string; value: number }>
    algorithm_version?: string
}

interface LearningSuggestionsProps {
    suggestions: Suggestion[]
}

export default function LearningSuggestions({ suggestions }: LearningSuggestionsProps) {


    const getBorderColor = (type: Suggestion['type']) => {
        switch (type) {
            case 'critical': return 'border-l-red-500 bg-red-50'
            case 'important': return 'border-l-yellow-500 bg-yellow-50'
            case 'normal': return 'border-l-green-500 bg-green-50'
            case 'info': return 'border-l-blue-500 bg-blue-50'
            default: return 'border-l-gray-500 bg-gray-50'
        }
    }

    if (!suggestions) {
        return (
            <div className="bg-white rounded-lg shadow p-6 animate-pulse">
                <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
                <div className="space-y-3">
                    <div className="h-20 bg-gray-100 rounded"></div>
                    <div className="h-20 bg-gray-100 rounded"></div>
                </div>
            </div>
        )
    }

    return (
        <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4">学习建议</h3>
            <div className="space-y-4">
                {suggestions.map((item) => (
                    <div
                        key={item.id}
                        className={`p-4 rounded-r-lg border-l-4 ${getBorderColor(item.type)}`}
                    >
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                            {item.suggestion_category ? (
                                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                                    {item.suggestion_category}
                                </span>
                            ) : null}
                            {item.target_construct ? (
                                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-slate-500">
                                    目标构念：{item.target_construct}
                                </span>
                            ) : null}
                        </div>
                        <h4 className="font-bold text-gray-800 mb-1">{item.title}</h4>
                        <p className="text-sm text-gray-600">{item.content}</p>
                        {item.evidence_items && item.evidence_items.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-1.5">
                                {item.evidence_items.map((evidence) => (
                                    <span key={evidence.label} className="rounded-full bg-white/80 px-2 py-0.5 text-[11px] text-slate-500">
                                        {evidence.label}: {evidence.value}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                        {item.algorithm_version ? (
                            <div className="mt-2 text-[10px] text-slate-400">算法版本：{item.algorithm_version}</div>
                        ) : null}
                    </div>
                ))}
            </div>
        </div>
    )
}
