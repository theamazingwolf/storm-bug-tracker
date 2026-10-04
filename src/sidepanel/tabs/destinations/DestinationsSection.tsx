import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Section } from "@/sidepanel/components/Section";
import { useSettingsStore } from "@/store/settings-store";
import type { DestinationProfile } from "@/types/connection";
import { connectionLabel, destinationTitle } from "@/sidepanel/lib/connection-labels";
import { DestinationDialog } from "./DestinationDialog";
import { OriginMappingsPanel } from "./OriginMappingsPanel";

export function DestinationsSection() {
  const t = useT();
  const profiles = useSettingsStore((s) => s.destinationProfiles);
  const mappings = useSettingsStore((s) => s.websiteOriginMappings);
  const connections = useSettingsStore((s) => s.connections);
  const removeDestinationProfile = useSettingsStore((s) => s.removeDestinationProfile);
  const [dialog, setDialog] = useState<{ profile?: DestinationProfile } | null>(null);
  const [removing, setRemoving] = useState<DestinationProfile | null>(null);

  function owner(profile: DestinationProfile): string {
    const record = (profile.platform === "github" ? connections.github : connections.linear).find(
      (item) => item.id === profile.connectionId,
    );
    return record ? connectionLabel(record) : t("destinations.connectionMissing");
  }

  const removingMappings = removing ? mappings.filter((m) => m.destinationId === removing.id).length : 0;

  return (
    <>
      <Section
        testId="destinations-section"
        title={t("destinations.title")}
        action={
          <Button variant="outline" size="sm" className="gap-1" onClick={() => setDialog({})}>
            <Plus className="h-3.5 w-3.5" />
            {t("destinations.add")}
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">{t("destinations.body")}</p>
        {profiles.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="destinations-empty">
            {t("destinations.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2" aria-label={t("destinations.title")}>
            {profiles.map((profile) => {
              const title = destinationTitle(profile);
              return (
                <li key={profile.id}>
                  <Card>
                    <CardContent className="flex items-center justify-between gap-2 px-4 py-3">
                      <div className="flex min-w-0 flex-col">
                        <span className="truncate text-sm font-medium">
                          {t(profile.platform === "github" ? "platform.tab.github" : "platform.tab.linear")} · {title}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">{owner(profile)}</span>
                        <span className="text-xs text-muted-foreground">
                          {t("destinations.originCount", { count: mappings.filter((m) => m.destinationId === profile.id).length })}
                        </span>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={t("destinations.edit.aria", { name: title })}
                          onClick={() => setDialog({ profile })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 hover:text-destructive"
                          aria-label={t("destinations.remove.aria", { name: title })}
                          onClick={() => setRemoving(profile)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section testId="origins-section" title={t("origins.title")}>
        <OriginMappingsPanel />
      </Section>

      {dialog && (
        <DestinationDialog
          key={dialog.profile?.id ?? "new"}
          profile={dialog.profile}
          open
          onOpenChange={(open) => !open && setDialog(null)}
        />
      )}

      <AlertDialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("destinations.remove.title", { name: removing ? destinationTitle(removing) : "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("destinations.remove.body", { count: removingMappings })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removing) removeDestinationProfile(removing.id);
                setRemoving(null);
              }}
            >
              {t("destinations.remove.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
