import { useState } from "react";
import { Trash2 } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldRow } from "@/sidepanel/components/FieldRow";
import { canonicalMappingOrigin } from "@/lib/connection-settings";
import { useSettingsStore } from "@/store/settings-store";
import { connectionErrorMessage } from "@/sidepanel/lib/connection-errors";
import { destinationTitle } from "@/sidepanel/lib/connection-labels";

/** Exact-origin rules only: `https://app.example.com` never matches a sibling subdomain or another path. */
export function OriginMappingsPanel() {
  const t = useT();
  const profiles = useSettingsStore((s) => s.destinationProfiles);
  const mappings = useSettingsStore((s) => s.websiteOriginMappings);
  const setWebsiteOriginMapping = useSettingsStore((s) => s.setWebsiteOriginMapping);
  const removeWebsiteOriginMapping = useSettingsStore((s) => s.removeWebsiteOriginMapping);
  const [origin, setOrigin] = useState("");
  const [destinationId, setDestinationId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const canonical = origin.trim() ? canonicalMappingOrigin(origin) : null;
  const replaces = canonical
    ? mappings.some((m) => canonicalMappingOrigin(m.origin) === canonical)
    : false;
  const destination = profiles.find((p) => p.id === destinationId);
  const canSave = !!origin.trim() && !!destination;

  function save() {
    if (!canSave) return;
    try {
      setWebsiteOriginMapping(origin, destinationId);
      setOrigin("");
      setError(null);
    } catch (err) {
      setError(connectionErrorMessage(t, err));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t("origins.body")}</p>

      {mappings.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="origins-empty">
          {t("origins.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label={t("origins.title")}>
          {mappings.map((mapping) => {
            const target = profiles.find((p) => p.id === mapping.destinationId);
            return (
              <li
                key={`${mapping.origin}\u0000${mapping.destinationId}`}
                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-xs">{mapping.origin}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {target ? destinationTitle(target) : t("origins.destination.missing")}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 shrink-0 hover:text-destructive"
                  aria-label={t("origins.remove.aria", { origin: mapping.origin })}
                  onClick={() => removeWebsiteOriginMapping(mapping.origin, mapping.destinationId)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {profiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("origins.needDestination")}</p>
      ) : (
        <div className="flex flex-col gap-3 rounded-md border border-dashed border-border p-3">
          <FieldRow label={t("origins.field.origin")} htmlFor="origin-mapping-input">
            <Input
              id="origin-mapping-input"
              placeholder={t("origins.field.origin.placeholder")}
              value={origin}
              onChange={(e) => {
                setOrigin(e.target.value);
                setError(null);
              }}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!!error}
            />
          </FieldRow>
          <FieldRow label={t("origins.field.destination")} htmlFor="origin-mapping-destination">
            <Select value={destinationId} onValueChange={setDestinationId}>
              <SelectTrigger id="origin-mapping-destination">
                <SelectValue placeholder={t("origins.field.destination.select")} />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {destinationTitle(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          {!error && origin.trim() && !canonical && (
            <p role="alert" className="text-xs text-destructive">
              {t("origins.error.invalid")}
            </p>
          )}
          {replaces && canonical && (
            <p className="text-xs text-muted-foreground">{t("origins.replaces", { origin: canonical })}</p>
          )}
          <div className="flex justify-end">
            <Button onClick={save} disabled={!canSave || !canonical}>
              {t("origins.save")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
