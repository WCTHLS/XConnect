ALTER TABLE "room_membership" DROP CONSTRAINT "room_membership_session_id_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "state_change_events" DROP CONSTRAINT "state_change_events_session_id_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "rooms" DROP CONSTRAINT "rooms_session_id_id_pk";--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
-- Data migration: a room used to be identified by (session_id, id). Each existing row becomes its
-- own occurrence: the old name moves to `code`, and the new unique id is `<old id>__<session id>`.
UPDATE "room_membership" m SET "room_id" = m."room_id" || '__' || m."session_id"
  WHERE EXISTS (SELECT 1 FROM "rooms" r WHERE r."id" = m."room_id" AND r."session_id" = m."session_id");--> statement-breakpoint
UPDATE "state_change_events" e SET "room_id" = e."room_id" || '__' || e."session_id"
  WHERE EXISTS (SELECT 1 FROM "rooms" r WHERE r."id" = e."room_id" AND r."session_id" = e."session_id");--> statement-breakpoint
UPDATE "rooms" r SET "code" = r."id", "id" = r."id" || '__' || r."session_id", "started_at" = r."created_at",
  "ended_at" = (SELECT s."ended_at" FROM "sessions" s WHERE s."id" = r."session_id");--> statement-breakpoint
DELETE FROM "room_membership" m WHERE NOT EXISTS (SELECT 1 FROM "rooms" r WHERE r."id" = m."room_id");--> statement-breakpoint
DELETE FROM "state_change_events" e WHERE e."room_id" IS NULL OR NOT EXISTS (SELECT 1 FROM "rooms" r WHERE r."id" = e."room_id");--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "rooms" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "state_change_events" ALTER COLUMN "room_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "room_membership" ADD CONSTRAINT "room_membership_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_change_events" ADD CONSTRAINT "state_change_events_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_membership" DROP COLUMN "session_id";--> statement-breakpoint
ALTER TABLE "state_change_events" DROP COLUMN "session_id";
