import type { LlmModelId } from "../plan-limits";

export interface LlmCallInput {
  model: LlmModelId;
  system: string;
  user: string;
  jsonMode?: boolean;
  /** Output-token ceiling; keeps a single runaway response from eating the budget. */
  maxTokens?: number;
}

const DEFAULT_MAX_TOKENS = 1024;

export interface LlmCallResult {
  content: string;
  model: string;
  tokensUsed?: number;
  provider: "mock" | "openai" | "gemini" | "groq";
}

async function callOpenAi(
  model: string,
  system: string,
  user: string,
  jsonMode: boolean,
  maxTokens: number
): Promise<LlmCallResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      temperature: 0.8,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI error: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number };
  };

  return {
    content: json.choices?.[0]?.message?.content ?? "{}",
    model,
    tokensUsed: json.usage?.total_tokens,
    provider: "openai",
  };
}

async function callGemini(
  system: string,
  user: string,
  maxTokens: number
): Promise<LlmCallResult> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

  const model = "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: `${user}\n\nRespond with valid JSON only.` }] }],
      generationConfig: {
        temperature: 0.8,
        responseMimeType: "application/json",
        maxOutputTokens: maxTokens,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini error: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { totalTokenCount?: number };
  };

  const content = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  return {
    content,
    model,
    tokensUsed: json.usageMetadata?.totalTokenCount,
    provider: "gemini",
  };
}

async function callGroq(
  system: string,
  user: string,
  jsonMode: boolean,
  maxTokens: number
): Promise<LlmCallResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not configured");

  const model = "llama-3.3-70b-versatile";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
      temperature: 0.7,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    throw new Error(`Groq error: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number };
  };

  return {
    content: json.choices?.[0]?.message?.content ?? "{}",
    model: "llama-3.3-70b-groq",
    tokensUsed: json.usage?.total_tokens,
    provider: "groq",
  };
}

export async function callLlm(input: LlmCallInput): Promise<LlmCallResult> {
  const jsonMode = input.jsonMode ?? true;
  const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;

  switch (input.model) {
    case "gpt-4o-mini":
      return callOpenAi("gpt-4o-mini", input.system, input.user, jsonMode, maxTokens);
    case "gpt-4o":
      return callOpenAi("gpt-4o", input.system, input.user, jsonMode, maxTokens);
    case "gemini-2.0-flash":
      return callGemini(input.system, input.user, maxTokens);
    case "llama-3.3-70b-groq":
      return callGroq(input.system, input.user, jsonMode, maxTokens);
    case "mock":
      return {
        content: JSON.stringify({ message: "Mock LLM response" }),
        model: "mock",
        provider: "mock",
      };
    default:
      return callOpenAi("gpt-4o-mini", input.system, input.user, jsonMode, maxTokens);
  }
}

export function resolveEffectiveModel(requested: LlmModelId): LlmModelId {
  if (requested === "mock") {
    if (!allowLlmMocks()) {
      throw new Error(
        "LLM mock model is not allowed in production. Configure GEMINI_API_KEY, OPENAI_API_KEY, or GROQ_API_KEY."
      );
    }
    return "mock";
  }
  if (requested === "gemini-2.0-flash") {
    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY) return requested;
    if (process.env.GROQ_API_KEY) return "llama-3.3-70b-groq";
    if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
    if (allowLlmMocks()) return "mock";
    throw new Error(
      "No LLM API key configured. Set GEMINI_API_KEY (or OPENAI_API_KEY / GROQ_API_KEY)."
    );
  }
  if (requested.startsWith("gpt-")) {
    if (process.env.OPENAI_API_KEY) return requested;
    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY) return "gemini-2.0-flash";
    if (process.env.GROQ_API_KEY) return "llama-3.3-70b-groq";
    if (allowLlmMocks()) return "mock";
    throw new Error(
      "No LLM API key configured. Set OPENAI_API_KEY (or GEMINI_API_KEY / GROQ_API_KEY)."
    );
  }
  return requested;
}

/** Mirrors @gumakart/services allowIntegrationMocks without a package cycle. */
function allowLlmMocks(): boolean {
  if (process.env.NODE_ENV === "test" || process.env.GUMA_TEST_ADAPTERS === "true") {
    return true;
  }
  if (process.env.VERCEL_ENV === "production") return false;
  if (process.env.NODE_ENV === "production" && !process.env.VERCEL_ENV) return false;
  return process.env.GUMA_ALLOW_INTEGRATION_MOCKS !== "false";
}


// ── Phase 33 (H2): photo → product listing. Only Gemini and OpenAI read images here. ──────────────

export interface VisionCallInput {
  system: string;
  user: string;
  /** Base64 (no data: prefix). */
  imageBase64: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  maxTokens?: number;
}

export type VisionModel = "gemini-2.0-flash" | "gpt-4o-mini" | "mock";

/** Which vision model this deployment can use; throws when none is configured. */
export function resolveVisionModel(): VisionModel {
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY) return "gemini-2.0-flash";
  if (process.env.OPENAI_API_KEY) return "gpt-4o-mini";
  if (allowLlmMocks()) return "mock";
  throw new Error("No vision AI key configured. Set GEMINI_API_KEY or OPENAI_API_KEY.");
}

export async function callVision(model: Exclude<VisionModel, "mock">, input: VisionCallInput): Promise<LlmCallResult> {
  const maxTokens = input.maxTokens ?? 700;
  if (model === "gemini-2.0-flash") {
    const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_AI_API_KEY;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.system }] },
        contents: [
          {
            role: "user",
            parts: [{ inlineData: { mimeType: input.mimeType, data: input.imageBase64 } }, { text: `${input.user}\n\nRespond with valid JSON only.` }],
          },
        ],
        generationConfig: { temperature: 0.4, responseMimeType: "application/json", maxOutputTokens: maxTokens },
      }),
    });
    if (!res.ok) throw new Error(`Gemini error: ${await res.text()}`);
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { totalTokenCount?: number };
    };
    return { content: json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}", model, tokensUsed: json.usageMetadata?.totalTokenCount, provider: "gemini" };
  }
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: input.system },
        {
          role: "user",
          content: [
            { type: "text", text: input.user },
            { type: "image_url", image_url: { url: `data:${input.mimeType};base64,${input.imageBase64}`, detail: "low" } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.4,
      max_tokens: maxTokens,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${await res.text()}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { total_tokens?: number } };
  return { content: json.choices?.[0]?.message?.content ?? "{}", model, tokensUsed: json.usage?.total_tokens, provider: "openai" };
}
