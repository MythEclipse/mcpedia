CREATE TABLE "sections" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"icon" text DEFAULT '📁' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 1000 NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sections_sort_order_idx" ON "sections" USING btree ("sort_order");