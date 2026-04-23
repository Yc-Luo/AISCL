import * as React from "react"

// Removed unused 'delayDuration' prop destructuring
const TooltipProvider = ({ children }: { children: React.ReactNode; delayDuration?: number }) => {
    return <>{children}</>
}

const Tooltip = ({ children }: { children: React.ReactNode }) => {
    return <div className="group relative inline-block">{children}</div>
}

// Removed unused 'asChild' prop destructuring
const TooltipTrigger = ({ children }: { children: React.ReactNode; asChild?: boolean }) => {
    return <>{children}</>
}

// Removed unused 'side' and 'align' prop destructuring
const TooltipContent = ({ children, className }: { children: React.ReactNode; className?: string; side?: string; align?: string }) => {
    return (
        <div className={`absolute z-50 hidden group-hover:block whitespace-nowrap rounded bg-black px-3 py-1.5 text-xs text-white ${className}`}>
            {children}
        </div>
    )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
