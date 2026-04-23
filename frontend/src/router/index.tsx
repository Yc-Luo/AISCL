import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { useEffect } from 'react'
import { ROUTES } from '../config/routes'

// Pages
import Login from '../pages/auth/Login'
import RequestResetPassword from '../pages/auth/RequestResetPassword'
import ResetPassword from '../pages/auth/ResetPassword'
import ProjectWorkspace from '../pages/student/ProjectWorkspace'
import ProjectList from '../pages/student/ProjectList'
import TeacherDashboard from '../pages/teacher/TeacherDashboard'
import AdminDashboard from '../pages/manager/AdminDashboard'
import Settings from '../pages/student/Settings'
import ProjectSettings from '../pages/student/ProjectSettings'
import NotFound from '../pages/shared/NotFound'
import LoadingPage from '../pages/shared/Loading'
import ProjectMonitor from '../components/features/teacher/projectmonitor/ProjectMonitor'
import ClassManagement from '../components/features/teacher/classmanagement/ClassManagement'
import StudentList from '../components/features/teacher/studentlist/StudentList'
import ProjectManager from '../components/features/teacher/projectmanager/ProjectManager'
import ProjectDashboard from '../components/features/teacher/studentanalytics/ProjectDashboard'
import TeacherSettings from '../components/features/teacher/settings/TeacherSettings'
import DashboardOverview from '../components/features/teacher/overview/DashboardOverview'
import CourseResource from '../components/features/teacher/courseresource/CourseResource'
import AssignmentReview from '../components/features/teacher/assignmentreview/AssignmentReview'


function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, isInitialized, fetchUser } = useAuthStore()

  useEffect(() => {
    if (!isInitialized && !isLoading) {
      fetchUser()
    }
  }, [isInitialized, isLoading, fetchUser])

  if (!isInitialized || isLoading) {
    return <LoadingPage />
  }

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} replace />
  }

  return <>{children}</>
}

function RoleBasedRoute({
  allowedRoles,
  children,
}: {
  allowedRoles: string[]
  children: React.ReactNode
}) {
  const { user } = useAuthStore()

  if (!user || !allowedRoles.includes(user.role)) {
    return <Navigate to={ROUTES.HOME} replace />
  }

  return <>{children}</>
}

export function Router() {
  return (
    <Routes>
      <Route path="/forgot-password" element={<RequestResetPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path={ROUTES.LOGIN} element={<Login />} />

      {/* Root redirects to Project List for students by default */}
      <Route
        path={ROUTES.HOME}
        element={
          <ProtectedRoute>
            <ProjectList />
          </ProtectedRoute>
        }
      />

      {/* Student Routes */}
      <Route
        path={ROUTES.STUDENT.PROJECT_LIST}
        element={
          <ProtectedRoute>
            <ProjectList />
          </ProtectedRoute>
        }
      />
      <Route
        path={ROUTES.STUDENT.SETTINGS}
        element={
          <ProtectedRoute>
            <Settings />
          </ProtectedRoute>
        }
      />
      <Route
        path={ROUTES.STUDENT.INQUIRY}
        element={
          <ProtectedRoute>
            <ProjectWorkspace />
          </ProtectedRoute>
        }
      />
      {/* For simplicity in existing components, we map other workspace views to Main as well */}
      <Route
        path={ROUTES.STUDENT.DOCUMENT}
        element={
          <ProtectedRoute>
            <ProjectWorkspace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/project/:projectId"
        element={
          <ProtectedRoute>
            <ProjectWorkspace />
          </ProtectedRoute>
        }
      />
      <Route
        path={ROUTES.STUDENT.DASHBOARD}
        element={
          <ProtectedRoute>
            <ProjectWorkspace />
          </ProtectedRoute>
        }
      />
      <Route
        path="/project/:projectId/settings"
        element={
          <ProtectedRoute>
            <ProjectSettings />
          </ProtectedRoute>
        }
      />

      {/* Teacher Routes */}
      <Route
        path={ROUTES.TEACHER.DASHBOARD}
        element={
          <ProtectedRoute>
            <RoleBasedRoute allowedRoles={['teacher', 'admin']}>
              <TeacherDashboard />
            </RoleBasedRoute>
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="overview" replace />} />
        <Route path="overview" element={<DashboardOverview />} />
        <Route path="class-manager" element={<ClassManagement />} />
        <Route path="student-list" element={<StudentList />} />
        <Route path="project-manager" element={<ProjectManager />} />
        <Route path="project-monitor" element={<ProjectMonitor />} />
        <Route path="project-dashboard" element={<ProjectDashboard />} />
        <Route path="resources" element={<CourseResource />} />
        <Route path="assignments" element={<AssignmentReview />} />
        <Route path="settings" element={<TeacherSettings />} />
      </Route>

      {/* Manager Routes */}
      <Route
        path={ROUTES.MANAGER.DASHBOARD}
        element={
          <ProtectedRoute>
            <RoleBasedRoute allowedRoles={['admin']}>
              <AdminDashboard />
            </RoleBasedRoute>
          </ProtectedRoute>
        }
      />

      {/* Legacy/Refactored Paths */}
      <Route path="/admin" element={<Navigate to={ROUTES.MANAGER.DASHBOARD} replace />} />
      <Route path="/teacher-dashboard" element={<Navigate to={ROUTES.TEACHER.DASHBOARD} replace />} />

      {/* 404 Route */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
