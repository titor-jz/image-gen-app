"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

// 位置响应式：小屏（手机）底部居中更易触达，桌面保持右下角。
// 初始值与 SSR 一致（bottom-right），挂载后按视口宽度切换。
function useResponsivePosition(): ToasterProps["position"] {
  const [position, setPosition] = useState<ToasterProps["position"]>("bottom-right")

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)")
    const update = () => setPosition(mq.matches ? "bottom-center" : "bottom-right")
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])

  return position
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const position = useResponsivePosition()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position={props.position ?? position}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
