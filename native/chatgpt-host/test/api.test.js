import test from "node:test";
import assert from "node:assert/strict";
import { createHostApplication } from "../src/host.js";
import { listModels, draft } from "../src/responses.js";

const fakeProfile = (overrides = {}) => ({ profileId: "profile_1", subject: "fake-subject", clientId: "issued-client", hostId: "urn:uuid:host", scopes: ["openid", "chatgpt.tokens.use.direct"], accessToken: "fake-access-token", refreshToken: "fake-refresh-token", idToken: "fake-id-token", expiresAt: Date.now() + 3600_000, earliestRefreshAt: 0, ...overrides });
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
function sse(events) {
  return new Response(new ReadableStream({ start(controller) { for (const event of events) controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)); controller.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
}

function fetchModelsThen(streamOrError) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/models")) return jsonResponse({ models: [
      { slug: "visible-model", display_name: "Visible", visibility: "list" },
      { slug: "hidden-model", display_name: "Hidden", visibility: "private" },
      { display_name: "Missing slug", visibility: "list" },
    ] });
    return typeof streamOrError === "function" ? streamOrError(init) : streamOrError;
  };
  return { fetchImpl, calls };
}

test("model list validates provider shape and includes only account-visible well-typed models", async () => {
  const { fetchImpl, calls } = fetchModelsThen(sse([]));
  const models = await listModels({ profile: fakeProfile(), fetchImpl });
  assert.deepEqual(models, [{ slug: "visible-model", displayName: "Visible" }]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/models");
  assert.equal(calls[0].init.headers.Authorization, "Bearer fake-access-token");
});

test("draft is text-only, validates model against account catalog, and succeeds only on response.completed", async () => {
  const events = [{ type: "response.output_text.delta", delta: "Draft text" }, { type: "response.completed", response: {} }];
  const { fetchImpl, calls } = fetchModelsThen(sse(events));
  const result = await draft({ profile: fakeProfile(), model: "visible-model", text: "Sanitized report text", fetchImpl });
  assert.deepEqual(result, { text: "Draft text", completed: true });
  const body = JSON.parse(calls[1].init.body);
  assert.equal(calls[1].url, "https://api.openai.com/v1/responses");
  assert.equal(calls[1].init.headers.Authorization, "Bearer fake-access-token");
  assert.equal(body.store, false); assert.equal(body.stream, true); assert.equal(body.model, "visible-model");
  assert.equal(body.input[0].content[0].type, "input_text"); assert.equal(body.input[0].content[0].text, "Sanitized report text");
  assert.equal(body.input.some((item) => item.role === "system"), false);
  for (const key of ["background", "max_output_tokens", "temperature", "tools", "previous_response_id"]) assert.equal(Object.hasOwn(body, key), false);
});

test("partial EOF, response.failed usage limit, incomplete response and invalid selected model never succeed", async () => {
  const partial = fetchModelsThen(sse([{ type: "response.output_text.delta", delta: "partial" }]));
  await assert.rejects(draft({ profile: fakeProfile(), model: "visible-model", text: "x", fetchImpl: partial.fetchImpl }), /stream_ended_without_completion/);
  const failed = fetchModelsThen(sse([{ type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } }]));
  await assert.rejects(draft({ profile: fakeProfile(), model: "visible-model", text: "x", fetchImpl: failed.fetchImpl }), /subscription_sharing_usage_limit_exceeded/);
  const incomplete = fetchModelsThen(sse([{ type: "response.incomplete" }]));
  await assert.rejects(draft({ profile: fakeProfile(), model: "visible-model", text: "x", fetchImpl: incomplete.fetchImpl }), /response_incomplete/);
  const unknown = fetchModelsThen(sse([{ type: "response.completed" }]));
  await assert.rejects(draft({ profile: fakeProfile(), model: "not-returned", text: "x", fetchImpl: unknown.fetchImpl }), /model_not_available/);
  assert.equal(unknown.calls.length, 1, "no inference call for an unlisted model");
});

test("absent plan scope fails before provider calls", async () => {
  let calls = 0;
  await assert.rejects(listModels({ profile: fakeProfile({ scopes: ["openid"] }), fetchImpl: async () => { calls++; } }), /plan_scope_not_granted/);
  assert.equal(calls, 0);
});

test("HTTP usage limit maps to explicit stop code without body leakage", async () => {
  const { fetchImpl } = fetchModelsThen(async () => jsonResponse({ error: { code: "subscription_sharing_usage_limit_exceeded", message: "secret-like text" } }, 429));
  await assert.rejects(draft({ profile: fakeProfile(), model: "visible-model", text: "x", fetchImpl }), (error) => error.code === "subscription_sharing_usage_limit_exceeded" && !error.message.includes("secret-like text"));
});

test("native host cancellation aborts an in-flight draft and keeps request correlation", async () => {
  const profile = fakeProfile();
  const store = { async list() { return [{ id: profile.profileId, email: null, subject: profile.subject, clientId: profile.clientId, planEnabled: true }]; }, async get() { return profile; }, async initialize() { return "urn:uuid:host"; }, async removeTokens() { return true; } };
  const app = createHostApplication({ store, draftImpl: ({ signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new Error("request_cancelled")), { once: true })) });
  const draftPromise = app({ id: "draft-1", method: "draft", params: { profileId: profile.profileId, model: "visible-model", text: "safe text" } });
  await new Promise((resolve) => setImmediate(resolve));
  const cancelled = await app({ id: "cancel-1", method: "cancel", params: { requestId: "draft-1" } });
  assert.deepEqual(cancelled, { id: "cancel-1", result: { requestId: "draft-1", cancelled: true } });
  const draftResult = await draftPromise;
  assert.equal(draftResult.id, "draft-1"); assert.equal(draftResult.error.code, "request_cancelled");
});
