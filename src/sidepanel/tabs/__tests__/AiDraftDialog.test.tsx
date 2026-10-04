import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
  t: (key: string) => key,
}));
vi.mock("@/sidepanel/lib/llmErrorToast", () => ({ toastLlmError: vi.fn() }));
vi.mock("@/sidepanel/lib/prompts/promptBudget", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/sidepanel/lib/prompts/promptBudget")>()),
  isPromptOverBudget: vi.fn(async () => false),
}));
vi.mock("@/sidepanel/lib/resolveInlineImages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/sidepanel/lib/resolveInlineImages")>()),
  resolveInlineImagesForSections: vi.fn(async () => []),
}));

import { AiDraftDialog } from "../AiDraftDialog";
import { useEditorStore } from "@/store/editor-store";
import { toastLlmError } from "@/sidepanel/lib/llmErrorToast";
import { NANO_CAPABILITIES, BYOK_CAPABILITIES, type AISession } from "@/sidepanel/lib/ai-provider";
import { makeSession, deferred } from "@/test/ai-session";
import { isPromptOverBudget } from "@/sidepanel/lib/prompts/promptBudget";
import { resolveInlineImagesForSections } from "@/sidepanel/lib/resolveInlineImages";

// 취소하지 않으면 실제로 적용되는 응답 — 아래 대조군이 이를 실증한다.
const VALID_RESPONSE = JSON.stringify({
  title: "AI title",
  sections: { description: "AI description" },
});

beforeEach(() => {
  vi.clearAllMocks();
  useEditorStore.setState({
    captureMode: "screenshot",
    draft: { title: "", sections: {}, environment: [] },
    aiCancel: null,
    aiDraftLoading: false,
  });
});

async function submit(text: string) {
  const user = userEvent.setup();
  const box = screen.getByRole("textbox");
  await user.clear(box);
  await user.type(box, text);
  await user.keyboard("{Enter}");
}

function renderDialog(createSession: () => Promise<AISession>) {
  return render(
    <AiDraftDialog
      open
      onOpenChange={vi.fn()}
      createSession={createSession}
      capabilities={NANO_CAPABILITIES}
    />,
  );
}

describe("AiDraftDialog 취소 레인", () => {
  // 대조군 — 이게 없으면 아래 "적용 안 됨" 단언이 공허해진다(POSTMORTEM 2026-07-28).
  it("캡처 컨텍스트만으로 생성할 수 있어 지시는 선택 사항이다", async () => {
    const { session, calls, pending } = makeSession();
    renderDialog(vi.fn(async () => session));

    const submitButton = screen.getByTestId("ai-draft-submit");
    expect((submitButton as HTMLButtonElement).disabled).toBe(false);
    await userEvent.setup().click(submitButton);
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].input).toBe("");
    pending[0].resolve(VALID_RESPONSE);
    await waitFor(() => expect(useEditorStore.getState().draft?.title).toBe("AI title"));
  });

  it("취소하지 않으면 응답이 draft에 적용된다", async () => {
    const { session, calls, pending } = makeSession();
    renderDialog(vi.fn(async () => session));

    await submit("write it");
    await waitFor(() => expect(calls.length).toBe(1));
    pending[0].resolve(VALID_RESPONSE);

    await waitFor(() =>
      expect(useEditorStore.getState().draft?.title).toBe("AI title"),
    );
  });

  it("실패하면 기존 제목·본문·캡처 evidence를 보존하고 오류 안내를 낸다", async () => {
    const { session } = makeSession();
    useEditorStore.setState({
      draft: { title: "kept title", sections: { description: "kept body" }, environment: [] },
      screenshotRaw: "data:image/png;base64,capture",
    });
    const runSession = { ...session, prompt: vi.fn(() => Promise.reject(new Error("safe failure"))) } as unknown as AISession;
    renderDialog(vi.fn(async () => runSession));

    await submit("add detail");
    await waitFor(() => expect(toastLlmError).toHaveBeenCalled());
    expect(useEditorStore.getState().draft).toEqual({
      title: "kept title", sections: { description: "kept body" }, environment: [],
    });
    expect(useEditorStore.getState().screenshotRaw).toBe("data:image/png;base64,capture");
  });

  it("중단하면 prompt signal을 abort하고 기존 draft·evidence를 보존하며 오류 토스트를 내지 않는다", async () => {
    const { session, calls, pending } = makeSession();
    useEditorStore.setState({
      draft: { title: "kept title", sections: { description: "kept body" }, environment: [] },
      screenshotRaw: "data:image/png;base64,capture",
    });
    renderDialog(vi.fn(async () => session));

    await submit("write it");
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0].signal).toBeDefined();
    expect(calls[0].signal!.aborted).toBe(false);

    useEditorStore.getState().aiCancel!();
    expect(calls[0].signal!.aborted).toBe(true);

    pending[0].resolve(VALID_RESPONSE);
    await waitFor(() =>
      expect(useEditorStore.getState().aiDraftLoading).toBe(false),
    );
    expect(useEditorStore.getState().draft).toEqual({
      title: "kept title", sections: { description: "kept body" }, environment: [],
    });
    expect(useEditorStore.getState().screenshotRaw).toBe("data:image/png;base64,capture");
    expect(toastLlmError).not.toHaveBeenCalled();
  });

  // cleanup deps가 [createSession]이라 provider 교체에서도 도는 경로 — 언마운트만
  // 덮으면 이 자리에서 오버레이·중단 슬롯이 남는 회귀를 못 잡는다.
  it("provider가 교체되면 진행 중 요청이 abort되고 로딩·슬롯이 즉시 정리된다", async () => {
    const { session, calls } = makeSession();
    const other = makeSession();
    const view = render(
      <AiDraftDialog
        open
        onOpenChange={vi.fn()}
        createSession={vi.fn(async () => session)}
        capabilities={NANO_CAPABILITIES}
      />,
    );

    await submit("write it");
    await waitFor(() => expect(calls.length).toBe(1));
    expect(useEditorStore.getState().aiDraftLoading).toBe(true);

    // createSession identity만 바뀐다 = AI provider 설정 변경.
    view.rerender(
      <AiDraftDialog
        open
        onOpenChange={vi.fn()}
        createSession={vi.fn(async () => other.session)}
        capabilities={NANO_CAPABILITIES}
      />,
    );

    expect(calls[0].signal!.aborted).toBe(true);
    expect(useEditorStore.getState().aiDraftLoading).toBe(false);
    expect(useEditorStore.getState().aiCancel).toBeNull();
  });

  it("중단하면 세션이 destroy되고 다음 실행이 새 세션을 만든다", async () => {
    const first = makeSession();
    const second = makeSession();
    const createSession = vi
      .fn<() => Promise<AISession>>()
      .mockResolvedValueOnce(first.session)
      .mockResolvedValueOnce(second.session);

    renderDialog(createSession);
    await submit("write it");
    await waitFor(() => expect(first.calls.length).toBe(1));

    useEditorStore.getState().aiCancel!();
    expect(first.destroy).toHaveBeenCalled();
    first.pending[0].resolve(VALID_RESPONSE);
    await waitFor(() =>
      expect(useEditorStore.getState().aiDraftLoading).toBe(false),
    );

    await submit("again");
    await waitFor(() => expect(second.calls.length).toBe(1));
    expect(second.calls[0].signal!.aborted).toBe(false);
  });

  // sessionRef는 run보다 오래 산다 — await 재개 지점에서 ref를 다시 읽으면 옛 run이
  // 새 run의 세션을 붙잡는다. 중단 후 재제출이 그 공존을 실제로 만든다(Chrome 내장 AI는
  // abort를 무시해 옛 run이 살아서 재개한다).
  it("예산 확인 await 중 중단·재제출되면 옛 run이 새 run의 세션에 prompt하지 않는다", async () => {
    const first = makeSession();
    const second = makeSession();
    const createSession = vi
      .fn<() => Promise<AISession>>()
      .mockResolvedValueOnce(first.session)
      .mockResolvedValueOnce(second.session);

    // 첫 예산 확인만 붙잡아 둔다 — 그 사이 run A가 중단되고 run B가 시작된다.
    const gate = deferred<boolean>();
    vi.mocked(isPromptOverBudget)
      .mockReturnValueOnce(gate.promise)
      .mockResolvedValue(false);

    renderDialog(createSession);
    await submit("turn A");
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));

    useEditorStore.getState().aiCancel!();
    await submit("turn B");
    await waitFor(() => expect(second.calls.length).toBe(1));
    expect(second.calls[0].input).toBe("turn B");

    // B를 정상 종료시켜 두면 sessionRef에는 B의 세션이 남는다.
    second.pending[0].resolve(VALID_RESPONSE);
    await waitFor(() =>
      expect(useEditorStore.getState().aiDraftLoading).toBe(false),
    );

    // 이제 A가 재개한다 — 가드가 없으면 B의 세션에 "turn A"를 실어보낸다.
    await act(async () => {
      gate.resolve(false);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(second.calls).toHaveLength(1);
    // run-local 세션만 되돌려도 red가 되도록 — A가 자기 세션에 prompt하는 것도 막는다.
    expect(first.calls).toHaveLength(0);
  });

  // A는 세션 생성 **전**(인라인 이미지 resolve)에 멈춘다. 그래서 B가 첫 세션을 만들고,
  // 뒤늦게 재개한 A의 "매 요청마다 세션 재생성" 줄이 B의 살아 있는 세션을 파괴한다.
  it("인라인 이미지 resolve await 중 중단·재제출되면 옛 run이 새 run의 세션을 destroy하지 않는다", async () => {
    const sessionB = makeSession();
    const sessionA = makeSession();
    const createSession = vi
      .fn<() => Promise<AISession>>()
      .mockResolvedValueOnce(sessionB.session)
      .mockResolvedValueOnce(sessionA.session);

    const gate = deferred<never[]>();
    vi.mocked(resolveInlineImagesForSections)
      .mockReturnValueOnce(gate.promise)
      .mockResolvedValue([]);

    render(
      <AiDraftDialog
        open
        onOpenChange={vi.fn()}
        createSession={createSession}
        capabilities={BYOK_CAPABILITIES}
      />,
    );

    await submit("turn A");
    await waitFor(() =>
      expect(resolveInlineImagesForSections).toHaveBeenCalledTimes(1),
    );
    expect(createSession).not.toHaveBeenCalled(); // A는 세션 생성 전에 멈춰 있다

    useEditorStore.getState().aiCancel!();
    await submit("turn B");
    await waitFor(() => expect(sessionB.calls.length).toBe(1));

    await act(async () => {
      gate.resolve([]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(sessionB.destroy).not.toHaveBeenCalled();
  });

  it("언마운트하면 진행 중 요청이 abort되고 로딩이 걷힌다", async () => {
    const { session, calls } = makeSession();
    const view = renderDialog(vi.fn(async () => session));

    await submit("write it");
    await waitFor(() => expect(calls.length).toBe(1));
    expect(useEditorStore.getState().aiDraftLoading).toBe(true);

    view.unmount();

    expect(calls[0].signal!.aborted).toBe(true);
    expect(useEditorStore.getState().aiDraftLoading).toBe(false);
    expect(useEditorStore.getState().aiCancel).toBeNull();
  });
});
