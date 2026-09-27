CREATE TYPE "public"."ai_call_kind" AS ENUM('CHAT_TURN', 'DECISION_REPLY', 'FOLLOW_UP', 'ADMIN_SUMMARY');--> statement-breakpoint
CREATE TYPE "public"."ai_call_outcome" AS ENUM('OK', 'INVALID', 'TIMEOUT', 'ERROR', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."conversation_mode" AS ENUM('AI', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."conversation_state" AS ENUM('ACTIVE', 'SUBMITTED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('CUSTOMER', 'ASSISTANT');--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid,
	"request_id" uuid,
	"kind" "ai_call_kind" NOT NULL,
	"provider" text,
	"model" text,
	"outcome" "ai_call_outcome" NOT NULL,
	"attempts" integer NOT NULL,
	"latency_ms" integer NOT NULL,
	"validated_output" jsonb,
	"failure_reason" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"typed" boolean DEFAULT false NOT NULL,
	"client_message_id" uuid,
	"structured" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_messages_client_message_unique" UNIQUE("conversation_id","client_message_id"),
	CONSTRAINT "conversation_messages_content_length" CHECK (char_length("conversation_messages"."content") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"state" "conversation_state" DEFAULT 'ACTIVE' NOT NULL,
	"mode" "conversation_mode" NOT NULL,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"failed_turns" integer DEFAULT 0 NOT NULL,
	"latest_proposal" jsonb,
	"discussed_item_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"flags" jsonb DEFAULT '{"injectionAttempt":false,"mentionsOtherCustomerOrder":false,"abusive":false,"offTopic":false}'::jsonb NOT NULL,
	"pending_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_counts_non_negative" CHECK ("conversations"."turn_count" >= 0 AND "conversations"."failed_turns" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_request_id_refund_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."refund_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_calls_conversation_idx" ON "ai_calls" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "ai_calls_request_idx" ON "ai_calls" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "conversation_messages_conversation_created_idx" ON "conversation_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conversations_customer_created_idx" ON "conversations" USING btree ("customer_id","created_at");