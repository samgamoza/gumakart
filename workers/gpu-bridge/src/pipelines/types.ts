import type { AiMediaJobRow } from "@gumakart/db";
import type { CircuitBreaker } from "../circuit-breaker";
import type { ComfyClient } from "../comfy-client";
import type { BridgeConfig } from "../config";
import type { LlmClient } from "../llm-client";
import type { Logger } from "../logger";
import type { SourceFetcher } from "../source-media";

/** One rendered file, ready for the bucket. */
export interface PipelineOutput {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
  variant?: string;
}

export type PipelineConfig = Pick<
  BridgeConfig,
  | "COMFY_POLL_INTERVAL_MS"
  | "COMFY_JOB_TIMEOUT_MS"
  | "LLM_VISION_MODEL"
  | "FFMPEG_PATH"
  | "FFMPEG_ENCODER"
  | "VOICE_PRESETS_DIR"
  | "BGM_DIR"
  | "SUBTITLE_FONT"
  | "FLUX_FILL_UNET"
  | "FLUX_CLIP_L"
  | "FLUX_T5"
  | "FLUX_VAE"
  | "RMBG_MODEL"
  | "WAN_I2V_UNET"
  | "WAN_TEXT_ENCODER"
  | "WAN_VAE"
  | "WAN_CLIP_VISION"
  | "COMFY_NODE_RMBG"
  | "COMFY_NODE_F5TTS"
  | "REALTIME_TIMEOUT_MS"
>;

export interface PipelineContext {
  row: AiMediaJobRow;
  comfy: ComfyClient;
  comfyBreaker: CircuitBreaker;
  llm: LlmClient;
  llmBreaker: CircuitBreaker;
  fetcher: SourceFetcher;
  cfg: PipelineConfig;
  /** This job's scratch folder (step results are cached here so a retry resumes). */
  workDir: string;
  log: Logger;
  /** Keeps the row from looking stuck during long steps. */
  heartbeat: () => Promise<void>;
}

export type Pipeline = (ctx: PipelineContext) => Promise<PipelineOutput[]>;
