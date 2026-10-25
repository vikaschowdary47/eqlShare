import type { Metadata } from "next";
import { LegalPage } from "../legal";

export const metadata: Metadata = { title: "Privacy" };

export default function Privacy() {
  return (
    <LegalPage title="Privacy">
      <h2>What we collect</h2>
      <p>Your name and email, the Spaces you create or join, the bills and shares you enter, payment reports you record, and statements you upload. From statements we keep the provider, amount due, due date, billing period and the last four digits of the account number, plus the original PDF.</p>
      <h2>What we don't collect</h2>
      <p>Bank logins, card numbers or payment credentials. Eqlshare doesn't move money.</p>
      <h2>Who can see it</h2>
      <p>Only members of a Space can see that Space's bills, shares and statements. Former members keep access to the history of bills they were part of.</p>
      <h2>Your choices</h2>
      <p>You can export a Space's records as CSV at any time, leave a Space, and turn off reminders. To delete your account, email support@eqlshare.com.</p>
    </LegalPage>
  );
}
