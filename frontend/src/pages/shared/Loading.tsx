

export default function LoadingPage() {
    return (
        <div className="h-screen flex flex-col items-center justify-center bg-white">
            <div className="relative">
                <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-2 h-2 bg-indigo-600 rounded-full animate-pulse"></div>
                </div>
            </div>
            <p className="mt-4 text-gray-600 font-medium animate-pulse">
                加载中...
            </p>
        </div>
    )
}
