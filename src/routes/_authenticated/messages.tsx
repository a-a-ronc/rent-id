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
  Select,
  TextArea,
} from "@/components/rentid/patterns";
import { useAuth, useProfile } from "@/lib/auth";
import { shortDate } from "@/lib/format";
import { useActiveOrg, useConversations, useSendMessage, useTenancies } from "@/lib/rentid";

export const Route = createFileRoute("/_authenticated/messages")({
  head: () => ({
    meta: [{ title: "Messages — RentID" }, { name: "robots", content: "noindex" }],
  }),
  component: MessagesPage,
});

function MessagesPage() {
  const { user } = useAuth();
  const profile = useProfile();
  const active = useActiveOrg();
  const tenancies = useTenancies(active.orgId);
  const conversations = useConversations({ viewerRole: "landlord", orgId: active.orgId });
  const send = useSendMessage();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tenancyId, setTenancyId] = useState("");
  const [body, setBody] = useState("");

  const threads = conversations.data ?? [];
  const thread = threads.find((t) => t.id === activeId) ?? threads[0] ?? null;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active.orgId || !body.trim()) return;
    const target = thread?.tenancy_id ?? tenancyId;
    if (!target) {
      toast.error("Choose a tenancy to start a thread.");
      return;
    }
    const tenancy = (tenancies.data ?? []).find((t) => t.id === target);
    try {
      await send.mutateAsync({
        conversationId: thread?.id ?? null,
        organizationId: active.orgId,
        tenancyId: target,
        subject:
          thread?.subject ??
          `${tenancy?.property?.name ?? "Tenancy"} — ${tenancy?.unit?.name ?? ""}`,
        senderId: user?.id ?? null,
        senderName: profile.data?.full_name ?? "Landlord",
        senderRole: "landlord",
        body,
      });
      setBody("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Message could not be sent.");
    }
  }

  return (
    <AppShell subtitle={active.isDemo ? "Demo portfolio" : "Landlord"}>
      <PageHeader title="Messages" subtitle={active.org?.name} />

      <div className="mt-5 space-y-4">
        <DemoNotice>
          Every thread is attached to a tenancy, so conversation history stays with the lease
          instead of an inbox.
        </DemoNotice>

        {conversations.isLoading ? (
          <LoadingCard label="Loading conversations…" />
        ) : conversations.isError ? (
          <InlineError
            message="Messages could not be loaded."
            onRetry={() => void conversations.refetch()}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
            <SectionCard title="Threads" aside={`${threads.length}`}>
              {threads.length === 0 ? (
                <p className="px-4 py-4 text-[12.5px] text-muted-foreground">
                  No conversations yet.
                </p>
              ) : (
                threads.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setActiveId(item.id)}
                    className={`w-full px-4 py-3 text-left transition-colors ${
                      thread?.id === item.id ? "bg-secondary/70" : "hover:bg-secondary/40"
                    }`}
                  >
                    <p className="truncate text-[13px] font-medium">{item.counterpart_name}</p>
                    <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
                      {item.subject} · {shortDate(item.last_message_at)}
                    </p>
                  </button>
                ))
              )}
            </SectionCard>

            <Glass className="flex min-h-[26rem] flex-col p-4">
              {threads.length === 0 && !tenancyId ? (
                <EmptyState
                  title="Start a conversation"
                  description="Pick a tenancy below and send the first message — the thread stays linked to that tenancy."
                />
              ) : (
                <div className="flex-1 space-y-3 overflow-y-auto">
                  {(thread?.messages ?? []).map((message) => {
                    const mine = message.sender_role !== "tenant";
                    return (
                      <div
                        key={message.id}
                        className={mine ? "flex justify-end" : "flex justify-start"}
                      >
                        <div
                          className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-[13px] ${
                            mine ? "bg-brand text-brand-foreground" : "bg-secondary text-foreground"
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
                  })}
                </div>
              )}

              <form onSubmit={submit} className="mt-4 space-y-2">
                {!thread ? (
                  <Select value={tenancyId} onChange={(event) => setTenancyId(event.target.value)}>
                    <option value="">Choose a tenancy…</option>
                    {(tenancies.data ?? []).map((tenancy) => (
                      <option key={tenancy.id} value={tenancy.id}>
                        {tenancy.tenant_name} — {tenancy.unit?.name ?? ""}
                      </option>
                    ))}
                  </Select>
                ) : null}
                <TextArea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Write a message…"
                  className="min-h-20"
                />
                <div className="flex justify-end">
                  <Button type="submit" size="sm" loading={send.isPending} disabled={!body.trim()}>
                    Send
                  </Button>
                </div>
              </form>
            </Glass>
          </div>
        )}
      </div>
    </AppShell>
  );
}
