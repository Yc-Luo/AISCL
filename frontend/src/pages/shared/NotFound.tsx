import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/button'

export default function NotFound() {
    const navigate = useNavigate()

    return (
        <div className="h-screen flex flex-col items-center justify-center bg-gray-50 px-4">
            <h1 className="text-9xl font-extrabold text-indigo-600 tracking-widest">404</h1>
            <div className="bg-indigo-600 text-white px-2 text-sm rounded rotate-12 absolute">
                Page Not Found
            </div>
            <p className="text-gray-500 text-xl mt-8 mb-8 text-center">
                抱歉，您访问的页面不存在。
            </p>
            <Button onClick={() => navigate('/')} size="lg">
                回到首页
            </Button>
        </div>
    )
}
