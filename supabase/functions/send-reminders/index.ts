// =====================================================================
// RunBoard - "send-reminders" Edge Function (Supabase, FaaS)
//
// Runs once a day, started by pg_cron (see supabase/reminders.sql).
// 1. Asks the database which reminders are due (races that start in the
//    next 48 hours and whose subscriber has not been reminded yet).
// 2. Sends one e-mail per subscription through the Resend e-mail API.
// 3. Marks each subscription as reminded, so a race is never e-mailed
//    twice, even if the function is called again.
//
// Secrets (Supabase > Edge Functions > Secrets), never in the code:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  -> added by Supabase itself
//   RESEND_API_KEY                           -> added by the team
//   REMINDER_FROM (optional)                 -> sender, e.g. "RunBoard <no-reply@domain>"
// Without RESEND_API_KEY the function runs in "dry run" mode: it only
// logs what it would send and does not mark anything.
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

// The service role key bypasses RLS, so it exists only on the server side
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = Deno.env.get("REMINDER_FROM") ?? "RunBoard <onboarding@resend.dev>";
const APP_URL = "https://runboard-tau.vercel.app";
const TIME_ZONE = "America/Sao_Paulo";

type DueReminder = {
  user_id: string;
  event_id: number;
  email: string;
  name: string;
  city: string;
  location: string | null;
  start_at: string;
  distances_km: number[];
  kit_pickup_info: string | null;
  official_url: string | null;
  banner_url: string | null;
};

// Organizers type these texts, so they are escaped before going into HTML
const safe = (text: unknown) =>
  String(text ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// "today", "tomorrow" or "in 2 days", counted in Brasília dates
function countdown(startAt: string) {
  const day = (d: Date) => new Date(d.toLocaleDateString("en-CA", { timeZone: TIME_ZONE })).getTime();
  const days = Math.round((day(new Date(startAt)) - day(new Date())) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
}

// One "label: value" line of the details table
const row = (label: string, value: string) => `
  <tr>
    <td style="padding:8px 0;color:#6b7480;font-size:14px;width:110px;vertical-align:top">${label}</td>
    <td style="padding:8px 0;color:#17222e;font-size:15px;font-weight:600">${value}</td>
  </tr>`;

// E-mail layout with tables and inline styles, which every e-mail client supports
function emailHtml(r: DueReminder) {
  const start = new Date(r.start_at);
  const date = start.toLocaleDateString("en-GB", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long" });
  const time = start.toLocaleTimeString("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" });
  const distances = (r.distances_km ?? [])
    .map((km) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 12px;border-radius:999px;background:#fde8e1;color:#9a3412;font-size:13px;font-weight:700">${safe(km)}K</span>`)
    .join("");

  return `
<div style="margin:0;padding:24px 12px;background:#f7f6f3;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e3e7eb">
    <tr>
      <td style="background:#17222e;padding:20px 28px">
        <span style="color:#ffffff;font-size:22px;font-weight:700">Run</span><span style="color:#e4572e;font-size:22px;font-weight:700">Board</span>
      </td>
    </tr>
    ${r.banner_url ? `<tr><td><img src="${safe(r.banner_url)}" alt="" width="560" style="display:block;width:100%;height:auto"></td></tr>` : ""}
    <tr>
      <td style="padding:28px">
        <p style="margin:0 0 6px;color:#e4572e;font-size:13px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Race day is ${countdown(r.start_at)}</p>
        <h1 style="margin:0 0 12px;color:#17222e;font-size:26px;line-height:1.25">${safe(r.name)}</h1>
        <p style="margin:0 0 20px;color:#4a5a6c;font-size:15px;line-height:1.5">Hi! You asked RunBoard to remind you about this race. Here is everything you need to be ready:</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e3e7eb;border-bottom:1px solid #e3e7eb;margin-bottom:20px">
          ${row("When", `${safe(date)} · ${safe(time)}`)}
          ${row("Where", safe(r.location ? `${r.location}, ${r.city}` : r.city))}
          ${distances ? row("Distances", distances) : ""}
          ${r.kit_pickup_info ? row("Kit pickup", safe(r.kit_pickup_info)) : ""}
        </table>
        <p style="margin:0 0 24px;color:#4a5a6c;font-size:15px;line-height:1.5">Tip: sleep well, drink water and get there early. Good race! 🏃</p>
        ${r.official_url ? `<a href="${safe(r.official_url)}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#e4572e;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">Official race website</a>` : ""}
      </td>
    </tr>
    <tr>
      <td style="padding:18px 28px;background:#f7f6f3;color:#6b7480;font-size:12px;line-height:1.5">
        You get this e-mail because you clicked "Notify me" on <a href="${APP_URL}" style="color:#e4572e">RunBoard</a>. To stop it, open the race there and click "Reminder on".
      </td>
    </tr>
  </table>
</div>`;
}

// Calls the Resend REST API; returns true when the e-mail was accepted
async function sendEmail(r: DueReminder) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: r.email,
      subject: `🏃 ${r.name} is ${countdown(r.start_at)}!`,
      html: emailHtml(r),
    }),
  });
  if (!response.ok) console.error("Resend error", response.status, await response.text());
  return response.ok;
}

Deno.serve(async () => {
  // due_reminders() is a SQL function that only the service role can run
  const { data, error } = await supabase.rpc("due_reminders");
  if (error) {
    console.error(error);
    return Response.json({ error: "Could not read the reminders" }, { status: 500 });
  }

  const due = (data ?? []) as DueReminder[];
  let sent = 0;
  let failed = 0;

  for (const r of due) {
    if (!RESEND_API_KEY) {
      console.log(`[dry run] would remind ${r.email} about "${r.name}"`);
      continue;
    }
    if (await sendEmail(r)) {
      sent++;
      await supabase
        .from("reminder_subscriptions")
        .update({ reminded_at: new Date().toISOString() })
        .eq("user_id", r.user_id)
        .eq("event_id", r.event_id);
    } else {
      failed++;
    }
  }

  // The answer has only counts: no e-mail address leaves the function
  const summary = { due: due.length, sent, failed, dryRun: !RESEND_API_KEY };
  console.log(summary);
  return Response.json(summary);
});
