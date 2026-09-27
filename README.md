# RunBoard

Web platform for street running events: runners find races and never miss the kit pickup; organizers publish each race once.

UNISINOS case study, Trending Information Technologies, Group D: Camila Isperling Machado, Felipe Alles Garcia, Julia Stelzer and Rodrigo Ritzel Bernasconi.

## Files

```
index.html          page structure
src/main.js         page logic (header, login, publish form, feed)
src/supabase.js     all Supabase calls (Auth, Database, Storage)
src/style.css       styles
supabase/setup.sql  database tables, rules and banner bucket
.env.example        template for the keys
```

## Run locally

Requires [Node.js](https://nodejs.org).

1. Copy `.env.example` to `.env` and fill in the URL and the publishable key of the Supabase project.
2. Run `npm install` and then `npm run dev`.
3. Open http://localhost:5173.

## Deploy on Vercel

Import the repository on Vercel (preset **Vite**) and add the two variables of the `.env` file under **Environment Variables**.
