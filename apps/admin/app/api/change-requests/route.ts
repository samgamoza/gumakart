import { NextResponse } from "next/server";
import { z } from "zod";
import {
  listChangeRequestsForTenant,
  listTenantAudit,
  getChangeRequest,
  approveChangeRequest,
  rejectChangeRequest,
  publishThemeChangeRequest,
  publishCatalogChangeRequest,
  publishPricingChangeRequest,
  publishSeoChangeRequest,
  rollbackThemeChangeRequest,
  rollbackSeoChangeRequest,
  publishCheckoutChangeRequest,
  rollbackCheckoutChangeRequest,
  publishShippingChangeRequest,
  rollbackShippingChangeRequest,
} from "@gumakart/db";
import { ApiAuthError, requireTenantSession } from "@/lib/api-auth";

export async function GET(request: Request) {
  try {
    const session = await requireTenantSession();
    const url = new URL(request.url);
    const view = url.searchParams.get("view") ?? "requests";

    if (view === "audit") {
      const audit = await listTenantAudit(session.tenantId, 40);
      return NextResponse.json({ ok: true, audit });
    }

    const statusParam = url.searchParams.get("status");
    const statuses = statusParam
      ? (statusParam.split(",") as Array<
          "draft" | "pending_review" | "approved" | "rejected" | "published" | "rolled_back"
        >)
      : undefined;

    const requests = await listChangeRequestsForTenant(session.tenantId, {
      status: statuses,
      limit: 40,
    });
    return NextResponse.json({ ok: true, requests });
  } catch (error) {
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[change-requests GET]", error);
    return NextResponse.json({ ok: false, error: "Something went wrong." }, { status: 500 });
  }
}

const actionSchema = z.object({
  action: z.enum(["approve", "reject", "publish", "rollback"]),
  id: z.string().uuid(),
  reviewNote: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  try {
    const session = await requireTenantSession();
    const body = actionSchema.parse(await request.json());
    const existing = await getChangeRequest(body.id, session.tenantId);
    if (!existing) {
      return NextResponse.json({ ok: false, error: "Change request not found." }, { status: 404 });
    }

    if (body.action === "approve") {
      const requestRow = await approveChangeRequest({
        id: body.id,
        tenantId: session.tenantId,
        reviewedBy: session.userId,
        reviewNote: body.reviewNote,
      });
      const { ensureEventsWired } = await import("@/lib/events-bootstrap");
      ensureEventsWired();
      const { emitDomainEvent, EVENT_NAMES } = await import("@gumakart/events");
      if (requestRow.domain === "catalog") {
        await emitDomainEvent({
          name: EVENT_NAMES.CATALOG_CHANGE_APPROVED,
          data: {
            tenantId: session.tenantId,
            changeRequestId: requestRow.id,
            productId:
              typeof requestRow.afterJson?.productId === "string"
                ? requestRow.afterJson.productId
                : undefined,
          },
          idempotencyKey: `Catalog.ChangeApproved.V1:${requestRow.id}:approve`,
        });
      } else if (requestRow.domain === "pricing") {
        const productId =
          typeof requestRow.afterJson?.productId === "string"
            ? requestRow.afterJson.productId
            : null;
        if (productId) {
          await emitDomainEvent({
            name: EVENT_NAMES.PRICING_CHANGE_APPROVED,
            data: {
              tenantId: session.tenantId,
              changeRequestId: requestRow.id,
              productId,
              basePrice:
                requestRow.afterJson?.basePrice != null
                  ? String(requestRow.afterJson.basePrice)
                  : undefined,
            },
            idempotencyKey: `Pricing.ChangeApproved.V1:${requestRow.id}:approve`,
          });
        }
      } else if (requestRow.domain === "seo") {
        await emitDomainEvent({
          name: EVENT_NAMES.SEO_CHANGE_APPROVED,
          data: {
            tenantId: session.tenantId,
            changeRequestId: requestRow.id,
            scope: requestRow.scope,
          },
          idempotencyKey: `Seo.ChangeApproved.V1:${requestRow.id}:approve`,
        });
      } else if (requestRow.domain === "checkout") {
        await emitDomainEvent({
          name: EVENT_NAMES.CHECKOUT_CHANGE_APPROVED,
          data: {
            tenantId: session.tenantId,
            changeRequestId: requestRow.id,
            scope: requestRow.scope,
          },
          idempotencyKey: `Checkout.ChangeApproved.V1:${requestRow.id}:approve`,
        });
      } else if (requestRow.domain === "shipping") {
        await emitDomainEvent({
          name: EVENT_NAMES.SHIPPING_CHANGE_APPROVED,
          data: {
            tenantId: session.tenantId,
            changeRequestId: requestRow.id,
            scope: requestRow.scope,
          },
          idempotencyKey: `Shipping.ChangeApproved.V1:${requestRow.id}:approve`,
        });
      } else {
        await emitDomainEvent({
          name: EVENT_NAMES.THEME_CHANGE_APPROVED,
          data: {
            tenantId: session.tenantId,
            changeRequestId: requestRow.id,
            scope: requestRow.scope,
          },
          idempotencyKey: `Theme.ChangeApproved.V1:${requestRow.id}`,
        });
      }
      return NextResponse.json({ ok: true, request: requestRow });
    }

    if (body.action === "reject") {
      const requestRow = await rejectChangeRequest({
        id: body.id,
        tenantId: session.tenantId,
        reviewedBy: session.userId,
        reviewNote: body.reviewNote,
      });
      return NextResponse.json({ ok: true, request: requestRow });
    }

    if (body.action === "publish") {
      if (existing.domain === "catalog") {
        if (existing.status !== "approved") {
          await approveChangeRequest({
            id: body.id,
            tenantId: session.tenantId,
            reviewedBy: session.userId,
            reviewNote: body.reviewNote ?? "Approved on publish",
          });
        }
        const { request: published, productId } = await publishCatalogChangeRequest({
          id: body.id,
          tenantId: session.tenantId,
          actorUserId: session.userId,
          actorEmail: session.email ?? null,
        });
        const { ensureEventsWired } = await import("@/lib/events-bootstrap");
        ensureEventsWired();
        const { emitDomainEvent, EVENT_NAMES } = await import("@gumakart/events");
        await emitDomainEvent({
          name: EVENT_NAMES.CATALOG_CHANGE_APPROVED,
          data: {
            tenantId: session.tenantId,
            changeRequestId: published.id,
            productId,
          },
          idempotencyKey: `Catalog.ChangeApproved.V1:${published.id}`,
        });
        return NextResponse.json({ ok: true, request: published, productId });
      }

      if (existing.domain === "pricing") {
        if (existing.status !== "approved") {
          await approveChangeRequest({
            id: body.id,
            tenantId: session.tenantId,
            reviewedBy: session.userId,
            reviewNote: body.reviewNote ?? "Approved on publish",
          });
        }
        const { request: published, productId } = await publishPricingChangeRequest({
          id: body.id,
          tenantId: session.tenantId,
          actorUserId: session.userId,
          actorEmail: session.email ?? null,
        });
        const { ensureEventsWired } = await import("@/lib/events-bootstrap");
        ensureEventsWired();
        const { emitDomainEvent, EVENT_NAMES } = await import("@gumakart/events");
        await emitDomainEvent({
          name: EVENT_NAMES.PRICING_CHANGE_APPROVED,
          data: {
            tenantId: session.tenantId,
            changeRequestId: published.id,
            productId,
            basePrice:
              published.afterJson?.basePrice != null
                ? String(published.afterJson.basePrice)
                : undefined,
          },
          idempotencyKey: `Pricing.ChangeApproved.V1:${published.id}`,
        });
        return NextResponse.json({ ok: true, request: published, productId });
      }

      if (existing.domain === "seo") {
        if (existing.status !== "approved") {
          await approveChangeRequest({
            id: body.id,
            tenantId: session.tenantId,
            reviewedBy: session.userId,
            reviewNote: body.reviewNote ?? "Approved on publish",
          });
        }
        const { request: published, seo } = await publishSeoChangeRequest({
          id: body.id,
          tenantId: session.tenantId,
          actorUserId: session.userId,
          actorEmail: session.email ?? null,
        });
        const { ensureEventsWired } = await import("@/lib/events-bootstrap");
        ensureEventsWired();
        const { emitDomainEvent, EVENT_NAMES } = await import("@gumakart/events");
        await emitDomainEvent({
          name: EVENT_NAMES.SEO_PUBLISHED,
          data: {
            tenantId: session.tenantId,
            changeRequestId: published.id,
            siteTitle: seo.siteTitle,
          },
          idempotencyKey: `Seo.Published.V1:${published.id}`,
        });
        return NextResponse.json({ ok: true, request: published, seo });
      }

      if (existing.domain === "checkout") {
        if (existing.status !== "approved") {
          await approveChangeRequest({
            id: body.id,
            tenantId: session.tenantId,
            reviewedBy: session.userId,
            reviewNote: body.reviewNote ?? "Approved on publish",
          });
        }
        const { request: published, checkout } = await publishCheckoutChangeRequest({
          id: body.id,
          tenantId: session.tenantId,
          actorUserId: session.userId,
          actorEmail: session.email ?? null,
        });
        const { ensureEventsWired } = await import("@/lib/events-bootstrap");
        ensureEventsWired();
        const { emitDomainEvent, EVENT_NAMES } = await import("@gumakart/events");
        await emitDomainEvent({
          name: EVENT_NAMES.CHECKOUT_PUBLISHED,
          data: {
            tenantId: session.tenantId,
            changeRequestId: published.id,
          },
          idempotencyKey: `Checkout.Published.V1:${published.id}`,
        });
        return NextResponse.json({ ok: true, request: published, checkout });
      }

      if (existing.domain === "shipping") {
        if (existing.status !== "approved") {
          await approveChangeRequest({
            id: body.id,
            tenantId: session.tenantId,
            reviewedBy: session.userId,
            reviewNote: body.reviewNote ?? "Approved on publish",
          });
        }
        const { request: published, shipping } = await publishShippingChangeRequest({
          id: body.id,
          tenantId: session.tenantId,
          actorUserId: session.userId,
          actorEmail: session.email ?? null,
        });
        const { ensureEventsWired } = await import("@/lib/events-bootstrap");
        ensureEventsWired();
        const { emitDomainEvent, EVENT_NAMES } = await import("@gumakart/events");
        await emitDomainEvent({
          name: EVENT_NAMES.SHIPPING_PUBLISHED,
          data: {
            tenantId: session.tenantId,
            changeRequestId: published.id,
            defaultProfileId: shipping.defaultProfileId,
          },
          idempotencyKey: `Shipping.Published.V1:${published.id}`,
        });
        return NextResponse.json({ ok: true, request: published, shipping });
      }

      if (existing.domain !== "theme") {
        return NextResponse.json(
          { ok: false, error: "Publish for this domain is not supported yet." },
          { status: 400 }
        );
      }
      if (existing.status !== "approved") {
        await approveChangeRequest({
          id: body.id,
          tenantId: session.tenantId,
          reviewedBy: session.userId,
          reviewNote: body.reviewNote ?? "Approved on publish",
        });
      }
      const { request: published, customizationVersion } = await publishThemeChangeRequest({
        id: body.id,
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorEmail: session.email ?? null,
      });
      const { ensureEventsWired } = await import("@/lib/events-bootstrap");
      ensureEventsWired();
      const { emitDomainEvent, EVENT_NAMES } = await import("@gumakart/events");
      await emitDomainEvent({
        name: EVENT_NAMES.THEME_PUBLISHED,
        data: {
          tenantId: session.tenantId,
          changeRequestId: published.id,
          customizationVersion,
          templateId:
            typeof published.afterJson?.templateId === "string"
              ? published.afterJson.templateId
              : undefined,
        },
        idempotencyKey: `Theme.Published.V1:${session.tenantId}:${customizationVersion}`,
      });
      return NextResponse.json({ ok: true, request: published, customizationVersion });
    }

    if (body.action === "rollback") {
      if (existing.domain === "seo") {
        const rolled = await rollbackSeoChangeRequest({
          id: body.id,
          tenantId: session.tenantId,
          actorUserId: session.userId,
          actorEmail: session.email ?? null,
        });
        const { ensureEventsWired } = await import("@/lib/events-bootstrap");
        ensureEventsWired();
        const { emitDomainEvent, EVENT_NAMES } = await import("@gumakart/events");
        await emitDomainEvent({
          name: EVENT_NAMES.SEO_ROLLED_BACK,
          data: {
            tenantId: session.tenantId,
            changeRequestId: rolled.id,
          },
          idempotencyKey: `Seo.RolledBack.V1:${rolled.id}`,
        });
        return NextResponse.json({ ok: true, request: rolled });
      }
      if (existing.domain === "checkout") {
        const rolled = await rollbackCheckoutChangeRequest({
          id: body.id,
          tenantId: session.tenantId,
          actorUserId: session.userId,
          actorEmail: session.email ?? null,
        });
        const { ensureEventsWired } = await import("@/lib/events-bootstrap");
        ensureEventsWired();
        const { emitDomainEvent, EVENT_NAMES } = await import("@gumakart/events");
        await emitDomainEvent({
          name: EVENT_NAMES.CHECKOUT_ROLLED_BACK,
          data: {
            tenantId: session.tenantId,
            changeRequestId: rolled.id,
          },
          idempotencyKey: `Checkout.RolledBack.V1:${rolled.id}`,
        });
        return NextResponse.json({ ok: true, request: rolled });
      }
      if (existing.domain === "shipping") {
        const rolled = await rollbackShippingChangeRequest({
          id: body.id,
          tenantId: session.tenantId,
          actorUserId: session.userId,
          actorEmail: session.email ?? null,
        });
        const { ensureEventsWired } = await import("@/lib/events-bootstrap");
        ensureEventsWired();
        const { emitDomainEvent, EVENT_NAMES } = await import("@gumakart/events");
        await emitDomainEvent({
          name: EVENT_NAMES.SHIPPING_ROLLED_BACK,
          data: {
            tenantId: session.tenantId,
            changeRequestId: rolled.id,
          },
          idempotencyKey: `Shipping.RolledBack.V1:${rolled.id}`,
        });
        return NextResponse.json({ ok: true, request: rolled });
      }
      if (existing.domain !== "theme") {
        return NextResponse.json(
          {
            ok: false,
            error: "Rollback is only supported for theme, SEO, checkout, and shipping changes.",
          },
          { status: 400 }
        );
      }
      const rolled = await rollbackThemeChangeRequest({
        id: body.id,
        tenantId: session.tenantId,
        actorUserId: session.userId,
        actorEmail: session.email ?? null,
      });
      const { ensureEventsWired } = await import("@/lib/events-bootstrap");
      ensureEventsWired();
      const { emitDomainEvent, EVENT_NAMES } = await import("@gumakart/events");
      await emitDomainEvent({
        name: EVENT_NAMES.THEME_ROLLED_BACK,
        data: {
          tenantId: session.tenantId,
          changeRequestId: rolled.id,
        },
        idempotencyKey: `Theme.RolledBack.V1:${rolled.id}`,
      });
      return NextResponse.json({ ok: true, request: rolled });
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
    console.error("[change-requests POST]", error);
    return NextResponse.json(
      { ok: false, error: "Something went wrong." },
      { status: 500 }
    );
  }
}
