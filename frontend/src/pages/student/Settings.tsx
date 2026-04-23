import { useState } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useNavigate } from 'react-router-dom'

export default function Settings() {
    const { user, logout } = useAuthStore()
    const navigate = useNavigate()
    const [formData] = useState({
        username: user?.username || '',
        email: user?.email || '',
        phone: user?.phone || '',
    })

    const handleLogout = () => {
        logout()
        navigate('/login')
    }

    return (
        <div className="min-h-screen bg-gray-50 py-8">
            <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="mb-8 flex items-center justify-between">
                    <h1 className="text-2xl font-bold text-gray-900">个人设置</h1>
                    <button
                        onClick={() => navigate(-1)}
                        className="text-sm text-gray-500 hover:text-gray-700"
                    >
                        返回
                    </button>
                </div>

                <div className="bg-white shadow rounded-lg overflow-hidden">
                    <div className="p-6 space-y-6">
                        <div className="flex items-center space-x-4">
                            <div className="h-20 w-20 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white text-2xl font-bold">
                                {user?.username?.[0]?.toUpperCase()}
                            </div>
                            <div>
                                <h2 className="text-xl font-medium text-gray-900">{user?.username}</h2>
                                <p className="text-gray-500">{user?.role === 'admin' ? '管理员' : user?.role === 'teacher' ? '教师' : '学生'}</p>
                            </div>
                        </div>

                        <div className="border-t border-gray-200 pt-6">
                            <h3 className="text-lg font-medium text-gray-900 mb-4">基本信息</h3>
                            <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
                                <div className="sm:col-span-4">
                                    <label className="block text-sm font-medium text-gray-700">用户名</label>
                                    <div className="mt-1">
                                        <input
                                            type="text"
                                            disabled
                                            value={formData.username}
                                            className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md bg-gray-50"
                                        />
                                    </div>
                                </div>

                                <div className="sm:col-span-4">
                                    <label className="block text-sm font-medium text-gray-700">邮箱</label>
                                    <div className="mt-1">
                                        <input
                                            type="text"
                                            disabled
                                            value={formData.email}
                                            className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md bg-gray-50"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="border-t border-gray-200 pt-6">
                            <button
                                onClick={handleLogout}
                                className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                            >
                                退出登录
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
