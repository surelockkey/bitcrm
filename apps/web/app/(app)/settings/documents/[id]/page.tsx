import { TemplateEditorPage } from "@/features/documents/editor/components/template-editor-page";

/** Full-screen template builder. `params` is a Promise in Next 16. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TemplateEditorPage templateId={id} />;
}
