import { ChatScreen } from "../../components/ChatScreen";

export default function BusinessChatPage({ params }: { params: { slug: string } }) {
  return <ChatScreen slug={params.slug} />;
}
