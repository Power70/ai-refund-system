CREATE TYPE "public"."audit_actor" AS ENUM('SYSTEM', 'AI', 'ADMIN', 'CUSTOMER');--> statement-breakpoint
CREATE TYPE "public"."decision_status" AS ENUM('APPROVED', 'DENIED', 'ESCALATED');--> statement-breakpoint
CREATE TYPE "public"."line_status" AS ENUM('REFUNDED', 'NOT_REFUNDED', 'UNDER_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."message_source" AS ENUM('AI', 'TEMPLATE');--> statement-breakpoint
CREATE TYPE "public"."policy_outcome" AS ENUM('ALLOW', 'DENY', 'REVIEW');--> statement-breakpoint
CREATE TYPE "public"."refund_reason" AS ENUM('DAMAGED', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'CHANGED_MIND', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."request_source" AS ENUM('CUSTOMER', 'SEED');--> statement-breakpoint
CREATE TYPE "public"."request_state" AS ENUM('PROCESSING', 'DECIDED');--> statement-breakpoint
CREATE TYPE "public"."resolution_outcome" AS ENUM('APPROVED', 'PARTIALLY_APPROVED', 'DENIED');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid,
	"type" text NOT NULL,
	"actor" "audit_actor" NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"correlation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"status" "decision_status" NOT NULL,
	"approved_amount_minor" integer DEFAULT 0 NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"rule_trace" jsonb NOT NULL,
	"gate_result" jsonb,
	"escalation_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"customer_message" text NOT NULL,
	"message_source" "message_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decisions_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "decisions_amount_non_negative" CHECK ("decisions"."approved_amount_minor" >= 0),
	CONSTRAINT "decisions_amount_only_when_approved" CHECK ("decisions"."status" = 'APPROVED' OR "decisions"."approved_amount_minor" = 0),
	CONSTRAINT "decisions_escalation_has_reasons" CHECK ("decisions"."status" <> 'ESCALATED' OR cardinality("decisions"."escalation_reasons") > 0)
);
--> statement-breakpoint
CREATE TABLE "refund_request_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"order_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"amount_minor" integer NOT NULL,
	"line_outcome" "policy_outcome",
	"deciding_rule_id" text,
	"final_line_status" "line_status",
	CONSTRAINT "refund_request_lines_request_item_unique" UNIQUE("request_id","order_item_id"),
	CONSTRAINT "refund_request_lines_quantity_positive" CHECK ("refund_request_lines"."quantity" > 0),
	CONSTRAINT "refund_request_lines_amount_non_negative" CHECK ("refund_request_lines"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "refund_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"policy_version_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload_hash" text NOT NULL,
	"reason_confirmed" "refund_reason" NOT NULL,
	"ai_proposal" jsonb,
	"reason_overridden" boolean DEFAULT false NOT NULL,
	"source" "request_source" DEFAULT 'CUSTOMER' NOT NULL,
	"state" "request_state" DEFAULT 'PROCESSING' NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_requests_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "refund_requests_customer_idempotency_unique" UNIQUE("customer_id","idempotency_key"),
	CONSTRAINT "refund_requests_id_order_id_unique" UNIQUE("id","order_id"),
	CONSTRAINT "refund_requests_public_id_format" CHECK ("refund_requests"."public_id" ~ '^rr_[0-9a-hjkmnp-tv-z]{12}$'),
	CONSTRAINT "refund_requests_idempotency_key_length" CHECK (char_length("refund_requests"."idempotency_key") BETWEEN 1 AND 100),
	CONSTRAINT "refund_requests_payload_hash_format" CHECK ("refund_requests"."payload_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "refund_requests_attempts_positive" CHECK ("refund_requests"."attempt_count" >= 1),
	CONSTRAINT "refund_requests_lease_matches_state" CHECK (("refund_requests"."state" = 'PROCESSING') = ("refund_requests"."lease_owner" IS NOT NULL AND "refund_requests"."lease_expires_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "review_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"outcome" "resolution_outcome" NOT NULL,
	"line_decisions" jsonb NOT NULL,
	"approved_amount_minor" integer NOT NULL,
	"reviewer_note" text NOT NULL,
	"customer_message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_resolutions_request_id_unique" UNIQUE("request_id"),
	CONSTRAINT "review_resolutions_amount_non_negative" CHECK ("review_resolutions"."approved_amount_minor" >= 0),
	CONSTRAINT "review_resolutions_denied_has_no_amount" CHECK ("review_resolutions"."outcome" <> 'DENIED' OR "review_resolutions"."approved_amount_minor" = 0),
	CONSTRAINT "review_resolutions_note_required" CHECK (char_length(btrim("review_resolutions"."reviewer_note")) >= 3)
);
--> statement-breakpoint
-- Hand-edited: drizzle-kit emitted these two unique constraints after the foreign keys
-- that reference them, which PostgreSQL rejects. They must exist first.
ALTER TABLE "orders" ADD CONSTRAINT "orders_id_customer_id_unique" UNIQUE("id","customer_id");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_id_order_id_unique" UNIQUE("id","order_id");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_request_id_refund_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."refund_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_request_id_refund_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."refund_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_request_lines" ADD CONSTRAINT "refund_request_lines_request_order_fk" FOREIGN KEY ("request_id","order_id") REFERENCES "public"."refund_requests"("id","order_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_request_lines" ADD CONSTRAINT "refund_request_lines_item_order_fk" FOREIGN KEY ("order_item_id","order_id") REFERENCES "public"."order_items"("id","order_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_policy_version_id_policy_versions_id_fk" FOREIGN KEY ("policy_version_id") REFERENCES "public"."policy_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_order_customer_fk" FOREIGN KEY ("order_id","customer_id") REFERENCES "public"."orders"("id","customer_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_customer_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_resolutions" ADD CONSTRAINT "review_resolutions_request_id_refund_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."refund_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_request_created_idx" ON "audit_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "refund_request_lines_order_item_idx" ON "refund_request_lines" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "refund_requests_customer_created_idx" ON "refund_requests" USING btree ("customer_id","created_at");--> statement-breakpoint
CREATE INDEX "refund_requests_order_id_idx" ON "refund_requests" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refund_requests_processing_lease_idx" ON "refund_requests" USING btree ("lease_expires_at") WHERE "refund_requests"."state" = 'PROCESSING';--> statement-breakpoint
