// Test environment: point the app pools at the integration database.
process.env.DATABASE_URL ??= "postgres://pti_app:pti_app@localhost:5432/pti_test";
process.env.SYSTEM_DATABASE_URL ??= "postgres://pti_system:pti_system@localhost:5432/pti_test";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-test-secret";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.EMAIL_PROVIDER ??= "log";
process.env.LOG_LEVEL ??= "error";
