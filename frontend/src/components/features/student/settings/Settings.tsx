import React, { useEffect, useState } from 'react'
import { KeyRound, LogOut, Mail, Save, Settings as SettingsIcon, User, X } from 'lucide-react'
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
  const { user, logout, updateUser } = useAuthStore()
  const navigate = useNavigate()
  const [confirmLogout, setConfirmLogout] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState('')

  useEffect(() => {
    if (isOpen) {
      setDisplayName(user?.username || '')
      setProfileMessage('')
      setPasswordMessage('')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }
  }, [isOpen, user?.username])

  if (!isOpen) return null

  const roleLabel = user?.role ? roleLabelMap[user.role] || user.role : '未识别角色'
  const avatarInitial = (user?.username || user?.email || 'U')[0].toUpperCase()

  const handleLogout = async () => {
    await logout()
    onClose()
    navigate('/login')
  }

  const handleSaveProfile = async () => {
    const nextName = displayName.trim()
    if (nextName.length < 1) {
      setProfileMessage('姓名不能为空。')
      return
    }
    setProfileSaving(true)
    setProfileMessage('')
    try {
      await updateUser({ username: nextName })
      setProfileMessage('姓名已更新。')
    } catch (error: any) {
      setProfileMessage(error?.response?.data?.detail || '姓名更新失败。')
    } finally {
      setProfileSaving(false)
    }
  }

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordMessage('请完整填写当前密码、新密码和确认密码。')
      return
    }
    if (newPassword.length < 8) {
      setPasswordMessage('新密码至少需要 8 个字符。')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage('两次输入的新密码不一致。')
      return
    }

    setPasswordSaving(true)
    setPasswordMessage('')
    try {
      await updateUser({
        current_password: currentPassword,
        new_password: newPassword,
      })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage('密码已更新，下次登录请使用新密码。')
    } catch (error: any) {
      setPasswordMessage(error?.response?.data?.detail || '密码修改失败。')
    } finally {
      setPasswordSaving(false)
    }
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
              <p className="text-xs text-slate-500">管理学生端显示姓名、登录密码与退出登录。</p>
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
                  这里的姓名用于学习空间展示；邮箱和班级归属由教师或管理员统一维护。
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

          <div className="mt-5 rounded-3xl border border-slate-100 bg-white p-5">
            <div className="flex items-center gap-2 text-sm font-black text-slate-900">
              <User size={18} className="text-indigo-600" />
              修改姓名
            </div>
            <label className="mt-4 block text-xs font-bold text-slate-500" htmlFor="student-display-name">
              显示姓名
            </label>
            <input
              id="student-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
              placeholder="请输入姓名或展示名称"
            />
            {profileMessage ? (
              <p className="mt-2 text-xs font-semibold text-slate-500">{profileMessage}</p>
            ) : null}
            <button
              type="button"
              onClick={handleSaveProfile}
              disabled={profileSaving}
              className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Save size={16} />
              {profileSaving ? '保存中...' : '保存姓名'}
            </button>
          </div>

          <div className="mt-5 rounded-3xl border border-slate-100 bg-white p-5">
            <div className="flex items-center gap-2 text-sm font-black text-slate-900">
              <KeyRound size={18} className="text-indigo-600" />
              修改密码
            </div>
            <div className="mt-4 grid gap-3">
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                placeholder="当前密码"
                autoComplete="current-password"
              />
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                placeholder="新密码（至少 8 位）"
                autoComplete="new-password"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                placeholder="再次输入新密码"
                autoComplete="new-password"
              />
            </div>
            {passwordMessage ? (
              <p className="mt-2 text-xs font-semibold text-slate-500">{passwordMessage}</p>
            ) : null}
            <button
              type="button"
              onClick={handleChangePassword}
              disabled={passwordSaving}
              className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <KeyRound size={16} />
              {passwordSaving ? '修改中...' : '修改密码'}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setConfirmLogout(true)}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600 transition hover:bg-red-100"
          >
            <LogOut size={18} />
            退出登录
          </button>

          {confirmLogout && (
            <div className="mt-4 rounded-2xl border border-red-100 bg-red-50/70 p-4">
              <div className="text-sm font-bold text-red-700">确认退出当前账号？</div>
              <p className="mt-1 text-xs leading-5 text-red-600">
                退出后需要重新登录才能继续进入学习空间。
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmLogout(false)}
                  className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-slate-600 ring-1 ring-slate-100 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white hover:bg-red-700"
                >
                  确认退出
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Settings
