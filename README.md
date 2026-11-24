# RunBoard

Cloud-native web platform for street running events. Runners find races and get an e-mail reminder before race day, so they never miss the kit pickup. Organizers publish each race once, in one place.

UNISINOS case study, Trending Information Technologies (Prof. Daniel Stefani Marcon), Group D: Camila Isperling Machado, Felipe Alles Garcia, Julia Stelzer and Rodrigo Ritzel Bernasconi.

Live version: https://runboard-tau.vercel.app

## Architecture

```
Runner / Organizer
      │  sign in (Supabase Auth → JWT)
      ▼
Web application  (static HTML + JS on Vercel: CDN + HTTPS)
      │  every request carries the JWT
      ▼
Supabase project, São Paulo region (sa-east-1)
  ├─ PostgreSQL database   events + reminder subscriptions, protected by Row Level Security
  ├─ Storage               race banners (bucket "banners")
  └─ Edge Function         "send-reminders", started every day by pg_cron
                                 │
                                 ▼
                           Resend e-mail API → runner's inbox
```

| Cloud service | Model | Used for |
| --- | --- | --- |
| Vercel | PaaS + CDN | hosts the web application, HTTPS, global edge network |
| Supabase Auth | IDaaS | sign-up, sign-in, JWT sessions |
| Supabase PostgreSQL | DBaaS | events and subscriptions, Row Level Security |
| Supabase Storage | Object storage | race banners |
| Supabase Edge Functions + pg_cron | FaaS | daily reminder job |
| Resend | E-mail API (SaaS) | delivers the reminders |

## Files

```
index.html                               page structure
src/main.js                              page logic: header, login, feed, publish/edit form, "Notify me"
src/supabase.js                          all Supabase calls (Auth, Database, Storage)
src/style.css                            styles
supabase/setup.sql                       tables, API grants, RLS rules and banner bucket (Grau A)
supabase/reminders.sql                   reminder query and daily schedule (Grau B)
supabase/functions/send-reminders/index.ts  Edge Function that e-mails the reminders
supabase/templates/reset-password.html   "Reset Password" e-mail template (Supabase Auth)
public/race-placeholder.svg               default image for races without a banner
.env.example                             template for the public keys
```

## Security in short

- Only the **publishable** key goes to the browser. The service role key and the Resend key live only in the Edge Function secrets.
- **Row Level Security**: anyone can read the feed; only the organizer who created a race can edit or delete it; each runner sees and manages only their own reminders.
- Banners can only be uploaded into a folder named with the user's own id.
- All traffic uses HTTPS (TLS). Supabase encrypts data at rest (AES-256).

## Run locally

Requires [Node.js](https://nodejs.org) 20 or newer.

1. Copy `.env.example` to `.env` and fill in the URL and the publishable key of the Supabase project (Project Settings > API Keys).
2. Run `npm install` and then `npm run dev`.
3. Open http://localhost:5173.

## Set up a new Supabase project

1. SQL Editor: run `supabase/setup.sql`.
2. Deploy the Edge Function (with the [Supabase CLI](https://supabase.com/docs/guides/cli)):
   `supabase functions deploy send-reminders --no-verify-jwt`
   The function sends only reminders that are due and marks each one, so calling it again sends nothing new.
3. Edge Functions > Secrets: add `RESEND_API_KEY` (from https://resend.com). Optional: `REMINDER_FROM`.
   Without a verified domain, Resend only delivers to the e-mail of the Resend account owner.
4. SQL Editor: run `supabase/reminders.sql` (change the project URL inside it first).
5. Authentication > URL Configuration: add the local and the Vercel URLs to **Redirect URLs** (used by the password reset link).
6. Authentication > Emails: set the Resend SMTP (host `smtp.resend.com`, port 465, user `resend`, password = Resend API key) and paste `supabase/templates/reset-password.html` into the **Reset Password** template.

## Deploy on Vercel

Import the repository on Vercel (preset **Vite**) and add the two variables of the `.env` file under **Environment Variables**, as type **Config** (they are public). Every push to `main` deploys again.
