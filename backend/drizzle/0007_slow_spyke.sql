CREATE TABLE "push_installations" (
	"installation_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email" text,
	"platform" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_installations" ADD CONSTRAINT "push_installations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;