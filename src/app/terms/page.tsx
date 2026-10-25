import type { Metadata } from "next";
import { LegalPage } from "../legal";

export const metadata: Metadata = { title: "Terms" };

export default function Terms() {
  return (
    <LegalPage title="Terms">
      <h2>What Eqlshare is</h2>
      <p>A tool for recording shared bills and who has paid whom. It doesn't process payments, hold funds, or pay providers for you.</p>
      <h2>Accuracy</h2>
      <p>Bill details read from statements are suggestions until a member confirms them. Payment statuses are reported by members. "Confirmed received" means the person owed confirmed it, not that a bank or provider verified it.</p>
      <h2>Reminders</h2>
      <p>Reminders help, but they don't guarantee that a bill is paid on time or that service won't be interrupted.</p>
      <h2>Beta</h2>
      <p>The service is in closed beta and may change. Features and terms will be updated before public launch.</p>
    </LegalPage>
  );
}
