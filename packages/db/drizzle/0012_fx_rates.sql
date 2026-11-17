CREATE TABLE "fx_rates" (
	"date" text NOT NULL,
	"currency" text NOT NULL,
	"rate" text NOT NULL,
	"source" text DEFAULT 'ECB' NOT NULL,
	CONSTRAINT "fx_rates_currency_date_pk" PRIMARY KEY("currency","date")
);
