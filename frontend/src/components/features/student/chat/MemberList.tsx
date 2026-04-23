import { useEffect, useState } from 'react'
import { useRoomStore } from '../../../../stores/roomStore'
import { projectService } from '../../../../services/api/project'
import { userService } from '../../../../services/api/user'
import { Project, User } from '../../../../types'

interface MemberListProps {
  projectId: string
}

export default function MemberList({ projectId }: MemberListProps) {
  const [project, setProject] = useState<Project | null>(null)
  const [members, setMembers] = useState<User[]>([])
  const [onlineMembers, setOnlineMembers] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const { roomUsers } = useRoomStore()
  const roomId = `project:${projectId}`
  const projectRoomUsers = roomUsers[roomId] || []

  useEffect(() => {
    const fetchProject = async () => {
      if (loading && project) return // Prevent duplicate fetches

      try {
        setLoading(true)
        const data = await projectService.getProject(projectId)
        setProject(data)

        // Fetch member details
        const memberIds = data.members.map((m: any) => m.user_id)
        if (memberIds.length > 0) {
          try {
            const memberUsers = await userService.getUsers(memberIds)
            setMembers(memberUsers)
          } catch (error) {
            console.error('Failed to fetch members:', error)
          }
        }
      } catch (error) {
        console.error('Failed to fetch project:', error)
      } finally {
        setLoading(false)
      }
    }

    if (projectId) {
      fetchProject()
    }
  }, [projectId])

  // Update online members from RoomStore
  useEffect(() => {
    if (projectRoomUsers) {
      // Filter users who are marked as online in the store
      const onlineIds = new Set(
        projectRoomUsers
          .filter(u => u.isOnline)
          .map(u => u.id)
      )

      // Only update if the set has actually changed to avoid infinite cycles
      setOnlineMembers(prev => {
        if (prev.size !== onlineIds.size) return onlineIds
        for (const id of onlineIds) {
          if (!prev.has(id)) return onlineIds
        }
        return prev
      })
    }
  }, [projectRoomUsers])

  if (loading) {
    return <div className="p-4">加载中...</div>
  }

  if (!project) {
    return <div className="p-4">小组不存在</div>
  }

  const getMemberUser = (userId: string) => {
    return members.find(m => m.id === userId)
  }

  const getMemberRole = (userId: string) => {
    return project.members.find((m: any) => m.user_id === userId)?.role || 'viewer'
  }

  const isOnline = (userId: string) => {
    return onlineMembers.has(userId)
  }

  return (
    <div className="p-4 space-y-2">
      <h3 className="font-semibold text-sm mb-3">小组成员</h3>
      <div className="space-y-2">
        {project.members.map((member: any) => {
          const memberUser = getMemberUser(member.user_id)
          const role = getMemberRole(member.user_id)
          const online = isOnline(member.user_id)

          return (
            <div
              key={member.user_id}
              className="flex items-center space-x-3 p-2 hover:bg-gray-50 rounded"
            >
              <div className="relative">
                {memberUser?.avatar_url ? (
                  <img
                    src={memberUser.avatar_url}
                    alt={memberUser.username}
                    className="w-10 h-10 rounded-full"
                  />
                ) : (
                  <div className="w-10 h-10 bg-indigo-600 rounded-full flex items-center justify-center text-white text-sm">
                    {memberUser?.username?.[0]?.toUpperCase() || role[0].toUpperCase()}
                  </div>
                )}
                {/* Online status indicator */}
                <div
                  className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${online ? 'bg-green-500' : 'bg-gray-400'
                    }`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {memberUser?.username || member.user_id}
                </div>
                <div className="text-xs text-gray-500">
                  {role === 'owner' ? '所有者' : role === 'editor' ? '编辑者' : '查看者'}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
