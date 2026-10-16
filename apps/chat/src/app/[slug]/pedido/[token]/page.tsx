import type { Metadata } from "next";
import { OrderStatusView } from "../../../../components/pharmacy/OrderStatusView";

// The token in the URL is the only credential of this page: keep it out of search indexes and
// out of Referer headers.
export const metadata: Metadata = {
  title: "Acompanhar pedido",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function OrderStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <OrderStatusView token={token} />;
}
