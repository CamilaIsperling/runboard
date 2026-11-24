// RunBoard - every call to Supabase (Auth, Database and Storage).
// The browser uses only the public "publishable" key; what each user may
// read or change is enforced by Row Level Security in the database.
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  alert("Supabase keys are missing. Create the .env file (see README).");
}

// A trailing "/" in the URL breaks the requests
export const supabase = createClient(url?.replace(/\/+$/, ""), key);

// Creates a new account. Returns true when Supabase asks the user to
// confirm the e-mail first (no session yet).
export async function signUp(email, password) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: window.location.origin },
  });
  if (error) throw error;
  // With e-mail confirmation on, an existing e-mail comes back without identities
  if (data.user?.identities?.length === 0) throw new Error("User already registered");
  return !data.session;
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

// Sends the "reset your password" e-mail. The link brings the user back to
// this page, where Supabase fires the PASSWORD_RECOVERY event (see main.js).
export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  if (error) throw error;
}

// Saves the new password of the user who opened the reset link
export async function updatePassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

// Upcoming races, optionally filtered by city (partial match) and distance
export async function listEvents(city, distance) {
  let query = supabase
    .from("events")
    .select("*")
    .gte("start_at", new Date().toISOString())
    .order("start_at");

  if (city) query = query.ilike("city", `%${city}%`);
  if (distance) query = query.contains("distances_km", [distance]);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// organizer_id is set by the database (auth.uid())
export async function createEvent(event) {
  const { error } = await supabase.from("events").insert(event);
  if (error) throw error;
}

// RLS only allows the owner
export async function updateEvent(id, changes) {
  const { error } = await supabase.from("events").update(changes).eq("id", id);
  if (error) throw error;
}

// RLS only allows the owner
export async function deleteEvent(id) {
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) throw error;
}

// --- Race reminders (Grau B) ---------------------------------------------
// A subscription links the logged-in runner to a race. RLS only lets each
// runner read, create and delete their own rows (auth.uid() = user_id).

// Returns the ids of the races the runner asked to be reminded about
export async function listMySubscriptions() {
  const { data, error } = await supabase.from("reminder_subscriptions").select("event_id");
  if (error) throw error;
  return new Set(data.map((row) => row.event_id));
}

// user_id is set by the database (default auth.uid())
export async function subscribe(eventId) {
  const { error } = await supabase.from("reminder_subscriptions").insert({ event_id: eventId });
  if (error) throw error;
}

export async function unsubscribe(eventId) {
  const { error } = await supabase.from("reminder_subscriptions").delete().eq("event_id", eventId);
  if (error) throw error;
}

// The storage policy only accepts uploads into the user's own folder
export async function uploadBanner(file, userId) {
  const path = `${userId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
  const { error } = await supabase.storage.from("banners").upload(path, file);
  if (error) throw error;
  return supabase.storage.from("banners").getPublicUrl(path).data.publicUrl;
}
