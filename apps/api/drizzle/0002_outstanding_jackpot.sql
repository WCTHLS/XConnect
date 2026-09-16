CREATE TABLE "state_change_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"room_id" text,
	"device_id" text NOT NULL,
	"field" text NOT NULL,
	"value" boolean NOT NULL,
	"changed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "state_change_events" ADD CONSTRAINT "state_change_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "state_change_events" ADD CONSTRAINT "state_change_events_device_id_devices_device_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("device_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "connected";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "current_room_id";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "confidence";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "wifi_similarity";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "ultrasonic_verified";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "motion_anomaly_flag";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "status_updated_at";