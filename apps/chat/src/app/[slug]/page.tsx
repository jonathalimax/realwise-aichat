import { ChatScreen } from "../../components/ChatScreen";

export default async function BusinessChatPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <ChatScreen slug={slug} />;
}
