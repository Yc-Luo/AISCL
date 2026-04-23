import React, { useState, useEffect } from 'react';
import {
    User,
    Settings as SettingsIcon,
    Bell,
    Shield,
    // Cpu,
    X,
    Camera,
    Moon,
    Sun,
    Layout,
    // Check,
    LogOut
} from 'lucide-react';
import { useAuthStore } from '../../../../stores/authStore';
import { useUiStore } from '../../../../stores/uiStore';

interface SettingsProps {
    isOpen: boolean;
    onClose: () => void;
}

const Settings: React.FC<SettingsProps> = ({ isOpen, onClose }) => {
    const { user, updateUser, isLoading: isUpdating } = useAuthStore();
    const { theme, setTheme, addNotification } = useUiStore();

    const [activeTab, setActiveTab] = useState('profile');

    // Form States
    const [username, setUsername] = useState('');
    const [bio, setBio] = useState('');
    // const [selectedModel, setSelectedModel] = useState('deepseek');

    // Initialize from store
    useEffect(() => {
        if (user) {
            setUsername(user.username || '');
            setBio((user.settings?.bio as string) || '');
            // setSelectedModel((user.settings?.ai_model as string) || 'deepseek');
        }
    }, [user, isOpen]);

    if (!isOpen) return null;

    const handleSaveProfile = async () => {
        try {
            await updateUser({
                username,
                settings: {
                    ...user?.settings,
                    bio
                }
            });
            addNotification({
                type: 'success',
                message: '个人资料已更新'
            });
        } catch (error) {
            addNotification({
                type: 'error',
                message: '更新失败，请重试'
            });
        }
    };

    const handleUpdateSettings = async (newSettings: any) => {
        try {
            await updateUser({
                settings: {
                    ...user?.settings,
                    ...newSettings
                }
            });
        } catch (error) {
            console.error('Failed to update settings:', error);
        }
    };

    const tabs = [
        { id: 'profile', label: '个人资料', icon: User },
        // { id: 'ai', label: 'AI 偏好', icon: Cpu },
        { id: 'notifications', label: '通知设置', icon: Bell },
        { id: 'display', label: '界面显示', icon: Layout },
        { id: 'security', label: '账户安全', icon: Shield },
    ];

    const renderContent = () => {
        switch (activeTab) {
            case 'profile':
                return (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div>
                            <h3 className="text-lg font-semibold text-gray-900">个人资料</h3>
                            <p className="text-sm text-gray-500">管理您的个人信息和公开展示内容</p>
                        </div>

                        <div className="flex items-center space-x-6">
                            <div className="relative group">
                                <div className="h-24 w-24 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-500 flex items-center justify-center text-white text-3xl font-bold shadow-lg ring-4 ring-white transition-transform group-hover:scale-105 overflow-hidden">
                                    {user?.avatar_url ? (
                                        <img src={user.avatar_url} alt="Profile" className="h-full w-full object-cover" />
                                    ) : (
                                        (username || user?.username || 'U')[0].toUpperCase()
                                    )}
                                </div>
                                <button className="absolute -bottom-2 -right-2 p-2 bg-white rounded-xl shadow-md border border-gray-100 text-indigo-600 hover:text-indigo-700 hover:scale-110 transition-all">
                                    <Camera size={16} />
                                </button>
                            </div>
                            <div className="flex-1 space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">显示名称</label>
                                    <input
                                        type="text"
                                        className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                                        placeholder="请输入您的姓名"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">邮箱地址</label>
                                    <input
                                        type="email"
                                        className="w-full px-4 py-2 border border-gray-200 rounded-xl bg-gray-50 text-gray-500 cursor-not-allowed outline-none"
                                        value={user?.email || ''}
                                        disabled
                                    />
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">个人简介</label>
                            <textarea
                                className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all h-24 resize-none"
                                placeholder="介绍一下你自己..."
                                value={bio}
                                onChange={(e) => setBio(e.target.value)}
                            />
                        </div>

                        <div className="pt-4 flex justify-end">
                            <button
                                onClick={handleSaveProfile}
                                disabled={isUpdating}
                                className="px-6 py-2 bg-indigo-600 text-white rounded-xl font-medium hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isUpdating ? '保存中...' : '保存更改'}
                            </button>
                        </div>
                    </div>
                );
            /*
            case 'ai':
                return (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div>
                            <h3 className="text-lg font-semibold text-gray-900">AI 助手设置</h3>
                            <p className="text-sm text-gray-500">定制您的 AI 导师与交互体验</p>
                        </div>

                        <div className="space-y-4">
                            <label className="block text-sm font-medium text-gray-700 uppercase tracking-wider text-xs">当前模型</label>
                            <div className="grid grid-cols-1 gap-3">
                                {[
                                    { id: 'deepseek', name: 'DeepSeek Chat', desc: '高效、精准的中英双语模型' },
                                    { id: 'gpt-4o', name: 'OpenAI GPT-4o', desc: '强大的通用逻辑与多模态能力' },
                                    { id: 'ollama', name: 'Llama 3 (Local)', desc: '低延迟本地私有部署' }
                                ].map((model) => (
                                    <div
                                        key={model.id}
                                        onClick={() => {
                                            setSelectedModel(model.id);
                                            handleUpdateSettings({ ai_model: model.id });
                                        }}
                                        className={`p-4 rounded-2xl border-2 cursor-pointer transition-all flex items-center justify-between group ${selectedModel === model.id
                                            ? 'border-indigo-600 bg-indigo-50/30'
                                            : 'border-gray-100 hover:border-indigo-200 hover:bg-gray-50'
                                            }`}
                                    >
                                        <div>
                                            <div className="font-semibold text-gray-900 flex items-center gap-2">
                                                {model.name}
                                                {selectedModel === model.id && <span className="px-2 py-0.5 text-[10px] bg-indigo-600 text-white rounded-full">当前使用</span>}
                                            </div>
                                            <div className="text-xs text-gray-500">{model.desc}</div>
                                        </div>
                                        <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center transition-all ${selectedModel === model.id ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-200 group-hover:border-indigo-400'
                                            }`}>
                                            {selectedModel === model.id && <Check size={14} />}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100">
                            <div className="flex gap-3">
                                <div className="text-amber-600"><SettingsIcon size={20} /></div>
                                <div>
                                    <div className="text-sm font-semibold text-amber-900">开发者选项</div>
                                    <div className="text-xs text-amber-700 mt-0.5">更改 AI 供应商可能需要配置相应的 API Key，目前由系统全局托管。</div>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            */
            case 'display':
                return (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div>
                            <h3 className="text-lg font-semibold text-gray-900">界面显示</h3>
                            <p className="text-sm text-gray-500">调整系统外观与布局偏好</p>
                        </div>

                        <div className="flex items-center justify-between p-4 rounded-2xl border border-gray-100 hover:bg-gray-50 transition-colors">
                            <div className="flex items-center gap-4">
                                <div className={`p-3 rounded-xl ${theme === 'dark' ? 'bg-gray-800 text-gray-100' : 'bg-amber-100 text-amber-600'}`}>
                                    {theme === 'dark' ? <Moon size={20} /> : <Sun size={20} />}
                                </div>
                                <div>
                                    <div className="font-medium">深色模式</div>
                                    <div className="text-xs text-gray-500">切换系统主题模式（当前：{theme === 'dark' ? '深色' : '浅色'}）</div>
                                </div>
                            </div>
                            <button
                                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                                className={`w-12 h-6 rounded-full p-1 transition-all duration-300 ${theme === 'dark' ? 'bg-indigo-600' : 'bg-gray-200'}`}
                            >
                                <div className={`h-4 w-4 bg-white rounded-full shadow-sm transform transition-transform duration-300 ${theme === 'dark' ? 'translate-x-6' : 'translate-x-0'}`} />
                            </button>
                        </div>

                        <div className="space-y-3">
                            <label className="block text-sm font-medium text-gray-700">强调色</label>
                            <div className="flex gap-3">
                                {['#4F46E5', '#8B5CF6', '#EC4899', '#22C55E', '#F59E0B'].map((color) => (
                                    <button
                                        key={color}
                                        onClick={() => handleUpdateSettings({ accent_color: color })}
                                        className={`h-8 w-8 rounded-full border-2 ring-2 transition-all ${user?.settings?.accent_color === color ? 'border-white ring-indigo-500 scale-110' : 'border-white ring-transparent hover:ring-gray-200'}`}
                                        style={{ backgroundColor: color }}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                );
            default:
                return (
                    <div className="flex flex-col items-center justify-center h-full text-gray-400 space-y-4">
                        <div className="p-4 bg-gray-50 rounded-full animate-pulse">
                            <SettingsIcon size={40} />
                        </div>
                        <p className="font-medium">该模块正在加紧开发中...</p>
                    </div>
                );
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-indigo-900/10 backdrop-blur-md transition-opacity"
                onClick={onClose}
            />

            {/* Modal Container */}
            <div className="relative bg-white/95 w-full max-w-4xl h-[600px] rounded-[32px] shadow-2xl overflow-hidden flex border border-white/50 animate-in zoom-in-95 duration-300">
                {/* Left Sidebar */}
                <div className="w-64 bg-gray-50/50 border-r border-gray-100 p-6 flex flex-col">
                    <div className="flex items-center gap-3 px-2 mb-8">
                        <div className="p-2 bg-indigo-600 rounded-xl text-white shadow-lg shadow-indigo-200">
                            <SettingsIcon size={20} />
                        </div>
                        <span className="font-bold text-gray-900 text-lg">设置中心</span>
                    </div>

                    <nav className="flex-1 space-y-1">
                        {tabs.map((tab) => {
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`w-full flex items-center space-x-3 px-4 py-3 rounded-2xl transition-all duration-200 group ${activeTab === tab.id
                                        ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-gray-200'
                                        : 'text-gray-500 hover:bg-white hover:text-indigo-500 hover:shadow-sm'
                                        }`}
                                >
                                    <Icon size={18} className={activeTab === tab.id ? 'stroke-[2.5px]' : 'stroke-2'} />
                                    <span className={`font-medium ${activeTab === tab.id ? 'text-gray-900' : ''}`}>{tab.label}</span>
                                    {activeTab === tab.id && (
                                        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-600" />
                                    )}
                                </button>
                            );
                        })}
                    </nav>

                    <div className="mt-auto space-y-4">
                        <div className="px-4 py-4 rounded-2xl bg-indigo-50/50 border border-indigo-100/50">
                            <div className="text-[10px] text-indigo-400 font-bold uppercase tracking-[0.1em] mb-1">系统版本</div>
                            <div className="text-xs text-indigo-900 font-medium">v1.2.4 (Latest)</div>
                        </div>

                        <button
                            onClick={() => {
                                if (window.confirm('确定要退出登录吗？')) {
                                    useAuthStore.getState().logout();
                                    onClose();
                                }
                            }}
                            className="w-full flex items-center space-x-3 px-4 py-3 rounded-2xl text-red-500 hover:bg-red-50 transition-all group"
                        >
                            <LogOut size={18} />
                            <span className="font-medium">退出登录</span>
                        </button>
                    </div>
                </div>

                {/* Right Content */}
                <div className="flex-1 flex flex-col min-w-0 bg-white">
                    <div className="p-6 border-b border-gray-50 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            {/* Optional dynamic title based on tab */}
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                        >
                            <X size={20} />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                        {renderContent()}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Settings;
