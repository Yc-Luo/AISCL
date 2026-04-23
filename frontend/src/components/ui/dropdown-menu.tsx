import * as React from "react"
import { cn } from "../../lib/utils"

interface DropdownMenuProps {
    children: React.ReactNode
    open?: boolean
    onOpenChange?: (open: boolean) => void
}

const DropdownMenuContext = React.createContext<{
    open: boolean
    setOpen: (open: boolean) => void
}>({
    open: false,
    setOpen: () => { },
})

const DropdownMenu = ({ children, open: controlledOpen, onOpenChange }: DropdownMenuProps) => {
    const [internalOpen, setInternalOpen] = React.useState(false)
    const isControlled = controlledOpen !== undefined
    const open = isControlled ? controlledOpen : internalOpen

    const setOpen = React.useCallback((newOpen: boolean) => {
        if (!isControlled) {
            setInternalOpen(newOpen)
        }
        onOpenChange?.(newOpen)
    }, [isControlled, onOpenChange])

    // Close on click outside
    const containerRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setOpen(false)
            }
        }

        if (open) {
            document.addEventListener('mousedown', handleClickOutside)
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [open, setOpen])

    return (
        <DropdownMenuContext.Provider value={{ open, setOpen }}>
            <div ref={containerRef} className="relative inline-block text-left">
                {children}
            </div>
        </DropdownMenuContext.Provider>
    )
}

interface DropdownMenuTriggerProps {
    children: React.ReactNode
    className?: string
    asChild?: boolean
}

const DropdownMenuTrigger = ({ children, className, asChild }: DropdownMenuTriggerProps) => {
    const { open, setOpen } = React.useContext(DropdownMenuContext)

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation()
        setOpen(!open)
    }

    if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children as React.ReactElement<{ onClick?: (e: React.MouseEvent) => void }>, {
            onClick: handleClick,
        })
    }

    return (
        <div className={className} onClick={handleClick}>
            {children}
        </div>
    )
}

interface DropdownMenuContentProps {
    children: React.ReactNode
    className?: string
    align?: "start" | "center" | "end"
    side?: "top" | "bottom" | "left" | "right"
    alignOffset?: number
    sideOffset?: number
}

const DropdownMenuContent = ({
    children,
    className,
    align = "center",
    side = "bottom"
}: DropdownMenuContentProps) => {
    const { open } = React.useContext(DropdownMenuContext)

    if (!open) return null

    const alignmentClasses = {
        start: "left-0",
        center: "left-1/2 -translate-x-1/2",
        end: "right-0",
    }

    const sideClasses = {
        top: "bottom-full mb-1",
        bottom: "top-full mt-1",
        left: "right-full mr-1",
        right: "left-full ml-1",
    }

    return (
        <div
            className={cn(
                "absolute z-50 min-w-[8rem] overflow-hidden rounded-md border bg-white p-1 text-black shadow-lg",
                alignmentClasses[align],
                sideClasses[side],
                className
            )}
        >
            {children}
        </div>
    )
}

interface DropdownMenuItemProps {
    children: React.ReactNode
    className?: string
    onClick?: () => void
    disabled?: boolean
}

const DropdownMenuItem = ({ children, className, onClick, disabled }: DropdownMenuItemProps) => {
    const { setOpen } = React.useContext(DropdownMenuContext)

    const handleClick = () => {
        if (!disabled) {
            onClick?.()
            setOpen(false)
        }
    }

    return (
        <div
            onClick={handleClick}
            className={cn(
                "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-zinc-100 transition-colors focus:bg-zinc-100 focus:text-black",
                disabled && "pointer-events-none opacity-50",
                className
            )}
        >
            {children}
        </div>
    )
}

const DropdownMenuLabel = ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={cn("px-2 py-1.5 text-sm font-semibold", className)}>
        {children}
    </div>
)

const DropdownMenuSeparator = ({ className }: { className?: string }) => (
    <div className={cn("-mx-1 my-1 h-px bg-zinc-200", className)} />
)

export {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
}
