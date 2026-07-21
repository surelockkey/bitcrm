export default function GeneralSettingsPage() {
  return (
    <div className="max-w-2xl space-y-2">
      <h2 className="text-base font-semibold tracking-tight">General</h2>
      <p className="text-sm text-muted-foreground">
        Workspace-wide preferences will live here. Use the <strong>Service Areas</strong> section to
        define the territories that auto-assign deals and match technicians.
      </p>
    </div>
  );
}
