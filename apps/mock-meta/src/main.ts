import express from "express";
import { buildOAuthState } from "@realwise/meta";

const app = express();
app.use(express.json());

app.get("/oauth/:provider/start", (request, response) => {
  const provider = String(request.params.provider).toUpperCase() as "WHATSAPP" | "INSTAGRAM" | "FACEBOOK";
  response.json({
    authorizationUrl: `/oauth/${provider.toLowerCase()}/callback?state=${buildOAuthState("demo-academia", provider, "mock-nonce")}&code=mock-code`,
    releaseState: "MOCK_VERIFIED",
  });
});

app.post("/events/:provider", (request, response) => {
  response.status(202).json({ accepted: true, provider: request.params.provider, echo: request.body });
});

app.listen(Number(process.env.PORT ?? 3010), () => {
  console.log(JSON.stringify({ event: "mock_meta_started", port: Number(process.env.PORT ?? 3010) }));
});
