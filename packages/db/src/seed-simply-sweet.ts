import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { getDb, closeDb } from "./client";
import { categories, productImages, products, productVariants, tenants, users } from "./schema/index";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
config({ path: path.join(rootDir, ".env") });

const SLUG = "simply-sweet";
const EMAIL = "hello@simplysweetcreations.com";
// Security G4 (GK-25): the seller's password comes from the environment, never from the repo.
// If this account exists on Neon with the old hard-coded password, rotate it.
const PASSWORD = process.env.SEED_SIMPLY_SWEET_PASSWORD ?? "";
if (!PASSWORD || PASSWORD.length < 12) {
  console.error("Set SEED_SIMPLY_SWEET_PASSWORD (12+ characters) before running this seed.");
  process.exit(1);
}
const LOGO_URL =
  "https://media.base44.com/images/public/6a4ba7511766086b2db6e7c5/5c6e9ed4e_logo_simply_sweet.png";
const COVER_URL =
  "https://media.base44.com/images/public/6a4ba7511766086b2db6e7c5/fcb9335f4_generated_5e801efe.png";

async function seedSimplySweet() {
  const db = getDb();

  const existing = await db.select().from(tenants).where(eq(tenants.slug, SLUG)).limit(1);
  if (existing.length > 0) {
    console.log("Simply Sweet tenant already exists — skipping seed.");
    console.log(`  Admin login: ${EMAIL}`);
    console.log(`  Storefront:  http://localhost:3000/${SLUG}`);
    return;
  }

  console.log("Seeding Simply Sweet Creations tenant…");

  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  const [tenant] = await db
    .insert(tenants)
    .values({
      slug: SLUG,
      name: "Simply Sweet Creations",
      legalName: "Simply Sweet Creations",
      category: "Home Baking & Pastry",
      logoUrl: LOGO_URL,
      coverUrl: COVER_URL,
      themeJson: {
        patternId: "simply-sweet",
        templateId: "simply-sweet",
        vibe: "cute",
        paletteId: "bubblegum",
        primaryColor: "#FF007F",
        accentColor: "#FFD1DC",
        tagline: "Home Baking Made With Love — Sweet Moments, Warm Memories.",
        promoTitle: "Fresh batches every week",
        promoSubtitle: "Order before Friday for weekend pickup · GCash & COD accepted",
      },
      localeDefault: "taglish",
      settingsJson: {
        codEnabled: true,
        autoAcceptOrders: false,
        minOrderAmount: 199,
        shopAssistant: {
          enabled: true,
          name: "Sweet Assistant",
          greeting: "Hi! Looking for a treat or a custom order? 💕",
          tone: "friendly_taglish",
        },
      },
      subscriptionPlan: "growth",
      status: "active",
    })
    .returning();

  if (!tenant) throw new Error("Failed to create Simply Sweet tenant");

  const [user] = await db
    .insert(users)
    .values({
      email: EMAIL,
      passwordHash,
      role: "seller_owner",
      tenantId: tenant.id,
      profileJson: { displayName: "Simply Sweet Baker" },
      emailVerifiedAt: new Date(),
    })
    .returning();

  if (!user) throw new Error("Failed to create Simply Sweet user");

  const catalogCategories = [
    { name: "Baked Goods", slug: "baked-goods", sortOrder: 0 },
    { name: "Recipes", slug: "recipes", sortOrder: 1 },
    { name: "Delicacies", slug: "delicacies", sortOrder: 2 },
  ];

  const categoryIds: Record<string, string> = {};
  for (const cat of catalogCategories) {
    const [row] = await db
      .insert(categories)
      .values({ tenantId: tenant.id, ...cat })
      .returning();
    if (row) categoryIds[cat.slug] = row.id;
  }

  const catalog = [
    {
      title: "Classic Butter Cupcakes (6 pcs)",
      slug: "butter-cupcakes-6",
      categorySlug: "baked-goods",
      basePrice: "450.00",
      compareAtPrice: "520.00",
      image:
        "https://images.unsplash.com/photo-1614707267537-b85adf62e550?w=800&q=80",
      descriptionHtml:
        "<p>Fluffy vanilla cupcakes with Swiss buttercream — perfect for celebrations.</p>",
    },
    {
      title: "Ube Cheese Pandesal (12 pcs)",
      slug: "ube-cheese-pandesal",
      categorySlug: "baked-goods",
      basePrice: "280.00",
      image:
        "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80",
      descriptionHtml: "<p>Soft ube pandesal with melty cheese filling, baked fresh daily.</p>",
    },
    {
      title: "Chocolate Lava Cake",
      slug: "chocolate-lava-cake",
      categorySlug: "baked-goods",
      basePrice: "320.00",
      image:
        "https://images.unsplash.com/photo-1624353365286-3f8d62daad51?w=800&q=80",
      descriptionHtml: "<p>Rich dark chocolate with a molten center — best served warm.</p>",
    },
    {
      title: "No-Bake Mango Float Recipe PDF",
      slug: "mango-float-recipe",
      categorySlug: "recipes",
      basePrice: "149.00",
      image:
        "https://images.unsplash.com/photo-1563805042-7684c019e1cb?w=800&q=80",
      descriptionHtml: "<p>Step-by-step home recipe with tips from my kitchen vlog series.</p>",
    },
    {
      title: "Calamansi Curd Jar",
      slug: "calamansi-curd",
      categorySlug: "delicacies",
      basePrice: "220.00",
      image:
        "https://images.unsplash.com/photo-1558961363-fa8cf8d7450a?w=800&q=80",
      descriptionHtml: "<p>Tangy-sweet calamansi curd — spread on toast or swirl into frosting.</p>",
    },
    {
      title: "Custom Celebration Cake",
      slug: "custom-celebration-cake",
      categorySlug: "baked-goods",
      basePrice: "1800.00",
      image:
        "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=800&q=80",
      descriptionHtml: "<p>Two-tier custom cake — message us 5 days ahead for design consult.</p>",
    },
  ];

  for (const item of catalog) {
    const [product] = await db
      .insert(products)
      .values({
        tenantId: tenant.id,
        categoryId: categoryIds[item.categorySlug],
        title: item.title,
        slug: item.slug,
        descriptionHtml: item.descriptionHtml,
        status: "active",
        basePrice: item.basePrice,
        compareAtPrice: item.compareAtPrice ?? null,
        metadataJson: { prepTimeMinutes: 48 },
      })
      .returning();

    if (product) {
      const [variant] = await db
        .insert(productVariants)
        .values({
          productId: product.id,
          sku: `${item.slug}-default`,
          title: "Regular",
          price: item.basePrice,
          stockQty: 24,
          optionsJson: { size: "Regular" },
          imageUrl: item.image,
        })
        .returning();

      if (variant) {
        await db.insert(productImages).values({
          productId: product.id,
          variantId: variant.id,
          url: item.image,
          alt: product.title,
          sortOrder: 0,
        });
      }
    }
  }

  console.log("Simply Sweet seed complete.");
  console.log(`  Admin:      http://localhost:3001`);
  console.log(`  Login:      ${EMAIL}`);
  console.log("  Password:   (the SEED_SIMPLY_SWEET_PASSWORD you set)");
  console.log(`  Storefront: http://localhost:3000/${SLUG}`);
}

seedSimplySweet()
  .catch((err) => {
    console.error("Simply Sweet seed failed:", err);
    process.exit(1);
  })
  .finally(() => closeDb());
