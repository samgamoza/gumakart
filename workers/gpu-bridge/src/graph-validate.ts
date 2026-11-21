import type { ComfyWorkflow } from "./comfy-client";

/** Shape of ComfyUI GET /object_info (only what we read). */
export type ObjectInfo = Record<
  string,
  { input?: { required?: Record<string, unknown[]>; optional?: Record<string, unknown[]> } }
>;

export interface GraphIssue {
  nodeId: string;
  classType: string;
  problem: string;
}

function comboOptions(spec: unknown[] | undefined): string[] | null {
  if (!spec) return null;
  const [type, opts] = spec as [unknown, { options?: unknown[] } | undefined];
  if (Array.isArray(type)) return type.map(String);
  if (type === "COMBO" && Array.isArray(opts?.options)) return opts!.options!.map(String);
  return null;
}

/**
 * Check a graph against this ComfyUI install: every class exists, every required input is given,
 * and every literal choice (model file, sampler, …) is one the node offers.
 */
export function validateGraph(graph: ComfyWorkflow, info: ObjectInfo): GraphIssue[] {
  const issues: GraphIssue[] = [];
  for (const [nodeId, node] of Object.entries(graph)) {
    const def = info[node.class_type];
    if (!def) {
      issues.push({ nodeId, classType: node.class_type, problem: "node type not installed" });
      continue;
    }
    const required = def.input?.required ?? {};
    const optional = def.input?.optional ?? {};
    for (const name of Object.keys(required)) {
      if (!(name in node.inputs)) issues.push({ nodeId, classType: node.class_type, problem: `missing required input "${name}"` });
    }
    for (const [name, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value)) continue; // a link to another node
      const options = comboOptions(required[name] ?? optional[name]);
      if (options && !options.includes(String(value))) {
        const shown = options.length > 6 ? `${options.slice(0, 6).join(", ")}, … (${options.length})` : options.join(", ");
        issues.push({ nodeId, classType: node.class_type, problem: `"${name}" = "${String(value)}" is not available (have: ${shown || "none"})` });
      }
    }
  }
  return issues;
}
