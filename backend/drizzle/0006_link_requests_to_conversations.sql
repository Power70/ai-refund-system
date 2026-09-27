ALTER TABLE "refund_requests" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD COLUMN "claim_context" jsonb;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "handover_reason" text;--> statement-breakpoint
-- Backfill conversations created before this column existed.
UPDATE "conversations" SET "handover_reason" = CASE
  WHEN "failed_turns" > 0 THEN 'AI_FAILED'
  WHEN "turn_count" >= 6 THEN 'TURN_LIMIT'
  ELSE 'AI_DISABLED'
END WHERE "mode" = 'MANUAL';--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_conversation_id_unique" UNIQUE("conversation_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_handover_reason" CHECK ("conversations"."handover_reason" IS NULL OR "conversations"."handover_reason" IN ('AI_DISABLED', 'AI_FAILED', 'TURN_LIMIT'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_manual_has_reason" CHECK (("conversations"."mode" = 'MANUAL') = ("conversations"."handover_reason" IS NOT NULL));