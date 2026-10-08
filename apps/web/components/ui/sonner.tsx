"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * Workiz's toasts (redux-toastr, reactCss.css on app.workiz.com): dropped in
 * top-centre, 440px wide, 4px corners, 15px in, `2px 2px 10px
 * rgba(0,0,0,.4)`, 500-weight words; a success is #83c795 with white words,
 * an error #f45e44, a warning #f7a336, an info #58abc3. A plain toast stays
 * white with ink words.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      // App-wide default: toasts drop in top-center, and when several queue up
      // they all stay visible (expanded) instead of collapsing into a stack.
      position="top-center"
      expand
      richColors
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
          "--width": "440px",
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "var(--wz-toast-success)",
          "--success-text": "#ffffff",
          "--success-border": "var(--wz-toast-success)",
          "--error-bg": "var(--wz-danger)",
          "--error-text": "#ffffff",
          "--error-border": "var(--wz-danger)",
          "--warning-bg": "var(--wz-toast-warning)",
          "--warning-text": "#ffffff",
          "--warning-border": "var(--wz-toast-warning)",
          "--info-bg": "var(--wz-toast-info)",
          "--info-text": "#ffffff",
          "--info-border": "var(--wz-toast-info)",
          "--border-radius": "4px",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !p-[15px] !font-medium !shadow-[2px_2px_10px_rgba(0,0,0,0.4)]",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
