(function () {
  const config = window.BIGWIZZ_SUPABASE_CONFIG;
  const supabaseApi = window.supabase;
  if (!config || !config.url || !config.publishableKey || !supabaseApi) return;

  const client = supabaseApi.createClient(config.url, config.publishableKey);
  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  let user = null;
  let profile = null;
  let savedListingIds = new Set();
  let remoteEditingId = null;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  function notify(message) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => toast.classList.remove("show"), 3500);
  }

  function report(error, message) {
    console.error(message, error);
    notify(message);
  }

  function initials(name) {
    return String(name || "Guest").trim().split(/\s+/).slice(0, 2)
      .map(part => part.charAt(0).toUpperCase()).join("") || "G";
  }

  function setProfileDisplay(name) {
    document.getElementById("profile-name").textContent = name || "Guest";
    document.getElementById("profile-avatar").textContent = initials(name);
    document.getElementById("account-switch-trigger").setAttribute(
      "aria-label",
      user ? `Switch account. Current account: ${activeAccount === "seller" ? "Seller" : "Buyer"}` : "Sign in"
    );
    if (!user) {
      document.getElementById("account-switch-menu").hidden = true;
      document.getElementById("account-switch-trigger").setAttribute("aria-expanded", "false");
    }
  }

  function showAuth() {
    document.getElementById("launch-screen").hidden = true;
    document.getElementById("marketplace-app").hidden = true;
    document.getElementById("auth-screen").hidden = false;
    document.getElementById("auth-title").focus({ preventScroll: true });
  }

  function showApp() {
    document.getElementById("auth-screen").hidden = true;
    document.getElementById("marketplace-app").hidden = false;
  }

  function activatePage(page) {
    if (page === "seller-listings" && (!user || !sellerProfileReady || activeAccount !== "seller")) {
      notify("Set up and switch to your Seller account to manage listings.");
      return;
    }
    if (page === "seller-progress" && (!user || activeAccount !== "seller")) {
      notify("Sign in and switch to your Seller account to continue.");
      return;
    }
    document.querySelectorAll(".page").forEach(section => {
      section.classList.toggle("active", section.id === page);
    });
    document.querySelectorAll("[data-page]").forEach(button => {
      button.classList.toggle("active", button.dataset.page === page);
    });
    if (page === "seller-studio") {
      document.getElementById("seller-onboarding").hidden = sellerProfileReady;
      document.getElementById("seller-dashboard").hidden = !sellerProfileReady;
    }
    if (page === "seller-listings") loadMyListings();
    if (page === "cart") loadCart();
    if (page === "messages") loadInbox();
    if (page === "notifications") loadNotifications();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateAccountState() {
    const roleButtons = document.querySelectorAll(".mobile-nav [data-audience]");
    roleButtons.forEach(button => {
      button.hidden = button.dataset.audience !== activeAccount;
    });
    renderAccountMenu();
    setProfileDisplay(profile ? profile.display_name : user ? user.email : "Guest");
  }

  async function loadCatalog() {
    const { data: rows, error } = await client
      .from("listings")
      .select("id,seller_id,kind,category,title,description,seller_name,price,image_url,rating,rating_count")
      .eq("status", "published")
      .order("created_at", { ascending: false });
    if (error) {
      report(error, "Marketplace listings could not be loaded from the database.");
      return;
    }

    listings = rows.filter(row => row.kind === "goods").map(row => ({
      id: row.id,
      title: row.title,
      category: row.category,
      kind: "Goods",
      price: row.price === null ? "Request an estimate" : currency.format(row.price),
      basePrice: row.price,
      image: row.image_url,
      seller: row.seller_name,
      rating: row.rating === null ? "" : Number(row.rating).toFixed(1),
      detail: row.description
    }));
    services = rows.filter(row => row.kind === "service").map(row => ({
      id: row.id,
      requestId: row.id,
      category: row.category,
      image: row.image_url,
      title: row.title,
      description: row.description,
      providerId: row.seller_id,
      sellerPrice: row.price,
      price: row.price === null ? "Request an estimate" : `From ${currency.format(row.price)} / service`,
      rating: row.rating === null ? "New listing" : Number(row.rating).toFixed(1),
      provider: row.seller_name
    }));

    const [eventsResult, postsResult] = await Promise.all([
      client.from("events").select("id,title,host,starts_at").order("starts_at"),
      client.from("community_posts").select("id,title,category,body,image_url,created_at")
        .eq("status", "published").order("created_at", { ascending: false })
    ]);
    if (eventsResult.error) report(eventsResult.error, "Events could not be loaded from the database.");
    else {
      events = eventsResult.data.map(item => {
        const date = new Date(item.starts_at);
        return {
          id: item.id,
          day: date.toLocaleDateString("en-US", { day: "2-digit" }),
          month: date.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
          title: item.title,
          host: item.host,
          time: date.toLocaleString("en-US", { weekday: "long", hour: "numeric", minute: "2-digit" })
        };
      });
    }
    if (postsResult.error) report(postsResult.error, "Community posts could not be loaded from the database.");
    else {
      conversations = postsResult.data.map(item => ({
        id: item.id,
        title: item.title,
        meta: item.category || "Community",
        copy: item.body,
        replies: "View discussion",
        image: item.image_url || "assets/home-repairs.jpg"
      }));
    }
    renderListings(document.getElementById("search-input").value);
    renderServices(document.getElementById("service-search-input").value);
    renderEvents();
    renderCommunity();
  }

  async function loadAccount() {
    if (!user) return;
    const [profileResult, rolesResult, sellerResult] = await Promise.all([
      client.from("profiles").select("display_name").eq("id", user.id).maybeSingle(),
      client.from("user_roles").select("role").eq("user_id", user.id),
      client.from("seller_profiles").select("shop_name,seller_type").eq("user_id", user.id).maybeSingle()
    ]);
    if (profileResult.error) throw profileResult.error;
    if (rolesResult.error) throw rolesResult.error;
    if (sellerResult.error) throw sellerResult.error;

    profile = profileResult.data || { display_name: user.email || "Member" };
    accountRoles = rolesResult.data.map(item => item.role);
    if (!accountRoles.includes("buyer")) accountRoles.unshift("buyer");
    sellerProfileReady = Boolean(sellerResult.data);
    if (sellerResult.data) {
      sellerShopName = sellerResult.data.shop_name;
      sellerType = sellerResult.data.seller_type;
      document.getElementById("seller-shop-title").textContent = sellerShopName;
      document.getElementById("seller-type-label").textContent =
        `${sellerType} · Manage listings, customer orders, and earnings.`;
    }
    if (!accountRoles.includes("seller") && sellerProfileReady) accountRoles.push("seller");
    if (!accountRoles.includes(activeAccount)) activeAccount = "buyer";
    updateAccountState();
    await loadSavedListings();
  }

  async function loadSavedListings() {
    if (!user) {
      savedListingIds = new Set();
      return;
    }
    const { data, error } = await client.from("saved_listings").select("listing_id").eq("user_id", user.id);
    if (error) {
      report(error, "Saved listings could not be loaded.");
      return;
    }
    savedListingIds = new Set(data.map(item => item.listing_id));
  }

  function updateSavedButtons() {
    document.querySelectorAll("[data-save]").forEach(button => {
      const saved = savedListingIds.has(button.dataset.save);
      button.classList.toggle("saved", saved);
      button.textContent = saved ? "♥" : "♡";
    });
  }

  async function loadMyListings() {
    if (!user || !sellerProfileReady) return;
    const { data, error } = await client.from("listings")
      .select("id,kind,category,title,description,price,image_url,status,seller_name")
      .eq("seller_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      report(error, "Your seller listings could not be loaded.");
      return;
    }
    const container = document.getElementById("seller-listing-items");
    if (!data.length) {
      container.innerHTML = '<div class="empty">You haven’t created any listings yet.</div>';
      return;
    }
    container.innerHTML = data.map(item => `<article class="seller-listing-item">
      <img src="${escapeHtml(item.image_url)}" alt="">
      <div class="seller-listing-info"><strong>${escapeHtml(item.title)}</strong>
        <small>${item.kind === "goods" ? "Goods" : "Service"} · ${escapeHtml(item.category)} · ${item.price === null ? "Request an estimate" : currency.format(item.price)} · ${item.status === "published" ? "Published" : "Paused"}</small>
      </div>
      <div class="seller-listing-actions">
        <button type="button" data-seller-listing-action="edit" data-listing-id="${item.id}">Edit</button>
        <button type="button" data-seller-listing-action="toggle" data-listing-id="${item.id}">${item.status === "published" ? "Pause" : "Publish"}</button>
        <button type="button" data-seller-listing-action="delete" data-listing-id="${item.id}">Delete</button>
      </div>
    </article>`).join("");
  }

  async function loadCart() {
    if (!user) {
      showAuth();
      return;
    }
    const { data, error } = await client.from("cart_items")
      .select("listing_id,quantity,listings(id,title,seller_name,image_url,price,kind)")
      .eq("user_id", user.id);
    if (error) {
      report(error, "Your shared cart could not be loaded.");
      return;
    }
    const items = data.filter(row => row.listings && row.listings.kind === "goods");
    cartItems = items.map(row => ({
      listingId: row.listing_id,
      title: row.listings.title,
      seller: row.listings.seller_name,
      image: row.listings.image_url,
      sellerPrice: Number(row.listings.price),
      quantity: row.quantity
    }));
    updateCartCount();
    const container = document.getElementById("cart-items");
    const summary = document.getElementById("cart-summary");
    if (!items.length) {
      container.innerHTML = '<div class="empty">Your cart is empty. Find something you like and add it here.<br><button class="text-button" type="button" data-page="discover">Explore goods →</button></div>';
      summary.hidden = true;
      return;
    }
    container.innerHTML = items.map(row => {
      const item = row.listings;
      const buyerPrice = Math.round((Number(item.price) * 1.02 + Number.EPSILON) * 100) / 100;
      return `<article class="cart-item">
        <img src="${escapeHtml(item.image_url)}" alt="">
        <div class="cart-item-info"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.seller_name)}</p>
          <strong>${currency.format(buyerPrice)} each</strong>
          <small>Includes ${currency.format(buyerPrice - Number(item.price))} Bigwizz fee</small>
        </div>
        <div class="cart-item-actions">
          <button type="button" aria-label="Decrease quantity of ${escapeHtml(item.title)}" data-cart-action="decrease" data-cart-id="${item.id}">−</button>
          <span>${row.quantity}</span>
          <button type="button" aria-label="Increase quantity of ${escapeHtml(item.title)}" data-cart-action="increase" data-cart-id="${item.id}">+</button>
          <button type="button" class="cart-remove" data-cart-action="remove" data-cart-id="${item.id}">Remove</button>
        </div>
      </article>`;
    }).join("");
    const subtotal = items.reduce((sum, row) => sum + Number(row.listings.price) * row.quantity, 0);
    const fee = Math.round((subtotal * 0.02 + Number.EPSILON) * 100) / 100;
    summary.hidden = false;
    summary.innerHTML = `<h3>Order summary</h3>
      <div class="cart-total-row"><span>Seller prices</span><strong>${currency.format(subtotal)}</strong></div>
      <div class="cart-total-row"><span>Bigwizz fee · 2%</span><strong>${currency.format(fee)}</strong></div>
      <div class="cart-total-row total"><span>Buyer total</span><strong>${currency.format(subtotal + fee)}</strong></div>
      <button class="primary" type="button" data-checkout-demo>Continue to checkout</button>
      <p class="notice">Checkout and payments aren't connected yet.</p>`;
  }

  async function changeCart(listingId, action) {
    if (!user) {
      showAuth();
      return;
    }
    const { data, error } = await client.from("cart_items").select("quantity")
      .eq("user_id", user.id).eq("listing_id", listingId).maybeSingle();
    if (error) throw error;
    if (action === "remove" || (action === "decrease" && data && data.quantity <= 1)) {
      const result = await client.from("cart_items").delete()
        .eq("user_id", user.id).eq("listing_id", listingId);
      if (result.error) throw result.error;
    } else {
      const quantity = action === "increase" ? (data ? data.quantity + 1 : 1) : data.quantity - 1;
      const result = await client.from("cart_items")
        .upsert({ user_id: user.id, listing_id: listingId, quantity }, { onConflict: "user_id,listing_id" });
      if (result.error) throw result.error;
    }
    await loadCart();
  }

  async function addCartItem(listingId) {
    if (!user) {
      showAuth();
      return;
    }
    const item = listings.find(row => row.id === listingId);
    if (!item || item.basePrice === null || item.basePrice === undefined) {
      notify("This item cannot be added to the cart.");
      return;
    }
    const cartResult = await client.from("carts").upsert({ user_id: user.id }, { onConflict: "user_id" });
    if (cartResult.error) throw cartResult.error;
    const current = await client.from("cart_items").select("quantity")
      .eq("user_id", user.id).eq("listing_id", listingId).maybeSingle();
    if (current.error) throw current.error;
    const result = await client.from("cart_items").upsert({
      user_id: user.id,
      listing_id: listingId,
      quantity: Math.min(99, (current.data ? current.data.quantity : 0) + 1)
    }, { onConflict: "user_id,listing_id" });
    if (result.error) throw result.error;
    await loadCart();
    notify("Added to your shared cart.");
  }

  async function saveListing(listingId) {
    if (!user) {
      showAuth();
      return;
    }
    if (savedListingIds.has(listingId)) {
      const { error } = await client.from("saved_listings").delete()
        .eq("user_id", user.id).eq("listing_id", listingId);
      if (error) throw error;
      savedListingIds.delete(listingId);
      notify("Removed from saved listings.");
    } else {
      const { error } = await client.from("saved_listings").insert({ user_id: user.id, listing_id: listingId });
      if (error) throw error;
      savedListingIds.add(listingId);
      notify("Saved to your account.");
    }
    updateSavedButtons();
  }

  async function saveSellerProfile(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!user) {
      showAuth();
      return;
    }
    const values = new FormData(event.currentTarget);
    const shopName = String(values.get("shopName") || "").trim();
    const sellerTypeValue = String(values.get("sellerType") || "");
    const { error } = await client.from("seller_profiles").upsert({
      user_id: user.id,
      shop_name: shopName,
      seller_type: sellerTypeValue
    }, { onConflict: "user_id" });
    if (error) {
      report(error, "Seller profile could not be saved.");
      return;
    }
    await loadAccount();
    event.currentTarget.reset();
    activeAccount = "seller";
    updateAccountState();
    activatePage("seller-studio");
    notify("Seller profile saved.");
  }

  async function uploadListingImage(file) {
    if (!file) return null;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      throw new Error("Use a JPG, PNG, or WebP image up to 5 MB.");
    }
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await client.storage.from("listing-images").upload(path, file, {
      contentType: file.type,
      upsert: false
    });
    if (error) throw error;
    return client.storage.from("listing-images").getPublicUrl(path).data.publicUrl;
  }

  async function saveListing(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!user || !sellerProfileReady) {
      showAuth();
      return;
    }
    const submit = document.getElementById("seller-listing-submit");
    submit.disabled = true;
    try {
      const values = new FormData(event.currentTarget);
      const title = String(values.get("title") || "").trim();
      const description = String(values.get("description") || "").trim();
      const kind = String(values.get("type") || "");
      const category = String(values.get("category") || "");
      const price = Number(values.get("price"));
      if (!title || !description || !Number.isFinite(price) || price <= 0) {
        throw new Error("Enter a title, description, and valid price.");
      }
      const { data: existing, error: existingError } = remoteEditingId
        ? await client.from("listings").select("id,status,image_url")
          .eq("id", remoteEditingId).eq("seller_id", user.id).single()
        : { data: null, error: null };
      if (existingError) throw existingError;
      const file = document.getElementById("seller-listing-image").files[0];
      const imageUrl = await uploadListingImage(file) || (existing && existing.image_url);
      if (!imageUrl) throw new Error("Upload a photo before publishing.");
      const row = {
        seller_id: user.id,
        kind,
        category,
        title,
        description,
        seller_name: sellerShopName,
        price: Math.round((price + Number.EPSILON) * 100) / 100,
        image_url: imageUrl,
        status: existing ? existing.status : "published"
      };
      const result = remoteEditingId
        ? await client.from("listings").update(row).eq("id", remoteEditingId).eq("seller_id", user.id)
        : await client.from("listings").insert(row);
      if (result.error) throw result.error;
      remoteEditingId = null;
      resetSellerListingForm();
      await Promise.all([loadMyListings(), loadCatalog()]);
      notify("Listing saved to the shared marketplace.");
    } catch (error) {
      report(error, error instanceof Error ? error.message : "Listing could not be saved.");
    } finally {
      submit.disabled = false;
    }
  }

  async function updateListing(action, listingId) {
    if (!user) {
      showAuth();
      return;
    }
    const row = await client.from("listings")
      .select("id,title,kind,category,description,price,image_url,status")
      .eq("id", listingId).eq("seller_id", user.id).single();
    if (row.error) throw row.error;
    if (action === "edit") {
      const item = row.data;
      remoteEditingId = item.id;
      document.getElementById("seller-listing-title").value = item.title;
      document.getElementById("seller-listing-type").value = item.kind;
      document.getElementById("seller-listing-type").dispatchEvent(new Event("change", { bubbles: true }));
      document.getElementById("seller-listing-category").value = item.category;
      document.getElementById("seller-listing-price").value = String(item.price);
      document.getElementById("seller-listing-description").value = item.description;
      document.getElementById("seller-listing-submit").textContent = "Save changes";
      document.getElementById("seller-listing-cancel").hidden = false;
      updateSellerListingPricePreview();
      document.getElementById("seller-listing-form").scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("seller-listing-title").focus();
      return;
    }
    if (action === "delete" && !window.confirm(`Delete “${row.data.title}”?`)) return;
    const result = action === "delete"
      ? await client.from("listings").delete().eq("id", listingId).eq("seller_id", user.id)
      : await client.from("listings").update({ status: row.data.status === "published" ? "paused" : "published" })
        .eq("id", listingId).eq("seller_id", user.id);
    if (result.error) throw result.error;
    await Promise.all([loadMyListings(), loadCatalog()]);
    notify(action === "delete" ? "Listing deleted." : "Listing status updated.");
  }

  async function submitServiceRequest(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!user) {
      showAuth();
      return;
    }
    const values = new FormData(event.currentTarget);
    const serviceTitle = String(values.get("service") || "");
    const listing = services.find(item => item.title === serviceTitle);
    const { error } = await client.from("service_requests").insert({
      buyer_id: user.id,
      listing_id: listing ? listing.id : null,
      provider_id: listing ? listing.providerId : null,
      service_title: serviceTitle,
      request_type: String(values.get("requestType")),
      preferred_date: String(values.get("preferredDate") || "") || null,
      area: String(values.get("area") || "").trim(),
      details: String(values.get("details") || "").trim()
    });
    if (error) {
      report(error, "Service request could not be saved.");
      return;
    }
    event.currentTarget.reset();
    document.getElementById("service-dialog").close();
    notify("Service request saved to your account.");
  }

  async function submitOrderReport(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!user) {
      showAuth();
      return;
    }
    const values = new FormData(event.currentTarget);
    const { error } = await client.from("order_reports").insert({
      buyer_id: user.id,
      order_reference: String(values.get("order") || "").trim(),
      issue_type: String(values.get("issue") || ""),
      notes: String(values.get("notes") || "").trim()
    });
    if (error) {
      report(error, "Order report could not be saved.");
      return;
    }
    event.currentTarget.reset();
    notify("Order report saved to the database. Support has not been contacted.");
  }

  async function loadInbox() {
    if (!user) {
      showAuth();
      return;
    }
    if (activeAccount !== "seller") return;
    const { data, error } = await client.from("service_requests")
      .select("service_title,request_type,area,details,preferred_date,created_at")
      .eq("provider_id", user.id).order("created_at", { ascending: false });
    if (error) {
      report(error, "Seller service requests could not be loaded.");
      return;
    }
    const requests = data.length ? `<div class="service-request-list">${data.map(item =>
      `<article class="service-request-card"><div><h4>${escapeHtml(item.service_title)} · ${escapeHtml(item.request_type)}</h4><p>${escapeHtml(item.details)}</p><small>${escapeHtml(item.area)}${item.preferred_date ? ` · Preferred date: ${escapeHtml(item.preferred_date)}` : ""} · ${new Date(item.created_at).toLocaleString()}</small></div></article>`
    ).join("")}</div>` : '<p class="notice">No service requests yet.</p>';
    document.getElementById("inbox").innerHTML =
      `<section class="service-request-section"><h3>Service requests</h3>${requests}</section><p class="notice">Messaging is not connected yet.</p>`;
    document.querySelector("#messages .section-head h2").textContent = "Seller inbox";
  }

  async function loadNotifications() {
    if (!user) {
      showAuth();
      return;
    }
    const { data, error } = await client.from("notifications").select("title,body,kind,created_at")
      .eq("user_id", user.id).order("created_at", { ascending: false });
    if (error) {
      report(error, "Notifications could not be loaded.");
      return;
    }
    document.getElementById("notification-list").innerHTML = data.length
      ? data.map(item => `<article class="notification-card"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p><small>${new Date(item.created_at).toLocaleString()}</small></div></article>`).join("")
      : '<div class="empty">No notifications yet.</div>';
  }

  async function handleSession(nextUser) {
    user = nextUser || null;
    if (!user) {
      profile = null;
      accountRoles = ["buyer"];
      activeAccount = "buyer";
      sellerProfileReady = false;
      setProfileDisplay("Guest");
      updateMobileNavigation();
      return;
    }
    try {
      await loadAccount();
      showApp();
      if (!document.querySelector(".page.active")) setPage("discover");
      await loadCatalog();
      if (activeAccount === "seller" && sellerProfileReady) loadMyListings();
      notify("Signed in. Your account data is shared across devices.");
    } catch (error) {
      report(error, "Account details could not be loaded.");
    }
  }

  function useDatabaseAuth() {
    const form = document.getElementById("auth-form");
    form.addEventListener("submit", async event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const values = new FormData(form);
      const email = String(values.get("email") || "").trim();
      const signingUp = authMode === "signup";
      const name = String(values.get("name") || email.split("@")[0] || "Member").trim();
      const accountType = String(values.get("accountType") || "buyer");
      const note = document.getElementById("auth-note");
      note.textContent = "Sending a sign-in link…";
      const { error } = await client.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: signingUp,
          emailRedirectTo: new URL(window.location.pathname, window.location.origin).href,
          data: { display_name: name, account_type: accountType }
        }
      });
      if (error) {
        report(error, "Could not send the sign-in link. Check the email and try again.");
        note.textContent = "Sign-in link could not be sent.";
        return;
      }
      note.textContent = "Check your email and open the Bigwizz sign-in link on this device.";
      notify("Sign-in link sent.");
    }, true);
  }

  function stop(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  document.addEventListener("submit", event => {
    if (event.target.id === "seller-setup-form") return saveSellerProfile(event);
    if (event.target.id === "seller-listing-form") return saveListing(event);
    if (event.target.id === "service-request-form") return submitServiceRequest(event);
    if (event.target.id === "issue-form") return submitOrderReport(event);
    if (event.target.id === "search-form") {
      stop(event);
      renderListings(document.getElementById("search-input").value);
      return;
    }
    if (event.target.id === "service-search-form") {
      stop(event);
      renderServices(document.getElementById("service-search-input").value);
    }
  }, true);

  document.addEventListener("click", event => {
    if (event.target.closest("#seller-listing-cancel")) {
      remoteEditingId = null;
      return;
    }
    const signOut = event.target.closest("[data-supabase-signout]");
    if (signOut) {
      stop(event);
      client.auth.signOut().then(({ error }) => {
        if (error) report(error, "Could not sign out.");
        else {
          showApp();
          notify("Signed out.");
        }
      });
      return;
    }
    const accountToggle = event.target.closest("[data-account-menu-toggle]");
    if (accountToggle && !user) {
      stop(event);
      showAuth();
      return;
    }
    const accountChoice = event.target.closest("[data-account-option]");
    if (accountChoice) {
      if (!user) {
        stop(event);
        showAuth();
        return;
      }
      if (accountChoice.dataset.accountOption === "seller" && !sellerProfileReady) return;
      stop(event);
      activeAccount = accountChoice.dataset.accountOption;
      updateAccountState();
      activatePage(activeAccount === "seller" ? "seller-studio" : "discover");
      return;
    }
    const category = event.target.closest("[data-category]");
    if (category) {
      activeCategory = category.dataset.category;
      document.querySelectorAll(".category").forEach(button => button.classList.toggle("selected", button === category));
      stop(event);
      renderListings(document.getElementById("search-input").value);
      return;
    }
    const serviceCategory = event.target.closest("[data-service-category]");
    if (serviceCategory) {
      activeServiceCategory = serviceCategory.dataset.serviceCategory;
      document.querySelectorAll("[data-service-category]").forEach(button => button.classList.toggle("active", button === serviceCategory));
      stop(event);
      renderServices(document.getElementById("service-search-input").value);
      return;
    }
    if (event.target.closest("#clear-filter")) {
      stop(event);
      activeCategory = "All";
      document.getElementById("search-input").value = "";
      document.querySelectorAll(".category").forEach(button => button.classList.toggle("selected", button.dataset.category === "All"));
      renderListings();
      return;
    }
    const addButton = event.target.closest("[data-add-to-cart]");
    if (addButton) {
      stop(event);
      addCartItem(addButton.dataset.addToCart).catch(error => report(error, "Could not add that item to your shared cart."));
      return;
    }
    const saveButton = event.target.closest("[data-save]");
    if (saveButton) {
      stop(event);
      saveListing(saveButton.dataset.save).catch(error => report(error, "Could not update your saved listings."));
      return;
    }
    const cartAction = event.target.closest("[data-cart-action]");
    if (cartAction) {
      stop(event);
      changeCart(cartAction.dataset.cartId, cartAction.dataset.cartAction)
        .catch(error => report(error, "Could not update your shared cart."));
      return;
    }
    const listingAction = event.target.closest("[data-seller-listing-action]");
    if (listingAction) {
      stop(event);
      updateListing(listingAction.dataset.sellerListingAction, listingAction.dataset.listingId)
        .catch(error => report(error, "Could not update that listing."));
      return;
    }
    const eventRsvp = event.target.closest("[data-rsvp]");
    if (eventRsvp) {
      stop(event);
      if (!user) {
        showAuth();
        return;
      }
      client.from("event_rsvps")
        .upsert({ event_id: eventRsvp.dataset.rsvp, user_id: user.id }, { onConflict: "event_id,user_id" })
        .then(({ error }) => {
          if (error) report(error, "Event RSVP could not be saved.");
          else {
            eventRsvp.textContent = "Interested ✓";
            eventRsvp.disabled = true;
            notify("Your RSVP is saved.");
          }
        });
      return;
    }
    const pageButton = event.target.closest("[data-page]");
    if (pageButton && ["seller-studio", "seller-listings", "seller-progress", "cart", "messages", "notifications"].includes(pageButton.dataset.page)) {
      if (!user) {
        stop(event);
        showAuth();
        return;
      }
      if (pageButton.dataset.page === "seller-studio" || pageButton.dataset.page === "seller-listings" || pageButton.dataset.page === "seller-progress") {
        stop(event);
        activatePage(pageButton.dataset.page);
        return;
      }
      window.setTimeout(() => {
        if (pageButton.dataset.page === "cart") loadCart();
        if (pageButton.dataset.page === "messages") loadInbox();
        if (pageButton.dataset.page === "notifications") loadNotifications();
      }, 0);
    }
  }, true);

  const accountMenu = document.getElementById("account-switch-menu");
  accountMenu.insertAdjacentHTML("beforeend",
    '<button type="button" data-supabase-signout><span class="account-option-icon">↪</span><span><b>Sign out</b><small>End this session</small></span></button>');
  setProfileDisplay("Guest");
  useDatabaseAuth();
  loadCatalog();

  client.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => handleSession(session && session.user), 0);
  });
  client.auth.getSession().then(({ data, error }) => {
    if (error) report(error, "Could not check the current sign-in session.");
    else handleSession(data.session && data.session.user);
  });
})();
