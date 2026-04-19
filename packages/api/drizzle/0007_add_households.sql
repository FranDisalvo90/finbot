-- Step 1: Create households table
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint

-- Step 2: Create a "Personal" household for the existing user and link them
DO $$
DECLARE
	v_household_id uuid;
	v_user_id uuid;
BEGIN
	-- Get the existing user (there is only one in production)
	SELECT id INTO v_user_id FROM users LIMIT 1;

	IF v_user_id IS NOT NULL THEN
		-- Create a personal household
		INSERT INTO households (id, name) VALUES (gen_random_uuid(), 'Personal')
		RETURNING id INTO v_household_id;

		-- Add household_id columns (nullable first)
		ALTER TABLE "categories" ADD COLUMN "household_id" uuid;
		ALTER TABLE "expenses" ADD COLUMN "household_id" uuid;
		ALTER TABLE "expenses" ADD COLUMN "created_by" uuid;
		ALTER TABLE "categorization_rules" ADD COLUMN "household_id" uuid;
		ALTER TABLE "imports" ADD COLUMN "household_id" uuid;
		ALTER TABLE "splitwise_sync_state" ADD COLUMN "household_id" uuid;
		ALTER TABLE "users" ADD COLUMN "active_household_id" uuid;

		-- Populate household_id from the created household for all existing data
		UPDATE categories SET household_id = v_household_id WHERE user_id = v_user_id;
		UPDATE expenses SET household_id = v_household_id, created_by = v_user_id WHERE user_id = v_user_id;
		UPDATE categorization_rules SET household_id = v_household_id WHERE user_id = v_user_id;
		UPDATE imports SET household_id = v_household_id WHERE user_id = v_user_id;
		UPDATE splitwise_sync_state SET household_id = v_household_id WHERE user_id = v_user_id;
		UPDATE users SET active_household_id = v_household_id WHERE id = v_user_id;
	ELSE
		-- No users exist (e.g. test DB), just add the columns
		ALTER TABLE "categories" ADD COLUMN "household_id" uuid;
		ALTER TABLE "expenses" ADD COLUMN "household_id" uuid;
		ALTER TABLE "expenses" ADD COLUMN "created_by" uuid;
		ALTER TABLE "categorization_rules" ADD COLUMN "household_id" uuid;
		ALTER TABLE "imports" ADD COLUMN "household_id" uuid;
		ALTER TABLE "splitwise_sync_state" ADD COLUMN "household_id" uuid;
		ALTER TABLE "users" ADD COLUMN "active_household_id" uuid;
	END IF;
END $$;
--> statement-breakpoint

-- Step 3: Set NOT NULL on splitwise_sync_state.household_id
ALTER TABLE "splitwise_sync_state" ALTER COLUMN "household_id" SET NOT NULL;
--> statement-breakpoint

-- Step 4: Drop old user_id foreign keys
ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT IF EXISTS "expenses_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "categorization_rules" DROP CONSTRAINT IF EXISTS "categorization_rules_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "imports" DROP CONSTRAINT IF EXISTS "imports_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "splitwise_sync_state" DROP CONSTRAINT IF EXISTS "splitwise_sync_state_user_id_users_id_fk";
--> statement-breakpoint

-- Step 5: Drop old unique constraint on splitwise_sync_state.user_id
ALTER TABLE "splitwise_sync_state" DROP CONSTRAINT IF EXISTS "splitwise_sync_state_user_id_unique";
--> statement-breakpoint

-- Step 6: Drop old user_id columns
ALTER TABLE "categories" DROP COLUMN IF EXISTS "user_id";
--> statement-breakpoint
ALTER TABLE "expenses" DROP COLUMN IF EXISTS "user_id";
--> statement-breakpoint
ALTER TABLE "categorization_rules" DROP COLUMN IF EXISTS "user_id";
--> statement-breakpoint
ALTER TABLE "imports" DROP COLUMN IF EXISTS "user_id";
--> statement-breakpoint
ALTER TABLE "splitwise_sync_state" DROP COLUMN IF EXISTS "user_id";
--> statement-breakpoint

-- Step 7: Add new foreign key constraints
ALTER TABLE "categories" ADD CONSTRAINT "categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "splitwise_sync_state" ADD CONSTRAINT "splitwise_sync_state_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_active_household_id_households_id_fk" FOREIGN KEY ("active_household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Step 8: Add unique constraint on splitwise_sync_state.household_id
ALTER TABLE "splitwise_sync_state" ADD CONSTRAINT "splitwise_sync_state_household_id_unique" UNIQUE("household_id");
--> statement-breakpoint

-- Step 9: Create household_members table
CREATE TABLE "household_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "household_members_household_user" UNIQUE("household_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint

-- Step 10: Insert household_member for existing user
DO $$
DECLARE
	existing_user_id uuid;
	existing_household_id uuid;
BEGIN
	SELECT id INTO existing_user_id FROM users LIMIT 1;
	IF existing_user_id IS NOT NULL THEN
		SELECT active_household_id INTO existing_household_id FROM users WHERE id = existing_user_id;
		IF existing_household_id IS NOT NULL THEN
			INSERT INTO household_members (household_id, user_id) VALUES (existing_household_id, existing_user_id);
		END IF;
	END IF;
END $$;
--> statement-breakpoint

-- Step 11: Create household_invites table
CREATE TABLE "household_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "household_invites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "household_invites" ADD CONSTRAINT "household_invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
