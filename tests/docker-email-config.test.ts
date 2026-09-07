import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("forwards transactional email configuration into the app container", () => {
  const email = { BREVO_API_KEY: "test-key", EMAIL_SENDER_NAME: "Test LMS", EMAIL_SENDER_ADDRESS: "sender@example.test", APP_BASE_URL: "https://lms.example.test" };
  const output = execFileSync("docker", ["compose", "--env-file", ".env.example", "config", "--format", "json"], {
    encoding: "utf8", env: { ...process.env, POSTGRES_PASSWORD: "test-password", MINIO_ROOT_USER: "test-user", MINIO_ROOT_PASSWORD: "test-password", ...email },
  });
  const config = JSON.parse(output);
  for (const [key, value] of Object.entries(email)) {
    expect(config.services.app.environment[key], key).toBe(value);
  }
});

it("preserves the email client's sender defaults when optional values are empty", () => {
  const output = execFileSync("docker", ["compose", "--env-file", ".env.example", "config", "--format", "json"], {
    encoding: "utf8", env: { ...process.env, POSTGRES_PASSWORD: "test-password", MINIO_ROOT_USER: "test-user",
      MINIO_ROOT_PASSWORD: "test-password", EMAIL_SENDER_NAME: "", EMAIL_SENDER_ADDRESS: "", APP_BASE_URL: "" },
  });
  const environment = JSON.parse(output).services.app.environment;
  expect(environment.EMAIL_SENDER_NAME).toBe("Professional Training LMS");
  expect(environment.EMAIL_SENDER_ADDRESS).toBe("no-reply@example.com");
  expect(environment.APP_BASE_URL).toBe("http://localhost:3000");
});
