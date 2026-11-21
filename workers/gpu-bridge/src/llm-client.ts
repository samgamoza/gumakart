import { HttpError } from "./circuit-breaker";

/** OpenAI-compatible chat completions against the local vLLM node (Qwen3). */
export type ChatContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  /** A string, or OpenAI-style parts (text + image_url) for vision models like Qwen3-VL. */
  content: string | ChatContentPart[];
  name?: string;
  tool_call_id?: string;
  /** Assistant turn that called tools (OpenAI format). */
  tool_calls?: Array<Record<string, unknown>>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** OpenAI-format tools, passed through untouched (Phase 3 closer tools). */
  tools?: unknown[];
  responseFormat?: { type: "json_object" | "text" };
}

export interface ChatResponse {
  content: string;
  toolCalls: unknown[];
  model: string;
  usage: { promptTokens: number; completionTokens: number };
  finishReason: string | null;
}

export class LlmClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly opts: { baseUrl: string; apiKey?: string; defaultModel: string; headers?: Record<string, string>; fetch?: typeof fetch }
  ) {
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
      ...(this.opts.headers ?? {}),
    };
  }

  async ping(): Promise<void> {
    const url = `${this.base}/models`;
    const res = await this.fetchImpl(url, { headers: this.headers(), signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ""));
  }

  async chat(req: ChatRequest, timeoutMs: number): Promise<ChatResponse> {
    const url = `${this.base}/chat/completions`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: this.headers(),
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: req.model ?? this.opts.defaultModel,
        messages: req.messages,
        max_tokens: req.maxTokens ?? 600,
        temperature: req.temperature ?? 0.7,
        ...(req.tools ? { tools: req.tools } : {}),
        ...(req.responseFormat ? { response_format: req.responseFormat } : {}),
      }),
    });
    if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ""));
    const body = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string | null; tool_calls?: unknown[] }; finish_reason?: string | null }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = body.choices?.[0];
    return {
      content: stripThinking(choice?.message?.content ?? ""),
      toolCalls: choice?.message?.tool_calls ?? [],
      model: body.model ?? req.model ?? this.opts.defaultModel,
      usage: { promptTokens: body.usage?.prompt_tokens ?? 0, completionTokens: body.usage?.completion_tokens ?? 0 },
      finishReason: choice?.finish_reason ?? null,
    };
  }
}

/** Qwen3 reasoning models may prefix replies with <think>…</think>; buyers must never see it. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, "").trim();
}
