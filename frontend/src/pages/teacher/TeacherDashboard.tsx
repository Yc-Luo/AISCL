import { useState } from 'react'
import { useNavigate, Outlet, NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  BarChart3,
  Settings,
  Brain,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Monitor,
  Briefcase,
  UserCircle,
  FolderOpen,
  ClipboardCheck
} from 'lucide-react'
import { ROUTES } from '../../config/routes'

export default function TeacherDashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const [isCollapsed, setIsCollapsed] = useState(false)

  // Helper to determine if a route is active (including sub-routes)
  const isActive = (path: string) => {
    return location.pathname.startsWith(path)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex font-sans text-slate-900 overflow-hidden">
      {/* Sidebar - Adjusted to 30% as per requirements, collapsible to 80px */}
      <div className={`
        ${isCollapsed ? 'w-20' : 'w-[30%] max-w-sm'} 
        bg-white border-r border-gray-200 flex flex-col z-20 sticky top-0 h-screen shadow-sm
        transition-all duration-300 ease-in-out
      `}>
        {/* Branding */}
        <div className={`px-4 ${isCollapsed ? 'py-8' : 'px-8 py-8'} border-b border-gray-100 relative`}>
          <div className={`flex items-center gap-3 ${isCollapsed ? 'justify-center' : ''}`}>
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-indigo-100 shadow-lg flex-shrink-0">
              <Brain className="w-6 h-6 text-white" />
            </div>
            {!isCollapsed && (
              <div className="animate-fadeIn">
                <span className="block font-bold text-slate-800 text-lg">AISCL</span>
                <span className="block text-xs text-slate-400 font-medium uppercase tracking-wider">Teacher Console</span>
              </div>
            )}
          </div>

          {/* Collapse Toggle Button */}
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 bg-white border border-gray-200 rounded-full flex items-center justify-center shadow-sm hover:bg-slate-50 transition-colors z-30"
          >
            {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-slate-500" /> : <ChevronLeft className="w-3.5 h-3.5 text-slate-500" />}
          </button>
        </div>

        {/* Navigation */}
        <nav className={`flex-1 ${isCollapsed ? 'px-2' : 'px-4'} py-8 space-y-2 overflow-y-auto`}>
          <SidebarLink
            to={ROUTES.TEACHER.OVERVIEW}
            icon={LayoutDashboard}
            label="概览"
            active={isActive(ROUTES.TEACHER.OVERVIEW)}
            isCollapsed={isCollapsed}
          />
          <SidebarLink
            to={ROUTES.TEACHER.PROJECT_MONITOR}
            icon={Monitor}
            label="小组监控"
            active={isActive(ROUTES.TEACHER.PROJECT_MONITOR)}
            isCollapsed={isCollapsed}
          />
          <SidebarLink
            to={ROUTES.TEACHER.PROJECT_MANAGER}
            icon={Briefcase}
            label="小组管理"
            active={isActive(ROUTES.TEACHER.PROJECT_MANAGER)}
            isCollapsed={isCollapsed}
          />
          <SidebarLink
            to={ROUTES.TEACHER.CLASS_MANAGEMENT}
            icon={Users}
            label="班级管理"
            active={isActive(ROUTES.TEACHER.CLASS_MANAGEMENT)}
            isCollapsed={isCollapsed}
          />
          <SidebarLink
            to={ROUTES.TEACHER.STUDENTS}
            icon={UserCircle}
            label="学生列表"
            active={isActive(ROUTES.TEACHER.STUDENTS)}
            isCollapsed={isCollapsed}
          />
          <div className="my-4 border-t border-gray-100 opacity-50 mx-2" />
          <SidebarLink
            to={ROUTES.TEACHER.COURSE_RESOURCES}
            icon={FolderOpen}
            label="课程资源"
            active={isActive(ROUTES.TEACHER.COURSE_RESOURCES)}
            isCollapsed={isCollapsed}
          />
          <SidebarLink
            to={ROUTES.TEACHER.ASSIGNMENT_REVIEW}
            icon={ClipboardCheck}
            label="作业与任务评审"
            active={isActive(ROUTES.TEACHER.ASSIGNMENT_REVIEW)}
            isCollapsed={isCollapsed}
          />
          <SidebarLink
            to={ROUTES.TEACHER.PROJECT_DASHBOARD}
            icon={BarChart3}
            label="小组仪表盘"
            active={isActive(ROUTES.TEACHER.PROJECT_DASHBOARD)}
            isCollapsed={isCollapsed}
          />
          <SidebarLink
            to={ROUTES.TEACHER.SETTINGS}
            icon={Settings}
            label="设置"
            active={isActive(ROUTES.TEACHER.SETTINGS)}
            isCollapsed={isCollapsed}
          />
        </nav>

        {/* User Profile */}
        <div className={`px-2 py-6 border-t border-gray-100 bg-slate-50/50 ${isCollapsed ? '' : 'px-4'}`}>
          <div
            className={`flex items-center gap-3 py-3 hover:bg-white hover:shadow-sm rounded-xl cursor-pointer transition-all duration-200 ${isCollapsed ? 'justify-center' : 'px-4'}`}
            onClick={() => navigate(ROUTES.TEACHER.SETTINGS)}
          >
            <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center border-2 border-white shadow-sm flex-shrink-0">
              <span className="font-bold text-indigo-600">教</span>
            </div>
            {!isCollapsed && (
              <div className="flex-1 min-w-0 animate-fadeIn">
                <p className="text-sm font-bold text-slate-800 truncate">教师账号</p>
                <p className="text-xs text-slate-400 font-medium">教育讲师</p>
              </div>
            )}
          </div>
          <button
            onClick={() => {
              localStorage.removeItem('access_token');
              localStorage.removeItem('refresh_token');
              window.location.href = ROUTES.LOGIN;
            }}
            title={isCollapsed ? "退出登录" : ""}
            className={`mt-4 w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-red-500 hover:bg-red-50 rounded-xl transition-colors ${isCollapsed ? 'px-0' : 'px-4'}`}
          >
            <LogOut className={`w-5 h-5 ${isCollapsed ? '' : 'mr-1'}`} />
            <span className={isCollapsed ? 'hidden' : 'block'}>退出登录</span>
          </button>
        </div>
      </div>

      {/* Main Content - Takes remaining space */}
      <div className="w-[70%] flex-1 p-10 overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

function SidebarLink({ to, icon: Icon, label, active, isCollapsed }: { to: string, icon: any, label: string, active: boolean, isCollapsed: boolean }) {
  return (
    <NavLink
      to={to}
      title={isCollapsed ? label : ""}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors duration-150 ${isCollapsed ? 'justify-center' : ''} ${active
        ? 'bg-indigo-50 text-indigo-700'
        : 'text-slate-600 hover:bg-gray-50 hover:text-slate-900'
        }`}
    >
      <Icon className={`w-5 h-5 flex-shrink-0 ${active ? 'text-indigo-600' : 'text-slate-500'}`} />
      {!isCollapsed && <span className={`${active ? 'font-medium' : ''} animate-fadeIn`}>{label}</span>}
    </NavLink>
  )
}
