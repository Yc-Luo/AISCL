import { useState } from 'react';
import { useAuthStore } from '../../../../stores/authStore';
import { Button, Input } from '../../../ui';
import { User, Shield, Bell, Lock } from 'lucide-react';

export default function TeacherSettings() {
    const { user } = useAuthStore();
    const [activeTab, setActiveTab] = useState<'profile' | 'security' | 'notifications'>('profile');

    return (
        <div className="space-y-6 animate-fadeIn">
            <div>
                <h1 className="text-2xl font-semibold text-slate-900">个人设置</h1>
                <p className="text-sm text-slate-600 mt-1">管理您的账号详情、安全选项及通知首选项。</p>
            </div>

            <div className="flex gap-6">
                {/* Side Tabs */}
                <div className="w-64 flex-shrink-0 space-y-1">
                    <button
                        onClick={() => setActiveTab('profile')}
                        className={`w-full flex items-center gap-3 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'profile' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        <User className="w-4 h-4" />
                        基本信息
                    </button>
                    <button
                        onClick={() => setActiveTab('security')}
                        className={`w-full flex items-center gap-3 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'security' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        <Shield className="w-4 h-4" />
                        安全设置
                    </button>
                    <button
                        onClick={() => setActiveTab('notifications')}
                        className={`w-full flex items-center gap-3 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'notifications' ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}
                    >
                        <Bell className="w-4 h-4" />
                        通知首选项
                    </button>
                </div>

                {/* Content Area */}
                <div className="flex-1 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    {activeTab === 'profile' && (
                        <div className="p-6 space-y-6">
                            <div className="flex items-center gap-6 pb-6 border-b border-gray-100">
                                <div className="w-20 h-20 bg-indigo-600 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-indigo-100">
                                    {user?.username?.[0]?.toUpperCase()}
                                </div>
                                <div>
                                    <Button variant="outline" size="sm">更换头像</Button>
                                    <p className="text-xs text-slate-400 mt-2">支持 JPG, PNG. 最大 2MB.</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-700">用户名</label>
                                    <Input defaultValue={user?.username} />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-700">邮箱地址</label>
                                    <Input defaultValue={user?.email} disabled />
                                </div>
                                <div className="space-y-2 col-span-2">
                                    <label className="text-sm font-medium text-slate-700">个人简介</label>
                                    <textarea
                                        className="w-full min-h-[100px] px-3 py-2 text-sm rounded-md border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-transparent"
                                        placeholder="简单介绍一下您自己..."
                                    />
                                </div>
                            </div>

                            <div className="flex justify-end pt-4">
                                <Button className="bg-indigo-600 hover:bg-indigo-700 text-white">保存更改</Button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'security' && (
                        <div className="p-6 space-y-6">
                            <div className="space-y-4">
                                <h3 className="text-lg font-medium text-slate-900 flex items-center gap-2">
                                    <Lock className="w-5 h-5 text-slate-400" />
                                    修改密码
                                </h3>
                                <div className="space-y-4 max-w-md">
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-slate-700">当前密码</label>
                                        <Input type="password" />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-slate-700">新密码</label>
                                        <Input type="password" />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium text-slate-700">确认新密码</label>
                                        <Input type="password" />
                                    </div>
                                </div>
                            </div>
                            <div className="flex justify-end pt-4 border-t border-gray-100">
                                <Button className="bg-indigo-600 hover:bg-indigo-700 text-white">更新密码</Button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'notifications' && (
                        <div className="p-6">
                            <p className="text-slate-500 text-sm">通知设置功能即将上线...</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
