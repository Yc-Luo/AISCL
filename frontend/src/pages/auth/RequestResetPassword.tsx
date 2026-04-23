import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ROUTES } from '../../config/routes'
import { authService } from '../../services/api/auth'

export default function RequestResetPassword() {
    const [email, setEmail] = useState('')
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
    const [message, setMessage] = useState('')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setStatus('loading')
        setMessage('')

        try {
            await authService.requestPasswordReset(email)
            setStatus('success')
            setMessage('重置链接已发送到您的邮箱（演示环境请查看后端控制台）')
        } catch (err: any) {
            setStatus('error')
            setMessage(err.response?.data?.detail || '请求失败，请稍后重试')
        }
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-md w-full space-y-8 bg-white p-8 rounded-lg shadow-md">
                <div>
                    <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
                        重置密码
                    </h2>
                    <p className="mt-2 text-center text-sm text-gray-600">
                        {status === 'success'
                            ? '请检查您的邮箱'
                            : '输入您的注册邮箱，我们将发送重置链接'}
                    </p>
                </div>

                {status === 'success' ? (
                    <div className="rounded-md bg-green-50 p-4">
                        <div className="flex">
                            <div className="flex-shrink-0">
                                <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div className="ml-3">
                                <p className="text-sm font-medium text-green-800">{message}</p>
                            </div>
                        </div>
                        <div className="mt-4 text-center">
                            <Link to={ROUTES.LOGIN} className="font-medium text-indigo-600 hover:text-indigo-500">
                                返回登录
                            </Link>
                        </div>
                    </div>
                ) : (
                    <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
                        {status === 'error' && (
                            <div className="rounded-md bg-red-50 p-4">
                                <div className="text-sm text-red-800">{message}</div>
                            </div>
                        )}
                        <div className="rounded-md shadow-sm -space-y-px">
                            <div>
                                <label htmlFor="email-address" className="sr-only">
                                    邮箱地址
                                </label>
                                <input
                                    id="email-address"
                                    name="email"
                                    type="email"
                                    autoComplete="email"
                                    required
                                    className="appearance-none rounded relative block w-full px-3 py-2 border border-gray-300 placeholder-gray-500 text-gray-900 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 focus:z-10 sm:text-sm"
                                    placeholder="邮箱地址"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                            </div>
                        </div>

                        <div>
                            <button
                                type="submit"
                                disabled={status === 'loading'}
                                className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                            >
                                {status === 'loading' ? '发送中...' : '发送重置链接'}
                            </button>
                        </div>

                        <div className="text-center">
                            <Link to={ROUTES.LOGIN} className="font-medium text-indigo-600 hover:text-indigo-500">
                                返回登录
                            </Link>
                        </div>
                    </form>
                )}
            </div>
        </div>
    )
}
