import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  alert("Supabase keys are missing. Create the .env file (see README).");
}

// A trailing "/" in the URL breaks the requests
export const supabase = createClient(url?.replace(/\/+$/, ""), key);

export async function signUp(email, password) {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
}

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}

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

// The storage policy only accepts uploads into the user's own folder
export async function uploadBanner(file, userId) {
  const path = `${userId}/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
  const { error } = await supabase.storage.from("banners").upload(path, file);
  if (error) throw error;
  return supabase.storage.from("banners").getPublicUrl(path).data.publicUrl;
}
