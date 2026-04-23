# AISCL 前端架构重构实施指南

## 现状分析

### 当前架构问题

1. **组件组织混乱**
   - `components/` 下分类标准不统一
   - 功能相关组件分散 (RemoteCursors 在两个地方)
   - 缺少组件职责划分规范

2. **页面架构臃肿**
   - 页面组件与业务逻辑耦合严重
   - 缺少页面级别的组件封装

3. **服务层结构简单**
   - 所有 API 调用在同一级目录
   - 缺少业务逻辑封装
   - 错误处理分散

4. **类型定义单一**
   - 所有类型在一个 `types/index.ts` 文件中
   - 缺少按模块分类的类型定义

## 重构目标架构

```
frontend/src/
├── components/
│   ├── ui/              # 基础UI组件 (Button, Input, Modal等)
│   ├── layout/          # 布局组件 (Sidebar, Header等)
│   ├── forms/           # 表单组件 (LoginForm, ProjectForm等)
│   ├── feedback/        # 反馈组件 (Loading, Alert, Toast等)
│   ├── features/        # 功能组件 (按业务域划分)
│   │   ├── auth/        # 认证相关组件
│   │   ├── student/     # 学生相关组件
│   │   │   ├── whiteboard/  # 白板功能组件
│   │   │   ├── document/    # 文档功能组件
│   │   │   ├── chat/        # 聊天功能组件
│   │   │   ├── ai/          # AI功能组件
│   │   │   ├── dashboard/   # 仪表盘组件
│   │   │   ├── resources/   # 资源管理组件
│   │   │   ├── browser/     # 浏览器批注组件
│   │   │   └── settings/    # 设置组件
│   │   ├── teacher/     # 教师相关组件
│   │   │   ├── teacheroverview/   # 仪表盘组件
│   │   │   ├── classmanagement/   # 课程管理组件
│   │   │   ├── studentanalytics/   # 学生分析组件
│   │   │   ├── coursereource/   # 课程资源组件
│   │   │   ├── assignmentreview/   # 作业评审组件
│   │   │   └── settings/    # 设置组件
│   │   └── manager/     # 管理员相关组件
│   │       ├── usermanagement/     # 用户管理组件
│   │       ├── datamanagement/    # 数据管理组件
│   │       ├── aimanager/    # AI管理组件
│   │       └── settings/    # 设置组件
│   └── shared/          # 跨功能共享组件
│
├── pages/
│   ├── auth/            # 认证页面 (Login, Register等)
│   ├── student/         # 学生页面 (Workspace, Settings等)
│   ├── teacher/         # 教师页面 (Teacher, Admin等)
│   ├── manager/         # 管理员页面 (Manager, Settings等)
│   └── shared/          # 共享页面 (404, Loading等)
│
├── services/
│   ├── api/             # API客户端层 (基础HTTP请求)
│   └── repositories/    # 数据仓库层 (业务数据管理)
│
├── types/
│   ├── api/             # API相关类型
│   ├── domain/          # 业务域类型
│   ├── ui/              # UI组件类型
│   └── shared/          # 共享类型
│
├── hooks/
│   ├── auth/            # 认证相关hooks
│   ├── project/         # 项目相关hooks
│   ├── websocket/       # WebSocket相关hooks
│   └── common/          # 通用hooks
│
├── stores/
│   ├── auth.ts          # 认证状态
│   ├── project.ts       # 项目状态
│   ├── ui.ts            # UI状态
│   └── websocket.ts     # WebSocket状态
│
├── utils/
│   ├── formatters/      # 格式化工具
│   ├── validators/      # 验证工具
│   ├── constants/       # 常量定义
│   └── helpers/         # 辅助函数
│
└── config/
    ├── routes.ts        # 路由配置
    ├── api.ts           # API配置
    ├── websocket.ts     # WebSocket配置
    └── constants.ts     # 应用常量
```


## 具体重构步骤

### Phase 1: 目录结构重构

#### 1.1 创建新目录结构
```bash
# 创建组件新结构
mkdir -p components/{ui,layout,forms,feedback,features/shared}
mkdir -p components/features/auth
mkdir -p components/features/student/{whiteboard,document,chat,ai,dashboard,resources,browser,settings}
mkdir -p components/features/teacher/{teacheroverview,classmanagement,studentanalytics,courseresource,assignmentreview,settings}
mkdir -p components/features/manager/{usermanagement,datamanagement,aimanager,settings}

# 创建页面新结构
mkdir -p pages/{auth,shared}
mkdir -p pages/student
mkdir -p pages/teacher
mkdir -p pages/manager

# 创建服务新结构
mkdir -p services/{api,repositories}

# 创建类型新结构
mkdir -p types/{api,domain,ui,shared}

# 创建hooks新结构
mkdir -p hooks/{auth,project,websocket,common}

# 创建utils新结构
mkdir -p utils/{formatters,validators,constants,helpers}
```

#### 1.2 迁移基础UI组件
```bash
# 迁移现有的UI组件到新结构
mv components/ui/* components/ui/
# 新建标准化的基础组件
```

### Phase 2: 组件重构

#### 2.1 重构布局组件
```typescript
// components/layout/AppLayout.tsx - 主应用布局
interface AppLayoutProps {
  children: React.ReactNode
  showSidebar?: boolean
  showHeader?: boolean
}

export function AppLayout({ children, showSidebar = true, showHeader = true }: AppLayoutProps) {
  return (
    <div className="app-layout">
      {showHeader && <Header />}
      <div className="app-content">
        {showSidebar && <Sidebar />}
        <main className="main-content">
          {children}
        </main>
      </div>
    </div>
  )
}

// components/layout/WorkspaceLayout.tsx - 工作空间布局
interface WorkspaceLayoutProps {
  leftSidebar: React.ReactNode
  mainContent: React.ReactNode
  rightSidebar: React.ReactNode
  leftSidebarOpen: boolean
  rightSidebarOpen: boolean
}

export function WorkspaceLayout({
  leftSidebar,
  mainContent,
  rightSidebar,
  leftSidebarOpen,
  rightSidebarOpen
}: WorkspaceLayoutProps) {
  return (
    <div className="workspace-layout">
      {leftSidebarOpen && <aside className="left-sidebar">{leftSidebar}</aside>}
      <main className="workspace-main">{mainContent}</main>
      {rightSidebarOpen && <aside className="right-sidebar">{rightSidebar}</aside>}
    </div>
  )
}
```

#### 2.2 重构功能组件
```typescript
// components/features/project/ProjectWorkspace.tsx
interface ProjectWorkspaceProps {
  projectId: string
  activeTab: string
  onTabChange: (tab: string) => void
}

export function ProjectWorkspace({ projectId, activeTab, onTabChange }: ProjectWorkspaceProps) {
  const { project, loading } = useProject(projectId)

  if (loading) return <LoadingSpinner />
  if (!project) return <ProjectNotFound />

  return (
    <WorkspaceLayout
      leftSidebar={<ProjectSidebar project={project} />}
      mainContent={
        <TabNavigation activeTab={activeTab} onTabChange={onTabChange}>
          <TabPanel tabId="whiteboard">
            <WhiteboardCanvas projectId={projectId} />
          </TabPanel>
          <TabPanel tabId="document">
            <DocumentEditor projectId={projectId} />
          </TabPanel>
          {/* ... 其他标签页 */}
        </TabNavigation>
      }
      rightSidebar={<ChatPanel projectId={projectId} />}
      leftSidebarOpen={true}
      rightSidebarOpen={true}
    />
  )
}
```

#### 2.3 重构表单组件
```typescript
// components/forms/LoginForm.tsx
interface LoginFormProps {
  onSubmit: (data: LoginData) => Promise<void>
  loading?: boolean
  error?: string
}

export function LoginForm({ onSubmit, loading, error }: LoginFormProps) {
  const [formData, setFormData] = useState<LoginData>({
    email: '',
    password: ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSubmit(formData)
  }

  return (
    <form onSubmit={handleSubmit} className="login-form">
      <Input
        type="email"
        placeholder="邮箱"
        value={formData.email}
        onChange={(value) => setFormData(prev => ({ ...prev, email: value }))}
        required
      />
      <Input
        type="password"
        placeholder="密码"
        value={formData.password}
        onChange={(value) => setFormData(prev => ({ ...prev, password: value }))}
        required
      />
      {error && <ErrorMessage message={error} />}
      <Button type="submit" loading={loading}>
        登录
      </Button>
    </form>
  )
}
```

### Phase 3: 页面重构

#### 3.1 页面容器模式
```typescript
// pages/project/ProjectWorkspace.container.tsx
export default function ProjectWorkspaceContainer() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  // 数据获取和状态管理
  const { project, loading, error } = useProject(projectId)

  // 业务逻辑
  const handleTabChange = useCallback((tab: string) => {
    // 标签页切换逻辑
  }, [])

  if (loading) return <LoadingPage />
  if (error) return <ErrorPage error={error} />
  if (!project) {
    navigate('/projects')
    return null
  }

  return (
    <ProjectWorkspacePage
      project={project}
      onTabChange={handleTabChange}
    />
  )
}

// pages/project/ProjectWorkspace.page.tsx
interface ProjectWorkspacePageProps {
  project: Project
  onTabChange: (tab: string) => void
}

export function ProjectWorkspacePage({ project, onTabChange }: ProjectWorkspacePageProps) {
  const [activeTab, setActiveTab] = useState('whiteboard')
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true)

  const handleTabChange = (tab: string) => {
    setActiveTab(tab)
    onTabChange(tab)
  }

  return (
    <AppLayout>
      <WorkspaceLayout
        leftSidebar={
          <ProjectSidebar
            project={project}
            onToggle={() => setLeftSidebarOpen(!leftSidebarOpen)}
          />
        }
        mainContent={
          <ProjectWorkspace
            projectId={project.id}
            activeTab={activeTab}
            onTabChange={handleTabChange}
          />
        }
        rightSidebar={
          <ChatPanel
            projectId={project.id}
            onToggle={() => setRightSidebarOpen(!rightSidebarOpen)}
          />
        }
        leftSidebarOpen={leftSidebarOpen}
        rightSidebarOpen={rightSidebarOpen}
      />
    </AppLayout>
  )
}
```

### Phase 4: 服务层重构

#### 4.1 API客户端层
```typescript
// services/api/base.ts
export class ApiClient {
  private client: AxiosInstance

  constructor(baseURL: string) {
    this.client = axios.create({
      baseURL,
      timeout: 10000,
    })

    this.setupInterceptors()
  }

  private setupInterceptors() {
    // 请求拦截器 - 添加认证头
    this.client.interceptors.request.use((config) => {
      const token = getAuthToken()
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
      }
      return config
    })

    // 响应拦截器 - 处理错误和token刷新
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        if (error.response?.status === 401) {
          // Token过期，尝试刷新
          await refreshAuthToken()
          // 重试原始请求
          return this.client.request(error.config)
        }
        throw error
      }
    )
  }

  async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get(url, config)
    return response.data
  }

  async post<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.post(url, data, config)
    return response.data
  }

  // ... 其他HTTP方法
}

// services/api/projectApi.ts
export class ProjectApi {
  constructor(private client: ApiClient) {}

  async getProjects(): Promise<Project[]> {
    return this.client.get('/api/v1/projects')
  }

  async getProject(id: string): Promise<Project> {
    return this.client.get(`/api/v1/projects/${id}`)
  }

  async createProject(data: CreateProjectData): Promise<Project> {
    return this.client.post('/api/v1/projects', data)
  }

  async updateProject(id: string, data: UpdateProjectData): Promise<Project> {
    return this.client.put(`/api/v1/projects/${id}`, data)
  }

  async deleteProject(id: string): Promise<void> {
    return this.client.delete(`/api/v1/projects/${id}`)
  }
}
```

#### 4.2 数据仓库层
```typescript
// services/repositories/projectRepository.ts
export class ProjectRepository {
  constructor(private api: ProjectApi) {}

  private cache = new Map<string, Project>()
  private cacheExpiry = new Map<string, number>()
  private readonly CACHE_TTL = 5 * 60 * 1000 // 5分钟

  async getProjects(forceRefresh = false): Promise<Project[]> {
    const cacheKey = 'projects:list'

    if (!forceRefresh && this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey) as Project[]
    }

    const projects = await this.api.getProjects()
    this.setCache(cacheKey, projects)
    return projects
  }

  async getProject(id: string, forceRefresh = false): Promise<Project> {
    const cacheKey = `projects:${id}`

    if (!forceRefresh && this.isCacheValid(cacheKey)) {
      return this.cache.get(cacheKey) as Project
    }

    const project = await this.api.getProject(id)
    this.setCache(cacheKey, project)
    return project
  }

  async createProject(data: CreateProjectData): Promise<Project> {
    const project = await this.api.createProject(data)

    // 使列表缓存失效
    this.invalidateCache('projects:list')

    return project
  }

  async updateProject(id: string, data: UpdateProjectData): Promise<Project> {
    const project = await this.api.updateProject(id, data)

    // 使相关缓存失效
    this.invalidateCache(`projects:${id}`)
    this.invalidateCache('projects:list')

    return project
  }

  private isCacheValid(key: string): boolean {
    const expiry = this.cacheExpiry.get(key)
    return expiry ? Date.now() < expiry : false
  }

  private setCache(key: string, data: any): void {
    this.cache.set(key, data)
    this.cacheExpiry.set(key, Date.now() + this.CACHE_TTL)
  }

  private invalidateCache(key: string): void {
    this.cache.delete(key)
    this.cacheExpiry.delete(key)
  }

  clearCache(): void {
    this.cache.clear()
    this.cacheExpiry.clear()
  }
}
```

#### 4.3 业务逻辑说明
由于采用了 **Store-First** 策略，复杂的业务逻辑（如权限检查、数据验证、通知发送）将直接封装在 Zustand Store 的 Actions 中，不再设立独立的 Business Service 层。这种方式更符合 React 生态的开发习惯，能减少样板代码。

### Phase 5: 类型定义重构

#### 5.1 业务域类型
```typescript
// types/domain/project.ts
export interface Project {
  id: string
  name: string
  description?: string
  owner_id: string
  members: ProjectMember[]
  progress: number
  is_template: boolean
  is_archived: boolean
  created_at: string
  updated_at: string
}

export interface ProjectMember {
  user_id: string
  role: 'owner' | 'editor' | 'viewer'
  joined_at: string
}

export interface CreateProjectData {
  name: string
  description?: string
  members?: string[]
  is_template?: boolean
}

export interface UpdateProjectData {
  name?: string
  description?: string
  progress?: number
  is_archived?: boolean
}
```

#### 5.2 API类型
```typescript
// types/api/common.ts
export interface ApiResponse<T> {
  data: T
  message?: string
  errors?: string[]
  meta?: {
    pagination?: PaginationMeta
    timestamp: string
  }
}

export interface PaginationMeta {
  page: number
  limit: number
  total: number
  total_pages: number
}

export interface ApiError {
  code: string
  message: string
  details?: any
}

// types/api/project.ts
export type ProjectListResponse = ApiResponse<Project[]>
export type ProjectResponse = ApiResponse<Project>
export type CreateProjectResponse = ApiResponse<Project>
export type UpdateProjectResponse = ApiResponse<Project>
```

#### 5.3 UI组件类型
```typescript
// types/ui/common.ts
export interface BaseComponentProps {
  className?: string
  children?: React.ReactNode
  testId?: string
  'data-testid'?: string
}

export interface LoadingProps extends BaseComponentProps {
  size?: 'sm' | 'md' | 'lg'
  text?: string
}

export interface ButtonProps extends BaseComponentProps {
  variant?: 'primary' | 'secondary' | 'danger' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  disabled?: boolean
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void
  type?: 'button' | 'submit' | 'reset'
}

// types/ui/project.ts
export interface ProjectCardProps extends BaseComponentProps {
  project: Project
  onClick?: (project: Project) => void
  onEdit?: (project: Project) => void
  onDelete?: (project: Project) => void
  showActions?: boolean
}

export interface ProjectListProps extends BaseComponentProps {
  projects: Project[]
  loading?: boolean
  onProjectClick?: (project: Project) => void
  onCreateProject?: () => void
}
```

### Phase 6: 状态管理重构

#### 6.1 项目状态管理
```typescript
// stores/project.ts
interface ProjectState {
  // 数据状态
  currentProject: Project | null
  projects: Project[]
  projectMembers: Record<string, ProjectMember[]>

  // UI状态
  activeTab: string
  leftSidebarOpen: boolean
  rightSidebarOpen: boolean

  // 异步状态
  loading: boolean
  error: string | null

  // 操作状态
  creatingProject: boolean
  updatingProject: boolean
  deletingProject: boolean
}

interface ProjectActions {
  // 数据操作
  setCurrentProject: (project: Project | null) => void
  setProjects: (projects: Project[]) => void
  addProject: (project: Project) => void
  updateProject: (id: string, updates: Partial<Project>) => void
  removeProject: (id: string) => void

  // UI操作
  setActiveTab: (tab: string) => void
  toggleLeftSidebar: () => void
  toggleRightSidebar: () => void

  // 异步操作
  loadProjects: () => Promise<void>
  loadProject: (id: string) => Promise<void>
  createProject: (data: CreateProjectData) => Promise<Project>
  updateProjectAsync: (id: string, data: UpdateProjectData) => Promise<Project>
  deleteProjectAsync: (id: string) => Promise<void>

  // 错误处理
  setError: (error: string | null) => void
  clearError: () => void
}

export const useProjectStore = create<ProjectState & ProjectActions>((set, get) => ({
  // 初始状态
  currentProject: null,
  projects: [],
  projectMembers: {},
  activeTab: 'whiteboard',
  leftSidebarOpen: true,
  rightSidebarOpen: true,
  loading: false,
  error: null,
  creatingProject: false,
  updatingProject: false,
  deletingProject: false,

  // 数据操作
  setCurrentProject: (project) => set({ currentProject: project }),
  setProjects: (projects) => set({ projects }),
  addProject: (project) => set((state) => ({
    projects: [...state.projects, project]
  })),
  updateProject: (id, updates) => set((state) => ({
    projects: state.projects.map(p => p.id === id ? { ...p, ...updates } : p),
    currentProject: state.currentProject?.id === id
      ? { ...state.currentProject, ...updates }
      : state.currentProject
  })),
  removeProject: (id) => set((state) => ({
    projects: state.projects.filter(p => p.id !== id),
    currentProject: state.currentProject?.id === id ? null : state.currentProject
  })),

  // UI操作
  setActiveTab: (tab) => set({ activeTab: tab }),
  toggleLeftSidebar: () => set((state) => ({ leftSidebarOpen: !state.leftSidebarOpen })),
  toggleRightSidebar: () => set((state) => ({ rightSidebarOpen: !state.rightSidebarOpen })),

  // 异步操作
  loadProjects: async () => {
    set({ loading: true, error: null })
    try {
      const projects = await projectService.getProjects()
      set({ projects, loading: false })
    } catch (error) {
      set({ error: error.message, loading: false })
    }
  },

  loadProject: async (id) => {
    set({ loading: true, error: null })
    try {
      const project = await projectService.getProject(id)
      set({ currentProject: project, loading: false })
    } catch (error) {
      set({ error: error.message, loading: false })
    }
  },

  createProject: async (data) => {
    set({ creatingProject: true, error: null })
    try {
      // 1. 业务验证
      if (!data.name?.trim()) throw new Error('项目名称不能为空')
      
      // 2. 调用API层
      const project = await projectApi.createProject(data)
      
      // 3. 更新本地状态
      get().addProject(project)
      
      // 4. 后置操作 (如日志、通知)
      console.log(`Project created: ${project.name}`)
      
      set({ creatingProject: false })
      return project
    } catch (error) {
      set({ error: error.message, creatingProject: false })
      throw error
    }
  },

  updateProjectAsync: async (id, data) => {
    set({ updatingProject: true, error: null })
    try {
      const project = await projectService.updateProject(id, data)
      get().updateProject(id, project)
      set({ updatingProject: false })
      return project
    } catch (error) {
      set({ error: error.message, updatingProject: false })
      throw error
    }
  },

  deleteProjectAsync: async (id) => {
    set({ deletingProject: true, error: null })
    try {
      await projectService.deleteProject(id)
      get().removeProject(id)
      set({ deletingProject: false })
    } catch (error) {
      set({ error: error.message, deletingProject: false })
      throw error
    }
  },

  // 错误处理
  setError: (error) => set({ error }),
  clearError: () => set({ error: null })
}))
```

#### 6.2 UI状态管理
```typescript
// stores/ui.ts
interface UiState {
  // 模态框状态
  modals: Record<string, boolean>

  // 通知状态
  notifications: Notification[]

  // 加载状态
  loadingStates: Record<string, boolean>

  // 响应式状态
  sidebarCollapsed: boolean
  theme: 'light' | 'dark'
}

interface UiActions {
  // 模态框操作
  openModal: (modalId: string) => void
  closeModal: (modalId: string) => void
  toggleModal: (modalId: string) => void

  // 通知操作
  addNotification: (notification: Omit<Notification, 'id'>) => void
  removeNotification: (id: string) => void
  clearNotifications: () => void

  // 加载状态操作
  setLoading: (key: string, loading: boolean) => void

  // UI设置操作
  toggleSidebar: () => void
  setTheme: (theme: 'light' | 'dark') => void
}

export const useUiStore = create<UiState & UiActions>((set, get) => ({
  // 初始状态
  modals: {},
  notifications: [],
  loadingStates: {},
  sidebarCollapsed: false,
  theme: 'light',

  // 模态框操作
  openModal: (modalId) => set((state) => ({
    modals: { ...state.modals, [modalId]: true }
  })),
  closeModal: (modalId) => set((state) => ({
    modals: { ...state.modals, [modalId]: false }
  })),
  toggleModal: (modalId) => set((state) => ({
    modals: { ...state.modals, [modalId]: !state.modals[modalId] }
  })),

  // 通知操作
  addNotification: (notification) => set((state) => ({
    notifications: [...state.notifications, {
      ...notification,
      id: Date.now().toString(),
      timestamp: new Date().toISOString()
    }]
  })),
  removeNotification: (id) => set((state) => ({
    notifications: state.notifications.filter(n => n.id !== id)
  })),
  clearNotifications: () => set({ notifications: [] }),

  // 加载状态操作
  setLoading: (key, loading) => set((state) => ({
    loadingStates: { ...state.loadingStates, [key]: loading }
  })),

  // UI设置操作
  toggleSidebar: () => set((state) => ({
    sidebarCollapsed: !state.sidebarCollapsed
  })),
  setTheme: (theme) => set({ theme })
}))
```

### Phase 7: Hooks重构

#### 7.1 项目相关Hooks
```typescript
// hooks/project/useProject.ts
export function useProject(projectId?: string) {
  const {
    currentProject,
    loading,
    error,
    loadProject
  } = useProjectStore()

  useEffect(() => {
    if (projectId && projectId !== currentProject?.id) {
      loadProject(projectId)
    }
  }, [projectId, currentProject?.id, loadProject])

  return {
    project: currentProject,
    loading,
    error,
    refetch: () => projectId && loadProject(projectId)
  }
}

// hooks/project/useProjectActions.ts
export function useProjectActions() {
  const {
    createProject,
    updateProjectAsync,
    deleteProjectAsync,
    creatingProject,
    updatingProject,
    deletingProject
  } = useProjectStore()

  return {
    createProject,
    updateProject: updateProjectAsync,
    deleteProject: deleteProjectAsync,
    creating: creatingProject,
    updating: updatingProject,
    deleting: deletingProject
  }
}

// hooks/project/useProjectTabs.ts
export function useProjectTabs() {
  const { activeTab, setActiveTab } = useProjectStore()

  const tabs = [
    { id: 'whiteboard', label: '白板', icon: 'board' },
    { id: 'document', label: '文档', icon: 'document' },
    { id: 'resources', label: '资源', icon: 'folder' },
    { id: 'browser', label: '浏览器', icon: 'globe' },
    { id: 'ai', label: 'AI助手', icon: 'sparkles' },
    { id: 'dashboard', label: '仪表盘', icon: 'chart' }
  ]

  return {
    activeTab,
    tabs,
    setActiveTab,
    isActive: (tabId: string) => activeTab === tabId
  }
}
```

#### 7.2 WebSocket相关Hooks
```typescript
// hooks/websocket/useCollaboration.ts
export function useCollaboration(config: CollaborationConfig) {
  const { projectId, resourceId, resourceType, skipYjs } = config

  // Socket.IO连接
  const socketConnection = useSocketIO({
    projectId,
    enabled: !!projectId
  })

  // Y.js连接 (仅在需要时)
  const yjsConnection = useYjsConnection({
    projectId,
    resourceId,
    resourceType,
    enabled: !!projectId && !skipYjs
  })

  // 连接状态
  const isConnected = socketConnection.isConnected && (!yjsConnection.enabled || yjsConnection.isConnected)
  const connectionStatus = socketConnection.status

  return {
    // 连接状态
    isConnected,
    connectionStatus,

    // Socket.IO
    socket: socketConnection.socket,
    emit: socketConnection.emit,
    on: socketConnection.on,
    off: socketConnection.off,

    // Y.js (如果启用)
    yjs: yjsConnection.enabled ? {
      doc: yjsConnection.doc,
      provider: yjsConnection.provider,
      awareness: yjsConnection.awareness
    } : null,

    // 用户状态
    onlineUsers: socketConnection.onlineUsers,
    userPresence: socketConnection.userPresence
  }
}

// hooks/websocket/useRealtimeSync.ts
export function useRealtimeSync(resourceType: string, resourceId?: string) {
  const { emit, on } = useSocketIO()

  const sendUpdate = useCallback((update: any) => {
    emit('resource:update', {
      type: resourceType,
      resourceId,
      update,
      timestamp: Date.now()
    })
  }, [emit, resourceType, resourceId])

  const subscribeToUpdates = useCallback((callback: (update: any) => void) => {
    const handleUpdate = (data: any) => {
      if (data.type === resourceType && data.resourceId === resourceId) {
        callback(data.update)
      }
    }

    on('resource:update', handleUpdate)

    return () => off('resource:update', handleUpdate)
  }, [on, off, resourceType, resourceId])

  return {
    sendUpdate,
    subscribeToUpdates
  }
}
```

## 迁移清单

### 立即执行的任务
- [ ] 创建新的目录结构
- [ ] 迁移基础UI组件 (`components/ui/`)
- [ ] 重构布局组件 (`components/layout/`)
- [ ] 按功能重组现有组件

### 短期任务 (1-2周)
- [ ] 重构页面组件，采用容器/展示模式
- [ ] 实现分层的服务架构 (API/Repository/Business)
- [ ] 重构类型定义，按模块组织
- [ ] 完善状态管理，添加项目和UI状态

### 长期任务 (2-4周)
- [ ] 重构所有功能组件
- [ ] 实现自定义Hooks系统
- [ ] 添加完整的错误处理
- [ ] 编写单元测试和集成测试

## 预期收益

### 开发效率提升
- **组件重用**: 标准化组件设计，提高重用率
- **类型安全**: 模块化的类型定义，减少运行时错误
- **代码导航**: 清晰的文件结构，快速定位代码

### 维护性改善
- **职责分离**: 每个模块职责明确，便于维护
- **依赖管理**: 清晰的依赖关系，易于重构
- **测试友好**: 模块化设计，便于单元测试

### 用户体验优化
- **性能提升**: 优化的状态管理和渲染
- **错误处理**: 完善的错误提示和恢复机制
- **响应式设计**: 更好的移动端适配

这个重构方案将显著提升前端代码的质量、可维护性和开发效率。

