import { defineManifest } from "@crxjs/vite-plugin";
import pkg from "./package.json" with { type: "json" };

export default defineManifest({
  manifest_version: 3,
  name: "__MSG_EXT_NAME__",
  short_name: "__MSG_EXT_NAME_SHORT__",
  description: "__MSG_EXT_DESCRIPTION__",
  version: pkg.version,
  default_locale: "en",
  minimum_chrome_version: "116",
  icons: {
    16: "src/assets/icons/icon-16.png",
    32: "src/assets/icons/icon-32.png",
    48: "src/assets/icons/icon-48.png",
    128: "src/assets/icons/icon-128.png",
  },
  action: {
    default_title: "__MSG_EXT_NAME_SHORT__",
    default_icon: {
      16: "src/assets/icons/icon-16.png",
      32: "src/assets/icons/icon-32.png",
    },
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  content_scripts: [
    {
      // index 0 고정 — picker-control.ts:ensureContentScript가 content_scripts[0].js를 programmatic 주입
      matches: ["<all_urls>"],
      js: ["src/content/picker.ts"],
      run_at: "document_idle",
      // iframe 내부 요소 선택·편집·캡처 — 프레임마다 독립 picker 인스턴스
      all_frames: true,
    },
    {
      // 로그 브리지(ISOLATED) — 모든 프레임(top + iframe)에 주입해 iframe 로그 커버리지 확보
      matches: ["<all_urls>"],
      js: ["src/content/recorder-bridge.ts"],
      run_at: "document_idle",
      all_frames: true,
    },
    {
      matches: ["<all_urls>"],
      js: ["src/content/recorders-entry.ts"],
      run_at: "document_start",
      world: "MAIN",
      all_frames: true,
    },
  ],
  permissions: [
    "sidePanel",
    "activeTab",
    "scripting",
    "storage",
    "commands",
    "contextMenus",
    "identity",
    "tabCapture",
    "webNavigation",
    "nativeMessaging",
  ],
  // <all_urls>가 모든 https origin을 포섭하므로 플랫폼 REST/OAuth host·OAuth proxy origin을
  // 따로 나열하지 않는다(전부 <all_urls> 커버). OAuth authorize는 launchWebAuthFlow라 host 불요.
  host_permissions: ["<all_urls>"],
  commands: {
    _execute_action: {
      suggested_key: {
        default: "Ctrl+Shift+E",
        mac: "Command+Shift+E",
      },
      description: "__MSG_CMD_TOGGLE_PANEL__",
    },
  },
});
