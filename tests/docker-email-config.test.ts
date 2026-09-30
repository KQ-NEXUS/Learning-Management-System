import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

const baseEnv = {
  POSTGRES_PASSWORD: "test-password",
  MINIO_ROOT_USER: "test-user",
  MINIO_ROOT_PASSWORD: "test-password",
  AUTH_SECRET: "test-auth-secret",
};

function composeEnvironment(overrides: Record<string, string>) {
  const output = execFileSync("docker", ["compose", "--env-file", ".env.example", "config", "--format", "json"], {
    encoding: "utf8",
    env: { ...process.env, ...baseEnv, ...overrides },
  });
  return JSON.parse(output).services.app.environment as Record<string, string | undefined>;
}

it("forwards transactional email configuration into the app container", { timeout: 60_000 }, () => {
  const email = {
    BREVO_API_KEY: "test-key",
    EMAIL_SENDER_NAME: "Test LMS",
    EMAIL_SENDER_ADDRESS: "sender@example.test",
    SUPPORT_CONTACT_EMAIL: "help@example.test",
    EMAIL_TRANSPORT: "stub",
    APP_BASE_URL: "https://lms.example.test",
  };
  const environment = composeEnvironment(email);
  for (const [key, value] of Object.entries(email)) {
    expect(environment[key], key).toBe(value);
  }
});

it("never injects a default sender identity (COM-04, D-14) but keeps the local base URL default", { timeout: 60_000 }, () => {
  const environment = composeEnvironment({ EMAIL_SENDER_NAME: "", EMAIL_SENDER_ADDRESS: "", APP_BASE_URL: "" });
  // Empty or absent, never the previous made-up defaults, so the app refuses to send.
  expect(environment.EMAIL_SENDER_NAME ?? "").toBe("");
  expect(environment.EMAIL_SENDER_ADDRESS ?? "").toBe("");
  expect(environment.EMAIL_SENDER_NAME).not.toBe("Professional Training LMS");
  expect(environment.EMAIL_SENDER_ADDRESS).not.toBe("no-reply@example.com");
  expect(environment.APP_BASE_URL).toBe("http://localhost:3000");
});
