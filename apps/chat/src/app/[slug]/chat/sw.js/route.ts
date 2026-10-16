import { SW_SOURCE } from "../../../../lib/sw-source";

// Served at /<slug>/chat/sw.js. Service-Worker-Allowed widens the scope from /<slug>/chat/ to /<slug>/ so the same
// worker also covers /<slug>/pedido/*. The slug is validated: it only ever feeds the header.
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) return new Response("Not found", { status: 404 });
  return new Response(SW_SOURCE, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Service-Worker-Allowed": `/${slug}/`,
      "Cache-Control": "no-cache",
    },
  });
}
