/** The screen a caller sees once it is known they may not see this one. */
export function NoAccess({ text }: { text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <h2 className="text-lg font-medium">No access</h2>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
