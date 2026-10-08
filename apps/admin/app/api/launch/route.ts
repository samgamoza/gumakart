import { NextResponse } from "next/server";
import { z } from "zod";
import {
  getLaunchTenantState,
  getPlatformOpsSettings,
  getTemplateStockByKey,
  listOnboardingCategoryLabels,
  listRecentTemplateIdsByCategory,
  listTemplateStock,
  recordTemplateIntelligenceEvent,
  triFlagToBoolOverride,
  updateStoreDna,
  saveThemeDraft,
} from "@gumakart/db";
import {
  brandGuardHasErrors,
  buildStoreDNA,
  deriveBrandKit,
  listCuratedTemplatesForDna,
  listLibraryMatchesForDna,
  matchStorePattern,
  recommendTemplates,
  resolveCatalogInstall,
  resolveShopTheme,
  selectionFitsSellerCategory,
  SHOP_BUSINESS_CATEGORIES,
  validateBrandGuardPersonalize,
} from "@gumakart/storefront-themes";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";
import { mergeCuratedWithStock, resolveStockInstall } from "@/lib/template-stock-launch";
import { canChangeStorefrontTemplateAfterPublish } from "@gumakart/plans";

async function templateSwitchOverrides() {
  const ops = await getPlatformOpsSettings();
  return {
    softLaunch: triFlagToBoolOverride(ops.softLaunch),
    freeTemplateSwitch: triFlagToBoolOverride(ops.freeTemplateSwitch),
    requiresUpgrade: triFlagToBoolOverride(ops.templateSwitchRequiresUpgrade),
  };
}

async function curatedForDna(
  dna: Parameters<typeof listCuratedTemplatesForDna>[0],
  plan: string | null | undefined
) {
  const base = listCuratedTemplatesForDna(dna, { plan, limit: 48 });
  const stock = await listTemplateStock({
    categoryLabel: dna.category,
    statuses: ["published"],
  });
  return mergeCuratedWithStock(base, stock, plan, 48);
}

export async function GET() {
  try {
    const session = await requireTenantSession();
    const state = await getLaunchTenantState(session.tenantId);
    if (!state) {
      return NextResponse.json({ ok: false, error: "Shop not found." }, { status: 404 });
    }

    const dna =
      state.storeDnaJson ??
      buildStoreDNA({
        businessName: state.name,
        category: state.category,
        vibe: state.themeDraftJson?.vibe ?? state.themeJson?.vibe,
        launchStep: "dna",
      });

    const avoidTemplateIds = await listRecentTemplateIdsByCategory(dna.category ?? state.category, {
      limit: 12,
      excludeTenantId: session.tenantId,
    });
    const recommendations = recommendTemplates(dna, {
      plan: state.subscriptionPlan,
      limit: 3,
      avoidTemplateIds,
    });
    const curatedTemplates = await curatedForDna(dna, state.subscriptionPlan);
    const libraryMatches = listLibraryMatchesForDna(dna, 12);
    const onboardingCategories = await listOnboardingCategoryLabels(SHOP_BUSINESS_CATEGORIES);

    const draft = state.themeDraftJson ?? state.themeJson;
    const theme = resolveShopTheme(draft, state.name);
    const storefrontUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3010";
    const published = Boolean(state.themePublishedJson?.templateId);
    const launchDone = dna.launchStep === "done" || published;
    const templateSwitch = canChangeStorefrontTemplateAfterPublish(
      state.subscriptionPlan,
      await templateSwitchOverrides()
    );

    return NextResponse.json({
      ok: true,
      state,
      dna,
      recommendations,
      curatedTemplates,
      libraryMatches,
      onboardingCategories,
      theme,
      draft,
      published,
      launchDone,
      templateSwitch,
      libraryStats: {
        curatedForCategory: curatedTemplates.length,
        liveTopPicks: recommendations.length,
        note: "Free Bundle + ops Template Stock for your category — each pick keeps a unique look.",
      },
      urls: {
        storefront: `${storefrontUrl}/${state.slug}`,
        preview: "/api/storefront-preview",
      },
    });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[launch GET]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}

const dnaSchema = z.object({
  action: z.literal("save_dna"),
  audience: z.string().max(120).optional(),
  productCountHint: z.enum(["none", "1-10", "11-50", "50+"]).optional(),
  sellingChannels: z.array(z.enum(["social", "marketplace", "in_person"])).optional(),
  goals: z.array(z.enum(["launch_fast", "brand_look", "conversion", "live_selling"])).optional(),
  vibe: z.string().max(32).optional(),
  category: z.string().max(100).optional(),
});

const selectSchema = z.object({
  action: z.literal("select_template"),
  templateId: z.string().min(1).max(80),
});

const personalizeSchema = z.object({
  action: z.literal("personalize"),
  tagline: z.string().max(160).optional(),
  promoTitle: z.string().max(120).optional(),
  promoSubtitle: z.string().max(160).optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  paletteId: z.string().max(64).optional(),
});

const publishSchema = z.object({
  action: z.literal("publish"),
});

const bodySchema = z.discriminatedUnion("action", [
  dnaSchema,
  selectSchema,
  personalizeSchema,
  publishSchema,
]);

export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = bodySchema.parse(await request.json());
    const state = await getLaunchTenantState(session.tenantId);
    if (!state) {
      return NextResponse.json({ ok: false, error: "Shop not found." }, { status: 404 });
    }

    if (body.action === "save_dna") {
      const current = state.storeDnaJson;
      const dna = buildStoreDNA({
        businessName: state.name,
        category: body.category ?? current?.category ?? state.category,
        vibe: body.vibe ?? current?.vibe ?? "fresh",
        audience: body.audience ?? current?.audience,
        productCountHint: body.productCountHint ?? current?.productCountHint,
        sellingChannels: body.sellingChannels ?? current?.sellingChannels,
        goals: body.goals ?? current?.goals,
        locale: current?.locale ?? "taglish",
        launchStep: "templates",
        selectedTemplateId: current?.selectedTemplateId,
      });
      const updated = await updateStoreDna(session.tenantId, dna);
      const avoidTemplateIds = await listRecentTemplateIdsByCategory(dna.category, {
        limit: 12,
        excludeTenantId: session.tenantId,
      });
      const recommendations = recommendTemplates(dna, {
        plan: state.subscriptionPlan,
        limit: 3,
        avoidTemplateIds,
      });
      const curatedTemplates = await curatedForDna(dna, state.subscriptionPlan);
      const libraryMatches = listLibraryMatchesForDna(dna, 12);
      return NextResponse.json({
        ok: true,
        dna,
        recommendations,
        curatedTemplates,
        libraryMatches,
        state: updated,
      });
    }

    if (body.action === "select_template") {
      const alreadyPublished = Boolean(state.themePublishedJson?.templateId);
      if (alreadyPublished) {
        const entitlement = canChangeStorefrontTemplateAfterPublish(
          state.subscriptionPlan,
          await templateSwitchOverrides()
        );
        if (!entitlement.allowed) {
          return NextResponse.json(
            {
              ok: false,
              error: entitlement.reason ?? "Upgrade required to change template.",
              code: "TEMPLATE_SWITCH_UPGRADE",
              upgradeRequired: true,
              requiredPlan: entitlement.requiredPlan,
              templateSwitch: entitlement,
            },
            { status: 403 }
          );
        }
      }

      const dnaBase =
        state.storeDnaJson ??
        buildStoreDNA({
          businessName: state.name,
          category: state.category,
          vibe: "fresh",
        });

      let install = resolveCatalogInstall(body.templateId, {
        plan: state.subscriptionPlan,
      });
      let stockCategoryLabel: string | null = null;
      if (!install) {
        const stock = await getTemplateStockByKey(body.templateId.trim().toLowerCase());
        if (stock) {
          stockCategoryLabel = stock.categoryLabel;
          install = resolveStockInstall(stock, state.subscriptionPlan);
        }
      }
      if (!install) {
        return NextResponse.json({ ok: false, error: "Unknown template." }, { status: 400 });
      }
      if (
        !selectionFitsSellerCategory(install.selectionId, dnaBase.category, {
          plan: state.subscriptionPlan,
          stockCategoryLabel,
        })
      ) {
        return NextResponse.json(
          {
            ok: false,
            error: `That look doesn’t fit ${dnaBase.category}. Pick one from your category.`,
          },
          { status: 400 }
        );
      }
      if (!install.installableOnPlan) {
        return NextResponse.json(
          { ok: false, error: "This template needs a higher plan." },
          { status: 403 }
        );
      }

      const brandKit = deriveBrandKit({
        shopName: state.name,
        slug: state.slug,
        category: dnaBase.category,
        vibe: String(dnaBase.vibe),
        subscriptionPlan: state.subscriptionPlan ?? "free",
      });

      const patternId = matchStorePattern({
        templateId: install.liveTemplateId,
        category: dnaBase.category,
        vibe: String(dnaBase.vibe),
      });

      const stockSkin =
        install && "stockSkin" in install
          ? (install as { stockSkin?: {
              primaryColor: string;
              accentColor: string;
              displayFont: "bricolage" | "system" | "mono-accent";
              radius: string;
            } }).stockSkin
          : undefined;

      const draft = {
        ...brandKit,
        templateId: install.liveTemplateId,
        patternId,
        vibe: String(dnaBase.vibe),
        // Curated pick identity + look knobs seeded from catalog id (not just shop name)
        storeLook: install.storeLook,
        // Ops stock skins also carry palette/font/radius so variants aren't clones
        ...(stockSkin
          ? {
              primaryColor: stockSkin.primaryColor,
              accentColor: stockSkin.accentColor,
              displayFont: stockSkin.displayFont,
              radius: stockSkin.radius,
            }
          : {}),
        ...(install.catalogId
          ? {
              catalogId: install.catalogId,
              ...(install.catalogLabel ? { catalogLabel: install.catalogLabel } : {}),
            }
          : {}),
      };

      const dna = {
        ...dnaBase,
        selectedTemplateId: install.selectionId,
        launchStep: "personalize" as const,
      };

      await updateStoreDna(session.tenantId, dna);
      const updated = await saveThemeDraft(session.tenantId, draft);
      const theme = resolveShopTheme(draft, state.name);

      if (install.fromCatalog && install.catalogId) {
        void recordTemplateIntelligenceEvent({
          eventType: "seller_selected_skin",
          categoryLabel: dnaBase.category,
          stockKey: install.catalogId,
          tenantId: session.tenantId,
          payload: {
            liveTemplateId: install.liveTemplateId,
            selectionId: install.selectionId,
          },
        }).catch(() => undefined);
      }

      return NextResponse.json({
        ok: true,
        draft,
        theme,
        dna,
        state: updated,
        install: {
          selectionId: install.selectionId,
          liveTemplateId: install.liveTemplateId,
          catalogId: install.catalogId,
          catalogLabel: install.catalogLabel,
          fromCatalog: install.fromCatalog,
        },
      });
    }

    if (body.action === "personalize") {
      const current = state.themeDraftJson ?? state.themeJson ?? {};
      if (!current.templateId) {
        return NextResponse.json(
          { ok: false, error: "Select a template first." },
          { status: 400 }
        );
      }

      const brandGuardIssues = validateBrandGuardPersonalize({
        tagline: body.tagline,
        promoTitle: body.promoTitle,
        promoSubtitle: body.promoSubtitle,
        paletteId: body.paletteId,
        primaryColor: body.primaryColor,
        accentColor: body.accentColor,
      });
      if (brandGuardHasErrors(brandGuardIssues)) {
        return NextResponse.json(
          {
            ok: false,
            error: brandGuardIssues.find((i) => i.severity === "error")?.message ?? "Brand Guard rejected this copy.",
            code: "BRAND_GUARD",
            brandGuardIssues,
          },
          { status: 400 }
        );
      }

      const draft = {
        ...current,
        ...(body.tagline !== undefined ? { tagline: body.tagline } : {}),
        ...(body.promoTitle !== undefined ? { promoTitle: body.promoTitle } : {}),
        ...(body.promoSubtitle !== undefined ? { promoSubtitle: body.promoSubtitle } : {}),
        ...(body.primaryColor !== undefined ? { primaryColor: body.primaryColor } : {}),
        ...(body.accentColor !== undefined ? { accentColor: body.accentColor } : {}),
        ...(body.paletteId !== undefined ? { paletteId: body.paletteId } : {}),
      };

      if (state.storeDnaJson) {
        await updateStoreDna(session.tenantId, {
          ...state.storeDnaJson,
          launchStep: "preview",
        });
      }

      const updated = await saveThemeDraft(session.tenantId, draft);
      const theme = resolveShopTheme(draft, state.name);
      return NextResponse.json({
        ok: true,
        draft,
        theme,
        state: updated,
        brandGuardIssues,
      });
    }

    if (body.action === "publish") {
      const { resolveApprovalLevel } = await import("@gumakart/ai");
      const { publishStorefrontWithApproval } = await import("@gumakart/db");
      const approvalLevel = resolveApprovalLevel(
        "ai.publish.store",
        state.subscriptionPlan
      );

      const result = await publishStorefrontWithApproval({
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorEmail: session.email ?? null,
        approvalLevel,
        scope: "ai.publish.store",
      });

      const { ensureEventsWired } = await import("@/lib/events-bootstrap");
      ensureEventsWired();
      const { emitDomainEvent, EVENT_NAMES } = await import("@gumakart/events");
      await emitDomainEvent({
        name: EVENT_NAMES.THEME_CHANGE_APPROVED,
        data: {
          tenantId: session.tenantId,
          changeRequestId: result.request.id,
          scope: "ai.publish.store",
        },
        idempotencyKey: `Theme.ChangeApproved.V1:${result.request.id}`,
      });
      await emitDomainEvent({
        name: EVENT_NAMES.THEME_PUBLISHED,
        data: {
          tenantId: session.tenantId,
          changeRequestId: result.request.id,
          customizationVersion: result.customizationVersion,
          templateId: result.templateId,
        },
        idempotencyKey: `Theme.Published.V1:${session.tenantId}:${result.customizationVersion}`,
      });
      await emitDomainEvent({
        name: EVENT_NAMES.STORE_PUBLISHED,
        data: {
          tenantId: session.tenantId,
          slug: result.slug,
          templateId: result.templateId,
          customizationVersion: result.customizationVersion,
        },
        idempotencyKey: `Store.Published.V1:${session.tenantId}:${result.customizationVersion}`,
      });

      const updated = await getLaunchTenantState(session.tenantId);
      return NextResponse.json({
        ok: true,
        published: true,
        changeRequestId: result.request.id,
        state: updated,
        message: "Storefront published with approval audit. Add a product, then activate your shop.",
      });
    }

    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: error.errors[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }
    console.error("[launch POST]", error);
    return NextResponse.json(
      { ok: false, error: "Something went wrong." },
      { status: 500 }
    );
  }
}
