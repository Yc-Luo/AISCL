import { useState } from 'react'

export default function DataExport() {
    const [dateRange, setDateRange] = useState('7')
    const [dataTypes, setDataTypes] = useState({
        studentLogs: true,
        chatHistory: false,
        projectResources: false
    })
    const [isExporting, setIsExporting] = useState(false)

    const handleExport = () => {
        setIsExporting(true)
        // Simulate export process
        setTimeout(() => {
            setIsExporting(false)
            alert("Export complted! Downloading file...")
        }, 2000)
    }

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 text-left">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">数据导出</h3>

            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">时间范围</label>
                    <select
                        value={dateRange}
                        onChange={(e) => setDateRange(e.target.value)}
                        className="w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    >
                        <option value="7">最近 7 天</option>
                        <option value="30">最近 30 天</option>
                        <option value="90">最近 3 个月</option>
                        <option value="all">全部时间</option>
                    </select>
                </div>

                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">导出内容</label>
                    <div className="space-y-2">
                        <label className="flex items-center">
                            <input
                                type="checkbox"
                                checked={dataTypes.studentLogs}
                                onChange={(e) => setDataTypes({ ...dataTypes, studentLogs: e.target.checked })}
                                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                            />
                            <span className="ml-2 text-sm text-gray-600">学生学习日志 (Activity Logs)</span>
                        </label>
                        <label className="flex items-center">
                            <input
                                type="checkbox"
                                checked={dataTypes.chatHistory}
                                onChange={(e) => setDataTypes({ ...dataTypes, chatHistory: e.target.checked })}
                                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                            />
                            <span className="ml-2 text-sm text-gray-600">聊天与讨论记录 (Chat History)</span>
                        </label>
                        <label className="flex items-center">
                            <input
                                type="checkbox"
                                checked={dataTypes.projectResources}
                                onChange={(e) => setDataTypes({ ...dataTypes, projectResources: e.target.checked })}
                                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                            />
                            <span className="ml-2 text-sm text-gray-600">项目资源列表 (Resource Metadata)</span>
                        </label>
                    </div>
                </div>

                <button
                    onClick={handleExport}
                    disabled={isExporting}
                    className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-400"
                >
                    {isExporting ? '生成中...' : '导出 CSV'}
                </button>
            </div>
        </div>
    )
}
