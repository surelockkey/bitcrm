import type { Ref, RefCallback } from "react";

/** One ref callback feeding several refs — ours and the caller's (react-hook-form's `field.ref`). */
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) (ref as { current: T | null }).current = node;
    }
  };
}
