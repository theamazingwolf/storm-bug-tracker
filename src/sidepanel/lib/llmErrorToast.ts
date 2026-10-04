import { toast } from "sonner";
import { NativeChatGptError } from "./nativeChatGptProtocol";
import type { TranslationFn } from "@/i18n";
import type { TranslationKey } from "@/i18n/ko";
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
} from "./ai-provider";

// 컨텍스트 초과는 원인·해법이 한 줄에 안 담겨 description까지 읽힐 시간이 필요하다.
const CONTEXT_OVERFLOW_TOAST_MS = 8000;

export function toastLlmError(
  err: unknown,
  t: TranslationFn,
  fallbackKey: TranslationKey,
): void {
  if (err instanceof AiContextOverflowError) {
    toast.error(t("llm.error.contextOverflow"), {
      description: t("llm.error.contextOverflow.hint"),
      duration: CONTEXT_OVERFLOW_TOAST_MS,
    });
  } else if (err instanceof LlmAuthError) {
    toast.error(t("llm.error.auth"));
  } else if (err instanceof LlmEmptyResponseError) {
    toast.error(t("llm.error.empty"));
  } else if (err instanceof LlmQuotaError) {
    toast.error(t("llm.error.quota"));
  } else if (err instanceof LlmOverloadedError) {
    toast.error(t("llm.error.overloaded"));
  } else if (err instanceof LlmRedirectError) {
    toast.error(t("llm.error.redirect"));
  } else if (err instanceof LlmPermissionError) {
    toast.error(t("llm.error.permissionDenied"));
  } else if (err instanceof LlmModelUnavailableError) {
    toast.error(t("llm.error.modelUnavailable"));
  } else if (err instanceof LlmUnsupportedRequestError) {
    toast.error(t("llm.error.unsupportedRequest"));
  } else if (err instanceof LlmNetworkError) {
    toast.error(t("llm.error.network"));
  } else if (err instanceof LlmRequestError) {
    toast.error(t("llm.error.request"));
  } else if (err instanceof LlmResponseTooLargeError) {
    toast.error(t("llm.error.responseTooLarge"));
  } else if (err instanceof NativeChatGptError) {
    const code = err.code.toLowerCase();
    const key = /usage_limit|quota|rate_limit/.test(code)
      ? "llm.error.nativeQuota"
      : /busy|timeout/.test(code)
        ? "llm.error.nativeBusy"
        : /context_too_large|request_too_large/.test(code)
          ? "llm.error.nativeContextOverflow"
          : /auth|sign_in|profile.*not_signed_in/.test(code)
            ? "llm.error.nativeAuth"
            : /plan_scope|scope|permission/.test(code)
              ? "llm.error.nativePlan"
              : /model/.test(code)
                ? "llm.error.nativeModel"
                : /unsupported.*image|image.*unsupported/.test(code)
                  ? "llm.error.nativeUnsupported"
                  : "llm.error.nativeHelper";
    toast.error(t(key));
  } else {
    toast.error(t(fallbackKey));
  }
}
