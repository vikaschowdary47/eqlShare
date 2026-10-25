#!/usr/bin/env node
/**
 * Deletes e2e test users (@eqlshare-test.dev only) and everything they created:
 * their Spaces (with bills, members, statements, activity), stored statement files,
 * imported people and their claim links, and import batches.
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from web/.env. Never prints keys.
 *
 *   node scripts/cleanup-test-users.mjs --all              every @eqlshare-test.dev user
 *   node scripts/cleanup-test-users.mjs a@eqlshare-test.dev b@eqlshare-test.dev
 */
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const TEST_DOMAIN = "@eqlshare-test.dev";

try {
  process.loadEnvFile(fileURLToPath(new URL("../.env", import.meta.url)));
} catch {
  // fall back to variables already in the environment
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in web/.env.");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });

const args = process.argv.slice(2);
if (!args.length) {
  console.error("Pass --all or one or more test emails.");
  process.exit(1);
}
const { data: list, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (listErr) throw new Error(`listUsers failed: ${listErr.message}`);
const testUsers = list.users.filter((u) => u.email?.endsWith(TEST_DOMAIN));
let targets;
if (args.includes("--all")) {
  targets = testUsers;
} else {
  const bad = args.find((e) => !e.endsWith(TEST_DOMAIN));
  if (bad) throw new Error(`Refusing ${bad}: only ${TEST_DOMAIN} users can be deleted.`);
  targets = testUsers.filter((u) => args.includes(u.email));
  for (const e of args) if (!targets.some((u) => u.email === e)) console.log(`${e}: not found`);
}
// Two passes: everyone's data first, then the accounts, because one test user can be a
// member of (or have claimed a person in) another's Space
const failures = new Map();
const report = [];
for (const u of targets) {
  const { data: spaces } = await admin.from("spaces").select("id").eq("created_by", u.id);
  const ids = (spaces ?? []).map((s) => s.id);
  const errors = [];
  if (ids.length) {
    for (const id of ids) {
      const { data: objs } = await admin.storage.from("statements").list(id);
      if (objs?.length) {
        const { error } = await admin.storage.from("statements").remove(objs.map((o) => `${id}/${o.name}`));
        if (error) errors.push(`storage: ${error.message}`);
      }
    }
    // bill_splits reference members without cascade, so bills go before Spaces
    for (const t of ["activity", "statements", "bills", "space_invitations"]) {
      const { error } = await admin.from(t).delete().in("space_id", ids);
      if (error) errors.push(`${t}: ${error.message}`);
    }
    const { error: unlink } = await admin.from("space_members").update({ import_batch_id: null }).in("space_id", ids);
    if (unlink) errors.push(`space_members: ${unlink.message}`);
    const { error } = await admin.from("spaces").delete().in("id", ids);
    if (error) errors.push(`spaces: ${error.message}`);
  }
  // People they added or claimed (claim links cascade), before the batches those people came from
  const { error: peopleErr } = await admin.from("import_people").delete().or(`owner_id.eq.${u.id},claimed_by.eq.${u.id}`);
  if (peopleErr) errors.push(`import_people: ${peopleErr.message}`);
  const { error: batchErr } = await admin.from("import_batches").delete().eq("created_by", u.id);
  if (batchErr) errors.push(`import_batches: ${batchErr.message}`);
  failures.set(u.id, errors);
  report.push([u, ids.length]);
}
let failed = 0;
for (const [u, spaces] of report) {
  const errors = failures.get(u.id);
  const { error: userErr } = await admin.auth.admin.deleteUser(u.id);
  if (userErr) errors.push(`user: ${userErr.message}`);
  if (errors.length) failed++;
  console.log(`${u.email}: ${errors.length ? `FAILED (${errors.join("; ")})` : `deleted, ${spaces} Space(s)`}`);
}

const { data: after } = await admin.auth.admin.listUsers({ perPage: 1000 });
console.log(`${after.users.filter((u) => u.email?.endsWith(TEST_DOMAIN)).length} ${TEST_DOMAIN} users remain.`);
process.exit(failed ? 1 : 0);
