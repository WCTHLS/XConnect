ALTER TABLE "devices" ADD COLUMN "connected" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "current_room_id" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "confidence" real;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "wifi_similarity" real;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "ultrasonic_verified" boolean;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "motion_anomaly_flag" boolean;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "status_updated_at" timestamp with time zone;