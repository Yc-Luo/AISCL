import * as React from "react"

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
