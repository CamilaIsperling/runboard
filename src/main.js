import "./style.css";
import { supabase, signIn, signUp, signOut, listEvents, createEvent, updateEvent, deleteEvent, uploadBanner } from "./supabase.js";

let user = null;
let events = [];
let editingId = null; // null = publishing a new race

const $ = (id) => document.getElementById(id);

function renderAccount() {
  $("account").innerHTML = user
    ? `<button class="btn" id="publish-btn">+ Publish race</button>
       <span class="avatar" title="${user.email}">${user.email[0].toUpperCase()}</span>
       <button class="btn btn--light" id="logout-btn">Sign out</button>`
    : `<button class="btn btn--light" id="login-btn">Organizer sign in</button>`;

  if (user) {
    $("publish-btn").onclick = () => openEventForm(null);
    $("logout-btn").onclick = signOut;
  } else {
    $("login-btn").onclick = () => $("login-dialog").showModal();
  }
}

// Prevents HTML injection from text typed by organizers
const safe = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

async function loadFeed() {
  const form = $("search");
  try {
    events = await listEvents(form.city.value.trim(), Number(form.distance.value) || null);
    $("feed-count").textContent = `${events.length} ${events.length === 1 ? "race" : "races"}`;
    $("feed").innerHTML = events.length ? events.map(cardHtml).join("") : `<p class="empty">No races found. Try another city or distance.</p>`;
  } catch (err) {
    $("feed").innerHTML = `<p class="empty">Could not load races: ${safe(err.message)}</p>`;
  }
}

const icon = (path) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const ICON_PIN = icon('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>');
const ICON_EDIT = icon('<path d="M4 20h4L19 9l-4-4L4 16v4z"/>');
const ICON_TRASH = icon('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>');

const money = (value) => Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function cardHtml(ev) {
  const date = new Date(ev.start_at);
  const day = date.toLocaleDateString("en-GB", { day: "2-digit" });
  const month = date.toLocaleDateString("en-GB", { month: "short" }).toUpperCase();
  const weekday = date.toLocaleDateString("en-GB", { weekday: "short" });
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const isOwner = user && user.id === ev.organizer_id;

  return `
    <article class="card">
      <div class="card__img">
        ${ev.banner_url ? `<img src="${safe(ev.banner_url)}" alt="" loading="lazy">` : ""}
        <span class="date"><b>${day}</b>${month}</span>
        ${isOwner ? `<div class="card__owner">
          <button class="icon-btn icon-btn--glass" data-edit="${ev.id}" title="Edit">${ICON_EDIT}</button>
          <button class="icon-btn icon-btn--glass" data-delete="${ev.id}" title="Delete">${ICON_TRASH}</button>
        </div>` : ""}
      </div>
      <div class="card__body">
        <p class="card__meta">${weekday} · ${time} · ${safe(ev.city)}</p>
        <h3>${safe(ev.name)}</h3>
        ${ev.location ? `<p class="card__line">${ICON_PIN} ${safe(ev.location)}</p>` : ""}
        <div class="tags">${(ev.distances_km || []).map((km) => `<span class="tag">${km}K</span>`).join("")}</div>
        ${ev.kit_pickup_info ? `<div class="kit"><b>Kit pickup</b>${safe(ev.kit_pickup_info)}</div>` : ""}
      </div>
      <div class="card__footer">
        <b>${ev.entry_fee == null ? "" : Number(ev.entry_fee) === 0 ? "Free" : money(ev.entry_fee)}</b>
        ${ev.official_url ? `<a class="btn btn--soft btn--small" href="${safe(ev.official_url)}" target="_blank" rel="noopener">Official site ↗</a>` : ""}
      </div>
    </article>`;
}

// RLS also blocks non-owners, even if the buttons were shown
$("feed").addEventListener("click", async (e) => {
  const { edit, delete: id } = e.target.closest("button")?.dataset ?? {};
  if (edit) {
    openEventForm(events.find((ev) => ev.id === Number(edit)));
    return;
  }
  if (!id || !confirm("Delete this race?")) return;
  try {
    await deleteEvent(id);
    loadFeed();
  } catch (err) {
    alert(err.message);
  }
});

$("search").addEventListener("submit", (e) => {
  e.preventDefault();
  loadFeed();
});
$("search").addEventListener("change", (e) => e.target.name === "distance" && loadFeed());

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const action = e.submitter.value;
  $("login-error").textContent = "";
  try {
    if (action === "signup") await signUp(form.email.value, form.password.value);
    else await signIn(form.email.value, form.password.value);
    form.reset();
    $("login-dialog").close();
  } catch (err) {
    $("login-error").textContent = err.message;
  }
});

function openEventForm(ev) {
  const form = $("event-form");
  form.reset();
  editingId = ev ? ev.id : null;
  $("event-title").textContent = ev ? "Edit race" : "Publish a race";
  $("event-submit").textContent = ev ? "Save changes" : "Publish race";
  showBanner(ev?.banner_url);

  if (ev) {
    // datetime-local expects local time
    const d = new Date(ev.start_at);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());

    form.elements.name.value = ev.name;
    form.city.value = ev.city;
    form.start_at.value = d.toISOString().slice(0, 16);
    form.location.value = ev.location ?? "";
    form.distances.value = (ev.distances_km || []).join(", ");
    form.kit_pickup_info.value = ev.kit_pickup_info ?? "";
    form.entry_fee.value = ev.entry_fee ?? "";
    form.official_url.value = ev.official_url ?? "";
  }
  $("event-dialog").showModal();
}

function showBanner(src) {
  $("banner-preview").hidden = !src;
  $("banner-hint").hidden = !!src;
  if (src) $("banner-preview").src = src;
}

$("event-form").banner.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) showBanner(URL.createObjectURL(file));
});

$("event-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const button = e.submitter;
  button.disabled = true;
  $("event-error").textContent = "";

  try {
    const race = {
      name: form.elements.name.value, // form.name would be the form's own name
      city: form.city.value,
      start_at: new Date(form.start_at.value).toISOString(),
      location: form.location.value || null,
      distances_km: form.distances.value.split(",").map(Number).filter((n) => n > 0),
      kit_pickup_info: form.kit_pickup_info.value || null,
      entry_fee: form.entry_fee.value ? Number(form.entry_fee.value) : null,
      official_url: form.official_url.value || null,
    };

    // Without a new file, the current banner is kept
    const file = form.banner.files[0];
    if (file) race.banner_url = await uploadBanner(file, user.id);

    if (editingId) await updateEvent(editingId, race);
    else await createEvent(race);

    form.reset();
    $("event-dialog").close();
    loadFeed();
  } catch (err) {
    $("event-error").textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelectorAll("[data-close]").forEach((btn) => (btn.onclick = () => btn.closest("dialog").close()));

// Fires on page load and on every sign-in / sign-out
supabase.auth.onAuthStateChange((_event, session) => {
  user = session?.user ?? null;
  renderAccount();
  loadFeed();
});
