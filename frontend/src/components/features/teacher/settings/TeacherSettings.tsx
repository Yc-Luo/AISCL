import { Mail, ShieldCheck, User, Settings as SettingsIcon } from 'lucide-react';
import { useAuthStore } from '../../../../stores/authStore';

const roleLabelMap: Record<string, string> = {
    teacher: '教师',
    admin: '管理员',
    student: '学生',
};

export default function TeacherSettings() {
    const { user } = useAuthStore();
    const roleLabel = user?.role ? roleLabelMap[user.role] || user.role : '未识别角色';
    const avatarInitial = (user?.username || user?.email || 'T')[0].toUpperCase();

    return (
        <div className="mx-auto max-w-4xl space-y-6 animate-fadeIn">
            <div className="rounded-3xl border border-white/70 bg-white p-6 shadow-sm">
                <div className="flex items-start gap-4">
                    <div className="rounded-2xl bg-indigo-600 p-3 text-white shadow-lg shadow-indigo-100">
                        <SettingsIcon className="h-6 w-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black tracking-tight text-slate-900">设置中心</h1>
                        <p className="mt-1 text-sm leading-6 text-slate-500">
                            教师端仅保留实验运行所需的账号识别信息。头像、密码、通知偏好等账户级配置由管理员端统一维护，避免教学现场出现未实现或不可追踪的操作入口。
                        </p>
                    </div>
                </div>
            </div>

            <div className="rounded-3xl border border-slate-100 bg-gradient-to-br from-slate-50 to-indigo-50/60 p-6">
                <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
                    <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-tr from-indigo-500 to-violet-500 text-3xl font-black text-white shadow-lg shadow-indigo-100">
                        {user?.avatar_url ? (
                            <img src={user.avatar_url} alt="教师头像" className="h-full w-full object-cover" />
                        ) : (
                            avatarInitial
                        )}
                    </div>

                    <div className="min-w-0 flex-1">
                        <div className="text-2xl font-black text-slate-900">{user?.username || '未命名教师'}</div>
                        <div className="mt-2 inline-flex rounded-full bg-white px-3 py-1 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-100">
                            {roleLabel}
                        </div>
                        <p className="mt-3 text-sm leading-6 text-slate-500">
                            当前账号用于班级管理、小组观察、资源分发、教师支持和实验数据导出。涉及学生账号、实验模板和模型配置的操作请在管理员端完成。
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-2xl border border-slate-100 bg-white p-4">
                    <div className="mb-3 inline-flex rounded-xl bg-slate-100 p-2 text-slate-500">
                        <User className="h-5 w-5" />
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">用户名</div>
                    <div className="mt-1 truncate text-sm font-bold text-slate-800">{user?.username || '未设置'}</div>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-white p-4">
                    <div className="mb-3 inline-flex rounded-xl bg-slate-100 p-2 text-slate-500">
                        <Mail className="h-5 w-5" />
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">邮箱</div>
                    <div className="mt-1 truncate text-sm font-bold text-slate-800">{user?.email || '未设置'}</div>
                </div>

                <div className="rounded-2xl border border-slate-100 bg-white p-4">
                    <div className="mb-3 inline-flex rounded-xl bg-slate-100 p-2 text-slate-500">
                        <ShieldCheck className="h-5 w-5" />
                    </div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">权限范围</div>
                    <div className="mt-1 text-sm font-bold text-slate-800">本人创建或负责的班级与小组</div>
                </div>
            </div>

            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
                如果需要修改账号密码、绑定邮箱、创建教师账号或调整系统配置，请联系管理员在管理员端处理。
            </div>
        </div>
    );
}
