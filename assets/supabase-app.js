(function () {
  const config = window.BIGWIZZ_SUPABASE_CONFIG;
  const supabaseApi = window.supabase;
  if (!config || !config.url || !config.publishableKey || !supabaseApi) return;

  const client = supabaseApi.createClient(config.url, config.publishableKey);
  const currency = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 });
  let user = null;
  let profile = null;
  let sellerAvailabilityStatus = "available";
  let savedListingIds = new Set();
  let remoteEditingId = null;

  async function loadListingReviews(listingId) {
    if (!listingId) return [];
    const { data, error } = await client.from("listing_reviews")
      .select("id,rating,body,reviewer_name,created_at")
      .eq("listing_id", listingId).order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(row => ({
      id: row.id, rating: row.rating, text: row.body,
      reviewer: row.reviewer_name || "Customer", createdAt: row.created_at, demo: false
    }));
  }

  async function submitListingReview({ listingId, rating, text, reviewer }) {
    if (!user) {
      showAuth();
      throw new Error("Please sign in to submit a review.");
    }
    const { error } = await client.from("listing_reviews").insert({
      listing_id: listingId,
      user_id: user.id,
      rating,
      body: text,
      reviewer_name: reviewer || (profile && profile.display_name) || "Customer"
    });
    if (error) {
      if (error.code === "23505") throw new Error("You have already reviewed this listing.");
      throw error;
    }
    const rows = await loadListingReviews(listingId);
    await loadCatalog();
    return rows;
  }

  async function loadCommunityPosts(){
    const query=client.from("community_posts").select("id,title,category,body,image_url,status,created_at,author_name").order("created_at",{ascending:false});
    const {data,error}=user?await query.or(`status.eq.published,author_id.eq.${user.id}`):await query.eq("status","published");
    if(error)throw error;
    const rows=data||[],ids=rows.map(row=>row.id);let counts=new Map();
    if(ids.length){const result=await client.from("community_comments").select("post_id").in("post_id",ids).eq("status","published");if(result.error)throw result.error;for(const row of result.data||[])counts.set(row.post_id,(counts.get(row.post_id)||0)+1);}
    conversations=rows.map(row=>({id:row.id,title:row.title,meta:row.category||"Community",copy:row.body,author:row.author_name||"Community member",status:row.status,commentCount:counts.get(row.id)||0,image:row.image_url||"assets/home-repairs.jpg"}));
    return conversations;
  }
  async function loadCommunityComments(postId){
    if(!postId)return [];
    const query=client.from("community_comments").select("id,post_id,body,status,created_at,author_name").eq("post_id",postId).order("created_at",{ascending:true});
    const {data,error}=user?await query.or(`status.eq.published,author_id.eq.${user.id}`):await query.eq("status","published");
    if(error)throw error;
    return (data||[]).map(row=>({id:row.id,body:row.body,status:row.status,author:row.author_name||"Community member",createdAt:row.created_at}));
  }
  async function submitCommunityPost({title,category,body}){
    if(!user){showAuth();throw new Error("Please sign in to start a conversation.");}
    const cleanTitle=String(title||"").trim(),cleanBody=String(body||"").trim();
    if(!cleanTitle||cleanTitle.length>160||!cleanBody||cleanBody.length>5000)throw new Error("Add a title and a message before submitting.");
    const {error}=await client.from("community_posts").insert({author_id:user.id,author_name:(profile&&profile.display_name)||"Community member",title:cleanTitle,category:String(category||"General").slice(0,60),body:cleanBody,status:"pending"});
    if(error)throw error;await loadCommunityPosts();renderCommunity();
  }
  async function submitCommunityComment({postId,body}){
    if(!user){showAuth();throw new Error("Please sign in to comment.");}
    const cleanBody=String(body||"").trim();if(!postId||!cleanBody||cleanBody.length>5000)throw new Error("Write a comment before submitting.");
    const {error}=await client.from("community_comments").insert({post_id:postId,author_id:user.id,author_name:(profile&&profile.display_name)||"Community member",body:cleanBody,status:"pending"});
    if(error)throw error;return loadCommunityComments(postId);
  }
  window.BIGWIZZ_BACKEND=Object.freeze({loadListingReviews,submitListingReview,loadCommunityPosts,loadCommunityComments,submitCommunityPost,submitCommunityComment,loadSellerServiceRequests,loadBuyerServiceRequests,respondToServiceRequest,getCurrentUser:()=>user,requireSignIn:()=>showAuth()});

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
      user ? "Switch account. Current account: Buyer" : "Switch account"
    );
    const authOpen = document.querySelector("[data-auth-open]");
    if (authOpen) {
      authOpen.hidden = false;
      authOpen.setAttribute("aria-label", "Buyer sign in");
      authOpen.title = "Buyer sign in";
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

  function setAuthMode(mode) {
    authMode = mode;
    const nameField = document.getElementById("auth-name-field");
    const locationFields = document.getElementById("auth-location-fields");
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
    if (nameField) nameField.hidden = mode !== "signup";
    if (locationFields) { locationFields.hidden = mode !== "signup"; locationFields.querySelectorAll("input").forEach(input => { input.required = mode === "signup"; }); }
    roleField.hidden = mode !== "signup";
    if (name) name.required = mode === "signup";
    passwordField.hidden = mode === "reset";
    password.required = mode !== "reset";
    password.autocomplete = mode === "signup" ? "new-password" : "current-password";
    signupLink.hidden = mode !== "signin";
    resetLink.hidden = mode !== "signin";
    backLink.hidden = mode === "signin";
    if (mode === "signup") {
      title.textContent = "Create your Buyer account";
      summary.textContent = "Create your buyer sign-in to shop on Bigwizz.";
      submit.textContent = "Create account";
    } else if (mode === "reset") {
      title.textContent = "Reset Buyer password";
      summary.textContent = "We will email you a password reset link.";
      submit.textContent = "Send reset link";
    } else {
      title.textContent = "Sign in to your Buyer account";
      summary.textContent = "Sign in to continue to your Buyer account.";
      submit.textContent = "Sign in";
    }
  }

  function showAuth(mode = "signin") {
    authAudience = "buyer";
    const dialog = document.getElementById("auth-dialog");
    if (!dialog) {
      notify("The sign-in window could not be opened.");
      return;
    }
    setAuthMode(mode);
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
    if (["seller-studio", "seller-listings", "seller-progress", "messages"].includes(page)) page = "discover";
    document.querySelectorAll(".page").forEach(section => {
      section.classList.toggle("active", section.id === page);
    });
    document.querySelectorAll("[data-page]").forEach(button => {
      button.classList.toggle("active", button.dataset.page === page);
    });
    if (page === "cart") loadCart();
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
      .select("id,seller_id,kind,category,title,description,seller_name,price,image_url,rating,rating_count,seller_profiles(service_area,country,state,city,area,latitude,longitude)")
      .eq("status", "published")
      .order("created_at", { ascending: false });
    if (error) {
      report(error, "Marketplace listings could not be loaded from the database.");
      return;
    }
    if (rows.length) {
      const reviewResult = await client.from("listing_reviews")
        .select("listing_id,rating").in("listing_id", rows.map(row => row.id));
      if (reviewResult.error) report(reviewResult.error, "Shared listing ratings could not be loaded.");
      else {
        const grouped = new Map();
        (reviewResult.data || []).forEach(review => {
          const current = grouped.get(review.listing_id) || { count: 0, total: 0 };
          current.count += 1;
          current.total += Number(review.rating);
          grouped.set(review.listing_id, current);
        });
        rows.forEach(row => {
          const added = grouped.get(row.id);
          if (!added || !added.count) return;
          const oldCount = Number(row.rating_count || 0);
          const oldRating = Number(row.rating);
          const totalCount = oldCount + added.count;
          row.rating = (oldCount && Number.isFinite(oldRating)
            ? (oldRating * oldCount + added.total) / totalCount
            : added.total / added.count);
          row.rating_count = totalCount;
        });
      }
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
      ratingCount: Number(row.rating_count || 0),
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
      ratingCount: Number(row.rating_count || 0),
      provider: row.seller_name,
      location: row.seller_profiles && [row.seller_profiles.area,row.seller_profiles.city,row.seller_profiles.state].filter(Boolean).join(", ") || (row.seller_profiles && row.seller_profiles.service_area) || "Location not provided by this service provider", providerCountry:row.seller_profiles?.country||"", providerState:row.seller_profiles?.state||"", providerCity:row.seller_profiles?.city||"", providerArea:row.seller_profiles?.area||"", providerLatitude:row.seller_profiles?.latitude??null, providerLongitude:row.seller_profiles?.longitude??null
    }));

    const [eventsResult, postsResult] = await Promise.all([
      client.from("events").select("id,title,host,starts_at").order("starts_at"),
      loadCommunityPosts().then(data=>({data,error:null})).catch(error=>({data:null,error}))
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
    if(postsResult.error)report(postsResult.error,"Community posts could not be loaded from the database.");
    renderListings(document.getElementById("search-input").value);
    renderServices(document.getElementById("service-search-input").value);
    renderEvents();
    renderCommunity();
  }

  async function loadAccount() {
    if (!user) return;
    const [profileResult, rolesResult] = await Promise.all([
      client.from("profiles").select("display_name,country,state,city,area").eq("id", user.id).maybeSingle(),
      client.from("user_roles").select("role").eq("user_id", user.id)
    ]);
    if (profileResult.error) throw profileResult.error;
    if (rolesResult.error) throw rolesResult.error;

    profile = profileResult.data || { display_name: user.email || "Member" };
    const metadata = user.user_metadata || {};
    if (!profileResult.data || (!profile.city && metadata.city)) {
      const saved = { id:user.id, display_name:profile.display_name || metadata.display_name || user.email || "Member", country:metadata.country || "Nigeria", state:metadata.state || null, city:metadata.city || null, area:metadata.area || null };
      const savedResult = await client.from("profiles").update({ country:saved.country, state:saved.state, city:saved.city, area:saved.area }).eq("id",user.id).select("display_name,country,state,city,area").single();
      if (!savedResult.error) profile = savedResult.data;
    }
    window.BIGWIZZ_LOCATION_CONTEXT = { source:"saved", country:profile.country||"", state:profile.state||"", city:profile.city||"", area:profile.area||"", latitude:null, longitude:null };
    if (typeof window.BIGWIZZ_REFRESH_SERVICE_LOCATION === "function") window.BIGWIZZ_REFRESH_SERVICE_LOCATION();
    accountRoles = rolesResult.data.map(item => item.role);
    if (!accountRoles.includes("buyer")) accountRoles.unshift("buyer");
    activeAccount = "buyer";
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
        <small>${item.kind === "goods" ? "Goods" : "Service"} · ${escapeHtml(item.category)} · ${item.kind === "service" && item.pricing_mode === "quote" ? "Request a quote" : item.kind === "service" && item.pricing_mode === "starting" ? "From " + currency.format(item.price) : item.kind === "service" && (item.pricing_mode === "quote" || item.price === null) ? "Request a quote" : item.kind === "service" && item.pricing_mode === "starting" ? "From " + currency.format(item.price) : item.price === null ? "Request an estimate" : currency.format(item.price)} · ${item.status === "published" ? "Published" : "Paused"}</small>
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
      document.getElementById("seller-service-pricing-mode").value = item.price === null ? "quote" : item.pricing_mode || "fixed";
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
    event.preventDefault();event.stopImmediatePropagation();
    if(!user){showAuth();return;}
    const form=event.currentTarget,values=new FormData(form),submit=form.querySelector('[type="submit"]');
    const serviceTitle=String(values.get("service")||"").trim(),listing=services.find(item=>item.title===serviceTitle);
    const city=String(values.get("city")||"").trim(),area=String(values.get("area")||"").trim(),details=String(values.get("details")||"").trim();
    const bookingTiming=String(values.get("bookingTiming")||"now");
    const preferredDate=String(values.get("preferredDate")||"").trim();
    const preferredTime=String(values.get("preferredTime")||"").trim();
    if(!listing||!listing.id||!listing.providerId){notify("This service is not connected to a provider account yet. Please choose a published service.");return;}
    if(!city||!area||!details){notify("Please add your city, neighbourhood and a short description.");return;}
    if(bookingTiming==="later"&&(!preferredDate||!preferredTime)){notify("Choose the date and time you want the service.");return;}
    const scheduledDate=bookingTiming==="later"?new Date(preferredDate+"T"+preferredTime):null;
    if(scheduledDate&&(!Number.isFinite(scheduledDate.getTime())||scheduledDate.getTime()<=Date.now())){notify("Choose a future date and time for this service.");return;}
    const scheduledAt=scheduledDate?scheduledDate.toISOString():null;
    submit.disabled=true;submit.textContent="Sending request…";
    try{
      const {error}=await client.from("service_requests").insert({buyer_id:user.id,listing_id:listing.id,provider_id:listing.providerId,service_title:serviceTitle,request_type:"Request a time",booking_timing:bookingTiming,preferred_date:bookingTiming==="later"?preferredDate:null,preferred_time:bookingTiming==="later"?preferredTime:null,scheduled_at:scheduledAt,city,area,latitude:((window.BIGWIZZ_LOCATION_CONTEXT||{}).latitude??null),longitude:((window.BIGWIZZ_LOCATION_CONTEXT||{}).longitude??null),details,status:"new"});
      if(error)throw error;
      form.reset();document.getElementById("service-dialog").close();await loadBuyerServiceRequests();
      notify("Your request was sent to the service provider. Track the response under Orders.");
    }catch(error){report(error,error.message||"Service request could not be sent.");}
    finally{submit.disabled=false;submit.innerHTML='Send service request <span aria-hidden="true">→</span>';}
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

  function serviceStatusLabel(status){return ({new:"New request",responded:"Quote / response sent",accepted:"Accepted",declined:"Declined",cancelled:"Cancelled"})[status]||status;}
  function serviceTimingLabel(item){
    if(item.booking_timing==="later"&&item.preferred_date){
      const time=item.preferred_time?String(item.preferred_time).slice(0,5):"";
      return "Scheduled for "+item.preferred_date+(time?" at "+time:"");
    }
    return "Requested as soon as possible";
  }
  async function loadSellerServiceRequests(){
    const target=document.getElementById("seller-service-request-list");if(!target)return;
    if(!user){target.innerHTML='<p class="notice">Sign in with your seller account to view customer requests.</p>';return;}
    if(!accountRoles.includes("seller")){target.innerHTML='<p class="notice">This workspace is available to approved seller accounts. Switch to your seller account or complete seller setup.</p>';return;}
    target.innerHTML='<p class="notice">Loading customer requests…</p>';
    const {data,error}=await client.from("service_requests").select("id,buyer_id,service_title,request_type,booking_timing,preferred_date,preferred_time,scheduled_at,city,area,details,status,quoted_amount,quote_currency,provider_response,created_at").eq("provider_id",user.id).order("created_at",{ascending:false});
    if(error){target.innerHTML='<p class="notice">Your service requests could not be loaded.</p>';report(error,"Seller service requests could not be loaded.");return;}
    target.innerHTML=data.length?data.map(item=>`<article class="service-request-card" data-service-request-card="${escapeHtml(item.id)}"><div>
      <h4>${escapeHtml(item.service_title)} · ${escapeHtml(item.request_type)}</h4><span class="service-request-status status-${escapeHtml(item.status)}">${escapeHtml(serviceStatusLabel(item.status))}</span>
      <p>${escapeHtml(item.details)}</p><small>Customer location: ${escapeHtml(item.city||"")} ${item.city&&item.area?" · ":""}${escapeHtml(item.area)}${serviceTimingLabel(item)} ·  · Received ${new Date(item.created_at).toLocaleString()}</small>
      ${item.quoted_amount!==null?`<div class="service-request-response"><b>Quotation sent</b>${escapeHtml(item.quote_currency)} ${Number(item.quoted_amount).toFixed(2)}</div>`:""}
      ${item.provider_response?`<div class="service-request-response"><b>Your response</b>${escapeHtml(item.provider_response)}</div>`:""}
      ${["new","responded"].includes(item.status)?`<form class="seller-request-actions" data-service-response-form><input type="hidden" name="requestId" value="${escapeHtml(item.id)}"><div class="field"><label>Quotation amount (optional)</label><input name="quotedAmount" type="number" min="0" step="0.01" placeholder="Enter your price"></div><div class="field"><label>Your response to the customer</label><textarea name="providerResponse" maxlength="2000" placeholder="Explain your availability, price or next steps…" required></textarea></div><button class="primary" type="submit">Send response / quotation</button><div class="seller-request-action-row"><button class="outline-button" type="button" data-service-request-action="accepted" data-request-id="${escapeHtml(item.id)}">Accept request</button><button class="outline-button" type="button" data-service-request-action="declined" data-request-id="${escapeHtml(item.id)}">Decline</button></div></form>`:""}
    </div></article>`).join(""):'<p class="notice">No customer service requests yet. New requests will appear here.</p>';
  }
  async function loadBuyerServiceRequests(){
    const target=document.getElementById("buyer-service-request-list");if(!target)return;
    if(!user){target.innerHTML='<p class="notice">Sign in to see your service requests.</p>';return;}
    target.innerHTML='<p class="notice">Loading your requests…</p>';
    const {data,error}=await client.from("service_requests").select("id,service_title,request_type,booking_timing,preferred_date,preferred_time,scheduled_at,city,area,details,status,quoted_amount,quote_currency,provider_response,created_at").eq("buyer_id",user.id).order("created_at",{ascending:false});
    if(error){target.innerHTML='<p class="notice">Your service requests could not be loaded.</p>';report(error,"Your service requests could not be loaded.");return;}
    target.innerHTML=data.length?data.map(item=>`<article class="service-request-card"><div><h4>${escapeHtml(item.service_title)} · ${escapeHtml(item.request_type)}</h4>
      <span class="service-request-status status-${escapeHtml(item.status)}">${escapeHtml(serviceStatusLabel(item.status))}</span><p>${escapeHtml(item.details)}</p>
      <small>Your location: ${escapeHtml(item.city||"")} ${item.city&&item.area?" · ":""}${escapeHtml(item.area)}${item.preferred_date?` · Preferred date: ${escapeHtml(item.preferred_date)}`:""} · Sent ${new Date(item.created_at).toLocaleString()}</small>
      ${item.quoted_amount!==null?`<div class="service-request-response"><b>Provider quotation</b>${escapeHtml(item.quote_currency)} ${Number(item.quoted_amount).toFixed(2)}</div>`:""}
      ${item.provider_response?`<div class="service-request-response"><b>Provider response</b>${escapeHtml(item.provider_response)}</div>`:""}
    </div></article>`).join(""):'<p class="notice">You have not sent any service requests yet.</p>';
  }
  async function respondToServiceRequest(requestId,{status="responded",quotedAmount=null,providerResponse=""}={}){
    if(!user){showAuth();throw new Error("Sign in with your seller account first.");}
    const amount=quotedAmount===null||quotedAmount===""?null:Number(quotedAmount);
    if(amount!==null&&(!Number.isFinite(amount)||amount<0))throw new Error("Enter a valid quotation amount.");
    const patch={status,provider_response:String(providerResponse||"").trim()||null,quoted_amount:amount,responded_at:new Date().toISOString(),updated_at:new Date().toISOString()};
    const {data,error}=await client.from("service_requests").update(patch).eq("id",requestId).eq("provider_id",user.id).select("id").maybeSingle();
    if(error)throw error;if(!data)throw new Error("This request is not assigned to your seller account.");
    await Promise.all([loadSellerServiceRequests(),loadBuyerServiceRequests()]);
    notify(status==="accepted"?"You accepted the service request.":status==="declined"?"You declined the service request.":"Your response was sent to the customer.");
  }
  async function loadInbox(){return loadSellerServiceRequests();}

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
      authAudience = "buyer";
      sessionStorage.removeItem("bigwizz-active-account");
      sessionStorage.removeItem("bigwizz-pending-seller-studio");
      setProfileDisplay("Guest");
      updateMobileNavigation();
      return;
    }
    try {
      await loadAccount();
      showApp();
      await loadCatalog();
      activeAccount = "buyer";
      if (!document.querySelector(".page.active")) activatePage("discover");
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
      const registrationLocation = { country: document.getElementById("auth-country")?.value.trim() || "Nigeria", state: document.getElementById("auth-state")?.value.trim() || "", city: document.getElementById("auth-city")?.value.trim() || "", area: document.getElementById("auth-area")?.value.trim() || "" };
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
              data: { display_name: displayName, account_type: accountType, country: registrationLocation.country, state: registrationLocation.state, city: registrationLocation.city, area: registrationLocation.area },
              emailRedirectTo: window.location.origin + window.location.pathname
            }
          });
          if (result.error) throw result.error;
          if (result.data.session) {
            document.getElementById("auth-dialog").close();
            notify("Your Buyer account has been created.");
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
          notify("You are signed in to your Buyer account.");
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
    if (event.target.id === "item-review-form") {
      stop(event);
      const form = event.target;
      const values = new FormData(form);
      const listingId = String(values.get("listingId") || "");
      const rating = Number(window.BIGWIZZ_PRODUCT_SELECTED_RATING || 0);
      const body = String(values.get("review") || "").trim();
      const reviewer = String(values.get("reviewer") || "").trim();
      if (!rating) { notify("Choose a star rating before posting."); return; }
      if (!body) { notify("Write a review before posting."); return; }
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        const rows = await submitListingReview({ listingId, rating, text: body, reviewer });
        document.getElementById("review-dialog").close();
        form.reset();
        if (typeof window.BIGWIZZ_PRODUCT_REVIEWS_UPDATED === "function") window.BIGWIZZ_PRODUCT_REVIEWS_UPDATED(rows);
        notify("Your review is now shared with other customers.");
      } catch (error) {
        report(error, error.message || "Your product review could not be saved.");
      } finally { submit.disabled = false; }
      return;
    }
    if (event.target.id === "service-review-form") {
      stop(event);
      const form = event.target;
      const submit = form.querySelector('[type="submit"]');
      const values = new FormData(form);
      const rating = Number(form.dataset.selectedRating || 0);
      const listingId = form.dataset.listingId;
      const reviewer = String(values.get("reviewer") || "").trim();
      const body = String(values.get("review") || "").trim();
      if (!rating) { notify("Please select a star rating."); return; }
      if (!reviewer || !body) { notify("Please enter your name and review."); return; }
      if (!listingId) { notify("This listing is not connected to the review database yet."); return; }
      submit.disabled = true;
      try {
        const rows = await submitListingReview({ listingId, rating, text: body, reviewer });
        if (typeof window.BIGWIZZ_RENDER_SERVICE_REVIEWS === "function") window.BIGWIZZ_RENDER_SERVICE_REVIEWS(rows);
        notify("Your review is now shared with other customers.");
      } catch (error) {
        report(error, error.message || "Your review could not be saved.");
      } finally { submit.disabled = false; }
      return;
    }
    if(event.target.matches("[data-service-response-form]")){stop(event);const form=event.target,values=new FormData(form),submit=form.querySelector('[type="submit"]'),rawAmount=String(values.get("quotedAmount")||"").trim();submit.disabled=true;submit.textContent="Sending…";try{await respondToServiceRequest(String(values.get("requestId")),{status:"responded",quotedAmount:rawAmount===""?null:rawAmount,providerResponse:values.get("providerResponse")});}catch(error){report(error,error.message||"Your response could not be sent.");}finally{submit.disabled=false;submit.textContent="Send response / quotation";}return;}
    if (event.target.id === "service-request-form") return submitServiceRequest(event);
    if(event.target.id==="community-post-form"){stop(event);const form=event.target,values=new FormData(form),submit=form.querySelector('[type="submit"]');submit.disabled=true;try{await submitCommunityPost({title:values.get("title"),category:values.get("category"),body:values.get("body")});form.reset();document.getElementById("community-compose-dialog").close();notify("Your post was submitted and is awaiting review.");}catch(error){report(error,error.message||"Your post could not be submitted.");}finally{submit.disabled=false;}return;}
    if(event.target.id==="community-comment-form"){stop(event);const form=event.target,values=new FormData(form),submit=form.querySelector('[type="submit"]'),postId=String(values.get("postId")||"");submit.disabled=true;try{const comments=await submitCommunityComment({postId,body:values.get("body")});form.reset();document.getElementById("community-comment-post-id").value=postId;renderCommunityComments(comments);notify("Your comment was submitted and is awaiting review.");}catch(error){report(error,error.message||"Your comment could not be submitted.");}finally{submit.disabled=false;}return;}
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

  document.addEventListener("change", event => {
    if(event.target.name==="bookingTiming"){
      const later=event.target.value==="later";
      const schedule=document.getElementById("service-schedule-fields");
      if(schedule)schedule.hidden=!later;
      const date=document.getElementById("request-date"),time=document.getElementById("request-time");
      if(date)date.required=later;
      if(time)time.required=later;
    }
  }, true);

  document.addEventListener("click", event => {
    const authOpen = event.target.closest("[data-auth-open]");
    if (authOpen) {
      stop(event);
      activeAccount = "buyer";
      updateAccountState();
      showAuth("signin");
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
      if (!user) return;
      stop(event);
      activeAccount = "buyer";
      sessionStorage.setItem("bigwizz-active-account", "buyer");
      updateAccountState();
      activatePage("discover");
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
    const serviceRequestAction=event.target.closest("[data-service-request-action]");if(serviceRequestAction){stop(event);const nextStatus=serviceRequestAction.dataset.serviceRequestAction;if(!window.confirm(nextStatus==="accepted"?"Accept this service request?":"Decline this service request?"))return;respondToServiceRequest(serviceRequestAction.dataset.requestId,{status:nextStatus,providerResponse:nextStatus==="accepted"?"Your service request has been accepted. The provider will follow up with the next steps.":"The provider is unable to take this service request."}).catch(error=>report(error,error.message||"The request could not be updated."));return;}
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
    if (pageButton && ["cart", "notifications"].includes(pageButton.dataset.page)) {
      if (!user) {
        stop(event);
        showAuth();
        return;
      }
      window.setTimeout(() => {
        if (pageButton.dataset.page === "cart") loadCart();
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
  client.channel("bigwizz-community-live")
    .on("postgres_changes",{event:"*",schema:"public",table:"community_posts"},async()=>{try{await loadCommunityPosts();renderCommunity();}catch(error){console.error("Community live refresh failed.",error);}})
    .on("postgres_changes",{event:"*",schema:"public",table:"community_comments"},async()=>{try{await loadCommunityPosts();renderCommunity();const postId=document.getElementById("community-comment-post-id")?.value;if(postId&&document.getElementById("community-thread-dialog")?.open)renderCommunityComments(await loadCommunityComments(postId));}catch(error){console.error("Community comment live refresh failed.",error);}})
    .on("postgres_changes",{event:"*",schema:"public",table:"service_requests"},async payload=>{try{if(!user)return;const row=payload.new||payload.old;if(row?.buyer_id===user.id)await loadBuyerServiceRequests();if(row?.provider_id===user.id)await loadSellerServiceRequests();}catch(error){console.error("Service request live refresh failed.",error);}})
    .on("postgres_changes",{event:"*",schema:"public",table:"notifications"},async payload=>{try{if(user&&(payload.new||payload.old)?.user_id===user.id&&document.getElementById("notifications")?.classList.contains("active"))await loadNotifications();}catch(error){console.error("Notification live refresh failed.",error);}})
    .subscribe();
  client.auth.getSession().then(({ data, error }) => {
    if (error) report(error, "Could not check the current sign-in session.");
    else handleSession(data.session && data.session.user);
  });
  document.querySelectorAll('[data-page="services"]').forEach(button => button.addEventListener("click", () => {
    window.setTimeout(loadBuyerServiceRequests, 100);
  }));
})();
