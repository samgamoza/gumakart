# Guma Kart V1 — Implementation Plan

**Document status:** Draft for implementation  
**Target:** Initial Guma Kart product launch  
**Date:** October 2, 2026

---

## 1. Executive Summary

Guma Kart is a **re-alignment of GumaCommerce**, not a replacement of the ecommerce platform.

The existing ecommerce capabilities should remain intact because they represent significant engineering investment. The change is primarily in **product focus, user journey, information architecture, and launch priorities**.

### Guma Kart V1 positioning

> **Guma Kart helps businesses sell anywhere, process every order, fulfill through BayanGo, and automatically stay connected with customers.**

The initial launch should focus on five connected capabilities:

1. **Sell Online — Guma Checkout**
2. **Sell In-Store — Veyron POS**
3. **Fulfill Orders — BayanGo as the primary in-house option**
4. **Automate Customer Communication — Guma Messaging/Automations**
5. **Build an Online Store — existing ecommerce capability, available but not the primary onboarding path**

The product should be built around a shared **Commerce Core** containing Products, Orders, Customers, Inventory, Payments, Businesses, and Locations.

---

# 2. Product Strategy

## 2.1 What changes

The current product is centered on:

> Build an ecommerce store.

Guma Kart V1 should be centered on:

> **Get the sale → process the order → fulfill it → communicate with the customer.**

The online store remains available as one sales channel.

### New hierarchy

```text
                         GUMA KART
                  Commerce Operating Platform
                              |
        +---------------------+----------------------+
        |                     |                      |
       SELL                 FULFILL                CONNECT
        |                     |                      |
   +----+----+                |                Guma Messaging
   |         |                |                Automations
Checkout   Veyron POS      BayanGo
   |
Guma Store
(optional/full ecommerce)
```

---

# 3. V1 Product Pillars

## Pillar 1 — Sell Online

### Guma Checkout

Primary online selling experience.

Capabilities:

- Create checkout
- Checkout link
- Product selection
- Customer information
- Address
- Payment method
- Order creation
- Checkout status
- Payment status
- Order confirmation

Primary CTA:

> **Create Checkout**

---

## Pillar 2 — Sell In-Store

### Veyron POS

Veyron POS is an add-on to Guma Kart and should share the same Commerce Core.

V1 capabilities:

- Product selection
- Cart
- Cash payment
- Supported digital payment
- Receipt
- Order creation
- Inventory deduction
- Customer association
- Basic cashier/session handling

The objective is not to build every possible POS feature in V1.

The objective is:

> **A physical sale creates a Guma order using the same commerce infrastructure as an online sale.**

---

## Pillar 3 — Fulfill

### BayanGo

BayanGo should be the **primary, in-house fulfillment option** at launch.

V1 capabilities:

- Fulfillment request
- Pickup address
- Delivery address
- Delivery fee
- Fulfillment status
- Pickup scheduling where supported
- Courier/driver assignment where supported
- Tracking reference
- Delivery status
- Failed delivery state
- Completed delivery state

The system should be architected so that third-party fulfillment providers can be added later.

### UX principle

Do not make V1 feel like a logistics marketplace.

Default:

> **Fulfill with BayanGo**

Optional later:

> Use another delivery provider

---

## Pillar 4 — Connect

### Guma Messaging & Automation

The initial automation layer should use predefined workflows rather than a full visual automation builder.

V1 automation recipes:

1. Checkout started but not completed
2. Order confirmation
3. Payment confirmation
4. Order ready for fulfillment
5. Order shipped / picked up
6. Out for delivery
7. Delivered

Potential channels:

- Messenger
- SMS
- Email
- Other supported channels as integrations mature

The automation engine should be event-driven.

---

## Pillar 5 — Store

### Existing Guma Ecommerce

The existing ecommerce functionality remains available.

Keep:

- Storefront
- Pages
- Themes
- Navigation
- Product catalog
- Categories
- Domain
- Store settings
- Ecommerce analytics
- Existing ecommerce capabilities

However, the store should not be the mandatory first step for a new merchant.

Position it as:

> **Build your full online store when you're ready.**

---

# 4. Core Architecture

The most important technical principle is:

> **All selling channels should create and consume the same Commerce Core entities.**

## Commerce Core

```text
Business
 |
 +-- Locations
 |
 +-- Products
 |
 +-- Inventory
 |
 +-- Customers
 |
 +-- Orders
 |
 +-- Payments
 |
 +-- Fulfillments
 |
 +-- Messages
 |
 +-- Automations
```

## Sales channels

```text
Guma Checkout ----+
                  |
Veyron POS -------+----> Commerce Core ----> Fulfillment
                  |                            |
Guma Store -------+                            +--> BayanGo
                                               |
                                               +--> Future providers

Commerce events ------------------------------> Automation Engine
                                               |
                                               +--> Messaging
```

---

# 5. Central Domain Object: Order

The **Order** should be the central object connecting sales, payment, fulfillment, inventory, and customer communication.

## Order sources

```text
ONLINE_CHECKOUT
POS
ONLINE_STORE
```

## Order lifecycle

```text
ORDER_CREATED
      |
      v
PAYMENT_PENDING
      |
      v
PAYMENT_CONFIRMED
      |
      v
READY_TO_FULFILL
      |
      v
FULFILLMENT_ASSIGNED
      |
      v
PICKED_UP
      |
      v
IN_TRANSIT
      |
      v
OUT_FOR_DELIVERY
      |
      v
DELIVERED
```

Exception states:

```text
PAYMENT_FAILED
CANCELLED
FULFILLMENT_FAILED
DELIVERY_FAILED
RETURNED
REFUNDED
```

The exact state machine should be validated against existing GumaCommerce and Veyron implementations before development begins.

---

# 6. Event-Driven Automation

The automation system should react to business events rather than UI actions.

## Core events

```text
CHECKOUT_VIEWED
CHECKOUT_STARTED
CUSTOMER_IDENTIFIED
PAYMENT_SELECTED
PAYMENT_ATTEMPTED
PAYMENT_FAILED

ORDER_CREATED
ORDER_PAID
ORDER_CONFIRMED
ORDER_CANCELLED

FULFILLMENT_REQUESTED
FULFILLMENT_ASSIGNED
ORDER_PICKED_UP
ORDER_IN_TRANSIT
ORDER_OUT_FOR_DELIVERY
ORDER_DELIVERED

CUSTOMER_CREATED
CUSTOMER_UPDATED
```

## Example

```text
CHECKOUT_STARTED
       |
       v
WAIT 30 MINUTES
       |
       v
Does order exist?
   |           |
  YES          NO
   |           |
 STOP      SEND MESSAGE
```

The automation engine must support a **stop/suppression condition** so a customer does not receive abandonment messages after completing an order.

---

# 7. New Merchant Onboarding

The new onboarding should prioritize selling rather than store construction.

## Step 1 — Business setup

Collect:

- Business name
- Business type
- Currency
- Contact details
- Primary location

## Step 2 — How do you sell?

```text
[ ] Online
[ ] In-store
[ ] Both
```

## Step 3 — Add first product

Minimum fields:

- Product name
- Price
- Image
- Description
- Inventory/stock

## Step 4 — Choose selling path

```text
Create Checkout
Build Online Store
Set Up Veyron POS
```

The recommended path should be:

> **Create Checkout**

## Step 5 — Payments

Configure supported payment methods.

## Step 6 — Fulfillment

Default:

> **BayanGo**

Configure:

- Pickup location
- Delivery settings
- Applicable delivery fees
- Fulfillment preferences

## Step 7 — Messaging

Connect available messaging channels.

## Step 8 — Launch

Show:

> **You're ready to sell.**

Actions:

- Copy checkout link
- View checkout
- Create another checkout
- Set up Veyron POS
- Build online store

---

# 8. Recommended Navigation

```text
GUMA KART

Overview

SELL
  Checkout
  Orders
  Products

IN-STORE
  Veyron POS

FULFILL
  Deliveries
  BayanGo

AUTOMATE
  Messages
  Automations

CUSTOMERS
  Customers
  Analytics

STORE
  Online Store

SETTINGS
```

If the current application already has a different navigation structure, use progressive migration rather than a complete rewrite.

---

# 9. Dashboard

The dashboard should answer:

> **What needs my attention today?**

## Proposed layout

```text
Good morning 👋

TODAY

Sales
₱48,520

Orders
64

Online
31

Veyron POS
33


ORDERS NEEDING ACTION

8   Awaiting payment
12  Ready to fulfill
17  With BayanGo
6   Out for delivery


DELIVERIES

17  In transit
9   Out for delivery
24  Delivered


AUTOMATION

84  Messages sent
7   Checkouts recovered
31  Delivery notifications
```

Avoid turning the dashboard into a feature catalog.

---

# 10. Checkout Experience

Checkout is one of the most important V1 surfaces and should receive significant UX attention.

## Recommended flow

```text
Product
  |
  v
Checkout
  |
  +-- Customer
  |
  +-- Delivery address
  |
  +-- Payment
  |
  +-- Order summary
  |
  v
Order confirmation
```

The checkout should be:

- Mobile-first
- Fast
- Minimal
- Clear
- Localized for the target market
- Explicit about delivery fees
- Explicit about total amount
- Designed for low-friction completion

---

# 11. Veyron POS Integration

Veyron should not be treated as a separate data island.

## Shared data

Veyron should consume/share:

- Products
- Prices
- Inventory
- Customers
- Orders
- Payments
- Locations

## POS order flow

```text
Cashier
  |
  v
Select products
  |
  v
Cart
  |
  v
Customer (optional/identified)
  |
  v
Payment
  |
  v
Order created
  |
  +--> Inventory updated
  |
  +--> Customer history updated
  |
  +--> Receipt
```

For V1, avoid adding advanced POS requirements that are not necessary to validate the shared commerce model.

---

# 12. BayanGo Integration

BayanGo should operate as a fulfillment provider behind a common fulfillment interface.

## Suggested abstraction

```text
FulfillmentProvider
 |
 +-- BayanGoProvider
 |
 +-- FutureProviderA
 |
 +-- FutureProviderB
```

This prevents Guma Kart's core order system from becoming tightly coupled to BayanGo implementation details.

## Fulfillment flow

```text
Order ready
   |
   v
Create fulfillment request
   |
   v
BayanGo
   |
   +--> Accepted
   |
   +--> Pickup scheduled
   |
   +--> Picked up
   |
   +--> In transit
   |
   +--> Out for delivery
   |
   +--> Delivered
```

Every meaningful BayanGo status change should map to a Guma fulfillment/order event.

---

# 13. Messaging Automation V1

Start with templates rather than a general-purpose workflow builder.

## Recipe 1 — Abandoned Checkout

```text
Trigger:
Checkout started

Wait:
30 minutes

Condition:
No order exists

Action:
Send message

Wait:
24 hours

Condition:
No order exists

Action:
Send second message
```

## Recipe 2 — Order Confirmation

```text
Trigger:
Order confirmed

Action:
Send confirmation
```

## Recipe 3 — Fulfillment Update

```text
Trigger:
Order picked up

Action:
Send delivery update
```

## Recipe 4 — Out for Delivery

```text
Trigger:
Order out for delivery

Action:
Send customer notification
```

## Recipe 5 — Delivered

```text
Trigger:
Order delivered

Action:
Send delivery confirmation
```

---

# 14. Existing Ecommerce Migration Strategy

Do not rewrite the ecommerce system.

Instead, progressively reposition it.

## Keep

- Existing storefront
- Existing product management
- Existing themes
- Existing pages
- Existing domains
- Existing checkout infrastructure where reusable
- Existing catalog/inventory capabilities

## Change

- Dashboard emphasis
- Navigation hierarchy
- Onboarding
- Primary CTAs
- Product messaging
- Store discoverability
- Checkout entry points
- Cross-linking to Veyron and BayanGo

## New connections

```text
Existing Store
      |
      v
Guma Checkout / Order
      |
      v
Commerce Core
      |
      +--> BayanGo
      |
      +--> Messaging
```

---

# 15. Implementation Phases

## Phase 0 — Product Audit

**Goal:** Understand what already exists before modifying it.

Tasks:

- Audit GumaCommerce modules
- Audit current checkout
- Audit order model
- Audit payment integrations
- Audit product/catalog model
- Audit inventory model
- Audit customer model
- Audit ecommerce storefront
- Audit Veyron POS
- Audit BayanGo capabilities/API
- Audit current messaging integrations
- Identify duplicated data models
- Identify reusable components
- Identify technical blockers

Deliverable:

> **Guma Kart Current-State Architecture Map**

---

## Phase 1 — Commerce Core Alignment

**Goal:** Establish the shared foundation.

Tasks:

- Standardize Product entity
- Standardize Customer entity
- Standardize Order entity
- Standardize Payment entity
- Standardize Inventory entity
- Standardize Location entity
- Define Order state machine
- Define source/channel enum
- Define fulfillment abstraction
- Define event model

Deliverable:

> **Guma Commerce Core V1**

---

## Phase 2 — Guma Checkout

**Goal:** Make online checkout the primary activation path.

Tasks:

- Checkout creation
- Checkout link
- Mobile checkout
- Customer form
- Address
- Payment methods
- Order creation
- Confirmation page
- Checkout session tracking
- Abandonment detection
- Basic checkout analytics

Deliverable:

> Merchant can create and share a working checkout.

---

## Phase 3 — Veyron POS Integration

**Goal:** Connect physical selling to the Commerce Core.

Tasks:

- Shared product catalog
- Shared pricing
- Inventory synchronization
- POS order creation
- Customer association
- Payment synchronization
- Receipt
- Basic cashier/session handling
- POS location support
- Order source tracking

Deliverable:

> An in-store Veyron transaction becomes a Guma order.

---

## Phase 4 — BayanGo Fulfillment

**Goal:** Make fulfillment operational immediately after the sale.

Tasks:

- Fulfillment provider interface
- BayanGo integration
- Delivery address mapping
- Pickup location mapping
- Delivery fee handling
- Fulfillment request
- Status synchronization
- Tracking reference
- Delivery exceptions
- Order fulfillment UI

Deliverable:

> A qualifying Guma order can be fulfilled through BayanGo from within Guma Kart.

---

## Phase 5 — Messaging & Automation

**Goal:** Turn order events into automated customer communication.

Tasks:

- Messaging provider abstraction
- Message templates
- Event triggers
- Automation execution
- Delays
- Conditions
- Suppression rules
- Delivery status notifications
- Abandoned checkout automation
- Message logs

Deliverable:

> Guma Kart automatically communicates with customers based on commerce events.

---

## Phase 6 — Unified Dashboard & Navigation

**Goal:** Reorient the existing product around Guma Kart.

Tasks:

- New dashboard
- New navigation
- Orders-first workflow
- Checkout-first onboarding
- Fulfillment visibility
- Veyron visibility
- Automation visibility
- Store as secondary/optional path
- Consistent terminology
- Empty states
- Help/onboarding prompts

Deliverable:

> Existing GumaCommerce feels like Guma Kart without requiring a backend rewrite.

---

## Phase 7 — Ecommerce Store Re-alignment

**Goal:** Preserve the ecommerce product while making its role clear.

Tasks:

- Keep storefront functionality
- Connect storefront products to Commerce Core
- Connect storefront orders to unified Order model
- Ensure checkout uses shared checkout/order infrastructure where practical
- Add “Sell with Checkout” entry points
- Add Veyron/POS references where appropriate
- Add BayanGo fulfillment options
- Improve cross-channel product visibility

Deliverable:

> Guma Store becomes a first-class sales channel inside Guma Kart.

---

## Phase 8 — Beta / Controlled Launch

Start with a limited group of merchants.

Validate:

### Activation

- Can merchant add a product?
- Can merchant create checkout?
- Can merchant share checkout?
- Can merchant receive an order?

### Fulfillment

- Can order be sent to BayanGo?
- Are statuses synchronized?
- Can merchant see delivery progress?

### POS

- Can Veyron create an order?
- Does inventory remain accurate?
- Does customer history remain unified?

### Automation

- Does confirmation send?
- Does abandoned checkout recovery work?
- Do fulfillment events trigger messages?
- Are duplicate/incorrect messages prevented?

---

# 16. V1 Definition of Done

Guma Kart V1 is ready for initial launch when a merchant can complete this journey:

```text
1. Create business
        |
2. Add product
        |
3. Create checkout
        |
4. Share checkout
        |
5. Customer places order
        |
6. Payment is recorded
        |
7. Order appears in Guma
        |
8. Merchant fulfills with BayanGo
        |
9. BayanGo status updates Guma
        |
10. Customer receives automated updates
        |
11. Order becomes delivered
        |
12. Customer history is updated
```

And separately:

```text
Veyron POS
    |
    v
In-store sale
    |
    v
Same Order Core
    |
    +--> Inventory
    +--> Customer
    +--> Analytics
    +--> Fulfillment where applicable
```

---

# 17. Feature Prioritization

## P0 — Required for launch

- Commerce Core alignment
- Product management
- Checkout
- Orders
- Payments
- Customer records
- Inventory basics
- BayanGo integration
- Basic fulfillment status
- Veyron POS basic integration
- Messaging infrastructure
- Abandoned checkout
- Order confirmation
- Delivery notifications
- New onboarding
- New dashboard
- New navigation

## P1 — Shortly after launch

- More messaging channels
- Advanced automation recipes
- More fulfillment providers
- Better analytics
- Multiple locations
- Staff permissions
- Advanced POS features
- Advanced ecommerce customization
- Customer segmentation
- Promotions

## P2 — Later

- Visual automation builder
- Loyalty
- Advanced CRM
- Advanced marketing campaigns
- Advanced inventory
- Advanced logistics management
- Marketplace features
- Subscriptions
- Multi-business / enterprise capabilities

---

# 18. What Not to Rebuild

The project should explicitly protect existing investment.

Do not rebuild simply for the sake of the rebrand:

- Existing ecommerce storefront
- Existing product/catalog system
- Existing theme system
- Existing page builder
- Existing domain functionality
- Existing payment integrations
- Existing inventory functionality
- Existing order functionality
- Existing Veyron functionality that already works
- Existing BayanGo infrastructure that already works

Instead:

> **Wrap, connect, normalize, and reposition.**

---

# 19. Product Metrics for V1

The primary metric should not be number of stores created.

The primary activation metric should be:

> **Merchant creates a checkout and receives their first order.**

Suggested metrics:

### Activation

- % merchants adding first product
- % merchants creating first checkout
- % merchants sharing checkout
- % merchants receiving first order
- Time to first order

### Conversion

- Checkout starts
- Checkout completion rate
- Payment success rate
- Abandoned checkout recovery rate

### Fulfillment

- % eligible orders fulfilled through BayanGo
- Fulfillment request success rate
- Delivery success rate
- Average fulfillment time

### POS

- Active Veyron merchants
- POS transactions
- POS order success rate
- Inventory synchronization accuracy

### Messaging

- Messages sent
- Delivery rate
- Automation execution rate
- Recovery conversions
- Notification failure rate

### Retention

- Merchants active after 7/30 days
- Repeat orders
- Online + POS adoption
- BayanGo adoption
- Automation adoption

---

# 20. Launch Messaging

## Primary

# Guma Kart

### Sell. Fulfill. Connect.

Sell online or in-store, fulfill with BayanGo, and automatically keep your customers updated.

### Supporting message

> Start with a simple checkout. Add Veyron POS for your physical store. Use BayanGo for fulfillment. Build a full online store whenever you're ready.

---

# 21. Internal Product Principle

The team should use this rule when deciding whether something belongs in V1:

> **Does this help a merchant sell, process, fulfill, or communicate around an order?**

If yes, it may belong in V1.

If it primarily helps customize the storefront without improving the transaction or merchant activation path, it can remain available but should not become a launch blocker.

---

# 22. Final Product Architecture

```text
                              GUMA KART
                     Commerce Operating Platform
                                   |
       +---------------------------+---------------------------+
       |                           |                           |
       v                           v                           v
     SELL                       FULFILL                     CONNECT
       |                           |                           |
 +-----+------+              +-----+------+             +------+
 |            |              |            |             |
 v            v              v            v             v
Checkout    Veyron POS    BayanGo     Future 3PL    Messaging
 |            |              |                          |
 +------------+--------------+--------------------------+
              |
              v
       GUMA COMMERCE CORE
              |
   +----------+----------+----------+----------+
   |          |          |          |          |
Products   Orders    Customers  Inventory  Payments
              |
              v
         Event System
              |
              v
       Automation Engine
              |
              v
        Customer Messages
```

---

# 23. The Strategic Outcome

The goal is **not** to turn GumaCommerce into a smaller ecommerce product.

The goal is to evolve it into:

> **Guma Kart — a commerce operating platform where ecommerce is one selling channel, Veyron POS is the in-store channel, BayanGo is the primary fulfillment channel, and messaging automation connects the entire customer journey.**

This approach preserves the existing ecommerce investment while giving the initial launch a much clearer and narrower activation path.

---

## Immediate Next Actions

1. Freeze unnecessary new ecommerce feature development temporarily.
2. Audit the existing GumaCommerce, Veyron, and BayanGo implementations.
3. Map the existing data models against the proposed Commerce Core.
4. Define the canonical Order and Order Status models.
5. Define the fulfillment provider interface.
6. Define the event model.
7. Design the new Guma Kart onboarding.
8. Redesign the dashboard around orders, fulfillment, and sales.
9. Polish Guma Checkout.
10. Connect Veyron POS to the shared Order/Inventory model.
11. Connect BayanGo to the fulfillment lifecycle.
12. Implement the first five messaging automations.
13. Run an internal end-to-end transaction test.
14. Launch a controlled merchant beta.
15. Measure time-to-first-order and fulfillment success before expanding scope.
