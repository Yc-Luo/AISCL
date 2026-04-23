

interface Suggestion {
    id: string
    title: string
    content: string
    type: 'critical' | 'important' | 'normal' | 'info'
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
                        <h4 className="font-bold text-gray-800 mb-1">{item.title}</h4>
                        <p className="text-sm text-gray-600">{item.content}</p>
                    </div>
                ))}
            </div>
        </div>
    )
}
