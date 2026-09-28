CREATE TABLE "session_invites" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_code" text NOT NULL,
	"email" text NOT NULL,
	"user_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" text,
	"title" text,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "session_invites_session_email" UNIQUE("session_code","email")
);
--> statement-breakpoint
ALTER TABLE "session_invites" ADD CONSTRAINT "session_invites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_invites" ADD CONSTRAINT "session_invites_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;