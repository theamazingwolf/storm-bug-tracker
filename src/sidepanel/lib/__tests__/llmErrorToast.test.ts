import { describe, it, expect, vi, beforeEach } from "vitest";
import { toast } from "sonner";
import { toastLlmError } from "../llmErrorToast";
import { NativeChatGptError } from "../nativeChatGptProtocol";
import {
  AiContextOverflowError,
  LlmAuthError,
  LlmEmptyResponseError,
  LlmOverloadedError,
  LlmQuotaError,
  LlmRedirectError,
  LlmPermissionError,
  LlmModelUnavailableError,
  LlmUnsupportedRequestError,
  LlmNetworkError,
  LlmRequestError,
  LlmResponseTooLargeError,
} from "../ai-provider";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), info: vi.fn() }),
}));

const t = ((key: string) => key) as never;

beforeEach(() => {
  vi.mocked(toast.error).mockClear();
});

describe("toastLlmError", () => {
  it("컨텍스트 초과 → 해법 힌트를 description으로, 읽을 시간을 주는 duration", () => {
    toastLlmError(new AiContextOverflowError(), t, "draft.aiError");
    expect(toast.error).toHaveBeenCalledWith("llm.error.contextOverflow", {
      description: "llm.error.contextOverflow.hint",
      duration: 8000,
    });
  });

  it("허용량 초과 → 전용 문구", () => {
    toastLlmError(new LlmQuotaError(), t, "draft.aiError");
    expect(toast.error).toHaveBeenCalledWith("llm.error.quota");
  });

  it("오버로드 → 전용 문구", () => {
    toastLlmError(new LlmOverloadedError(), t, "draft.aiError");
    expect(toast.error).toHaveBeenCalledWith("llm.error.overloaded");
  });

  it("인증 실패 → 전용 문구", () => {
    toastLlmError(new LlmAuthError(), t, "draft.aiError");
    expect(toast.error).toHaveBeenCalledWith("llm.error.auth");
  });

  it("빈/파싱실패 응답 → 재시도 유도 공통 문구", () => {
    toastLlmError(new LlmEmptyResponseError(), t, "draft.aiError");
    expect(toast.error).toHaveBeenCalledWith("llm.error.empty");
  });

  // 리다이렉트 차단은 fallback("요청 실패")으로 뭉개면 사용자가 Base URL 오타를
  // 네트워크 장애로 오독한다. 전용 문구로 원인을 지목한다.
  it("리다이렉트 차단 → 전용 문구", () => {
    toastLlmError(new LlmRedirectError(), t, "draft.aiError");
    expect(toast.error).toHaveBeenCalledWith("llm.error.redirect");
  });

  it.each([
    [new LlmPermissionError(), "llm.error.permissionDenied"],
    [new LlmModelUnavailableError(), "llm.error.modelUnavailable"],
    [new LlmUnsupportedRequestError(), "llm.error.unsupportedRequest"],
    [new LlmNetworkError(), "llm.error.network"],
    [new LlmRequestError(), "llm.error.request"],
    [new LlmResponseTooLargeError(), "llm.error.responseTooLarge"],
  ])("실패 유형에 맞는 안전한 안내: %s", (error, key) => {
    toastLlmError(error, t, "draft.aiError");
    expect(toast.error).toHaveBeenCalledWith(key);
  });

  it.each([
    ["usage_limit", "llm.error.nativeQuota"],
    ["busy", "llm.error.nativeBusy"],
    ["provider_timeout", "llm.error.nativeBusy"],
    ["request_too_large", "llm.error.nativeContextOverflow"],
    ["sign_in_required", "llm.error.nativeAuth"],
    ["plan_scope_required", "llm.error.nativePlan"],
    ["model_not_visible", "llm.error.nativeModel"],
    ["unsupported_images", "llm.error.nativeUnsupported"],
    ["unknown_future_code", "llm.error.nativeHelper"],
  ])("native helper code %s maps to a safe localized class", (code, key) => {
    toastLlmError(new NativeChatGptError(code), t, "draft.aiError");
    expect(toast.error).toHaveBeenCalledWith(key);
  });

  it("그 외 에러 → 호출부가 준 fallback 키", () => {
    toastLlmError(new Error("boom"), t, "aiStyling.error");
    expect(toast.error).toHaveBeenCalledWith("aiStyling.error");
  });

  it("Error가 아닌 값도 fallback으로 처리 (throw 안 함)", () => {
    expect(() => toastLlmError("문자열", t, "draft.aiError")).not.toThrow();
    expect(toast.error).toHaveBeenCalledWith("draft.aiError");
  });
});
