interface RemoteUser {
  name: string
  color: string
  cursor?: {
    x: number
    y: number
  }
}

interface RemoteCursorsProps {
  users: RemoteUser[]
}

export default function RemoteCursors({ users }: RemoteCursorsProps) {
  if (users.length === 0) {
    return null
  }

  return (
    <div className="absolute inset-0 pointer-events-none">
      {users.map((user, index) => (
        <div
          key={index}
          className="absolute pointer-events-none"
          style={{
            left: user.cursor?.x || 0,
            top: user.cursor?.y || 0,
          }}
        >
          <div
            className="w-0.5 h-5"
            style={{
              backgroundColor: user.color,
            }}
          />
          <div
            className="px-2 py-1 text-xs text-white rounded shadow"
            style={{
              backgroundColor: user.color,
              marginTop: '1.25rem',
            }}
          >
            {user.name}
          </div>
        </div>
      ))}
    </div>
  )
}

