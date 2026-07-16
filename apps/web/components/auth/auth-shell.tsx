import type { ReactNode } from "react";
import { BrandLogo } from "./brand-logo";

/** Centered auth layout: logo + heading + subtitle, then the form card. */
export function AuthShell({
  title,
  subtitle,
  icon,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  /** Optional badge shown between the logo and the title (e.g. success check). */
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <div className="w-full max-w-[460px]">
        <div className="flex flex-col items-center text-center">
          <BrandLogo />
          {icon ? <div className="mt-8">{icon}</div> : null}
          <h1
            className={`${icon ? "mt-6" : "mt-8"} text-3xl font-bold tracking-tight text-balance`}
          >
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 text-muted-foreground text-pretty">{subtitle}</p>
          ) : null}
        </div>
        <div className="mt-8">{children}</div>
        {footer ? <div className="mt-6">{footer}</div> : null}
      </div>
    </div>
  );
}
