import { NextResponse } from "next/server";
import { GetAccountCommand, GetEmailIdentityCommand } from "@aws-sdk/client-sesv2";
import { clientFor, getSesConfig } from "@/lib/channels/email/ses";

export async function GET() {
  const cfg = await getSesConfig();
  if (!cfg) {
    return NextResponse.json({
      configured: false,
      hint: "Add AWS credentials + sender address in the form below (or via env vars).",
    });
  }
  const client = clientFor(cfg);
  const domain = cfg.fromEmail.split("@")[1];

  try {
    const acct = await client.send(new GetAccountCommand({}));
    let identity = null;
    try {
      const ident = await client.send(new GetEmailIdentityCommand({ EmailIdentity: domain }));
      identity = {
        name: domain,
        verified: ident.VerifiedForSendingStatus ?? false,
        dkimStatus: ident.DkimAttributes?.Status ?? "NOT_STARTED",
        dkimTokens: ident.DkimAttributes?.Tokens ?? [],
        mailFromDomain: ident.MailFromAttributes?.MailFromDomain ?? null,
        mailFromStatus: ident.MailFromAttributes?.MailFromDomainStatus ?? null,
      };
    } catch {
      // domain identity not created yet
    }
    return NextResponse.json({
      configured: true,
      fromEmail: cfg.fromEmail,
      region: cfg.region,
      productionAccess: acct.ProductionAccessEnabled ?? false,
      sendingEnabled: acct.SendingEnabled ?? false,
      maxSendRate: acct.SendQuota?.MaxSendRate ?? 0,
      max24HourSend: acct.SendQuota?.Max24HourSend ?? 0,
      sentLast24Hours: acct.SendQuota?.SentLast24Hours ?? 0,
      identity,
    });
  } catch (e) {
    return NextResponse.json({ configured: true, error: String(e).slice(0, 300) }, { status: 502 });
  }
}
