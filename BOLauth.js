'use strict';

const SUPABASE_URL = "https://muifdxmbtrpbqglyuudx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_vD-_br5ry0EDmwkTgPVCHg_a9Bazjcv";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);
document.addEventListener("DOMContentLoaded", async () => {

  const { data, error } = await supabaseClient.auth.getUser();

  if (error || !data?.user) {
    window.location.href = "index.html";
    return;
  }

  const user = data.user;

  // Inject Email
  const emailEl = document.getElementById("userEmail");
  if (emailEl) {
    emailEl.textContent = user.email;
  }

  // Inject Name (from metadata)
  const nameEl = document.getElementById("userNameDisplay");
  if (nameEl) {
    const fullName = user.user_metadata?.full_name;
    nameEl.textContent = fullName ? `Hey, ${fullName}` : "Welcome";
  }

});


  // logout button logic bhi ideally yahin hona chahiye
  const logoutBtn = document.getElementById('logoutBtn');

  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await supabaseClient.auth.signOut();
      window.location.href = "index.html";
    });
  }
