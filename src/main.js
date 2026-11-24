// RunBoard - page logic.
// Renders the header and the race feed, and handles sign-in, the
// publish/edit form and the "Notify me" reminders. Every call to the
// cloud goes through src/supabase.js.
import "./style.css";
import {
  supabase, signIn, signUp, signOut, sendPasswordReset, updatePassword,
  listEvents, createEvent, updateEvent, deleteEvent, uploadBanner,
  listMySubscriptions, subscribe, unsubscribe,
} from "./supabase.js";

let user = null;
let events = [];
let subscribed = new Set(); // ids of the races with a reminder on
let editingId = null; // null = publishing a new race

const $ = (id) => document.getElementById(id);

function renderAccount() {
  $("account").innerHTML = user
    ? `<button class="btn" id="publish-btn">+ Publish race</button>
       <span class="avatar" title="${user.email}">${user.email[0].toUpperCase()}</span>
       <button class="btn btn--light" id="logout-btn">Sign out</button>`
    : `<button class="btn btn--light" id="login-btn">Sign in</button>`;

  if (user) {
    $("publish-btn").onclick = () => openEventForm(null);
    $("logout-btn").onclick = signOut;
  } else {
    $("login-btn").onclick = () => openLogin("signin");
  }
}

// Prevents HTML injection from text typed by organizers
const safe = (text) => String(text ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// Reads the filters, loads the races and draws one card per race
async function loadFeed() {
  const form = $("search");
  try {
    // The feed is public; subscriptions are only loaded for a logged-in runner
    [events, subscribed] = await Promise.all([
      listEvents(form.city.value.trim(), Number(form.distance.value) || null),
      user ? listMySubscriptions() : new Set(),
    ]);
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
const ICON_BELL = icon('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>');
const ICON_TRASH = icon('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>');

// Shown on races without a banner (file in /public)
const PLACEHOLDER = "/race-placeholder.svg";

const money = (value) => Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// HTML of one race card; owners also get the edit and delete buttons
function cardHtml(ev) {
  const date = new Date(ev.start_at);
  const day = date.toLocaleDateString("en-GB", { day: "2-digit" });
  const month = date.toLocaleDateString("en-GB", { month: "short" }).toUpperCase();
  const weekday = date.toLocaleDateString("en-GB", { weekday: "short" });
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const isOwner = user && user.id === ev.organizer_id;
  const hasReminder = subscribed.has(ev.id);

  return `
    <article class="card">
      <div class="card__img">
        <img src="${ev.banner_url ? safe(ev.banner_url) : PLACEHOLDER}" alt="" loading="lazy">
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
        <div class="card__actions">
          <button class="btn btn--small ${hasReminder ? "btn--on" : "btn--soft"}" data-notify="${ev.id}"
            title="${hasReminder ? "Click to cancel the reminder" : "Get an e-mail the day before the race"}">
            ${ICON_BELL} ${hasReminder ? "Reminder on" : "Notify me"}
          </button>
          ${ev.official_url ? `<a class="btn btn--soft btn--small" href="${safe(ev.official_url)}" target="_blank" rel="noopener">Official site ↗</a>` : ""}
        </div>
      </div>
    </article>`;
}

// One listener handles the buttons of every card (event delegation).
// RLS also blocks non-owners, even if the buttons were shown.
$("feed").addEventListener("click", async (e) => {
  const { edit, delete: id, notify } = e.target.closest("button")?.dataset ?? {};
  if (notify) {
    toggleReminder(Number(notify));
    return;
  }
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

// "Notify me": a visitor must sign in first; a runner turns the reminder on or off
async function toggleReminder(eventId) {
  if (!user) {
    openLogin("signin");
    return;
  }
  try {
    if (subscribed.has(eventId)) await unsubscribe(eventId);
    else await subscribe(eventId);
    loadFeed();
  } catch (err) {
    alert(err.message);
  }
}

$("search").addEventListener("submit", (e) => {
  e.preventDefault();
  loadFeed();
});
$("search").addEventListener("change", (e) => e.target.name === "distance" && loadFeed());

// --- Sign in, create account and forgot password ------------------------
// The same dialog changes its texts and fields for each mode.
const LOGIN_MODES = {
  signin: {
    title: "Sign in to RunBoard",
    subtitle: "Runners get race reminders. Organizers publish and manage their races.",
    submit: "Sign in",
    switchText: "New to RunBoard?",
    switchTo: ["signup", "Create an account"],
  },
  signup: {
    title: "Create your account",
    subtitle: "Use your e-mail and choose a password with at least 6 characters.",
    submit: "Create account",
    switchText: "Already have an account?",
    switchTo: ["signin", "Sign in"],
  },
  forgot: {
    title: "Reset your password",
    subtitle: "Type your e-mail and we will send you a link to choose a new password.",
    submit: "Send reset link",
    switchText: "Remembered it?",
    switchTo: ["signin", "Back to sign in"],
  },
};
let loginMode = "signin";

function setLoginMode(mode) {
  const m = LOGIN_MODES[mode];
  const form = $("login-form");
  loginMode = mode;

  $("login-title").textContent = m.title;
  $("login-subtitle").textContent = m.subtitle;
  $("login-submit").textContent = m.submit;
  $("login-switch").innerHTML = `${m.switchText} <button class="link" type="button" data-mode="${m.switchTo[0]}">${m.switchTo[1]}</button>`;
  $("login-error").textContent = "";
  $("login-notice").textContent = "";

  // Hidden fields are also disabled, so the browser does not validate them
  const showPassword = mode !== "forgot";
  const showConfirm = mode === "signup";
  $("password-field").hidden = !showPassword;
  form.password.disabled = !showPassword;
  form.password.autocomplete = mode === "signup" ? "new-password" : "current-password";
  $("confirm-field").hidden = !showConfirm;
  form.confirm.disabled = !showConfirm;
  $("forgot-link").hidden = mode !== "signin";
}

function openLogin(mode) {
  $("login-form").reset();
  setLoginMode(mode);
  $("login-dialog").showModal();
}

// "Create an account", "Sign in", "Forgot your password?" links
$("login-form").addEventListener("click", (e) => {
  const mode = e.target.closest("[data-mode]")?.dataset.mode;
  if (mode) setLoginMode(mode);
});

// Turns Supabase error messages into clear texts for the user
function friendlyError(err) {
  const msg = err.message || "";
  if (/invalid login credentials/i.test(msg)) return "Wrong e-mail or password.";
  if (/already registered/i.test(msg)) return "This e-mail already has an account. Sign in or reset your password.";
  if (/not confirmed/i.test(msg)) return "Please confirm your e-mail first. Check your inbox.";
  if (/rate limit|security purposes/i.test(msg)) return "Too many attempts. Please wait a minute and try again.";
  if (/sending .*email/i.test(msg)) return "We could not send the e-mail right now. Please try again later.";
  return msg;
}

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const button = $("login-submit");
  const email = form.email.value.trim();
  $("login-error").textContent = "";
  $("login-notice").textContent = "";

  if (loginMode === "signup" && form.password.value !== form.confirm.value) {
    $("login-error").textContent = "The passwords do not match.";
    return;
  }

  button.disabled = true;
  try {
    if (loginMode === "signin") {
      await signIn(email, form.password.value);
      $("login-dialog").close();
    } else if (loginMode === "signup") {
      const mustConfirm = await signUp(email, form.password.value);
      if (mustConfirm) {
        setLoginMode("signin");
        form.email.value = email;
        $("login-notice").textContent = "Account created! Confirm your e-mail through the link we sent, then sign in.";
      } else {
        $("login-dialog").close();
      }
    } else {
      await sendPasswordReset(email);
      // Same answer for any e-mail, so the page does not reveal who has an account
      $("login-notice").textContent = "If this e-mail has an account, a reset link is on its way. Check your inbox.";
    }
  } catch (err) {
    $("login-error").textContent = friendlyError(err);
  } finally {
    button.disabled = false;
  }
});

// The reset link signs the user in and opens this dialog for the new password
$("password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  $("password-error").textContent = "";
  if (form.password.value !== form.confirm.value) {
    $("password-error").textContent = "The passwords do not match.";
    return;
  }
  try {
    await updatePassword(form.password.value);
    form.reset();
    $("password-dialog").close();
    alert("Your password was changed.");
  } catch (err) {
    $("password-error").textContent = friendlyError(err);
  }
});

// Opens the form empty (new race) or filled with an existing race (edit)
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

// Fires on page load, on every sign-in / sign-out and when the user
// arrives through a password reset link (PASSWORD_RECOVERY)
supabase.auth.onAuthStateChange((event, session) => {
  user = session?.user ?? null;
  if (event === "PASSWORD_RECOVERY") $("password-dialog").showModal();
  renderAccount();
  loadFeed();
});
