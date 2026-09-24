import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import {
  AppShell,
  Button,
  DemoNotice,
  EmptyState,
  Glass,
  InlineError,
  LoadingCard,
  PageHeader,
  SectionCard,
  TextArea,
} from "@/components/rentid/patterns";
import { shortDate } from "@/lib/format";
import { useAuth, useProfile } from "@/lib/auth";
import { useConversations, useMyTenancies, useSendMessage } from "@/lib/rentid";

export const Route = createFileRoute("/_authenticated/tenant/messages")({
  head: () => ({
    meta: [{ title: "Messages — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: TenantMessagesPage,
});

function TenantMessagesPage() {
  const { user } = useAuth();
  const profile = useProfile();
  const tenancies = useMyTenancies();
  const tenancy = tenancies.data?.[0] ?? null;
  const conversations = useConversations({
    viewerRole: "tenant",
    tenancyIds: (tenancies.data ?? []).map((t) => t.id),
  });
  const send = useSendMessage();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [body, setBody] = useState("");

  const threads = conversations.data ?? [];
  const active = threads.find((t) => t.id === activeId) ?? threads[0] ?? null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tenancy || !body.trim()) return;
    try {
      await send.mutateAsync({
        conversationId: active?.id ?? null,
        organizationId: tenancy.organization_id,
        tenancyId: tenancy.id,
        subject:
          active?.subject ?? `${tenancy.property?.name ?? "Tenancy"} — ${tenancy.unit?.name ?? ""}`,
        senderId: user?.id ?? null,
        senderName: profile.data?.full_name ?? "Tenant",
        senderRole: "tenant",
        body,
      });
      setBody("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Message could not be sent.");
    }
  }

  return (
    <AppShell subtitle="Tenant">
      <PageHeader
        title="Messages"
        subtitle={tenancy?.organization?.name ? `With ${tenancy.organization.name}` : undefined}
      />

      <div className="mt-5 space-y-4">
        {tenancies.isLoading || conversations.isLoading ? (
          <LoadingCard label="Loading your conversations…" />
        ) : conversations.isError ? (
          <InlineError
            message="Messages could not be loaded."
            onRetry={() => void conversations.refetch()}
          />
        ) : !tenancy ? (
          <EmptyState
            title="No active tenancy"
            description="Messaging opens as soon as your tenancy is linked to a landlord."
          />
        ) : (
          <>
            <DemoNotice>
              Threads stay attached to your tenancy, so the history follows the lease rather than a
              personal inbox.
            </DemoNotice>

            <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
              <SectionCard title="Threads" aside={`${threads.length}`}>
                {threads.length === 0 ? (
                  <p className="px-4 py-4 text-[12.5px] text-muted-foreground">
                    No threads yet — start one below.
                  </p>
                ) : (
                  threads.map((thread) => (
                    <button
                      key={thread.id}
                      onClick={() => setActiveId(thread.id)}
                      className={`w-full px-4 py-3 text-left transition-colors ${
                        active?.id === thread.id ? "bg-secondary/70" : "hover:bg-secondary/40"
                      }`}
                    >
                      <p className="truncate text-[13px] font-medium">{thread.subject}</p>
                      <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                        {thread.counterpart_name} · {shortDate(thread.last_message_at)}
                      </p>
                    </button>
                  ))
                )}
              </SectionCard>

              <Glass className="flex min-h-[24rem] flex-col p-4">
                <div className="flex-1 space-y-3 overflow-y-auto">
                  {(active?.messages ?? []).length === 0 ? (
                    <p className="text-[12.5px] text-muted-foreground">
                      Ask about rent, repairs or your lease — your landlord sees it in the same
                      thread.
                    </p>
                  ) : (
                    (active?.messages ?? []).map((message) => {
                      const mine = message.sender_role === "tenant";
                      return (
                        <div
                          key={message.id}
                          className={mine ? "flex justify-end" : "flex justify-start"}
                        >
                          <div
                            className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13px] ${
                              mine
                                ? "bg-brand text-brand-foreground"
                                : "bg-secondary text-foreground"
                            }`}
                          >
                            <p className="label-eyebrow mb-1 opacity-70">{message.sender_name}</p>
                            <p className="whitespace-pre-wrap">{message.body}</p>
                            <p className="mt-1 text-[10.5px] opacity-70">
                              {shortDate(message.created_at)}
                            </p>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <form onSubmit={submit} className="mt-4 space-y-2">
                  <TextArea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    placeholder="Write a message…"
                    className="min-h-20"
                  />
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      size="sm"
                      loading={send.isPending}
                      disabled={!body.trim()}
                    >
                      Send
                    </Button>
                  </div>
                </form>
              </Glass>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
