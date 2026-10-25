import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractStatement, statementKey } from "@/lib/domain/statement";

/**
 * Inbound email webhook (provider-agnostic JSON). Disabled until INBOUND_WEBHOOK_SECRET and
 * SUPABASE_SERVICE_ROLE_KEY are set. Expected body: { to, from, subject, text, attachments?: [{ filename, contentType, contentBase64 }] }.
 * Only the parsed fields and the PDF are kept; the email body is not stored.
 */
export async function POST(req: Request) {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  const admin = supabaseAdmin();
  if (!secret || !admin) return NextResponse.json({ error: "forwarding_disabled" }, { status: 503 });
  const given = Buffer.from(req.headers.get("x-eqlshare-signature") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { to?: string; from?: string; text?: string; attachments?: { filename?: string; contentType?: string; contentBase64?: string }[] } | null;
  const token = body?.to?.match(/bills\+([a-f0-9]{18})@/i)?.[1];
  if (!body || !token) return NextResponse.json({ error: "unknown_address" }, { status: 400 });

  const pdf = (body.attachments ?? []).find((a) => a.contentType === "application/pdf" && a.contentBase64);
  let text = body.text ?? "";
  let filePath: string | null = null;
  let fileName: string | null = null;
  if (pdf) {
    const bytes = Buffer.from(pdf.contentBase64!, "base64");
    if (bytes.length <= 10 * 1024 * 1024 && bytes.subarray(0, 5).toString() === "%PDF-") {
      try {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const out = await extractText(await getDocumentProxy(new Uint8Array(bytes)), { mergePages: true });
        text = `${out.text}\n${text}`;
      } catch { /* fall back to the email body */ }
      const { data: space } = await admin.from("spaces").select("id").eq("inbound_token", token).maybeSingle();
      if (space) {
        const path = `${space.id}/${crypto.randomUUID()}.pdf`;
        const up = await admin.storage.from("statements").upload(path, bytes, { contentType: "application/pdf" });
        if (!up.error) { filePath = path; fileName = (pdf.filename ?? "statement.pdf").slice(0, 200); }
      }
    }
  }

  const e = extractStatement(text);
  const { error } = await admin.rpc("ingest_emailed_statement", {
    p_inbound_token: token, p_sender: body.from?.slice(0, 200) ?? null, p_file_path: filePath, p_file_name: fileName,
    p_kind: text.trim() ? e.kind : "unreadable", p_provider: e.provider.value, p_amount_cents: e.amountDueCents.value, p_due_date: e.dueDate.value,
    p_period_start: e.periodStart, p_period_end: e.periodEnd, p_account_last4: e.accountLast4, p_statement_ref: e.statementId,
    p_statement_key: statementKey(e), p_reasons: e.reasons, p_parser_version: e.parserVersion,
  });
  // Same response for unknown addresses and success, so addresses can't be probed
  if (error && !error.message.includes("unknown_address")) return NextResponse.json({ error: "ingest_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
