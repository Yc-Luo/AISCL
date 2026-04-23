import React, { useEffect, useState } from "react";

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

    useEffect(() => {
        const timer = setTimeout(() => {
            setVisible(false);
            onClose?.();
        }, duration);
        return () => clearTimeout(timer);
    }, [duration, onClose]);

    if (!visible) return null;

    const bg = type === "success" ? "bg-green-600" : "bg-red-600";

    return (
        <div
            className={`fixed bottom-4 right-4 min-w-[200px] p-3 rounded shadow-lg text-white ${bg} animate-fade-in`}
        >
            {message}
        </div>
    );
};
