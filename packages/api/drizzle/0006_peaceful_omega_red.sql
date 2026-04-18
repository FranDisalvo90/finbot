CREATE TABLE "splitwise_sync_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"last_sync_at" timestamp,
	"last_updated_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "splitwise_sync_state_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "splitwise_access_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "splitwise_user_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "splitwise_group_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "splitwise_group_name" text;--> statement-breakpoint
ALTER TABLE "splitwise_sync_state" ADD CONSTRAINT "splitwise_sync_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;