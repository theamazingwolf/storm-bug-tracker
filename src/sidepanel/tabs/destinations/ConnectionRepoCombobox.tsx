import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { useT } from "@/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { canCreateIssue } from "@/lib/github-repo";
import { sendBg } from "@/lib/bg-client";
import type { GithubRepo } from "@/types/github";

export interface ConnectionRepoValue {
  owner: string;
  repo: string;
}

interface Props {
  /** Every search is scoped to this connection; without one the picker stays disabled. */
  connectionId: string | undefined;
  value: ConnectionRepoValue | null;
  onChange: (next: ConnectionRepoValue | null) => void;
  ariaLabel: string;
}

/**
 * Settings-only twin of the issue form's RepoCombobox. It always sends `connectionId` and drops
 * any response that belongs to a previous connection or an older query, so rapid account switches
 * cannot show (or select) another account's repositories.
 */
export function ConnectionRepoCombobox({ connectionId, value, onChange, ariaLabel }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<GithubRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    reqIdRef.current++;
    setItems([]);
    setError(null);
    setLoading(false);
    setQuery("");
  }, [connectionId]);

  useEffect(() => {
    if (!open || !connectionId) return;
    const myReq = ++reqIdRef.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      sendBg<GithubRepo[]>({ type: "github.searchRepos", query, connectionId })
        .then((list) => {
          if (myReq === reqIdRef.current) setItems(list);
        })
        .catch((err: unknown) => {
          if (myReq === reqIdRef.current) setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (myReq === reqIdRef.current) setLoading(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, query, connectionId]);

  const disabled = !connectionId;
  const label = value ? `${value.owner}/${value.repo}` : t("github.field.repo.select");

  return (
    <Popover open={open} onOpenChange={(v) => !disabled && setOpen(v)}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          disabled={disabled}
          className="w-full min-w-0 justify-between font-normal"
        >
          <span className={cn("min-w-0 flex-1 truncate text-left", !value && "text-muted-foreground")}>
            {label}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" onWheel={(e) => e.stopPropagation()}>
        <Command shouldFilter={false}>
          <CommandInput placeholder={t("github.field.repo.search")} value={query} onValueChange={setQuery} />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("common.loading")}
              </div>
            ) : error ? (
              <div className="px-3 py-6 text-center text-xs text-destructive">{error}</div>
            ) : (
              <>
                <CommandEmpty>{t("github.field.repo.empty")}</CommandEmpty>
                <CommandGroup>
                  {items.map((r) => {
                    const selected = value?.owner === r.owner && value?.repo === r.name;
                    const blocked = !canCreateIssue(r);
                    return (
                      <CommandItem
                        key={`${r.owner}/${r.name}`}
                        value={`${r.owner}/${r.name}`}
                        disabled={blocked}
                        onSelect={() => {
                          onChange(selected ? null : { owner: r.owner, repo: r.name });
                          setOpen(false);
                        }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", selected ? "opacity-100" : "opacity-0")} />
                        <span className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span className="min-w-0 flex-1 truncate">{r.fullName}</span>
                          {blocked ? (
                            <Badge variant="secondary" className="shrink-0">
                              {t(r.archived ? "github.field.repo.archived" : "github.field.repo.issuesOff")}
                            </Badge>
                          ) : null}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
