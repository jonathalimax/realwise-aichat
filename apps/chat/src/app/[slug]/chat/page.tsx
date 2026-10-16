import { ChatScreen } from "../../../components/ChatScreen";

export default async function BusinessChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ c?: string; t?: string }>;
}) {
  const { slug } = await params;
  const { c, t } = await searchParams;
  return <ChatScreen slug={slug} resumeConversationId={c} resumeToken={t} />;
}
