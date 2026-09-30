"use client";

import { useId, useRef } from "react";
import type { AutomationAction } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShortCodeMenu } from "@/features/messaging/components/short-code-menu";
import {
  AutomationMessageEditor,
  type MessageEditorHandle,
} from "../../components/automation-message-editor";

/**
 * "Preview/edit message" (§5.3, §8.6). Workiz keeps the message body out of
 * the rule sentence and behind a button, and so do we: the panel beside the
 * chain stays a sentence somebody can read at a glance, and the thing that
 * needs room — the body, its variables, an email's subject — gets a window of
 * its own.
 *
 * It writes straight through to the action as it is typed rather than holding
 * a draft: the node is the only copy, so closing this window can never be the
 * moment a message is lost, and reopening it shows exactly what is saved.
 */
export function MessageDialog({
  open,
  onOpenChange,
  action,
  onChange,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  action: AutomationAction;
  onChange: (next: AutomationAction) => void;
  disabled?: boolean;
}) {
  const editor = useRef<MessageEditorHandle>(null);
  const fieldId = useId();
  const bodyLabelId = `${fieldId}-body`;
  const email = action.type === "send_email";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{email ? "Email" : "Message"}</DialogTitle>
          <DialogDescription>
            Short codes are filled in when the message goes out — never guessed here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {email ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-subject`}>Subject</Label>
              <Input
                id={`${fieldId}-subject`}
                placeholder="Your appointment with {{biz_name}}"
                disabled={disabled}
                value={action.subject ?? ""}
                onChange={(e) => onChange({ ...action, subject: e.target.value })}
              />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label id={bodyLabelId}>Message</Label>
              <ShortCodeMenu
                disabled={disabled}
                onInsert={(code) => editor.current?.insertCode(code.replace(/^\{\{|\}\}$/g, ""))}
              />
            </div>
            <AutomationMessageEditor
              ref={editor}
              labelledBy={bodyLabelId}
              className="min-h-40"
              disabled={disabled}
              value={action.body ?? ""}
              placeholder="Hi {{first_name}}, your job {{job_id}} is scheduled for {{job_date}}."
              onChange={(body) => onChange({ ...action, body })}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="brand" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
