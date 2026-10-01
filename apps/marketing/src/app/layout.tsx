import "./globals.css";

export const metadata = {
  title: "Realwise — Seu atendimento não dorme",
  description: "Um link no seu Instagram que responde, agenda e te passa o cliente pronto no WhatsApp. Sem contratar ninguém.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
