ALTER TABLE "session_invites" ADD COLUMN "invite_role" text DEFAULT 'attendee' NOT NULL;--> statement-breakpoint
ALTER TABLE "session_invites" ADD COLUMN "room_code" text;