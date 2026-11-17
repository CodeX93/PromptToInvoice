// Test environment: point the app pools at the integration database.
process.env.DATABASE_URL ??= "postgres://pti_app:pti_app@localhost:5432/pti_test";
process.env.SYSTEM_DATABASE_URL ??= "postgres://pti_system:pti_system@localhost:5432/pti_test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-test-secret";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.EMAIL_PROVIDER ??= "log";
process.env.LOG_LEVEL ??= "error";
process.env.ANTHROPIC_API_KEY ??= "sk-test-not-used";
process.env.STRIPE_SECRET_KEY ??= "sk_test_dummy_not_used_for_network";
process.env.STRIPE_WEBHOOK_SECRET ??= "whsec_test_secret";
process.env.STRIPE_PRICE_PRO_MONTH ??= "price_pro_m";
process.env.STRIPE_PRICE_PRO_YEAR ??= "price_pro_y";
process.env.STRIPE_PRICE_BUSINESS_MONTH ??= "price_bus_m";
process.env.STRIPE_PRICE_SEAT_MONTH ??= "price_seat_m";
