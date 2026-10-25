import { supabaseServer } from "@/lib/supabase/server";
import { extractBalancesFromImages, sniffImageType } from "@/lib/import/extract";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_IMAGES = 20;
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * POST multipart "images" (1-20). Streams NDJSON:
 *   {"type":"progress","index":0,"status":"reading"|"done"|"failed"}
 *   {"type":"result","result":ExtractionResult} | {"type":"error","error":string}
 * Images are processed in memory and never stored.
 */
export async function POST(req: Request) {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Please sign in again." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const files = (form?.getAll("images") ?? []).filter((f): f is File => f instanceof File);
  if (files.length === 0) return Response.json({ error: "Add at least one screenshot." }, { status: 400 });
  if (files.length > MAX_IMAGES) return Response.json({ error: `You can add up to ${MAX_IMAGES} screenshots at a time.` }, { status: 400 });

  const images: { bytes: Uint8Array; mimeType: string }[] = [];
  for (const [i, f] of files.entries()) {
    if (f.size > MAX_BYTES) return Response.json({ error: `Screenshot ${i + 1} is over 10 MB.` }, { status: 400 });
    const bytes = new Uint8Array(await f.arrayBuffer());
    const mimeType = sniffImageType(bytes);
    if (!mimeType) return Response.json({ error: `Screenshot ${i + 1} isn't a supported image (JPEG, PNG, WebP or HEIC).` }, { status: 400 });
    images.push({ bytes, mimeType });
  }
  if (!process.env.GEMINI_API_KEY) return Response.json({ error: "Screenshot import isn't available right now. You can enter balances manually." }, { status: 503 });

  const { data: requestId, error: limitErr } = await supabase.rpc("begin_extraction", { p_image_count: images.length });
  if (limitErr) {
    const limited = limitErr.message.includes("rate_limited");
    return Response.json({ error: limited ? "You've reached the limit of 10 imports an hour. Try again later, or enter balances manually." : "Something went wrong. Please try again." }, { status: limited ? 429 : 500 });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      try {
        const { result, usage } = await extractBalancesFromImages(images, { onProgress: (index, status) => send({ type: "progress", index, status }) });
        await supabase.rpc("finish_extraction", { p_id: requestId, p_latency_ms: usage.latencyMs, p_input_tokens: usage.inputTokens, p_output_tokens: usage.outputTokens, p_succeeded: true });
        send({ type: "result", result });
      } catch {
        await supabase.rpc("finish_extraction", { p_id: requestId, p_latency_ms: null, p_input_tokens: null, p_output_tokens: null, p_succeeded: false });
        send({ type: "error", error: "We couldn't read your screenshots. Try again, or enter balances manually." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
