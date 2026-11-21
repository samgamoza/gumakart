import type { AiMediaJobRow } from "@gumakart/db";
import type { ComfyWorkflow } from "./comfy-client";

/**
 * Turns an ai_media_jobs row into a ComfyUI API-format graph.
 *
 * Phase 1 contract: the producer puts a ready graph in input_payload.workflow.
 * Phase 2 registers builders here (flux_product_studio, wan_video_ad, f5_voice_clone, printair_mockup)
 * that build the graph from friendlier inputs (image URL, scene preset, aspect ratio…).
 */
export type WorkflowBuilder = (row: AiMediaJobRow) => ComfyWorkflow;

const builders = new Map<string, WorkflowBuilder>();

export function registerWorkflowBuilder(jobType: AiMediaJobRow["jobType"], builder: WorkflowBuilder): void {
  builders.set(jobType, builder);
}

export class WorkflowInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowInputError";
  }
}

export function resolveWorkflow(row: AiMediaJobRow): ComfyWorkflow {
  const explicit = (row.inputPayload as { workflow?: unknown }).workflow;
  if (explicit !== undefined) {
    if (!isComfyWorkflow(explicit)) throw new WorkflowInputError("input_payload.workflow is not a ComfyUI API-format graph");
    return explicit;
  }
  const builder = builders.get(row.jobType);
  if (!builder) throw new WorkflowInputError(`no workflow builder registered for ${row.jobType}`);
  return builder(row);
}

export function isComfyWorkflow(value: unknown): value is ComfyWorkflow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const nodes = Object.values(value as Record<string, unknown>);
  return (
    nodes.length > 0 &&
    nodes.every((n) => !!n && typeof n === "object" && typeof (n as { class_type?: unknown }).class_type === "string" && typeof (n as { inputs?: unknown }).inputs === "object")
  );
}
