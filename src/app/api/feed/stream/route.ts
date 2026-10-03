import { getCurrentUser } from "@/server/auth";
import { feedRevision } from "@/server/board/service";

export const dynamic = "force-dynamic";

/** Tells an open dashboard when stored labels changed. The page itself stays a normal server render. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      let last = "";
      const tick = async () => {
        const revision = await feedRevision();
        if (revision === last) {
          controller.enqueue(encoder.encode(": ping\n\n"));
          return;
        }
        last = revision;
        controller.enqueue(encoder.encode(`data: ${revision}\n\n`));
      };
      await tick();
      timer = setInterval(() => {
        tick().catch(() => controller.close());
      }, 5_000);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
