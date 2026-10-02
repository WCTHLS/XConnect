CREATE INDEX "room_membership_room_id_idx" ON "room_membership" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "room_membership_user_id_idx" ON "room_membership" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_invites_email_idx" ON "session_invites" USING btree ("email");--> statement-breakpoint
CREATE INDEX "state_change_events_room_id_idx" ON "state_change_events" USING btree ("room_id");