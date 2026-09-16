"use client";

import { Fragment, useMemo } from "react";
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AUTOMATION_TEMPLATES,
  AUTOMATION_TEMPLATE_SECTIONS,
  type AutomationTemplate,
} from "../templates";

/** `<the assigned techs>` → the words alone; what a reader searches on. */
const plainSentence = (sentence: string) => sentence.replace(/[<>]/g, "");

const matches = (template: AutomationTemplate, search: string) => {
  const haystack = `${template.title} ${plainSentence(template.sentence)} ${template.blurb}`.toLowerCase();
  return search
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
};

/**
 * The sentence as Workiz draws it: the parts a person edits are underlined,
 * the rest is plain. Split on the markers rather than replacing them, so a
 * slot is one element the card can style and a test can find.
 */
function TemplateSentence({ sentence }: { sentence: string }) {
  const parts = sentence.split(/(<[^<>]+>)/g).filter(Boolean);
  return (
    <p className="text-sm text-foreground">
      {parts.map((part, i) =>
        part.startsWith("<") && part.endsWith(">") ? (
          <span
            key={i}
            data-template-slot
            className="font-medium underline decoration-dotted underline-offset-4"
          >
            {part.slice(1, -1)}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </p>
  );
}

/**
 * The LIBRARY tab (Workiz "Automation Center" → templates): ready recipes
 * grouped by section, each a sentence with its editable parts underlined and
 * a **Use** button that hands the template back. What happens next — the
 * editor, the save — belongs to the page, not here.
 */
export function AutomationLibrary({
  canEdit,
  search = "",
  onUse,
}: {
  canEdit: boolean;
  search?: string;
  onUse: (template: AutomationTemplate) => void;
}) {
  const sections = useMemo(() => {
    const query = search.trim();
    return AUTOMATION_TEMPLATE_SECTIONS.map((section) => ({
      section,
      templates: AUTOMATION_TEMPLATES.filter(
        (t) => t.section === section && (!query || matches(t, query)),
      ),
    })).filter((group) => group.templates.length > 0);
  }, [search]);

  return (
    <div className="space-y-6" data-testid="automation-library">
      {canEdit ? null : (
        <p className="text-sm text-muted-foreground">
          You can read the recipes, but adding an automation needs permission to edit them.
        </p>
      )}

      {sections.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed py-14 text-center">
          <p className="text-sm font-medium">No recipe matches “{search.trim()}”</p>
          <p className="text-sm text-muted-foreground">
            Try a status, “call” or “reminder” — or start a rule from scratch.
          </p>
        </div>
      ) : null}

      {sections.map(({ section, templates }) => (
        <section key={section} aria-labelledby={`automation-library-${section.replace(/\s+/g, "-")}`}>
          <h3
            id={`automation-library-${section.replace(/\s+/g, "-")}`}
            className="mb-2 text-sm font-semibold tracking-tight"
          >
            {section}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((template) => (
              <Card
                key={template.id}
                size="sm"
                data-testid={`automation-template-${template.id}`}
                className="group/recipe gap-2"
              >
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {template.title}
                    {template.popular ? (
                      <Badge variant="secondary" className="gap-1 font-normal">
                        <Sparkles className="size-3" /> Most used here
                      </Badge>
                    ) : null}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-2">
                  <TemplateSentence sentence={template.sentence} />
                  <p className="text-xs text-muted-foreground">{template.blurb}</p>
                  {canEdit ? (
                    // Shown on hover like Workiz, but never hover-only: opacity
                    // leaves the button in the tab order and in the a11y tree,
                    // and focusing it brings it back into view.
                    <div className="mt-auto pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Use ${template.title}`}
                        className="opacity-0 transition-opacity group-hover/recipe:opacity-100 group-focus-within/recipe:opacity-100 focus-visible:opacity-100"
                        onClick={() => onUse(template)}
                      >
                        Use
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
