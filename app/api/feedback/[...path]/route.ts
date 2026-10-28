import { dispatchFeedbackRequest, type FeedbackDispatchEnv } from "@/lib/server/feedback-dispatch";

export const dynamic = "force-dynamic";

async function respond(request: Request) {
  const { env } = await import("cloudflare:workers");
  return dispatchFeedbackRequest(request, env as unknown as FeedbackDispatchEnv);
}

export const GET = respond;
export const POST = respond;
export const PATCH = respond;
export const DELETE = respond;
