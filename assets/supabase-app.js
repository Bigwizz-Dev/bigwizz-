(function () {
  const config = window.BIGWIZZ_SUPABASE_CONFIG;
  const supabaseApi = window.supabase;
  if (!config || !config.url || !config.publishableKey || !supabaseApi) return;

  const client = supabaseApi.createClient(config.url, config.publishableKey);
  // The Seller workspace owns its pages and navigation, outside the Buyer shell.
  const sellerWorkspace = document.getElementById("seller-workspace");
  const sellerWorkspaceMain = document.getElementById("seller-workspace-main");
  ["seller-studio", "seller-listings", "seller-progress", "messages"].forEach(id => {
    const page = document.getElementById(id);
    if (page && sellerWorkspaceMain) sellerWorkspaceMain.appendChild(page);
  });

  const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  let user = null;
  let profile = null;
  let sellerAvailabilityStatus = "available";
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
    document.getElementById("profile-name").textContent = user ? name || "Guest" : "Switch account";
    document.getElementById("profile-avatar").textContent = initials(name);
    document.getElementById("account-switch-trigger").setAttribute(
      "aria-label",
      user ? `Switch account. Current account: ${activeAccount === "seller" ? "Seller" : "Buyer"}` : "Switch account"
    );
    const authOpen = document.querySelector("[data-auth-open]");
    if (authOpen) {
      // Keep the Buyer sign-in entry visible while the Seller workspace is active.
      authOpen.hidden = Boolean(user) && activeAccount !== "seller";
      authOpen.setAttribute("aria-label", activeAccount === "seller" ? "Buyer sign in" : "Sign in");
      authOpen.title = activeAccount === "seller" ? "Buyer sign in" : "Sign in";
    }
    const signOut = document.querySelector("[data-supabase-signout]");
    if (signOut) signOut.hidden = !user;
    if (!user) {
      document.getElementById("account-switch-menu").hidden = true;
      document.getElementById("account-switch-trigger").setAttribute("aria-expanded", "false");
    }
  }

  let authMode = "signin";
  let authAudience = "buyer";
  let sellerAuthVerified = false;

  function setAuthMode(mode) {
    authMode = mode;
    const nameField = document.getElementById("auth-name-field");
    const roleField = document.getElementById("auth-role-field");
    const passwordField = document.getElementById("auth-password-field");
    const password = document.getElementById("auth-password");
    const name = document.getElementById("auth-name");
    const title = document.getElementById("auth-title");
    const summary = document.getElementById("auth-summary");
    const submit = document.getElementById("auth-submit");
    const feedback = document.getElementById("auth-feedback");
    const signupLink = document.querySelector('[data-auth-mode="signup"]');
    const resetLink = document.querySelector('[data-auth-mode="reset"]');
    const backLink = document.querySelector('[data-auth-mode="signin"]');
    feedback.hidden = true;
    feedback.textContent = "";
    nameField.hidden = mode !== "signup";
    roleField.hidden = mode !== "signup";
    name.required = mode === "signup";
    passwordField.hidden = mode === "reset";
    password.required = mode !== "reset";
    password.autocomplete = mode === "signup" ? "new-password" : "current-password";
    signupLink.hidden = mode !== "signin";
    resetLink.hidden = mode !== "signin";
    backLink.hidden = mode === "signin";
    if (mode === "signup") {
      title.textContent = authAudience === "seller" ? "Create your Seller account" : "Create your Buyer account";
      summary.textContent = authAudience === "seller" ? "Create your seller sign-in to continue to Seller Studio." : "Create your buyer sign-in to shop on Bigwizz.";
      submit.textContent = "Create account";
    } else if (mode === "reset") {
      title.textContent = authAudience === "seller" ? "Reset Seller password" : "Reset Buyer password";
      summary.textContent = "We will email you a password reset link.";
      submit.textContent = "Send reset link";
    } else {
      title.textContent = authAudience === "seller" ? "Sign in to Seller Studio" : "Sign in to your Buyer account";
      summary.textContent = authAudience === "seller" ? "Use your email and password to open your separate Seller sign-in journey. You can use the same email as your Buyer account." : "Sign in to continue to your Buyer account.";
      submit.textContent = "Sign in";
    }
  }

  function showAuth(mode = "signin", audience = "buyer") {
    authAudience = audience;
    const dialog = document.getElementById("auth-dialog");
    if (!dialog) {
      notify("The sign-in window could not be opened.");
      return;
    }
    setAuthMode(mode);
    if (authAudience === "seller" && mode === "signup") document.getElementById("auth-role").value = "seller";
    if (!dialog.open) dialog.showModal();
  }

  function showAuthFeedback(message, isError = false) {
    const feedback = document.getElementById("auth-feedback");
    feedback.textContent = message;
    feedback.hidden = false;
    feedback.style.background = isError ? "#fff0ef" : "#edf4e9";
    feedback.style.color = isError ? "#8b3028" : "#245c45";
  }

  function showApp() {
    document.getElementById("marketplace-app").hidden = false;
  }

  function activatePage(page) {
    const sellerPages = ["seller-studio", "seller-listings", "seller-progress", "messages"];
    const isSellerPage = sellerPages.includes(page);
    if (isSellerPage && page !== "seller-studio" && (!user || activeAccount !== "seller" || !sellerAuthVerified)) {
      notify("Sign in to your Seller account to open the Seller Dashboard.");
      return;
    }
    if (page === "seller-listings" && !sellerProfileReady) {
      page = "seller-studio";
      notify("Complete your shop profile before managing listings.");
    }
    if (sellerWorkspace) {
      sellerWorkspace.hidden = !isSellerPage;
      const buyerShell = document.querySelector("#marketplace-app > .shell");
      if (buyerShell) buyerShell.hidden = isSellerPage;
      const buyerNav = document.querySelector("#marketplace-app > .mobile-nav");
      if (buyerNav) buyerNav.hidden = isSellerPage;
    }
    document.querySelectorAll(".page").forEach(section => {
      section.classList.toggle("active", section.id === page);
    });
    document.querySelectorAll("[data-page]").forEach(button => {
      button.classList.toggle("active", button.dataset.page === page);
    });
    if (page === "seller-studio") {
      const sellerCanOpenDashboard = sellerProfileReady && Boolean(user) &&
        activeAccount === "seller" && sellerAuthVerified;
      document.getElementById("seller-onboarding").hidden = sellerCanOpenDashboard;
      document.getElementById("seller-dashboard").hidden = !sellerCanOpenDashboard;
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
      button.hidden = button.dataset.audience !== activeAccount ||
        (!user && button.dataset.audience === "seller" && button.dataset.page !== "seller-studio");
    });
    renderAccountMenu();
    setProfileDisplay(profile ? profile.display_name : user ? user.email : "Guest");
  }

  async function loadCatalog() {
    const { data: rows, error } = await client
      .from("listings")
      .select("id,seller_id,kind,category,title,description,seller_name,price,pricing_mode,image_url,rating,rating_count")
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
      pricingMode: row.pricing_mode || "fixed",
      price: row.pricing_mode === "quote" || row.price === null ? "Request a quote" : row.pricing_mode === "starting" ? `From ${currency.format(row.price)} / service` : currency.format(row.price),
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
      client.from("seller_profiles").select("shop_name,seller_type,availability_status").eq("user_id", user.id).maybeSingle()
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
      sellerAvailabilityStatus = sellerResult.data.availability_status || "available";
      const availabilitySelect = document.getElementById("seller-service-availability");
      if (availabilitySelect) availabilitySelect.value = sellerAvailabilityStatus;
      document.getElementById("seller-shop-title").textContent = sellerShopName;
      document.getElementById("seller-type-label").textContent =
        `${sellerType} · Manage listings, customer orders, and earnings.`;
    }
    if (!accountRoles.includes("seller") && sellerProfileReady) accountRoles.push("seller");
    // A restored session must recognize an existing seller account without
    // forcing the seller to sign in again after refreshing the page.
    if (accountRoles.includes("seller") || sellerProfileReady) sellerAuthVerified = true;
    // Keep the Seller journey selected while sign-in callbacks race or the
    // seller profile is being created for an account that already signed in.
    const sellerJourneyRequested = activeAccount === "seller" &&
      (sellerAuthVerified || authAudience === "seller");
    if (!accountRoles.includes(activeAccount) && !sellerJourneyRequested) {
      activeAccount = "buyer";
    }
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
      .select("id,kind,category,title,description,price,pricing_mode,image_url,status,seller_name")
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
        <small>${item.kind === "goods" ? "Goods" : "Service"} · ${escapeHtml(item.category)} · ${item.kind === "service" && item.pricing_mode === "quote" ? "Request a quote" : item.kind === "service" && item.pricing_mode === "starting" ? "From " + currency.format(item.price) : item.kind === "service" && item.pricing_mode === "quote" ? "Request a quote" : item.kind === "service" && item.pricing_mode === "starting" ? "From " + currency.format(item.price) : item.price === null ? "Request an estimate" : currency.format(item.price)} · ${item.status === "published" ? "Published" : "Paused"}</small>
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

  async function finalizePendingSellerStudio() {
    if (!user || !sellerAuthVerified || activeAccount !== "seller") return false;
    let pending;
    try {
      pending = JSON.parse(sessionStorage.getItem("bigwizz-pending-seller-studio") || "null");
    } catch {
      sessionStorage.removeItem("bigwizz-pending-seller-studio");
      throw new Error("Your saved studio details could not be read. Please enter them again.");
    }
    if (!pending || !pending.shopName || !pending.sellerType) return false;

    const { error } = await client.from("seller_profiles").upsert({
      user_id: user.id, shop_name: pending.shopName, seller_type: pending.sellerType,
      city: pending.city || null, area: pending.area || null, service_area: pending.serviceArea || "",
      latitude: pending.latitude === null || pending.latitude === "" ? null : Number(pending.latitude),
      longitude: pending.longitude === null || pending.longitude === "" ? null : Number(pending.longitude),
      availability_status: pending.availabilityStatus || "available"
    }, { onConflict: "user_id" });
    if (error) throw error;

    sessionStorage.removeItem("bigwizz-pending-seller-studio");
    await loadAccount();
    if (!sellerProfileReady) {
      throw new Error("Your Seller Studio details were submitted but could not be loaded. Please try again.");
    }
    activeAccount = "seller";
    sellerAuthVerified = true;
    sessionStorage.setItem("bigwizz-active-account", "seller");
    updateAccountState();
    activatePage("seller-studio");
    notify("Seller Studio created successfully. Welcome to your Seller Dashboard.");
    return true;
  }

  async function saveSellerProfile(event) {
    event.preventDefault();
    event.stopImmediatePropagation();

    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    if (submit && submit.disabled) return;

    const values = new FormData(form);
    const shopName = String(values.get("shopName") || "").trim();
    const sellerTypeValue = String(values.get("sellerType") || "").trim();
    if (!shopName || !sellerTypeValue) {
      notify("Enter your shop name and choose a seller type.");
      return;
    }

    sessionStorage.setItem("bigwizz-pending-seller-studio", JSON.stringify({
      shopName, sellerType: sellerTypeValue,
      city: String(values.get("city") || "").trim(),
      area: String(values.get("area") || "").trim(),
      serviceArea: String(values.get("serviceArea") || "").trim(),
      latitude: String(values.get("latitude") || ""),
      longitude: String(values.get("longitude") || ""),
      availabilityStatus: String(values.get("availabilityStatus") || "available")
    }));
    activeAccount = "seller";
    sellerAuthVerified = false;
    sessionStorage.setItem("bigwizz-active-account", "seller");
    updateAccountState();
    showAuth("signin", "seller");
    notify("Studio details saved. Sign in and confirm your account to finish creating your Seller Studio.");
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

  async function saveSellerListing(event) {
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
      const pricingMode = kind === "service" ? String(values.get("pricingMode") || "fixed") : "fixed";
      const rawPrice = String(values.get("price") || "").trim();
      const price = kind === "service" && pricingMode === "quote" ? null : Number(rawPrice);
      if (!title || !description || (price !== null && (!Number.isFinite(price) || price <= 0)) || (price === null && !(kind === "service" && pricingMode === "quote"))) {
        throw new Error("Enter a valid price or select quotation required.");
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
        price: price === null ? null : Math.round((price + Number.EPSILON) * 100) / 100,
        pricing_mode: pricingMode,
        image_url: imageUrl,
        status: existing ? existing.status : "published"
      };
      const result = remoteEditingId
        ? await client.from("listings").update(row).eq("id", remoteEditingId).eq("seller_id", user.id)
        : await client.from("listings").insert(row);
      if (result.error) throw result.error;
      if (kind === "service") {
        const { error: profileError } = await client.from("seller_profiles").update({
          is_public: true,
          availability_status: String(values.get("serviceAvailability") || sellerAvailabilityStatus || "available")
        }).eq("user_id", user.id);
        sellerAvailabilityStatus = String(values.get("serviceAvailability") || sellerAvailabilityStatus || "available");
        if (profileError) throw profileError;
      }
      remoteEditingId = null;
      resetSellerListingForm();
      document.getElementById("seller-service-availability").value = sellerAvailabilityStatus;
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
      .select("id,title,kind,category,description,price,pricing_mode,image_url,status")
      .eq("id", listingId).eq("seller_id", user.id).single();
    if (row.error) throw row.error;
    if (action === "edit") {
      const item = row.data;
      remoteEditingId = item.id;
      document.getElementById("seller-listing-title").value = item.title;
      document.getElementById("seller-listing-type").value = item.kind;
      document.getElementById("seller-listing-type").dispatchEvent(new Event("change", { bubbles: true }));
      document.getElementById("seller-listing-category").value = item.category;
      document.getElementById("seller-service-pricing-mode").value = item.pricing_mode || "fixed";
      document.getElementById("seller-service-availability").value = sellerAvailabilityStatus;
      document.getElementById("seller-listing-price").value = item.price === null ? "" : String(item.price);
      document.getElementById("seller-listing-price").disabled = item.kind === "service" && item.pricing_mode === "quote";
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
    const form = event.currentTarget;
    const values = new FormData(form);
    const serviceTitle = String(values.get("service") || "");
    const listing = services.find(item => item.title === serviceTitle);
    const matchingMode = String(values.get("matchingMode") || "direct");
    if (matchingMode === "direct" && !listing?.providerId) {
      notify("Choose the nearby-provider option for this service so Bigwizz can find an available professional.");
      return;
    }
    const scheduledAt = String(values.get("scheduledAt") || "");
    const latitude = values.get("latitude") ? Number(values.get("latitude")) : null;
    const longitude = values.get("longitude") ? Number(values.get("longitude")) : null;
    const area = String(values.get("area") || "").trim();
    const serviceAddress = String(values.get("serviceAddress") || "").trim();
    const requestRow = {
      buyer_id:user.id, listing_id:listing?listing.id:null,
      provider_id:matchingMode==="direct"&&listing?listing.providerId:null,
      service_title:serviceTitle, request_type:String(values.get("requestType")),
      preferred_date:scheduledAt?scheduledAt.slice(0,10):null,
      scheduled_at:scheduledAt?new Date(scheduledAt).toISOString():null,
      matching_mode:matchingMode, service_address:serviceAddress,
      representative_name:String(values.get("representativeName")||"").trim()||null,
      representative_phone:String(values.get("representativePhone")||"").trim()||null,
      area, details:String(values.get("details")||"").trim(), latitude, longitude
    };
    const {data:request,error}=await client.from("service_requests").insert(requestRow).select("id").single();
    if(error){report(error,"Service request could not be saved.");return;}
    let directMatchCreated=false;
    if(matchingMode==="direct"&&listing?.providerId){
      const {error:matchError}=await client.from("service_request_matches").insert({request_id:request.id,buyer_id:user.id,provider_id:listing.providerId});
      if(matchError)report(matchError,"Request saved, but the selected provider could not be notified.");
      else directMatchCreated=true;
    }
    if(matchingMode==="nearby"){
      const {data:providers,error:providerError}=await client.from("seller_profiles")
        .select("user_id,city,area,latitude,longitude,availability_status").eq("is_public",true).eq("availability_status","available");
      if(providerError)report(providerError,"Request saved, but nearby providers could not be searched.");
      else{
        const {data:providerListings,error:listingError}=await client.from("listings")
          .select("seller_id,category").eq("kind","service").eq("status","published");
        if(listingError)report(listingError,"Request saved, but service categories could not be matched.");
        else{
          const category=listing&&listing.category;
          const eligibleIds=new Set(providerListings.filter(item=>!category||item.category===category).map(item=>item.seller_id).filter(Boolean));
          const radians=value=>value*Math.PI/180;
          const distanceKm=(aLat,aLon,bLat,bLon)=>{
            const dLat=radians(bLat-aLat),dLon=radians(bLon-aLon);
            const value=Math.sin(dLat/2)**2+Math.cos(radians(aLat))*Math.cos(radians(bLat))*Math.sin(dLon/2)**2;
            return 6371*2*Math.atan2(Math.sqrt(value),Math.sqrt(1-value));
          };
          const ranked=providers.filter(item=>item.user_id!==user.id&&eligibleIds.has(item.user_id)).map(item=>{
            let distance=null;
            if(latitude!==null&&longitude!==null&&item.latitude!==null&&item.longitude!==null)distance=distanceKm(latitude,longitude,item.latitude,item.longitude);
            const sameArea=area&&[item.area,item.city].some(value=>value&&area.toLowerCase().includes(String(value).toLowerCase()));
            return {user_id:item.user_id,distance,sameArea};
          }).filter(item=>item.distance!==null?item.distance<=25:item.sameArea).sort((x,y)=>(x.distance??999)-(y.distance??999)).slice(0,5);
          if(ranked.length){
            const {error:matchError}=await client.from("service_request_matches").insert(ranked.map(item=>({request_id:request.id,buyer_id:user.id,provider_id:item.user_id})));
            if(matchError)report(matchError,"Request saved, but provider invitations could not be sent.");
            else notify(`Your request was sent to ${ranked.length} nearby provider${ranked.length===1?"":"s"}.`);
          }else notify("Your request was saved. No available nearby provider matched this area yet.");
        }
      }
    }else if(directMatchCreated) notify("Your request was sent to the selected provider.");
    form.reset();
    document.getElementById("service-dialog").close();
    await loadBuyerServiceRequests();
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
    if(!user){showAuth();return;}
    if(activeAccount!=="seller")return;
    const {data,error}=await client.from("service_request_matches")
      .select("id,status,quoted_amount,currency,response_note,sent_at,service_requests(service_title,request_type,area,details,scheduled_at,service_address,representative_name),service_request_selections(match_id)")
      .eq("provider_id",user.id).order("sent_at",{ascending:false});
    if(error){report(error,"Nearby service requests could not be loaded.");return;}
    const requests=data.length?`<div class="service-request-list">${data.map(match=>{
      const item=match.service_requests||{},schedule=item.scheduled_at?new Date(item.scheduled_at).toLocaleString():"As soon as possible";
      const selected=(match.service_request_selections||[]).some(row=>row.match_id===match.id);
      return `<article class="service-request-card"><div><h4>${escapeHtml(item.service_title||"Service request")} · ${escapeHtml(selected?"Buyer selected you":match.status)}</h4><p>${escapeHtml(item.details||"")}</p><small>${escapeHtml(item.area||"")} · ${escapeHtml(schedule)} · ${escapeHtml(item.service_address||"")}${item.representative_name?" · Contact on arrival: "+escapeHtml(item.representative_name):""}</small>
      ${match.status==="sent"||match.status==="viewed"?`<form class="service-match-response" data-service-match-response="${match.id}"><input name="quotedAmount" type="number" min="0.01" step="0.01" placeholder="Your quotation" required><input name="currency" value="USD" maxlength="3" aria-label="Currency" required><textarea name="responseNote" placeholder="Explain what is included, availability and any conditions" maxlength="2000"></textarea><button class="primary" type="submit">Send private quotation</button></form>`:match.quoted_amount?`<div class="service-quote-card">Your quotation: <strong>${escapeHtml(match.currency)} ${Number(match.quoted_amount).toLocaleString()}</strong><p>${escapeHtml(match.response_note||"")}</p></div>`:""}</div></article>`;
    }).join("")}</div>`:'<p class="notice">No nearby service requests yet. New requests from buyers in your service area will appear here.</p>';
    document.getElementById("inbox").innerHTML=`<section class="service-request-section"><h3>Nearby service requests</h3>${requests}</section><p class="notice">Send quotations privately. Buyers compare provider profiles and offers; Bigwizz does not run a public bidding contest.</p>`;
    document.querySelector("#messages .section-head h2").textContent="Seller inbox";
  }

  async function respondToServiceMatch(event) {
    event.preventDefault();event.stopImmediatePropagation();
    if(!user){showAuth();return;}
    const form=event.currentTarget,values=new FormData(form),amount=Number(values.get("quotedAmount"));
    if(!Number.isFinite(amount)||amount<=0){notify("Enter a valid quotation.");return;}
    const {error}=await client.from("service_request_matches").update({
      status:"quoted",quoted_amount:Math.round(amount*100)/100,
      currency:String(values.get("currency")||"USD").toUpperCase(),
      response_note:String(values.get("responseNote")||"").trim(),responded_at:new Date().toISOString()
    }).eq("id",form.dataset.serviceMatchResponse).eq("provider_id",user.id);
    if(error){report(error,"Your quotation could not be sent.");return;}
    notify("Your private quotation was sent to the buyer.");await loadInbox();
  }

  async function loadBuyerServiceRequests() {
    const panel=document.getElementById("buyer-service-request-panel"),list=document.getElementById("buyer-service-request-list");
    if(!panel||!list||!user){if(panel)panel.hidden=true;return;}
    const {data,error}=await client.from("service_requests")
      .select("id,service_title,area,details,scheduled_at,created_at,service_request_matches(id,provider_id,status,quoted_amount,currency,response_note,seller_profiles(shop_name)),service_request_selections(match_id,provider_id)")
      .eq("buyer_id",user.id).order("created_at",{ascending:false}).limit(10);
    if(error){report(error,"Your service requests could not be loaded.");return;}
    panel.hidden=false;
    list.innerHTML=data.length?data.map(request=>{
      const selected=(request.service_request_selections||[])[0];
      const offers=(request.service_request_matches||[]).map(match=>{
        const shop=Array.isArray(match.seller_profiles)?match.seller_profiles[0]:match.seller_profiles,isSelected=selected&&selected.match_id===match.id;
        return `<article class="service-quote-card"><strong>${escapeHtml(shop?.shop_name||"Nearby provider")}</strong><p>${match.quoted_amount?`Quotation: ${escapeHtml(match.currency)} ${Number(match.quoted_amount).toLocaleString()}`:"Waiting for provider response"}</p><small>${escapeHtml(match.response_note||match.status)}</small>${isSelected?'<p><strong>Selected provider.</strong> Secure checkout will appear once Bigwizz payment processing is connected.</p>':match.status==="quoted"&&!selected?`<button class="primary" type="button" data-select-service-match="${match.id}" data-request-id="${request.id}" data-provider-id="${match.provider_id}">Choose this provider</button>`:""}</article>`;
      }).join("");
      return `<article class="service-request-card"><div><h4>${escapeHtml(request.service_title)}</h4><p>${escapeHtml(request.details)}</p><small>${escapeHtml(request.area)} · ${request.scheduled_at?new Date(request.scheduled_at).toLocaleString():"As soon as possible"}</small>${offers||'<p class="notice">Waiting for provider responses.</p>'}</div></article>`;
    }).join(""):'<p class="notice">You have not sent a service request yet.</p>';
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
      const hasPendingSellerStudio = Boolean(sessionStorage.getItem("bigwizz-pending-seller-studio"));
      activeAccount = hasPendingSellerStudio ? "seller" : "buyer";
      sellerProfileReady = false;
      sellerAuthVerified = false;
      authAudience = hasPendingSellerStudio ? "seller" : "buyer";
      if (sellerWorkspace) sellerWorkspace.hidden = true;
      const buyerShell = document.querySelector("#marketplace-app > .shell");
      const buyerNav = document.querySelector("#marketplace-app > .mobile-nav");
      if (buyerShell) buyerShell.hidden = false;
      if (buyerNav) buyerNav.hidden = false;
      setProfileDisplay("Guest");
      updateMobileNavigation();
      return;
    }
    try {
      await loadAccount();
      showApp();
      await loadCatalog();
      if (activeAccount !== "seller") await loadBuyerServiceRequests();
      if (activeAccount === "seller" && sessionStorage.getItem("bigwizz-pending-seller-studio")) {
        sellerAuthVerified = true;
        await finalizePendingSellerStudio();
      } else if (activeAccount === "seller" && sellerAuthVerified) {
        activatePage("seller-studio");
      } else if (!document.querySelector(".page.active")) {
        activatePage("discover");
      }
      notify("Signed in. Your account data is shared across devices.");
    } catch (error) {
      report(error, "Account details could not be loaded.");
    }
  }

  function stop(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  document.addEventListener("submit", async event => {
    if (event.target.id === "auth-form") {
      stop(event);
      const submit = document.getElementById("auth-submit");
      const email = document.getElementById("auth-email").value.trim();
      const password = document.getElementById("auth-password").value;
      const displayName = document.getElementById("auth-name").value.trim();
      const accountType = document.getElementById("auth-role").value;
      submit.disabled = true;
      submit.textContent = "Please wait…";
      try {
        let result;
        if (authMode === "signup") {
          result = await client.auth.signUp({
            email,
            password,
            options: {
              data: { display_name: displayName, account_type: accountType },
              emailRedirectTo: window.location.origin + window.location.pathname
            }
          });
          if (result.error) throw result.error;
          if (result.data.session) {
            document.getElementById("auth-dialog").close();
            if (authAudience === "seller") {
              sellerAuthVerified = true;
              activeAccount = "seller";
              await handleSession(result.data.user);
              activeAccount = "seller";
              updateAccountState();
              activatePage("seller-studio");
              notify(sellerProfileReady
                ? "Seller account created. Opening Seller Studio."
                : "Seller account created. Complete your shop profile in Seller Studio.");
            } else {
              notify("Your Buyer account has been created.");
            }
          } else {
            showAuthFeedback("Account created. Check your email for a confirmation link, then return here to sign in.");
          }
        } else if (authMode === "reset") {
          result = await client.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + window.location.pathname
          });
          if (result.error) throw result.error;
          showAuthFeedback("If an account exists for that email, a password reset link has been sent.");
        } else {
          result = await client.auth.signInWithPassword({ email, password });
          if (result.error) throw result.error;
          document.getElementById("auth-dialog").close();
          if (authAudience === "seller") {
            sellerAuthVerified = true;
            activeAccount = "seller";
            await handleSession(result.data.user);
            activeAccount = "seller";
            updateAccountState();
            activatePage("seller-studio");
            notify(sellerProfileReady
              ? "Seller sign-in successful. Opening Seller Studio."
              : "Seller sign-in successful. Complete your shop profile in Seller Studio.");
          } else {
            notify("You are signed in to your Buyer account.");
          }
        }
      } catch (error) {
        showAuthFeedback(error.message || "Authentication failed. Please try again.", true);
      } finally {
        submit.disabled = false;
        submit.textContent = authMode === "signup" ? "Create account" :
          authMode === "reset" ? "Send reset link" : "Sign in";
      }
      return;
    }
    if (event.target.id === "seller-setup-form") return saveSellerProfile(event);
    if (event.target.id === "seller-listing-form") return saveSellerListing(event);
    if (event.target.id === "service-request-form") return submitServiceRequest(event);
    if (event.target.matches("[data-service-match-response]")) return respondToServiceMatch(event);
    if (event.target.matches("[data-service-match-response]")) return respondToServiceMatch(event);
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
    const authOpen = event.target.closest("[data-auth-open]");
    if (authOpen) {
      stop(event);
      activeAccount = "buyer";
      sellerAuthVerified = false;
      updateAccountState();
      showAuth("signin", "buyer");
      return;
    }
    const authClose = event.target.closest("[data-auth-close]");
    if (authClose) {
      document.getElementById("auth-dialog").close();
      return;
    }
    const authModeButton = event.target.closest("[data-auth-mode]");
    if (authModeButton) {
      stop(event);
      showAuth(authModeButton.dataset.authMode, authAudience);
      return;
    }
    if (event.target.closest("#seller-listing-cancel")) {
      remoteEditingId = null;
      return;
    }
    const signOut = event.target.closest("[data-supabase-signout]");
    if (signOut) {
      stop(event);
      sellerAuthVerified = false;
      sessionStorage.removeItem("bigwizz-active-account");
      client.auth.signOut().then(({ error }) => {
        if (error) report(error, "Could not sign out.");
        else {
          showApp();
          notify("Signed out.");
        }
      });
      return;
    }
    const accountChoice = event.target.closest("[data-account-option]");
    if (accountChoice) {
      if (accountChoice.dataset.accountOption === "seller") {
        stop(event);
        activeAccount = "seller";
        sellerAuthVerified = false;
        sessionStorage.setItem("bigwizz-active-account", "seller");
        updateAccountState();
        activatePage("seller-studio");
        return;
      }
      if (!user) return;
      stop(event);
      sellerAuthVerified = false;
      activeAccount = "buyer";
      sessionStorage.setItem("bigwizz-active-account", "buyer");
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
      if (!user && pageButton.dataset.page !== "seller-studio") {
        stop(event);
        showAuth();
        return;
      }
      if (pageButton.dataset.page === "seller-studio" || pageButton.dataset.page === "seller-listings" || pageButton.dataset.page === "seller-progress" || pageButton.dataset.page === "messages") {
        stop(event);
        if (!sellerAuthVerified) {
          activeAccount = "seller";
          updateAccountState();
          activatePage("seller-studio");
          showAuth("signin", "seller");
          return;
        }
        activeAccount = "seller";
        updateAccountState();
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

  document.addEventListener("click",async event=>{
    const choose=event.target.closest("[data-select-service-match]");
    if(!choose||!user)return;
    const {error}=await client.from("service_request_selections").insert({
      request_id:choose.dataset.requestId,match_id:choose.dataset.selectServiceMatch,
      buyer_id:user.id,provider_id:choose.dataset.providerId
    });
    if(error){report(error,"Provider selection could not be saved.");return;}
    notify("Provider selected. No payment has been taken; secure checkout is not connected yet.");
    await loadBuyerServiceRequests();
  });
  const accountMenu = document.getElementById("account-switch-menu");
  accountMenu.insertAdjacentHTML("beforeend",
    '<button type="button" data-supabase-signout><span class="account-option-icon">↪</span><span><b>Sign out</b><small>End this session</small></span></button>');
  setProfileDisplay("Guest");
  loadCatalog();

  client.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => handleSession(session && session.user), 0);
  });
  client.auth.getSession().then(({ data, error }) => {
    if (error) report(error, "Could not check the current sign-in session.");
    else handleSession(data.session && data.session.user);
  });
  document.querySelectorAll('[data-page="services"]').forEach(button => button.addEventListener("click", () => {
    window.setTimeout(loadBuyerServiceRequests, 100);
  }));
})();
