import { Construction } from "lucide-react";

/** Standard "under construction" body for not-yet-built feature pages. */
export function PagePlaceholder({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <Construction className="size-6" />
        </div>
        <h2 className="text-lg font-medium">Under construction</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          {description ?? `The ${title} page is being built. Check back soon.`}
        </p>
      </div>
    </div>
  );
}
