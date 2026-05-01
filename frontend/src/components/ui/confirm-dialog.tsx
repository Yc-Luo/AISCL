import {
    AlertTriangle,
    Loader2,
} from 'lucide-react'
import { Button } from './button'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from './dialog'
import { cn } from '../../lib/utils'

interface ConfirmDialogProps {
    open: boolean
    title: string
    description: string
    confirmLabel?: string
    cancelLabel?: string
    tone?: 'default' | 'danger'
    loading?: boolean
    onOpenChange: (open: boolean) => void
    onConfirm: () => void | Promise<void>
}

export default function ConfirmDialog({
    open,
    title,
    description,
    confirmLabel = '确认',
    cancelLabel = '取消',
    tone = 'default',
    loading = false,
    onOpenChange,
    onConfirm,
}: ConfirmDialogProps) {
    const isDanger = tone === 'danger'

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => {
            if (!loading) onOpenChange(nextOpen)
        }}>
            <DialogContent className="max-w-md rounded-3xl p-0">
                <div className="p-6">
                    <DialogHeader>
                        <div className={cn(
                            "mb-4 flex h-12 w-12 items-center justify-center rounded-2xl",
                            isDanger ? "bg-rose-50 text-rose-600" : "bg-indigo-50 text-indigo-600"
                        )}>
                            <AlertTriangle className="h-6 w-6" />
                        </div>
                        <DialogTitle className="text-xl font-bold text-slate-900">{title}</DialogTitle>
                        <DialogDescription className="mt-2 leading-6 text-slate-500">
                            {description}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="mt-8 gap-3 sm:gap-0">
                        <Button
                            type="button"
                            variant="ghost"
                            onClick={() => onOpenChange(false)}
                            disabled={loading}
                            className="rounded-xl"
                        >
                            {cancelLabel}
                        </Button>
                        <Button
                            type="button"
                            onClick={onConfirm}
                            disabled={loading}
                            className={cn(
                                "rounded-xl text-white shadow-lg",
                                isDanger
                                    ? "bg-rose-600 shadow-rose-100 hover:bg-rose-700"
                                    : "bg-indigo-600 shadow-indigo-100 hover:bg-indigo-700"
                            )}
                        >
                            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {confirmLabel}
                        </Button>
                    </DialogFooter>
                </div>
            </DialogContent>
        </Dialog>
    )
}
