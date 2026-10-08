CREATE TABLE "market_ticks" (
	"instrument" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"seq" integer NOT NULL,
	"price" double precision NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_ticks_instrument_received_at_seq_pk" PRIMARY KEY("instrument","received_at","seq")
);
--> statement-breakpoint
CREATE INDEX "market_ticks_instrument_at_idx" ON "market_ticks" USING btree ("instrument","at");
