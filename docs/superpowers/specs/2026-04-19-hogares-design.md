# Hogares (Households) — Design Spec

## Goal

Allow multiple users to share financial data (expenses, categories, rules, imports, Splitwise sync) under a shared "hogar" (household). Each user logs in with their own Google account and can belong to multiple hogares, switching between them freely.

## Current State

- All data tables (`expenses`, `categories`, `categorization_rules`, `imports`, `splitwise_sync_state`) are scoped by `userId`.
- Single-user model: every query filters by `userId` extracted from JWT.
- Auth: Google OAuth → JWT (HS256, 7-day expiry) with `sub = userId`.

## Architecture

Replace `userId` with `householdId` as the data ownership key across all tables. Users belong to households via a join table. Each user has an active household that determines what data they see. Invitations use a shareable code (no email service needed).

## Data Model

### New Tables

**`households`**

| Column     | Type      | Constraints          |
|------------|-----------|----------------------|
| id         | uuid PK   | default gen_random_uuid() |
| name       | text      | not null             |
| created_at | timestamp | default now()        |

**`household_members`**

| Column       | Type      | Constraints                              |
|--------------|-----------|------------------------------------------|
| id           | uuid PK   | default gen_random_uuid()               |
| household_id | uuid FK   | → households.id, not null               |
| user_id      | uuid FK   | → users.id, not null                    |
| created_at   | timestamp | default now()                            |
|              |           | unique(household_id, user_id)           |

**`household_invites`**

| Column       | Type      | Constraints                              |
|--------------|-----------|------------------------------------------|
| id           | uuid PK   | default gen_random_uuid()               |
| household_id | uuid FK   | → households.id, not null               |
| code         | text      | not null, unique, 8 alphanumeric chars  |
| created_by   | uuid FK   | → users.id, not null                    |
| expires_at   | timestamp | not null (48h from creation)            |
| created_at   | timestamp | default now()                            |

### Modified Tables

**`users`** — add column:
- `active_household_id` (uuid FK → households.id, nullable)

**`expenses`** — replace `user_id` with:
- `household_id` (uuid FK → households.id, not null)
- `created_by` (uuid FK → users.id, nullable) — who created the expense

**`categories`** — replace `user_id` with:
- `household_id` (uuid FK → households.id, not null)

**`categorization_rules`** — replace `user_id` with:
- `household_id` (uuid FK → households.id, not null)

**`imports`** — replace `user_id` with:
- `household_id` (uuid FK → households.id, not null)

**`splitwise_sync_state`** — replace `user_id` with:
- `household_id` (uuid FK → households.id, not null)

### Splitwise Connection

The OAuth credentials (`splitwise_access_token`, `splitwise_user_id`, `splitwise_group_id`, `splitwise_group_name`) remain on the `users` table — they are personal credentials. However, the synced expenses and sync state belong to the household. When syncing, the system uses the user's token but writes expenses with `householdId`.

## Active Household Context

### Storage

The `users.active_household_id` column tracks the user's currently selected household. Set on login (default) or when the user switches households.

### Propagation

The auth middleware resolves `userId` from the JWT, then reads `activeHouseholdId` from the `users` table. Both are set in the Hono context. Routes use `getHouseholdId(c)` instead of `getUserId(c)` to filter data.

To avoid an extra DB query on every request, `activeHouseholdId` is included in the JWT payload alongside `userId`. When the user switches households, a new JWT is issued. This eliminates the per-request user lookup. The auth middleware reads `householdId` directly from the JWT claims.

### Validation

Every data operation verifies that the user is a member of the active household. If the `activeHouseholdId` doesn't match any membership, the request is rejected with 403.

## Invitation Flow

1. A member of a household calls `POST /api/households/:id/invite`.
2. The backend generates an 8-character alphanumeric code, stores it in `household_invites` with a 48-hour expiration, and returns it.
3. The user shares the code externally (WhatsApp, etc).
4. The invited person, already logged in, calls `POST /api/households/join` with the code.
5. The backend validates the code (exists, not expired), adds the user as a member via `household_members`, deletes the code (single use), and sets the joined household as the user's `activeHouseholdId`.
6. If the user is already a member of that household, return a friendly error.

## Auto-creation

When a user registers (first Google login), a household named "Personal" is automatically created, the user is added as its sole member, and it is set as their `activeHouseholdId`.

## API Endpoints

### New Routes (`/api/households`)

| Method | Path                        | Description                          |
|--------|-----------------------------|--------------------------------------|
| GET    | /                           | List user's households               |
| POST   | /                           | Create a new household               |
| PUT    | /:id                        | Update household name                |
| POST   | /switch                     | Switch active household              |
| GET    | /:id/members                | List members of a household          |
| POST   | /:id/invite                 | Generate invitation code             |
| POST   | /join                       | Join a household using a code        |
| POST   | /:id/leave                  | Leave a household (must have ≥2)     |

### Modified Routes

All existing routes that use `getUserId(c)` switch to `getHouseholdId(c)`:
- `/api/expenses` — CRUD operations
- `/api/reports` — monthly, trend, breakdown, category
- `/api/import` — upload, confirm, categorize
- `/api/categories` — list, seed
- `/api/rules` — CRUD
- `/api/splitwise` — status, groups, group, sync, disconnect (but `/connect` and callback still use `userId` for OAuth credentials)

## Frontend Changes

### Household Selector (Header)

A dropdown in the navbar/header showing the active household name. Lists all households the user belongs to. Selecting one calls `POST /api/households/switch`, reloads page data.

### Household Settings Page (`/household`)

- Household name (editable)
- Members list (name, email, Google profile picture)
- "Generate invitation code" button → displays code to copy
- "Create new household" button
- "Leave household" button (disabled if user has only one household)

### Join Household

Accessible from the household selector. Input field for the code + "Join" button.

### Existing Pages

No visual changes. They display data from the active household. The experience is identical to today for a single-user household.

## Migration

Since there is only one user in production:

1. Create a household "Personal".
2. Insert a `household_members` row linking the existing user to that household.
3. Set `active_household_id` on the user.
4. Add `household_id` column to all data tables, populate with the new household ID.
5. Drop `user_id` columns from data tables (except `expenses.created_by` which gets the existing `user_id` value).
6. Add `household_id` FK constraints.

This can be a single migration file. No data loss, no ambiguity — one user, one household.

## Scope Exclusions

- No roles/permissions within a household — all members are equal.
- No email-based invitations — code-only.
- No notifications when someone joins a household.
- No audit log of who changed what (beyond `expenses.created_by`).
- No household deletion — users can leave, and empty households are inert.
