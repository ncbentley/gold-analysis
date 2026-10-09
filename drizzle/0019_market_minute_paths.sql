CREATE TABLE "market_minute_paths" (
	"instrument" text NOT NULL,
	"minute" timestamp with time zone NOT NULL,
	"offsets" integer[] NOT NULL,
	"prices" double precision[] NOT NULL,
	CONSTRAINT "market_minute_paths_instrument_minute_pk" PRIMARY KEY("instrument","minute")
);
