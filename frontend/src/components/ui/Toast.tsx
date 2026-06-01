import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from "lucide-react";
import { useUiStore } from "../../stores/uiStore";

type ToastProps = {
    message: string;
    type?: "success" | "error";
    duration?: number; // ms
    onClose?: () => void;
};

export const Toast: React.FC<ToastProps> = ({
    message,
    type = "success",
    duration = 3000,
    onClose,
}) => {
    const [visible, setVisible] = useState(true);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    const close = useCallback(() => {
        setVisible(false);
        onCloseRef.current?.();
    }, []);

    useEffect(() => {
        setVisible(true);
        const timer = setTimeout(close, duration);
        return () => clearTimeout(timer);
    }, [close, duration, message, type]);

    if (!visible) return null;

    const bg = type === "success" ? "bg-green-600" : "bg-red-600";

    return (
        <div
            className={`fixed bottom-4 right-4 min-w-[200px] cursor-pointer rounded p-3 text-white shadow-lg ${bg} animate-fade-in`}
            role="button"
            tabIndex={0}
            aria-label="点击确认并关闭提示"
            onClick={close}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    close();
                }
            }}
        >
            {message}
        </div>
    );
};

const toastStyles = {
    success: {
        icon: CheckCircle2,
        className: "border-emerald-100 bg-emerald-50 text-emerald-800",
        iconClassName: "text-emerald-600",
    },
    error: {
        icon: XCircle,
        className: "border-rose-100 bg-rose-50 text-rose-800",
        iconClassName: "text-rose-600",
    },
    warning: {
        icon: AlertTriangle,
        className: "border-amber-100 bg-amber-50 text-amber-800",
        iconClassName: "text-amber-600",
    },
    info: {
        icon: Info,
        className: "border-indigo-100 bg-indigo-50 text-indigo-800",
        iconClassName: "text-indigo-600",
    },
};

export function useToast() {
    const addNotification = useUiStore((state) => state.addNotification);
    return {
        show: (message: string, type: "info" | "success" | "warning" | "error" = "info", duration = 3000) =>
            addNotification({ message, type, duration }),
        success: (message: string, duration?: number) => addNotification({ message, type: "success", duration }),
        error: (message: string, duration?: number) => addNotification({ message, type: "error", duration }),
        warning: (message: string, duration?: number) => addNotification({ message, type: "warning", duration }),
        info: (message: string, duration?: number) => addNotification({ message, type: "info", duration }),
    };
}

export function ToastViewport() {
    const notifications = useUiStore((state) => state.notifications);
    const removeNotification = useUiStore((state) => state.removeNotification);

    useEffect(() => {
        const timers = notifications.map((notification) => {
            const duration = notification.duration ?? 3000;
            if (duration <= 0) return null;
            return window.setTimeout(() => removeNotification(notification.id), duration);
        });
        return () => timers.forEach((timer) => timer && window.clearTimeout(timer));
    }, [notifications, removeNotification]);

    if (typeof document === "undefined") return null;

    return createPortal(
        <div className="fixed right-4 top-4 z-[9999] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3">
            {notifications.map((notification) => {
                const meta = toastStyles[notification.type];
                const Icon = meta.icon;
                return (
                    <div
                        key={notification.id}
                        className={`flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-lg shadow-slate-900/5 backdrop-blur ${meta.className}`}
                        role="status"
                    >
                        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${meta.iconClassName}`} />
                        <div className="min-w-0 flex-1 text-sm font-medium leading-5">{notification.message}</div>
                        <button
                            type="button"
                            onClick={() => removeNotification(notification.id)}
                            className="rounded-full p-1 opacity-60 transition hover:bg-white/70 hover:opacity-100"
                            aria-label="关闭提示"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                );
            })}
        </div>,
        document.body
    );
}
