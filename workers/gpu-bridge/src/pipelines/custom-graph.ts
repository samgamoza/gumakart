import { resolveWorkflow } from "../workflows";
import { runGraph } from "./runner";
import type { Pipeline } from "./types";

/** Phase 1 contract kept: input_payload.workflow is a ready ComfyUI API graph (any job type). */
export const customGraphPipeline: Pipeline = async (ctx) => {
  const results = await runGraph(ctx, resolveWorkflow(ctx.row), ctx.row.id);
  return results.map((r) => ({ bytes: r.bytes, contentType: r.contentType, filename: r.file.filename }));
};
