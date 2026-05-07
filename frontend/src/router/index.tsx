import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'
import { lazy, Suspense, useEffect } from 'react'
import type { ReactNode } from 'react'
import { ROUTES } from '../config/routes'

import LoadingPage from '../pages/shared/Loading'

const Login = lazy(() => import('../pages/auth/Login'))
const RequestResetPassword = lazy(() => import('../pages/auth/RequestResetPassword'))
const ResetPassword = lazy(() => import('../pages/auth/ResetPassword'))
const ProjectWorkspace = lazy(() => import('../pages/student/ProjectWorkspace'))
const ProjectList = lazy(() => import('../pages/student/ProjectList'))
const TeacherDashboard = lazy(() => import('../pages/teacher/TeacherDashboard'))
const AdminDashboard = lazy(() => import('../pages/manager/AdminDashboard'))
const Settings = lazy(() => import('../pages/student/Settings'))
const ProjectSettings = lazy(() => import('../pages/student/ProjectSettings'))
const NotFound = lazy(() => import('../pages/shared/NotFound'))
const ProjectMonitor = lazy(() => import('../components/features/teacher/projectmonitor/ProjectMonitor'))
const ClassManagement = lazy(() => import('../components/features/teacher/classmanagement/ClassManagement'))
const StudentList = lazy(() => import('../components/features/teacher/studentlist/StudentList'))
const ProjectManager = lazy(() => import('../components/features/teacher/projectmanager/ProjectManager'))
const ProjectDashboard = lazy(() => import('../components/features/teacher/studentanalytics/ProjectDashboard'))
const TeacherSettings = lazy(() => import('../components/features/teacher/settings/TeacherSettings'))
const DashboardOverview = lazy(() => import('../components/features/teacher/overview/DashboardOverview'))
const CourseResource = lazy(() => import('../components/features/teacher/courseresource/CourseResource'))
const CourseTaskRelease = lazy(() => import('../components/features/teacher/taskrelease/CourseTaskRelease'))
const AssignmentReview = lazy(() => import('../components/features/teacher/assignmentreview/AssignmentReview'))


function ProtectedRoute({ children }: { children: ReactNode }) {
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
  children: ReactNode
}) {
  const { user } = useAuthStore()

  if (!user || !allowedRoles.includes(user.role)) {
    return <Navigate to={ROUTES.HOME} replace />
  }

  return <>{children}</>
}

export function Router() {
  return (
    <Suspense fallback={<LoadingPage />}>
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
        <Route path="task-releases" element={<CourseTaskRelease />} />
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
    </Suspense>
  )
}
