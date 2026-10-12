CREATE TABLE "document_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" text,
	"actor_role" text,
	"via" text DEFAULT 'system' NOT NULL,
	"action" text NOT NULL,
	"resource" text DEFAULT 'document' NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "document_activity_created_at_idx" ON "document_activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "document_activity_resource_idx" ON "document_activity" USING btree ("resource","resource_id");--> statement-breakpoint
CREATE INDEX "document_activity_actor_id_idx" ON "document_activity" USING btree ("actor_id");