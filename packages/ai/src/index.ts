export { AiContentGenerator, createAiGenerator } from "./generator";
export { MASTER_SYSTEM_PROMPT, TEMPLATE_PROMPTS } from "./templates/index";
export {
  MAX_TOKENS_BY_TASK,
  PLAN_AI_LIMITS,
  THRIFTY_MODEL,
  checkQuota,
  normalizePlan,
  resolveBudgetAwareModel,
  resolveModelForTask,
  type AiTaskType,
  type AiUsageSnapshot,
  type LlmModelId,
  type PlanAiLimits,
  type QuotaCheckResult,
  type SubscriptionPlan,
} from "./plan-limits";
export {
  AI_SKIN_PALETTE_IDS,
  curateTemplateSkins,
  fallbackTemplateSkins,
  parseAiSkinBatch,
  type AiCuratedSkinDraft,
  type CurateTemplateSkinsInput,
  type CurateTemplateSkinsResult,
} from "./template-skins";
export {
  SCOPE_MATRIX,
  resolveApprovalLevel,
  isAdminOnly,
  canSellerApprove,
  type AiScope,
  type ApprovalLevel,
} from "./permissions";
export type {
  AiTone,
  GenerateInput,
  GenerateResult,
  SellerContext,
  TemplateKey,
} from "./types";
export { callLlm, resolveEffectiveModel } from "./providers/llm";export {
  buildAssistPrompt,
  parseAssistOutput,
  mockAssist,
  runSellerAssist,
  assistTaskType,
  type AssistTask,
  type AssistInput,
  type CaptionsInput,
  type RepliesInput,
  type AdvisorInput,
  type AdvisorFacts,
  type CaptionsOutput,
  type RepliesOutput,
  type AdvisorOutput,
  type SupplierInput,
  type SupplierOutput,
  type PromoInput,
  type PromoOutput,
  cleanPromoOptions,
  smsSafeText,
  PROMO_MAX_CHARS,
} from "./seller-assist";
// Phase 33 (H2): photo → draft product listing.
export {
  buildPhotoListingPrompt,
  parsePhotoListing,
  mockPhotoListing,
  runPhotoListing,
  type PhotoListing,
  type PhotoListingInput,
} from "./product-from-photo";

// AI Marketing Suite Phase 2: Marketing Studio presets, GPU bridge client, Taglish copywriter.
export * from "./studio-presets";
export {
  bridgeConfigFromEnv,
  callBridgeChat,
  runLocalFirst,
  signBridgeRequest,
  hmacSha256Hex,
  BridgeUnavailableError,
  BridgeRejectedError,
  type GpuBridgeConfig,
  type BridgeChatRequest,
  type BridgeChatResult,
  type BridgePurpose,
  type LocalFirstResult,
} from "./gpu-bridge-client";
export {
  COPY_PLATFORMS,
  COPY_ANGLES,
  PAYMENT_METHODS,
  DEFAULT_PUBLIC_REPLIES,
  copywriterInputSchema,
  buildCopywriterMessages,
  parseCopywriterOutput,
  normalizeHashtags,
  scrubCopyClaims,
  mockCopywriter,
  runTaglishCopywriter,
  type CopywriterInput,
  type CopywriterOutput,
  type CopywriterRunResult,
} from "./taglish-copywriter";
// AI suite Phase 3: comment-to-DM matching, Taglish sales closer, cart nudges.
export { matchCommentTrigger, pickPublicReply, expandKeyword, normalizeCommentText } from "./comment-triggers";
export {
  CLOSER_TOOL_NAMES,
  CLOSER_TOOL_SPECS,
  MAX_STEPS as CLOSER_MAX_STEPS,
  buildCloserSystemPrompt,
  parseJsonAction,
  parseNativeToolCalls,
  bridgeCloserModel,
  cloudCloserModel,
  mockCloserModel,
  knownAmounts,
  unknownPesoAmounts,
  scrubClaims,
  runCloserTurn,
  type CloserTools,
  type CloserToolName,
  type CloserShopContext,
  type CloserHistoryMessage,
  type CloserModel,
  type CloserResult,
  type ToolLogEntry,
  type AgentStep,
  type TurnState,
} from "./agents/taglish-closer";
export { writeCartNudge, templateNudge, sanitizeNudge, offerCodSwitch, buildNudgePrompt, type NudgeInput } from "./agents/cart-nudge";
// AI suite Phase 4: broadcast polish, review loop texts.
export { polishBroadcast, sanitizeBroadcast, buildBroadcastPrompt, defaultBroadcastDraft, BROADCAST_PLACEHOLDERS, type BroadcastKind, type BroadcastDraftInput } from "./agents/broadcast-writer";
export { parseReviewRating, reviewBodyFrom, reviewPromptText, reviewPhotoAckText, reviewThanksText } from "./review-loop";
