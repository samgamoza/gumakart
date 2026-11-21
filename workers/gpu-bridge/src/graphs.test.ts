import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { ComfyWorkflow } from "./comfy-client";
import { validateGraph, type ObjectInfo } from "./graph-validate";
import { seedFrom } from "./graphs/builder";
import { buildF5Tts } from "./graphs/f5-tts";
import { buildFluxProductStudio, placeProduct } from "./graphs/flux-product-studio";
import { buildWanI2V, wanFrames } from "./graphs/wan-i2v";
import { isComfyWorkflow } from "./workflows";
import { referenceWorkflows } from "./workflow-exports";

const models = { unet: "flux1-fill-dev.safetensors", clipL: "clip_l.safetensors", t5: "t5.safetensors", vae: "ae.safetensors", rmbgModel: "RMBG-2.0", rmbgNode: "RMBG" };
const byClass = (g: ComfyWorkflow, c: string) => Object.values(g).filter((n) => n.class_type === c);

/** Every link must point at an existing node. */
function assertLinked(g: ComfyWorkflow) {
  for (const [id, node] of Object.entries(g)) {
    for (const [k, v] of Object.entries(node.inputs)) {
      if (Array.isArray(v) && v.length === 2 && typeof v[0] === "string") assert.ok(g[v[0]], `node ${id}.${k} links to missing node ${v[0]}`);
    }
  }
}

describe("flux_product_studio graph", () => {
  it("places the product centred in the lower part, within the canvas, on an 8px grid", () => {
    const sq = placeProduct(1200, 800, 1024, 1024);
    assert.ok(sq.x >= 0 && sq.x + sq.width <= 1024 && sq.y >= 0 && sq.y + sq.height <= 1024);
    assert.equal(sq.width % 8, 0);
    assert.ok(Math.abs(sq.x - (1024 - sq.width) / 2) <= 1);
    assert.ok(sq.y + sq.height > 1024 * 0.8, "rests low, room for the scene above");
    const tall = placeProduct(300, 1500, 768, 1344);
    assert.ok(tall.height <= 1344 * 0.46 + 8 && tall.width <= 768);
  });

  it("one shared model set, one branch + export per aspect, product pixels protected", () => {
    const g = buildFluxProductStudio({
      sourceImage: "gumakart/x.png",
      sourceWidth: 1000,
      sourceHeight: 1000,
      prompt: "p",
      seed: 7,
      filenamePrefix: "gk_ab",
      models,
      aspects: [
        { key: "1x1", width: 1080, height: 1080, genWidth: 1024, genHeight: 1024 },
        { key: "9x16", width: 1080, height: 1920, genWidth: 768, genHeight: 1344 },
      ],
    });
    assert.ok(isComfyWorkflow(g));
    assertLinked(g);
    assert.equal(byClass(g, "UNETLoader").length, 1);
    assert.equal(byClass(g, "RMBG").length, 1);
    assert.equal(byClass(g, "KSampler").length, 2);
    assert.deepEqual(byClass(g, "SaveImage").map((n) => n.inputs.filename_prefix), ["gk_ab_1x1", "gk_ab_9x16"]);
    assert.deepEqual(byClass(g, "ImageScale").filter((n) => n.inputs.crop === "center").map((n) => `${n.inputs.width}x${n.inputs.height}`), ["1080x1080", "1080x1920"]);
    assert.equal(byClass(g, "InvertMask").length, 2, "Flux paints only the background");
    assert.ok(byClass(g, "FluxGuidance")[0]!.inputs.guidance === 30);
  });
});

describe("wan + f5 graphs", () => {
  it("Wan frame counts are 4k+1 and capped at 81", () => {
    assert.equal(wanFrames(5), 81);
    assert.equal(wanFrames(10), 81);
    assert.equal(wanFrames(3), 49);
    assert.equal((wanFrames(2.7) - 1) % 4, 0);
    const g = buildWanI2V({ image: "a.png", prompt: "p", seconds: 4, seed: 1, filenamePrefix: "c", models: { unet: "u", textEncoder: "t", vae: "v", clipVision: "cv" } });
    assertLinked(g);
    assert.equal(byClass(g, "WanImageToVideo")[0]!.inputs.length, 65);
    assert.equal(byClass(g, "SaveVideo").length, 1);
  });
  it("F5 graph wires reference audio + transcript", () => {
    const g = buildF5Tts({ referenceAudio: "gumakart/r.wav", referenceText: "ref", speech: "Order na po!", seed: 3, filenamePrefix: "v", nodeClass: "F5TTSAudioInputs" });
    assertLinked(g);
    const tts = byClass(g, "F5TTSAudioInputs")[0]!;
    assert.equal(tts.inputs.speech, "Order na po!");
    assert.equal(byClass(g, "SaveAudio").length, 1);
  });
  it("seeds are stable per job", () => {
    assert.equal(seedFrom("job-1"), seedFrom("job-1"));
    assert.notEqual(seedFrom("job-1"), seedFrom("job-2"));
  });
});

describe("validateGraph (used by `doctor`)", () => {
  const info: ObjectInfo = {
    UNETLoader: { input: { required: { unet_name: [["flux1-fill-dev.safetensors"]], weight_dtype: [["default", "fp8_e4m3fn"]] } } },
    SaveImage: { input: { required: { images: ["IMAGE"], filename_prefix: ["STRING"] } } },
    KSampler: { input: { required: { sampler_name: ["COMBO", { options: ["euler", "uni_pc"] }], seed: ["INT"] } } },
  };
  it("reports missing nodes, inputs and unavailable model files", () => {
    const g: ComfyWorkflow = {
      "1": { class_type: "UNETLoader", inputs: { unet_name: "wan.safetensors", weight_dtype: "default" } },
      "2": { class_type: "SaveImage", inputs: { images: ["1", 0] } },
      "3": { class_type: "KSampler", inputs: { sampler_name: "dpmpp", seed: 1 } },
      "4": { class_type: "RMBG", inputs: {} },
    };
    const problems = validateGraph(g, info).map((i) => `${i.classType}: ${i.problem}`);
    assert.equal(problems.length, 4);
    assert.match(problems[0]!, /unet_name" = "wan.safetensors" is not available \(have: flux1-fill-dev/);
    assert.match(problems[1]!, /missing required input "filename_prefix"/);
    assert.match(problems[2]!, /sampler_name/);
    assert.match(problems[3]!, /RMBG: node type not installed/);
  });
});

describe("reference workflow files", () => {
  it("workflows/comfyui/*.json match the builders (run export-workflows after changing a graph)", () => {
    for (const [name, graph] of Object.entries(referenceWorkflows())) {
      const onDisk = JSON.parse(readFileSync(new URL(`../workflows/comfyui/${name}`, import.meta.url), "utf8"));
      assert.deepEqual(onDisk, graph, name);
    }
  });
});
