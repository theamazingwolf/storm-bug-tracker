import { MAX_DRAFT_CHARS } from "./constants.js";

const METHODS = new Set(["status", "signIn", "listProfiles", "selectProfile", "listModels", "draft", "cancel", "signOut"]);
const ownKeysOnly = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));

export function validateRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !ownKeysOnly(value, ["id", "method", "params"])) throw new Error("invalid_request");
  if (!(typeof value.id === "string" || Number.isSafeInteger(value.id)) || String(value.id).length > 128) throw new Error("invalid_request_id");
  if (!METHODS.has(value.method)) throw new Error("unsupported_method");
  const params = value.params ?? {};
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("invalid_params");
  switch (value.method) {
    case "status": case "listProfiles":
      if (!ownKeysOnly(params, [])) throw new Error("invalid_params");
      break;
    case "signIn":
      if (!ownKeysOnly(params, ["profileId", "reconnect"])) throw new Error("invalid_params");
      if (params.profileId !== undefined && !/^[a-zA-Z0-9_-]{1,80}$/.test(params.profileId)) throw new Error("invalid_profile_id");
      if (params.reconnect !== undefined && typeof params.reconnect !== "boolean") throw new Error("invalid_params");
      break;
    case "selectProfile": case "signOut":
      if (!ownKeysOnly(params, ["profileId"]) || typeof params.profileId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(params.profileId)) throw new Error("invalid_profile_id");
      break;
    case "listModels":
      if (!ownKeysOnly(params, ["profileId"]) || (params.profileId !== undefined && typeof params.profileId !== "string")) throw new Error("invalid_params");
      break;
    case "draft":
      if (!ownKeysOnly(params, ["profileId", "model", "text", "images", "imageChoice"])) throw new Error("invalid_params");
      if (typeof params.model !== "string" || params.model.length < 1 || params.model.length > 200) throw new Error("invalid_model");
      if (typeof params.text !== "string" || params.text.length < 1 || params.text.length > MAX_DRAFT_CHARS) throw new Error("invalid_draft_text");
      if (params.images !== undefined) {
        if (!Array.isArray(params.images) || params.images.length > 8 || params.images.some((i) => !i || typeof i !== "object" || !ownKeysOnly(i, ["mimeType", "data"]))) throw new Error("invalid_images");
        throw new Error("images_unsupported");
      }
      if (params.imageChoice !== undefined && params.imageChoice !== "text-only") throw new Error("images_unsupported");
      if (params.profileId !== undefined && typeof params.profileId !== "string") throw new Error("invalid_params");
      break;
    case "cancel":
      if (!ownKeysOnly(params, ["requestId"]) || !(typeof params.requestId === "string" || Number.isSafeInteger(params.requestId))) throw new Error("invalid_cancel_request");
      break;
  }
  return { id: value.id, method: value.method, params };
}

export function resultMessage(id, result) { return { id, result }; }
export function errorMessage(id, code, message) { return { id, error: { code, message } }; }
export function eventMessage(event, data) { return { event, data }; }
