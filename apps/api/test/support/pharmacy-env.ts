// Import this FIRST in pharmacy tests: ES imports are hoisted above statements, so env defaults
// must be set by a module that is evaluated before the modules under test.
process.env.SESSION_SECRET ??= "test-secret-test-secret-test-secret-123456";
process.env.INFERENCE_GATEWAY_TOKEN ??= "test-internal-token-test-internal-token";
export {};
