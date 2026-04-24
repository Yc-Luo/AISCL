import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users,
  Settings as SettingsIcon,
  Shield,
  LogOut,
  Box,
  Cpu,
  Database,
  Activity,
  GitBranch
} from 'lucide-react'
import { ROUTES } from '../../config/routes'
import { useAuthStore } from '../../stores/authStore'
import { adminService, SystemStats } from '../../services/api/admin'
import UserManager from '../../components/features/manager/usermanagement/UserManager'
import SystemConfig from '../../components/features/manager/settings/SystemConfig'
import BehaviorLogs from '../../components/features/manager/behavior/BehaviorLogs'
import ResearchConfig from '../../components/features/manager/research/ResearchConfig'

// Types
type TabType = 'users' | 'research' | 'system' | 'behavior'

interface NavItem {
  id: TabType
  label: string
  icon: React.ElementType
  description: string
}

// Components
const StatCard = ({
  icon: Icon,
  label,
  value,
  colorClass,
  bgClass,
  loading
}: {
  icon: React.ElementType
  label: string
  value: string | number
  colorClass: string
  bgClass: string
  loading?: boolean
}) => (
  <div className="bg-white/80 backdrop-blur-sm p-5 rounded-2xl border border-white/50 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] transition-all duration-300 group">
    <div className="flex items-center gap-4">
      <div className={`w-12 h-12 ${bgClass} rounded-2xl flex items-center justify-center ${colorClass} group-hover:scale-110 transition-transform duration-300`}>
        <Icon className="w-6 h-6" />
      </div>
      <div>
        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
        {loading ? (
          <div className="h-8 w-24 bg-slate-200 rounded animate-pulse" />
        ) : (
          <p className="text-2xl font-black text-slate-800 tracking-tight">{value}</p>
        )}
      </div>
    </div>
  </div>
)

const NAV_ITEMS: NavItem[] = [
  { id: 'users', label: '用户管理', icon: Users, description: 'Manage Users' },
  { id: 'research', label: '研究配置', icon: GitBranch, description: 'Research Config' },
  { id: 'system', label: '系统配置', icon: SettingsIcon, description: 'System Config' },
  { id: 'behavior', label: '行为数据', icon: Activity, description: 'Behavior Logs' },
]

export default function AdminDashboard() {
  const navigate = useNavigate()
  const { logout, user } = useAuthStore()
  const [activeTab, setActiveTab] = useState<TabType>('users')
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [isLoadingStats, setIsLoadingStats] = useState(true)

  useEffect(() => {
    fetchStats()
  }, [])

  const fetchStats = async () => {
    try {
      setIsLoadingStats(true)
      const data = await adminService.getSystemStats()
      setStats(data)
    } catch (error) {
      console.error('Failed to fetch system stats:', error)
    } finally {
      setIsLoadingStats(false)
    }
  }

  const handleLogout = () => {
    logout()
    navigate(ROUTES.LOGIN)
  }

  const formatStorage = (bytes: number) => {
    if (!bytes) return '0 GB'
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  }

  const formatPercent = (value: number) => `${Math.round(value * 100)}%`

  return (
    <div className="min-h-screen bg-slate-50/50 flex font-sans text-slate-900 overflow-hidden relative">
      <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-[0.03] pointer-events-none" />

      {/* Sidebar */}
      <aside className="w-80 bg-white/90 backdrop-blur-xl border-r border-slate-200/60 flex flex-col z-20 h-screen shadow-[4px_0_24px_rgba(0,0,0,0.02)] transition-all duration-300">
        {/* Branding */}
        <div className="px-6 py-8">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20 ring-4 ring-indigo-50">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="block font-black text-slate-800 text-lg tracking-tight">AISCL</span>
              <span className="block text-[10px] text-indigo-600 font-bold uppercase tracking-[0.2em]">Admin Console</span>
            </div>
          </div>

          <div className="px-3 py-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center gap-3 mb-2">
            <div className="w-8 h-8 bg-white border border-slate-200 rounded-lg flex items-center justify-center text-indigo-600 font-bold shadow-sm">
              {(user?.username || 'A')[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-slate-800 truncate">{user?.username || '管理员'}</p>
              <p className="text-[10px] text-slate-400 font-medium">System Administrator</p>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 space-y-1 overflow-y-auto custom-scrollbar">
          <div className="px-4 mb-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Management</p>
          </div>

          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group relative overflow-hidden ${activeTab === item.id
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                }`}
            >
              <item.icon className={`w-5 h-5 transition-colors ${activeTab === item.id ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'
                }`} />
              <div className="text-left">
                <span className="block font-semibold text-sm">{item.label}</span>
              </div>
              {activeTab === item.id && (
                <div className="absolute right-4 w-1.5 h-1.5 bg-white rounded-full animate-pulse shadow-[0_0_8px_rgba(255,255,255,0.8)]" />
              )}
            </button>
          ))}
        </nav>

        {/* Bottom Actions */}
        <div className="p-4 border-t border-slate-100">
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-bold text-red-600 hover:bg-red-50 rounded-xl transition-all duration-200 hover:shadow-lg hover:shadow-red-500/10 active:scale-[0.98] border border-transparent hover:border-red-100"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col min-w-0 bg-slate-50/50">
        {/* Header */}
        <header className="h-20 px-10 border-b border-slate-200/60 bg-white/80 backdrop-blur-md flex items-center justify-between sticky top-0 z-10 w-full">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-400">
            <span className="hover:text-indigo-600 cursor-pointer transition-colors">Console</span>
            <span className="text-slate-300">/</span>
            <span className="text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md">
              {NAV_ITEMS.find(i => i.id === activeTab)?.label}
            </span>
          </div>
          <div className="text-xs font-semibold text-slate-400">真实运行数据</div>
        </header>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
          <div className="max-w-[1600px] mx-auto space-y-8">

            {/* Stats Row */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 animate-slideUp">
              <StatCard
                icon={Cpu}
                label="Active User Ratio"
                value={formatPercent(stats?.system_load || 0)}
                colorClass="text-rose-600"
                bgClass="bg-rose-50"
                loading={isLoadingStats}
              />
              <StatCard
                icon={Users}
                label="Total Users"
                value={stats?.total_users || 0}
                colorClass="text-indigo-600"
                bgClass="bg-indigo-50"
                loading={isLoadingStats}
              />
              <StatCard
                icon={Box}
                label="Active Projects"
                value={stats?.active_projects || 0}
                colorClass="text-amber-600"
                bgClass="bg-amber-50"
                loading={isLoadingStats}
              />
              <StatCard
                icon={Database}
                label="Storage"
                value={formatStorage(stats?.storage_used || 0)}
                colorClass="text-emerald-600"
                bgClass="bg-emerald-50"
                loading={isLoadingStats}
              />
            </div>

            {/* Content Tab */}
            <div className="bg-white rounded-3xl border border-slate-200/60 shadow-sm min-h-[600px] overflow-hidden animate-fadeIn relative">
              <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              {activeTab === 'users' ? (
                <UserManager />
              ) : activeTab === 'research' ? (
                <ResearchConfig />
              ) : activeTab === 'system' ? (
                <SystemConfig />
              ) : (
                <BehaviorLogs />
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
