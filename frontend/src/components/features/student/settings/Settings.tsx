import React from 'react'
import { LogOut, Mail, Settings as SettingsIcon, User, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../../../stores/authStore'

interface SettingsProps {
  isOpen: boolean
  onClose: () => void
}

const roleLabelMap: Record<string, string> = {
  student: '学生',
  teacher: '教师',
  admin: '管理员',
}

const Settings: React.FC<SettingsProps> = ({ isOpen, onClose }) => {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  if (!isOpen) return null

  const roleLabel = user?.role ? roleLabelMap[user.role] || user.role : '未识别角色'
  const avatarInitial = (user?.username || user?.email || 'U')[0].toUpperCase()

  const handleLogout = async () => {
    if (!window.confirm('确定要退出登录吗？')) return
    await logout()
    onClose()
    navigate('/login')
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-indigo-600 p-2 text-white shadow-lg shadow-indigo-100">
              <SettingsIcon size={20} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900">设置中心</h2>
              <p className="text-xs text-slate-500">仅保留实验运行所需的账号信息与退出入口。</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            aria-label="关闭设置中心"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-6">
          <div className="rounded-3xl border border-slate-100 bg-gradient-to-br from-slate-50 to-indigo-50/60 p-5">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-tr from-indigo-500 to-violet-500 text-2xl font-black text-white shadow-lg shadow-indigo-100">
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="用户头像" className="h-full w-full object-cover" />
                ) : (
                  avatarInitial
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="text-xl font-black text-slate-900">{user?.username || '未命名用户'}</div>
                <div className="mt-1 inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">
                  {roleLabel}
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-500">
                  学生端不开放个人偏好、通知、安全策略等配置，相关设置由教师端或管理员端统一维护。
                </p>
              </div>
            </div>
          </div>

          <div className="mt-5 grid gap-3">
            <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3">
              <div className="rounded-xl bg-slate-100 p-2 text-slate-500">
                <User size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">用户名</div>
                <div className="truncate text-sm font-semibold text-slate-800">{user?.username || '未设置'}</div>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3">
              <div className="rounded-xl bg-slate-100 p-2 text-slate-500">
                <Mail size={18} />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">邮箱</div>
                <div className="truncate text-sm font-semibold text-slate-800">{user?.email || '未设置'}</div>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleLogout}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600 transition hover:bg-red-100"
          >
            <LogOut size={18} />
            退出登录
          </button>
        </div>
      </div>
    </div>
  )
}

export default Settings
