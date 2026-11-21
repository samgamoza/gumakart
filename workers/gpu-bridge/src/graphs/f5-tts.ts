import type { ComfyWorkflow } from "../comfy-client";
import { GraphBuilder } from "./builder";

/**
 * F5-TTS voice (ComfyUI-F5-TTS node pack): reference audio + its exact transcript → new speech in
 * that voice. LoadAudio / SaveAudio are ComfyUI core nodes.
 */
export function buildF5Tts(input: {
  referenceAudio: string; // ComfyUI input name
  referenceText: string;
  speech: string;
  seed: number;
  filenamePrefix: string;
  nodeClass: string;
  speed?: number;
}): ComfyWorkflow {
  const g = new GraphBuilder();
  const ref = g.add("LoadAudio", { audio: input.referenceAudio }, "Reference voice");
  const tts = g.add(
    input.nodeClass,
    {
      sample_audio: g.out(ref),
      sample_text: input.referenceText,
      speech: input.speech,
      seed: input.seed,
      model: "F5v1",
      vocoder: "vocos",
      speed: input.speed ?? 1.0,
      model_type: "F5TTS_v1_Base",
    },
    "F5-TTS"
  );
  g.add("SaveAudio", { audio: g.out(tts), filename_prefix: input.filenamePrefix }, "Voiceover");
  return g.graph;
}
