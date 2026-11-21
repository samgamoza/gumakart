import type { ComfyWorkflow } from "../comfy-client";

/** Tiny helper to build ComfyUI API-format graphs with numeric string ids. */
export type NodeRef = [string, number];

export class GraphBuilder {
  private next = 1;
  readonly graph: ComfyWorkflow = {};

  add(classType: string, inputs: Record<string, unknown>, title?: string): string {
    const id = String(this.next++);
    this.graph[id] = { class_type: classType, inputs, ...(title ? { _meta: { title } } : {}) } as ComfyWorkflow[string];
    return id;
  }

  out(id: string, index = 0): NodeRef {
    return [id, index];
  }
}

/** Stable 32-bit seed from a job id, so a retried render looks the same. */
export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function roundTo(value: number, multiple: number): number {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}
