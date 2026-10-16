import { Alert } from "./ui/alert";

/** Static, always-on banner: order and handoff notifications cannot be turned off (API.md 10.3). */
export function NotificationsAlwaysOn({ text }: { text?: string }) {
  return <Alert variant="soft">{text ?? "Notificações de pedidos e atendimentos estão sempre ativas e não podem ser desligadas."}</Alert>;
}
