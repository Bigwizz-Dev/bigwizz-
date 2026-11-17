(function () {
  const config = window.BIGWIZZ_SUPABASE_CONFIG;
  const supabaseApi = window.supabase;
  if (!config || !config.url || !config.publishableKey || !supabaseApi) return;

  const client = supabaseApi.createClient(config.url, config.publishableKey);
  const currency = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 });
  let user = null;
  let profile = null;
  let sellerAvailabilityStatus = "available";
  let sellerProfileReady = false;
  let sellerShopName = "";
  let savedListingIds = new Set();
  let remoteEditingId = null;

  async function loadProductReviews(productKey) {
    if (!productKey) return [];
    const { data, error } = await client.from("product_reviews").select("id,rating,body,reviewer_name,created_at").eq("product_key", String(productKey)).order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(row => ({ id: row.id, rating: row.rating, text: row.body, reviewer: row.reviewer_name || "Customer", createdAt: row.created_at, demo: false }));
  }

  async function submitProductReview({ productKey, rating, text, reviewer }) {
    if (!user) { showAuth(); throw new Error("Please sign in to submit a review."); }
    const { error } = await client.from("product_reviews").insert({ product_key: String(productKey), user_id: user.id, rating, body: text, reviewer_name: reviewer || (profile && profile.display_name) || "Customer" });
    if (error) { if (error.code === "23505") throw new Error("You have already reviewed this product."); throw error; }
    return await loadProductReviews(productKey);
  }
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
    const query=client.from("community_posts").select("id,title,category,body,caption,image_url,media_url,media_type,product_id,author_avatar_url,status,created_at,author_name").order("created_at",{ascending:false});
    const {data,error}=user?await query.or(`status.eq.published,author_id.eq.${user.id}`):await query.eq("status","published");
    if(error)throw error;
    const rows=data||[],ids=rows.map(row=>row.id);
    const counts=new Map(),likes=new Map(),liked=new Set();
    if(ids.length){
      const [commentsResult,likesResult]=await Promise.all([
        client.from("community_comments").select("post_id").in("post_id",ids).eq("status","published"),
        client.from("community_post_likes").select("post_id,user_id").in("post_id",ids)
      ]);
      if(commentsResult.error)throw commentsResult.error;
      if(likesResult.error)throw likesResult.error;
      for(const row of commentsResult.data||[])counts.set(row.post_id,(counts.get(row.post_id)||0)+1);
      for(const row of likesResult.data||[]){likes.set(row.post_id,(likes.get(row.post_id)||0)+1);if(user&&row.user_id===user.id)liked.add(row.post_id);}
    }
    conversations=rows.map(row=>({id:row.id,title:row.title,meta:row.category||"Maker update",copy:row.caption||row.body||"",author:row.author_name||"Bigwizz maker",avatar:row.author_avatar_url||"",createdAt:new Date(row.created_at).toLocaleDateString(),status:row.status,commentCount:counts.get(row.id)||0,likeCount:likes.get(row.id)||0,liked:liked.has(row.id),mediaUrl:row.media_url||row.image_url||"",mediaType:row.media_type||(row.image_url?"image":null),productId:row.product_id}));
    return conversations;
  }
  async function loadCommunityProducts(){
    const {data,error}=await client.from("listings").select("id,title").eq("kind","goods").eq("status","published").order("created_at",{ascending:false}).limit(100);
    if(error)throw error;
    return data||[];
  }
  async function toggleCommunityLike(postId){
    if(!user){showAuth();throw new Error("Please sign in to like maker updates.");}
    const {data,error}=await client.from("community_post_likes").select("id").eq("post_id",postId).eq("user_id",user.id).maybeSingle();
    if(error)throw error;
    if(data){const result=await client.from("community_post_likes").delete().eq("id",data.id);if(result.error)throw result.error;}
    else{const result=await client.from("community_post_likes").insert({post_id:postId,user_id:user.id});if(result.error)throw result.error;}
  }
  async function loadCommunityComments(postId){
    if(!postId)return [];
    const query=client.from("community_comments").select("id,post_id,body,status,created_at,author_name").eq("post_id",postId).order("created_at",{ascending:true});
    const {data,error}=user?await query.or(`status.eq.published,author_id.eq.${user.id}`):await query.eq("status","published");
    if(error)throw error;
    return (data||[]).map(row=>({id:row.id,body:row.body,status:row.status,author:row.author_name||"Community member",createdAt:row.created_at}));
  }
  async function getMakerVideoDuration(file){
    const video=document.createElement("video"),objectUrl=URL.createObjectURL(file);
    try{return await new Promise((resolve,reject)=>{video.preload="metadata";video.onloadedmetadata=()=>resolve(video.duration);video.onerror=()=>reject(new Error("Video duration could not be checked."));video.src=objectUrl;});}
    finally{URL.revokeObjectURL(objectUrl);video.removeAttribute("src");video.load();}
  }
  async function submitCommunityPost({title,category,body,file,productId}){
    if(!user){showAuth();throw new Error("Please sign in with your seller account to share a maker update.");}
    if(!accountRoles.includes("seller")) throw new Error("Only approved seller accounts can publish Community progress updates.");
    const cleanBody=String(body||"").trim();
    if(!cleanBody||cleanBody.length>5000)throw new Error("Add a caption before sharing.");
    let mediaUrl=null,mediaType=null,storagePath=null;
    if(file){
      const allowed=["image/jpeg","image/png","image/webp","image/avif","video/mp4","video/webm"];
      if(!allowed.includes(file.type))throw new Error("Choose a JPG, PNG, WebP, AVIF, MP4 or WebM file.");
      if(file.size>50*1024*1024)throw new Error("Media must be 50 MB or smaller.");
      if(file.type.startsWith("video/")){const duration=await getMakerVideoDuration(file);if(!Number.isFinite(duration)||duration<=0||duration>60)throw new Error("Maker videos must be 60 seconds or shorter.");}
      const extension=(file.name.split(".").pop()||"bin").toLowerCase();
      storagePath=user.id+"/"+crypto.randomUUID()+"."+extension;
      const uploaded=await client.storage.from("community-media").upload(storagePath,file,{upsert:false});
      if(uploaded.error)throw uploaded.error;
      mediaUrl=client.storage.from("community-media").getPublicUrl(storagePath).data.publicUrl;
      mediaType=file.type.startsWith("video/")?"video":"image";
    }
    const {error}=await client.from("community_posts").insert({
      author_id:user.id,author_name:(profile&&profile.display_name)||"Bigwizz maker",
      title:cleanBody.slice(0,160)||"Maker update",category:String(category||"Craftsmanship").slice(0,60),
      body:cleanBody,caption:cleanBody,media_url:mediaUrl,media_type:mediaType,product_id:productId||null,
      image_url:mediaType==="image"?mediaUrl:null,status:"pending"
    });
    if(error){if(storagePath)await client.storage.from("community-media").remove([storagePath]);throw error;}
    await loadCommunityPosts();renderCommunity();
  }
  async function submitCommunityComment({postId,body}){
    if(!user){showAuth();throw new Error("Please sign in to comment.");}
    if(accountRoles.includes("seller")) throw new Error("Seller accounts can read comments but cannot reply.");
    const cleanBody=String(body||"").trim();if(!postId||!cleanBody||cleanBody.length>5000)throw new Error("Write a comment before submitting.");
    const {error}=await client.from("community_comments").insert({post_id:postId,author_id:user.id,author_name:(profile&&profile.display_name)||"Community member",body:cleanBody,status:"pending"});
    if(error)throw error;return loadCommunityComments(postId);
  }



  async function updateSellerOrderStatus(orderId,nextStatus){
    if(!user||!accountRoles.includes("seller"))throw new Error("A seller account is required.");
    if(!["processing","shipped","completed","cancelled"].includes(nextStatus))throw new Error("That order status is not allowed.");
    const {data,error}=await client.from("orders").update({status:nextStatus}).eq("id",orderId).eq("seller_id",user.id).select("id,order_number,status").maybeSingle();
    if(error)throw error;
    if(!data)throw new Error("Only paid orders can be moved through fulfilment. Payment must be confirmed first.");
    await loadSellerStudio();
    notify("Order "+data.order_number+" updated to "+data.status+". The buyer has been notified.");
  }

  async function loadBuyerOrders(){
    const target=document.getElementById("buyer-orders-list");
    if(!target)return;
    if(!user){target.innerHTML='<p class="notice">Sign in to view your orders.</p>';return;}
    target.innerHTML='<p class="notice">Loading your orders…</p>';
    const {data,error}=await client.from("orders").select("id,order_number,seller_id,status,currency,seller_subtotal,platform_fee,total,created_at,order_items(id,title_snapshot,seller_name_snapshot,unit_price,quantity,variant_size,variant_color),payment_records(provider,status,amount,currency)").eq("buyer_id",user.id).order("created_at",{ascending:false});
    if(error){target.innerHTML='<p class="notice">Your orders could not be loaded.</p>';report(error,"Your orders could not be loaded.");return;}
    const money=(amount,code="NGN")=>new Intl.NumberFormat("en-NG",{style:"currency",currency:code||"NGN",maximumFractionDigits:2}).format(Number(amount||0));
    target.innerHTML=data.length?data.map(order=>{
      const items=(order.order_items||[]).map(item=>'<li>'+escapeHtml(item.title_snapshot)+' × '+item.quantity+((item.variant_size||item.variant_color)?' <small>('+escapeHtml([item.variant_size&&"Size: "+item.variant_size,item.variant_color&&"Color: "+item.variant_color].filter(Boolean).join(" · "))+')</small>':'')+'</li>').join("");
      const payment=order.payment_records?.[0];
      return '<article class="seller-order-card buyer-order-card"><div><strong>'+escapeHtml(order.order_number)+'</strong><small>'+new Date(order.created_at).toLocaleString()+' · '+(payment?.status==="paid"?"Paid":"Payment pending")+'</small><ul class="buyer-order-lines">'+items+'</ul><small>Items: '+money(order.seller_subtotal,order.currency)+' · Bigwizz fee: '+money(order.platform_fee,order.currency)+'</small><strong class="buyer-order-total">Total: '+money(order.total,order.currency)+'</strong></div><span class="seller-order-status">'+escapeHtml(order.status)+'</span></article>';
    }).join(""):'<p class="notice">You have not placed any orders yet. Products you order will appear here.</p>';
  }

  async function checkoutCart(){
    if(!user){showAuth();throw new Error("Please sign in before checkout.");}
    const {data,error}=await client.rpc("checkout_cart");
    if(error)throw error;
    if(!Array.isArray(data)||!data.length)throw new Error("No orders were created. Check your cart and try again.");
    await Promise.all([loadCart(),loadBuyerOrders(),loadNotifications()]);
    if(typeof activatePage==="function")activatePage("orders");
    notify("Your order(s) "+data.map(order=>order.order_number).join(", ")+" have been saved. Payment is not yet available.");
    return data;
  }

  async function loadSellerStudio(){
    if(!user||!accountRoles.includes("seller"))return;
    const ids=["seller-products-list","seller-orders-list","seller-action-items"];
    ids.forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML='<p class="notice">Loading store data…</p>';});
    const results=await Promise.all([
      client.from("seller_profiles").select("shop_name,seller_type").eq("user_id",user.id).maybeSingle(),
      client.from("listings").select("id,title,kind,price,currency,image_url,status,created_at").eq("seller_id",user.id).order("created_at",{ascending:false}),
      client.from("orders").select("id,order_number,status,total,currency,seller_subtotal,platform_fee,created_at,order_items(id,title_snapshot,quantity,unit_price,variant_size,variant_color),payment_records(status,provider)").eq("seller_id",user.id).order("created_at",{ascending:false}).limit(100),
      client.from("service_requests").select("id,service_title,status,created_at").eq("provider_id",user.id).order("created_at",{ascending:false}).limit(100),
      client.from("order_reports").select("id,order_id,order_reference,issue_type,notes,status,created_at").order("created_at",{ascending:false}).limit(100)
    ]);
    const [shopResult,productsResult,ordersResult,requestsResult,reportsResult]=results;
    for(const pair of [[shopResult,"Seller profile"],[productsResult,"Seller products"],[ordersResult,"Seller orders"],[requestsResult,"Customer requests"],[reportsResult,"Buyer order reports"]]){
      if(pair[0].error)throw new Error(pair[1]+" could not be loaded: "+pair[0].error.message);
    }
    const shop=shopResult.data||{};
    sellerShopName=shop.shop_name||sellerShopName||profile?.display_name||user.email?.split("@")[0]||"Seller";
    sellerProfileReady=true;
    await loadMyListings();
    const displayName=sellerShopName;
    const nameNode=document.getElementById("seller-welcome-name");
    const avatarNode=document.getElementById("seller-studio-avatar");
    if(nameNode)nameNode.textContent=displayName;
    if(avatarNode)avatarNode.textContent=initials(displayName);
    const products=productsResult.data||[],orders=ordersResult.data||[],requests=requestsResult.data||[],reports=reportsResult.data||[];
    const reviewResults=products.length?await Promise.all([
      client.from("listing_reviews").select("listing_id,rating,body,reviewer_name,created_at").in("listing_id",products.map(item=>item.id)).order("created_at",{ascending:false}),
      client.from("product_reviews").select("product_key,rating,body,reviewer_name,created_at").in("product_key",products.map(item=>String(item.id))).order("created_at",{ascending:false})
    ]):[{data:[],error:null},{data:[],error:null}];
    const reviewError=reviewResults.find(result=>result.error)?.error;
    if(reviewError)throw new Error("Customer reviews could not be loaded: "+reviewError.message);
    const reviews=[
      ...(reviewResults[0].data||[]),
      ...(reviewResults[1].data||[]).map(item=>({...item,listing_id:item.product_key}))
    ].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    const averageRating=reviews.length?reviews.reduce((sum,item)=>sum+Number(item.rating),0)/reviews.length:0;
    const today=new Date().toLocaleDateString("en-CA");
    const paidStatuses=["paid","processing","shipped","completed","delivered"];
    const todaysOrders=orders.filter(order=>new Date(order.created_at).toLocaleDateString("en-CA")===today&&paidStatuses.includes(String(order.status||"").toLowerCase()));
    const todayValue=todaysOrders.reduce((sum,order)=>sum+Number(order.seller_subtotal||order.total||0),0);
    const chartDates=Array.from({length:7},(_,index)=>{const date=new Date();date.setHours(0,0,0,0);date.setDate(date.getDate()-(6-index));return date;});
    const dailyTotals=chartDates.map(date=>{const key=date.toLocaleDateString("en-CA");return orders.filter(order=>new Date(order.created_at).toLocaleDateString("en-CA")===key&&paidStatuses.includes(String(order.status||"").toLowerCase())).reduce((sum,order)=>sum+Number(order.seller_subtotal||order.total||0),0);});
    const chartDays=document.getElementById("seller-chart-days");
    if(chartDays)chartDays.innerHTML=chartDates.map(date=>"<span>"+escapeHtml(date.toLocaleDateString("en",{weekday:"short"}))+"</span>").join("");
    const maxDaily=Math.max(1,...dailyTotals);
    const points=dailyTotals.map((amount,index)=>({x:index*560/6,y:102-(amount/maxDaily)*82}));
    const linePath=points.map((point,index)=>(index?"L":"M")+point.x.toFixed(1)+" "+point.y.toFixed(1)).join(" ");
    const line=document.getElementById("seller-sales-chart-line"),fill=document.getElementById("seller-sales-chart-fill");
    if(line)line.setAttribute("d",linePath);
    if(fill)fill.setAttribute("d",linePath+" L560 112 L0 112 Z");
    const money=(amount,currencyCode="NGN")=>new Intl.NumberFormat("en-NG",{style:"currency",currency:currencyCode||"NGN",maximumFractionDigits:2}).format(Number(amount||0));
    const setText=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=String(value);};
    setText("seller-today-sales",money(todayValue));
    setText("seller-sales-trend",todaysOrders.length?String(todaysOrders.length)+" today":"—");
    setText("seller-order-count",orders.length);
    setText("seller-product-count",products.filter(item=>item.status==="published").length);
    setText("seller-request-count",requests.filter(item=>["new","responded"].includes(item.status)).length);
    setText("seller-average-rating",reviews.length?averageRating.toFixed(1)+" / 5":"—");
    setText("seller-review-count",reviews.length);
    const productCard=item=>'<article class="seller-product-card"><img src="'+escapeHtml(item.image_url||"assets/ceramic-set.jpg")+'" alt=""><div class="seller-product-copy"><strong>'+escapeHtml(item.title)+'</strong><small>'+(item.status==="published"?"Published":"Paused")+' · '+(item.price===null?"Quote":money(item.price,item.currency))+'</small></div><button type="button" data-page="seller-products">Manage</button></article>';
    const productMarkup=products.length?products.map(productCard).join(""):'<p class="notice">No products yet. Your first listing will appear here once published.</p>';
    const allProducts=document.getElementById("seller-products-list");
    if(allProducts)allProducts.innerHTML=productMarkup;
    const orderMarkup=orders.length?orders.slice(0,50).map(order=>{
      const payment=order.payment_records?.[0],status=String(order.status||"pending").toLowerCase();
      const lines=(order.order_items||[]).map(item=>'<li>'+escapeHtml(item.title_snapshot)+' × '+item.quantity+((item.variant_size||item.variant_color)?' <small>('+escapeHtml([item.variant_size&&"Size: "+item.variant_size,item.variant_color&&"Color: "+item.variant_color].filter(Boolean).join(" · "))+')</small>':'')+'</li>').join("");
      const next=status==="pending"?"processing":status==="processing"?"shipped":status==="shipped"?"completed":null;
      const actionLabel=next==="processing"?"Start fulfilment":next==="shipped"?"Mark shipped":next==="completed"?"Mark completed":"";
      const action=payment?.status==="paid"&&next?'<button type="button" data-seller-order-status="'+next+'" data-order-id="'+escapeHtml(order.id)+'">'+actionLabel+'</button>':"";
      return '<article class="seller-order-card"><div><strong>'+escapeHtml(order.order_number||("Order "+String(order.id).slice(0,8)))+'</strong><small>'+new Date(order.created_at).toLocaleString()+' · '+money(order.total,order.currency)+' · '+(payment?.status==="paid"?"Paid":"Payment pending")+'</small><ul class="seller-order-lines">'+lines+'</ul>'+action+'</div><span class="seller-order-status">'+escapeHtml(status)+'</span></article>';
    }).join(""):'<p class="notice">No customer orders have been recorded yet. Buyer purchases will appear here.</p>';
    const orderTarget=document.getElementById("seller-orders-list");if(orderTarget)orderTarget.innerHTML=orderMarkup;
    const openRequests=requests.filter(item=>["new","responded"].includes(item.status));
    const pendingOrders=orders.filter(order=>["pending","processing","paid","confirmed","ready_to_ship"].includes(String(order.status||"").toLowerCase()));
    const actions=[];
    if(pendingOrders.length)actions.push('<div class="seller-action-item"><span class="seller-action-icon">⚠️</span><div class="seller-action-copy"><strong>'+pendingOrders.length+' Order(s) Pending Fulfilment</strong><small>Review order status and prepare dispatch</small></div><button type="button" data-page="seller-orders">View</button></div>');
    if(openRequests.length)actions.push('<div class="seller-action-item"><span class="seller-action-icon">✉️</span><div class="seller-action-copy"><strong>'+openRequests.length+' New Customer Request(s)</strong><small>Review formal service requests</small></div><button type="button" data-page="seller-orders">View</button></div>');
    if(products.some(item=>item.status==="paused"))actions.push('<div class="seller-action-item"><span class="seller-action-icon">▣</span><div class="seller-action-copy"><strong>Paused listings need attention</strong><small>'+products.filter(item=>item.status==="paused").length+' listing(s) are not visible to buyers</small></div><button type="button" data-page="seller-products">Review</button></div>');
    if(!actions.length)actions.push('<div class="seller-action-item"><span class="seller-action-icon">✓</span><div class="seller-action-copy"><strong>You are all caught up</strong><small>New orders and service requests will appear here.</small></div></div>');
    const actionTarget=document.getElementById("seller-action-items");if(actionTarget)actionTarget.innerHTML=actions.join("");
    const reportTarget=document.getElementById("seller-reports-list");
    if(reportTarget)reportTarget.innerHTML=reports.length?reports.map(item=>'<article class="seller-order-card"><div><strong>'+escapeHtml(item.order_reference||"Order report")+' · '+escapeHtml(item.issue_type)+'</strong><small>'+new Date(item.created_at).toLocaleString()+' · '+escapeHtml(item.status||"open")+'</small><p>'+escapeHtml(item.notes||"")+'</p></div></article>').join(""):'<p class="notice">No buyer order reports have been submitted.</p>';
    const reviewTarget=document.getElementById("seller-reviews-list");
    if(reviewTarget)reviewTarget.innerHTML=reviews.length?reviews.slice(0,50).map(item=>'<article class="seller-order-card"><div><strong>'+Number(item.rating).toFixed(0)+' / 5 · '+escapeHtml(item.reviewer_name||"Customer")+'</strong><small>'+new Date(item.created_at).toLocaleString()+'</small><p>'+escapeHtml(item.body||"")+'</p></div></article>').join(""):'<p class="notice">Customer reviews for your listings will appear here.</p>';
    return {shop,products,orders,requests,reports,reviews,todayValue};
  }

  window.BIGWIZZ_BACKEND=Object.freeze({beginAuth:(audience,mode="signin")=>{authAudience=audience==="seller"?"seller":"buyer";document.getElementById("auth-role").value=authAudience;showAuth(mode);},loadProductReviews,submitProductReview,loadListingReviews,submitListingReview,loadCommunityPosts,loadCommunityComments,submitCommunityPost,submitCommunityComment,toggleCommunityLike,loadCommunityProducts,loadSellerServiceRequests,loadBuyerServiceRequests,loadCart,changeCart,addCartItem,loadNotifications,markNotificationRead,uploadServiceRequestMedia,removeServiceRequestMedia,createServiceRequestWithMedia,respondToServiceRequest,getCurrentUser:()=>user,isSeller:()=>!!user&&accountRoles.includes("seller"),getActiveAccount:()=>activeAccount,setActiveAccount:(account)=>{if(account==="seller"&&(!user||!accountRoles.includes("seller")))return false;activeAccount=account==="seller"?"seller":"buyer";updateAccountState();activatePage(activeAccount==="seller"?"seller-studio":"discover");if(activeAccount==="seller")Promise.all([loadSellerStudio(),loadSellerServiceRequests()]).catch(error=>report(error,"Seller Studio could not be be loaded."));return true;},loadSellerStudio,loadBuyerOrders,checkoutCart,updateSellerOrderStatus,requireSignIn:()=>showAuth()});

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
      user ? "Switch account. Current account: " + (activeAccount === "seller" ? "Seller" : "Buyer") : "Switch account"
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
      title.textContent = `Create your ${authAudience} account`;
      summary.textContent = authAudience === "seller" ? "Create your seller sign-in to offer products and services on Bigwizz." : "Create your buyer sign-in to shop on Bigwizz.";
      submit.textContent = "Create account";
    } else if (mode === "reset") {
      title.textContent = `Reset ${authAudience} password`;
      summary.textContent = `We will email you a password reset link for your ${authAudience} account.`;
      submit.textContent = "Send reset link";
    } else {
      title.textContent = `Sign in to your ${authAudience} account`;
      summary.textContent = `Sign in to continue to your ${authAudience} account.`;
      submit.textContent = "Sign in";
    }
  }

  function showAuth(mode = "signin") {
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
    document.getElementById("account-entry").hidden = true;
    document.getElementById("marketplace-app").hidden = false;
  }

  function activatePage(page) {
    if (["messages", "inbox", "chat", "conversation"].includes(page)) page = "discover";
    if (["seller-studio", "seller-products", "seller-orders"].includes(page) && (!user || !accountRoles.includes("seller"))) page = "discover";
    document.querySelectorAll(".page").forEach(section => {
      section.classList.toggle("active", section.id === page);
    });
    document.body.classList.toggle("seller-mode", ["seller-studio", "seller-products", "seller-orders"].includes(page));
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
    const communityPublishButton = document.getElementById("new-post");
    if (communityPublishButton) communityPublishButton.hidden = !(user && activeAccount === "seller" && accountRoles.includes("seller"));
    renderAccountMenu();
    setProfileDisplay(profile ? profile.display_name : user ? user.email : "Guest");
  }

  async function loadCatalog() {
    const { data: rows, error } = await client
      .from("listings")
      .select("id,seller_id,kind,category,title,description,seller_name,price,currency,image_url,rating,rating_count,size_type,sizes,colors,color_images,seller_profiles(service_area,country,state,city,area,latitude,longitude)")
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
      currency: row.currency||"NGN",
      image: row.image_url,
      seller: row.seller_name,
      sizeType:row.size_type||"other",
      sizes:Array.isArray(row.sizes)?row.sizes:[],
      colors:Array.isArray(row.colors)?row.colors:[],
      colorImages:row.color_images&&typeof row.color_images==="object"?row.color_images:{},
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
    sellerProfileReady = false;
    if (accountRoles.includes("seller")) {
      const {data:sellerData,error:sellerError}=await client.from("seller_profiles").select("shop_name,seller_type,availability_status").eq("user_id",user.id).maybeSingle();
      if(sellerError)throw sellerError;
      let sellerRecord=sellerData;
      if(!sellerRecord){
        const fallbackShop=(profile.display_name||user.email?.split("@")[0]||"Seller")+"’s Shop";
        const created=await client.from("seller_profiles").insert({user_id:user.id,shop_name:fallbackShop,seller_type:"Goods and services",offering_description:"",country:profile.country||"Nigeria",state:profile.state||null,city:profile.city||null,area:profile.area||null}).select("shop_name,seller_type,availability_status").single();
        if(created.error)throw created.error;
        sellerRecord=created.data;
      }
      sellerShopName=sellerRecord.shop_name||profile.display_name||"Bigwizz Seller";
      sellerAvailabilityStatus=sellerRecord.availability_status||"available";
      sellerProfileReady=true;
    } else {
      sellerShopName="";
      sellerAvailabilityStatus="available";
    }
    activeAccount = accountRoles.includes("seller") ? "seller" : "buyer";
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
      const badge = document.getElementById("cart-count");
      const itemsContainer = document.getElementById("cart-items");
      const summary = document.getElementById("cart-summary");
      if (badge) { badge.hidden = true; badge.textContent = "0"; }
      if (itemsContainer) itemsContainer.innerHTML = '<div class="empty">Sign in to view your cart.</div>';
      if (summary) summary.hidden = true;
      showAuth();
      return;
    }
    const { data, error } = await client.from("cart_items")
      .select("listing_id,quantity,variant_size,variant_color,listings(id,title,seller_name,image_url,price,kind)")
      .eq("user_id", user.id);
    if (error) {
      const itemsContainer = document.getElementById("cart-items");
      const summary = document.getElementById("cart-summary");
      if (itemsContainer) itemsContainer.innerHTML = '<div class="empty">Your cart could not be loaded. Please try again.</div>';
      if (summary) summary.hidden = true;
      report(error, "Your shared cart could not be loaded.");
      return;
    }
    const items = (data || []).filter(row => row.listings && row.listings.kind === "goods");
    const cartItems = items.map(row => ({
      listingId: row.listing_id,
      title: row.listings.title,
      seller: row.listings.seller_name,
      image: row.listings.image_url,
      sellerPrice: Number(row.listings.price),
      quantity: Number(row.quantity),
      size: row.variant_size || "",
      color: row.variant_color || ""
    }));
    const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
    const cartBadge = document.getElementById("cart-count");
    if (cartBadge) {
      cartBadge.hidden = cartCount === 0;
      cartBadge.textContent = cartCount > 99 ? "99+" : String(cartCount);
      cartBadge.setAttribute("aria-label", `${cartCount} item${cartCount === 1 ? "" : "s"} in cart`);
    }
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
      const variantText = [row.variant_size ? `Size: ${escapeHtml(row.variant_size)}` : "", row.variant_color ? `Color: ${escapeHtml(row.variant_color)}` : ""].filter(Boolean).join(" · ");
      const variantAttrs = `data-cart-size="${escapeHtml(row.variant_size || "")}" data-cart-color="${escapeHtml(row.variant_color || "")}"`;
      return `<article class="cart-item">
        <img src="${escapeHtml(item.image_url)}" alt="">
        <div class="cart-item-info"><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.seller_name)}</p>
          ${variantText ? `<small>${variantText}</small>` : ""}
          <strong>${currency.format(buyerPrice)} each</strong>
          <small>Includes ${currency.format(buyerPrice - Number(item.price))} Bigwizz fee</small>
        </div>
        <div class="cart-item-actions">
          <button type="button" aria-label="Decrease quantity of ${escapeHtml(item.title)}" data-cart-action="decrease" data-cart-id="${item.id}" ${variantAttrs}>−</button>
          <span>${row.quantity}</span>
          <button type="button" aria-label="Increase quantity of ${escapeHtml(item.title)}" data-cart-action="increase" data-cart-id="${item.id}" ${variantAttrs}>+</button>
          <button type="button" class="cart-remove" data-cart-action="remove" data-cart-id="${item.id}" ${variantAttrs}>Remove</button>
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
      <button class="primary" type="button" data-checkout-demo>Place order</button>
      <p class="notice">Your order will be sent to the seller. Online payment is not enabled yet.</p>`;
  }

  async function changeCart(listingId, action, options = {}) {
    if (!user) { showAuth(); return; }
    const variantSize = String(options.size || "");
    const variantColor = String(options.color || "");
    const filters = query => query.eq("user_id", user.id).eq("listing_id", listingId).eq("variant_size", variantSize).eq("variant_color", variantColor);
    const { data, error } = await filters(client.from("cart_items").select("quantity")).maybeSingle();
    if (error) throw error;
    if (action === "remove" || (action === "decrease" && data && Number(data.quantity) <= 1)) {
      const result = await filters(client.from("cart_items").delete());
      if (result.error) throw result.error;
    } else {
      if (!data && action === "decrease") throw new Error("This cart variant is no longer available.");
      const quantity = action === "increase" ? Math.min(99, (data ? Number(data.quantity) : 0) + 1) : Number(data.quantity) - 1;
      const result = await client.from("cart_items").upsert({ user_id: user.id, listing_id: listingId, variant_size: variantSize, variant_color: variantColor, quantity }, { onConflict: "user_id,listing_id,variant_size,variant_color" });
      if (result.error) throw result.error;
    }
    await loadCart();
  }

  async function addCartItem(listingId, options = {}) {
    if (!user) { showAuth(); return; }
    const variantSize = String(options.size || "").trim();
    const variantColor = String(options.color || "").trim();
    const item = listings.find(row => row.id === listingId);
    if (!item || item.basePrice === null || item.basePrice === undefined) { notify("This item cannot be added to the cart."); return; }
    // The product detail UI enforces required options; blank values represent non-applicable variants.
    const cartResult = await client.from("carts").upsert({ user_id: user.id }, { onConflict: "user_id" });
    if (cartResult.error) throw cartResult.error;
    const current = await client.from("cart_items").select("quantity")
      .eq("user_id", user.id).eq("listing_id", listingId).eq("variant_size", variantSize).eq("variant_color", variantColor).maybeSingle();
    if (current.error) throw current.error;
    const result = await client.from("cart_items").upsert({
      user_id: user.id, listing_id: listingId, variant_size: variantSize, variant_color: variantColor,
      quantity: Math.min(99, (current.data ? Number(current.data.quantity) : 0) + 1)
    }, { onConflict: "user_id,listing_id,variant_size,variant_color" });
    if (result.error) throw result.error;
    await loadCart();
    notify("Added to your cart.");
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
    if(!user){showAuth();return;}
    if(!accountRoles.includes("seller")||!sellerProfileReady)throw new Error("Complete seller account setup before publishing listings.");
    const form=event.currentTarget,submit=document.getElementById("seller-listing-submit");
    submit.disabled=true;
    try{
      const values=new FormData(form);
      const title=String(values.get("title")||"").trim();
      const description=String(values.get("description")||"").trim();
      const kind=String(values.get("type")||"");
      const category=String(values.get("category")||"").trim();
      const pricingMode=kind==="service"?String(values.get("pricingMode")||"fixed"):"fixed";
      const rawPrice=String(values.get("price")||"").trim();
      const price=kind==="service"&&pricingMode==="quote"?null:Number(rawPrice);
      if(!title||title.length>80||!description||!category||!["goods","service"].includes(kind))throw new Error("Complete the title, category, type and description.");
      if(price!==null&&(!Number.isFinite(price)||price<=0))throw new Error("Enter a valid listing price.");
      if(price===null&&!(kind==="service"&&pricingMode==="quote"))throw new Error("Enter a price or choose quotation required.");
      const existing=remoteEditingId?await client.from("listings").select("id,status,image_url,color_images").eq("id",remoteEditingId).eq("seller_id",user.id).single():{data:null,error:null};
      if(existing.error)throw existing.error;
      const file=document.getElementById("seller-listing-image").files[0];
      const imageUrl=await uploadListingImage(file)||(existing.data&&existing.data.image_url);
      if(!imageUrl)throw new Error("Upload a product or service photo before publishing.");
      const sizeType=kind==="goods"?String(values.get("sizeType")||"other"):"other";
      const sizes=["clothing","shoes","caps"].includes(sizeType)?String(values.get("sizes")||"").split(",").map(value=>value.trim()).filter(Boolean):[];
      const colors=kind==="goods"?String(values.get("colors")||"").split(",").map(value=>value.trim()).filter(Boolean):[];
      const row={seller_id:user.id,kind,category,title,description,seller_name:sellerShopName,price:price===null?null:Math.round((price+Number.EPSILON)*100)/100,currency:"NGN",pricing_mode:pricingMode,image_url:imageUrl,status:existing.data?existing.data.status:"published",size_type:sizeType,sizes,colors,color_images:existing.data?.color_images||{}};
      const result=remoteEditingId?await client.from("listings").update(row).eq("id",remoteEditingId).eq("seller_id",user.id):await client.from("listings").insert(row);
      if(result.error)throw result.error;
      if(kind==="service"){
        const availability=String(values.get("serviceAvailability")||sellerAvailabilityStatus||"available");
        const profileUpdate=await client.from("seller_profiles").update({is_public:true,availability_status:availability}).eq("user_id",user.id);
        if(profileUpdate.error)throw profileUpdate.error;
        sellerAvailabilityStatus=availability;
      }
      remoteEditingId=null;form.reset();
      document.getElementById("seller-listing-submit").textContent="Publish listing";
      document.getElementById("seller-listing-cancel").hidden=true;
      document.getElementById("seller-service-pricing-mode").disabled=false;
      document.getElementById("seller-listing-price").disabled=false;
      await Promise.all([loadMyListings(),loadCatalog(),loadSellerStudio()]);
      notify("Your listing is live in the Bigwizz marketplace.");
    }catch(error){report(error,error.message||"Listing could not be saved.");}
    finally{submit.disabled=false;}
  }

  async function updateListing(action, listingId) {
    if (!user) {
      showAuth();
      return;
    }
    const row = await client.from("listings")
      .select("id,title,kind,category,description,price,pricing_mode,image_url,status,size_type,sizes,colors")
      .eq("id", listingId).eq("seller_id", user.id).single();
    if (row.error) throw row.error;
    if (action === "edit") {
      const item=row.data;
      remoteEditingId=item.id;
      document.getElementById("seller-listing-title").value=item.title||"";
      document.getElementById("seller-listing-type").value=item.kind||"goods";
      document.getElementById("seller-listing-category").value=item.category||"";
      document.getElementById("seller-size-type").value=item.size_type||"other";
      document.getElementById("seller-listing-sizes").value=(item.sizes||[]).join(", ");
      document.getElementById("seller-listing-colors").value=(item.colors||[]).join(", ");
      document.getElementById("seller-listing-type").dispatchEvent(new Event("change",{bubbles:true}));
      document.getElementById("seller-size-type").dispatchEvent(new Event("change",{bubbles:true}));
      document.getElementById("seller-service-pricing-mode").value=item.price===null?"quote":item.pricing_mode||"fixed";
      document.getElementById("seller-service-availability").value=sellerAvailabilityStatus;
      document.getElementById("seller-listing-price").value=item.price===null?"":String(item.price);
      document.getElementById("seller-listing-price").disabled=item.kind==="service"&&item.pricing_mode==="quote";
      document.getElementById("seller-listing-description").value=item.description||"";
      document.getElementById("seller-listing-submit").textContent="Save changes";
      document.getElementById("seller-listing-cancel").hidden=false;
      document.getElementById("seller-listing-form").scrollIntoView({behavior:"smooth",block:"start"});
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
    const orderReference=String(values.get("order")||"").trim();
    const {data:order,error:orderLookupError}=await client.from("orders").select("id,order_number").eq("buyer_id",user.id).eq("order_number",orderReference).maybeSingle();
    if(orderLookupError){report(orderLookupError,"Your order could not be verified.");return;}
    if(!order){notify("Enter an order reference from one of your Bigwizz purchases.");return;}
    const { error } = await client.from("order_reports").insert({
      buyer_id: user.id,
      order_id: order.id,
      order_reference: order.order_number,
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
  async function uploadServiceRequestMedia({requestId,file,onProgress=()=>{}}){
    if(!user)throw new Error("Please sign in before uploading attachments.");
    const {data:{session},error:sessionError}=await client.auth.getSession();
    if(sessionError||!session?.access_token)throw new Error("Your sign-in session has expired. Please sign in again.");
    const safeName=String(file.name||"attachment").replace(/[^a-zA-Z0-9._-]/g,"_").slice(-100);
    const path=user.id+"/"+requestId+"/"+crypto.randomUUID()+"-"+safeName;
    await new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open("POST",config.url.replace(/\/$/,"")+"/storage/v1/object/service-request-media/"+path.split("/").map(encodeURIComponent).join("/"));
      xhr.setRequestHeader("Authorization","Bearer "+session.access_token);
      xhr.setRequestHeader("apikey",config.publishableKey);
      xhr.setRequestHeader("Content-Type",file.type||"application/octet-stream");
      xhr.setRequestHeader("x-upsert","false");
      xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(Math.round(event.loaded/event.total*100));};
      xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(new Error("Upload failed ("+xhr.status+")."));
      xhr.onerror=()=>reject(new Error("Network error while uploading."));
      xhr.onabort=()=>reject(new Error("Upload cancelled."));
      xhr.send(file);
    });
    return {path,metadata:{path,name:file.name,type:file.type,size:file.size}};
  }
  async function removeServiceRequestMedia(paths){
    if(!user||!paths?.length)return;
    await client.storage.from("service-request-media").remove(paths);
  }
  async function createServiceRequestWithMedia({listingId,providerId,serviceTitle,bookingTiming="now",preferredDate="",preferredTime="",city="",area="",details="",requestId,attachments=[]}){
    if(!user){showAuth();throw new Error("Please sign in before sending a service request.");}
    const targetProviderId=String(providerId||"");
    if(!listingId||!targetProviderId)throw new Error("This service listing is not connected to a provider account yet. Please choose a published service listing.");
    if(attachments.some(file=>!file?.path||!file.path.startsWith(user.id+"/"+requestId+"/")))throw new Error("One or more attachments are not ready. Please upload them again.");
    const scheduledAt=bookingTiming==="later"&&preferredDate&&preferredTime?new Date(preferredDate+"T"+preferredTime).toISOString():null;
    if(bookingTiming==="later"&&!scheduledAt)throw new Error("Choose a date and time for your scheduled request.");
    const {data:request,error}=await client.from("service_requests").insert({
      id:requestId,buyer_id:user.id,listing_id:listingId,provider_id:targetProviderId,service_title:String(serviceTitle||"").slice(0,200),
      request_type:bookingTiming==="later"?"Request a time":"Ask a question",booking_timing:bookingTiming,
      preferred_date:bookingTiming==="later"?preferredDate:null,preferred_time:bookingTiming==="later"?preferredTime:null,scheduled_at:scheduledAt,
      city:String(city||"").trim(),area:String(area||"").trim(),service_address:[city,area].filter(Boolean).join(", "),
      details:String(details||"").trim(),matching_mode:"direct",quote_currency:"NGN",attachments
    }).select("id").single();
    if(error)throw error;
    await Promise.all([loadBuyerServiceRequests(),loadSellerServiceRequests()]);
    return request;
  }
  async function loadSellerServiceRequests(){
    const target=document.getElementById("seller-service-request-list");if(!target)return;
    if(!user){target.innerHTML='<p class="notice">Sign in with your seller account to view customer requests.</p>';return;}
    if(!accountRoles.includes("seller")){target.innerHTML='<p class="notice">This workspace is available to approved seller accounts. Switch to your seller account or complete seller setup.</p>';return;}
    target.innerHTML='<p class="notice">Loading customer requests…</p>';
    const {data,error}=await client.from("service_requests").select("id,buyer_id,service_title,request_type,booking_timing,preferred_date,preferred_time,scheduled_at,city,area,details,status,quoted_amount,quote_currency,provider_response,attachments,created_at").eq("provider_id",user.id).order("created_at",{ascending:false});
    if(error){target.innerHTML='<p class="notice">Your service requests could not be loaded.</p>';report(error,"Seller service requests could not be loaded.");return;}
    await Promise.all((data||[]).map(async item=>{item.attachments=await Promise.all((item.attachments||[]).map(async file=>{const result=await client.storage.from("service-request-media").createSignedUrl(file.path,3600);return {...file,signedUrl:result.error?null:result.data.signedUrl};}));}));
    target.innerHTML=data.length?data.map(item=>`<article class="service-request-card" data-service-request-card="${escapeHtml(item.id)}"><div>
      <h4>${escapeHtml(item.service_title)}</h4><span class="service-request-status status-${escapeHtml(item.status)}">${escapeHtml(serviceStatusLabel(item.status))}</span>
      <p>${escapeHtml(item.details)}</p><small>Customer location: ${escapeHtml(item.city||"")} ${item.city&&item.area?" · ":""}${escapeHtml(item.area)}${serviceTimingLabel(item)} · Received ${new Date(item.created_at).toLocaleString()}</small>
      ${Array.isArray(item.attachments)&&item.attachments.length?`<div class="service-request-response"><b>Customer attachments</b><div>${item.attachments.map(file=>`<a href="${escapeHtml(file.signedUrl||"#")}" target="_blank" rel="noopener noreferrer">${escapeHtml(file.name||"View attachment")}</a>`).join(" · ")}</div></div>`:""}
      ${item.quoted_amount!==null?`<div class="service-request-response"><b>Quotation sent</b>${escapeHtml(item.quote_currency)} ${Number(item.quoted_amount).toFixed(2)}</div>`:""}
      ${item.provider_response?`<div class="service-request-response"><b>Your response</b>${escapeHtml(item.provider_response)}</div>`:""}
      ${["new","responded"].includes(item.status)?`<form class="seller-request-actions" data-service-response-form><input type="hidden" name="requestId" value="${escapeHtml(item.id)}"><div class="field"><label>Formal quotation amount (optional)</label><input name="quotedAmount" type="number" min="0" step="0.01" placeholder="Enter your price"></div><input type="hidden" name="providerResponse" value="A formal quotation was submitted through Bigwizz."><button class="primary" type="submit">Submit formal quotation</button><div class="seller-request-action-row"><button class="outline-button" type="button" data-service-request-action="accepted" data-request-id="${escapeHtml(item.id)}">Accept request</button><button class="outline-button" type="button" data-service-request-action="declined" data-request-id="${escapeHtml(item.id)}">Decline</button></div><small class="notice">No private messages or free-text replies are available.</small></form>`:""}
    </div></article>`).join(""):'<p class="notice">No customer service requests yet. New requests will appear here.</p>';
  }
  async function loadBuyerServiceRequests(){
    const target=document.getElementById("buyer-service-request-list");if(!target)return;
    if(!user){target.innerHTML='<p class="notice">Sign in to see your service requests.</p>';return;}
    target.innerHTML='<p class="notice">Loading your requests…</p>';
    const {data,error}=await client.from("service_requests").select("id,service_title,request_type,booking_timing,preferred_date,preferred_time,scheduled_at,city,area,details,status,quoted_amount,quote_currency,provider_response,created_at").eq("buyer_id",user.id).order("created_at",{ascending:false});
    if(error){target.innerHTML='<p class="notice">Your service requests could not be loaded.</p>';report(error,"Your service requests could not be loaded.");return;}
    target.innerHTML=data.length?data.map(item=>`<article class="service-request-card"><div><h4>${escapeHtml(item.service_title)}</h4>
      <span class="service-request-status status-${escapeHtml(item.status)}">${escapeHtml(serviceStatusLabel(item.status))}</span><p>${escapeHtml(item.details)}</p>
      <small>Your location: ${escapeHtml(item.city||"")} ${item.city&&item.area?" · ":""}${escapeHtml(item.area)} · ${serviceTimingLabel(item)} · Sent ${new Date(item.created_at).toLocaleString()}</small>
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
    notify(status==="accepted"?"You accepted the service request.":status==="declined"?"You declined the service request.":"Your formal quotation was submitted to the customer.");
  }
  async function loadInbox(){return loadSellerServiceRequests();}

  async function loadNotifications() {
    const list = document.getElementById("notification-list");
    const badge = document.getElementById("notification-count");
    const sellerBadge = document.getElementById("seller-notification-count");
    if (!user) {
      if (badge) { badge.hidden = true; badge.textContent = "0"; }
      if (sellerBadge) { sellerBadge.hidden = true; sellerBadge.textContent = "0"; }
      if (list) list.innerHTML = '<div class="empty">Sign in to view your notifications.</div>';
      showAuth();
      return;
    }
    if (list) list.innerHTML = '<p class="notice">Loading notifications…</p>';
    const { data, error } = await client.from("notifications")
      .select("id,title,body,kind,created_at,read_at")
      .eq("user_id", user.id).order("created_at", { ascending: false });
    if (error) {
      if (list) list.innerHTML = '<div class="empty">Notifications could not be loaded. Please try again.</div>';
      report(error, "Notifications could not be loaded.");
      return;
    }
    const rows = data || [];
    const unreadCount = rows.filter(item => !item.read_at).length;
    if (badge) {
      badge.hidden = unreadCount === 0;
      badge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
      badge.setAttribute("aria-label", `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`);
    }
    if (sellerBadge) {
      sellerBadge.hidden = unreadCount === 0;
      sellerBadge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
      sellerBadge.setAttribute("aria-label", `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`);
    }
    if (list) list.innerHTML = rows.length
      ? rows.map(item => `<article class="notification-card${item.read_at ? "" : " is-unread"}"><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p><small>${escapeHtml(item.kind || "Update")} · ${new Date(item.created_at).toLocaleString()}</small>${item.read_at ? "" : `<button type="button" class="notification-read" data-notification-read="${escapeHtml(item.id)}">Mark as read</button>`}</div></article>`).join("")
      : '<div class="empty">No notifications yet.</div>';
  }

  async function markNotificationRead(notificationId) {
    if (!user || !notificationId) return;
    const { error } = await client.from("notifications").update({ read_at: new Date().toISOString() })
      .eq("id", notificationId).eq("user_id", user.id).is("read_at", null);
    if (error) throw error;
    await loadNotifications();
  }

  async function handleSession(nextUser) {
    user = nextUser || null;
    if (!user) {
      profile = null;
      accountRoles = ["buyer"];
      activeAccount = "buyer";
      authAudience = "buyer";
      ["cart-count", "notification-count"].forEach(id => { const badge = document.getElementById(id); if (badge) { badge.hidden = true; badge.textContent = "0"; } });
      const cartItemsTarget = document.getElementById("cart-items");
      const cartSummaryTarget = document.getElementById("cart-summary");
      const notificationsTarget = document.getElementById("notification-list");
      if (cartItemsTarget) cartItemsTarget.innerHTML = '<div class="empty">Sign in to view your cart.</div>';
      if (cartSummaryTarget) cartSummaryTarget.hidden = true;
      if (notificationsTarget) notificationsTarget.innerHTML = '<div class="empty">Sign in to view your notifications.</div>';
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
      await Promise.all([loadCart(), loadNotifications()]);
      activeAccount = accountRoles.includes("seller") ? "seller" : "buyer";
      updateAccountState();
      activatePage(activeAccount === "seller" ? "seller-studio" : "discover");
      if (activeAccount === "seller") await Promise.all([loadSellerStudio(), loadSellerServiceRequests()]);
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
            notify(`Your ${authAudience} account has been created.`);
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
          notify(`You are signed in to your ${authAudience} account.`);
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
        const rows = await submitProductReview({ productKey: listingId, rating, text: body, reviewer });
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
    if(event.target.matches("[data-service-response-form]")){stop(event);const form=event.target,values=new FormData(form),submit=form.querySelector('[type="submit"]'),rawAmount=String(values.get("quotedAmount")||"").trim();submit.disabled=true;submit.textContent="Sending…";try{await respondToServiceRequest(String(values.get("requestId")),{status:"responded",quotedAmount:rawAmount===""?null:rawAmount,providerResponse:values.get("providerResponse")});}catch(error){report(error,error.message||"Your response could not be sent.");}finally{submit.disabled=false;submit.textContent="Submit formal quotation";}return;}
    if (event.target.id === "seller-listing-form") return saveSellerListing(event);
    if (event.target.id === "service-request-form") return submitServiceRequest(event);
    if(event.target.id==="community-post-form"){stop(event);const form=event.target,values=new FormData(form),submit=form.querySelector('[type="submit"]'),file=form.querySelector("[name=media]")?.files?.[0]||null,progress=document.getElementById("community-upload-progress"),preview=document.getElementById("community-media-preview");submit.disabled=true;submit.textContent=file?"Uploading…":"Publishing…";if(progress)progress.hidden=!file;try{await submitCommunityPost({title:values.get("title"),category:values.get("category"),body:values.get("body"),file,productId:values.get("productId")||null});form.reset();if(preview){preview.hidden=true;preview.innerHTML="";}document.getElementById("community-compose-dialog").close();notify("Your post was submitted and is awaiting review.");}catch(error){report(error,error.message||"Your post could not be submitted.");}finally{submit.disabled=false;submit.textContent="Share maker update";if(progress)progress.hidden=true;}return;}
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
    if(event.target.id==="seller-size-type"||event.target.id==="seller-listing-type"){
      const type=document.getElementById("seller-listing-type")?.value||"goods";
      const sizeType=document.getElementById("seller-size-type")?.value||"other";
      const service=type==="service";
      const sizeField=document.getElementById("seller-size-options-field");
      const colourField=document.getElementById("seller-colour-options-field");
      if(sizeField)sizeField.hidden=service||!["clothing","shoes","caps"].includes(sizeType);
      if(colourField)colourField.hidden=service;
      const pricing=document.getElementById("seller-service-pricing-field");
      const availability=document.getElementById("seller-service-availability-field");
      const mode=document.getElementById("seller-service-pricing-mode");
      const price=document.getElementById("seller-listing-price");
      if(pricing)pricing.hidden=!service;
      if(availability)availability.hidden=!service;
      if(mode)mode.disabled=!service;
      if(price){price.disabled=service&&mode?.value==="quote";price.required=!(service&&mode?.value==="quote");}
    }
    if(event.target.id==="seller-service-pricing-mode"){
      const price=document.getElementById("seller-listing-price");
      if(price)price.required=event.target.value!=="quote";
      if(price)price.disabled=event.target.value==="quote";
    }
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
      const form=document.getElementById("seller-listing-form");
      if(form)form.reset();
      const submit=document.getElementById("seller-listing-submit");
      if(submit)submit.textContent="Publish listing";
      event.target.closest("#seller-listing-cancel").hidden=true;
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
    const sellerOrderAction=event.target.closest("[data-seller-order-status]");
    if(sellerOrderAction){stop(event);updateSellerOrderStatus(sellerOrderAction.dataset.orderId,sellerOrderAction.dataset.sellerOrderStatus).catch(error=>report(error,error.message||"Order status could not be updated."));return;}
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

  }, true);

  document.addEventListener("click",async event=>{
    const readNotification=event.target.closest("[data-notification-read]");
    if(readNotification){stop(event);try{await markNotificationRead(readNotification.dataset.notificationRead);}catch(error){report(error,"Could not update this notification.");}return;}
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
    .on("postgres_changes",{event:"*",schema:"public",table:"community_post_likes"},async()=>{try{await loadCommunityPosts();renderCommunity();}catch(error){console.error("Community like live refresh failed.",error);}})
    .on("postgres_changes",{event:"*",schema:"public",table:"service_requests"},async payload=>{try{if(!user)return;const row=payload.new||payload.old;if(row?.buyer_id===user.id)await loadBuyerServiceRequests();if(row?.provider_id===user.id){await loadSellerServiceRequests();if(activeAccount==="seller")await loadSellerStudio();}}catch(error){console.error("Service request live refresh failed.",error);}})
    .on("postgres_changes",{event:"*",schema:"public",table:"notifications"},async payload=>{try{if(user&&(payload.new||payload.old)?.user_id===user.id)await loadNotifications();}catch(error){console.error("Notification live refresh failed.",error);}})
    .on("postgres_changes",{event:"*",schema:"public",table:"orders"},async payload=>{try{const row=payload.new||payload.old;if(!user||!row)return;if(row.seller_id===user.id&&activeAccount==="seller")await loadSellerStudio();if(row.buyer_id===user.id)await loadBuyerOrders();}catch(error){console.error("Order feed refresh failed.",error);}})
    .on("postgres_changes",{event:"*",schema:"public",table:"payment_records"},async()=>{try{if(user){if(activeAccount==="seller")await loadSellerStudio();await loadBuyerOrders();}}catch(error){console.error("Payment status refresh failed.",error);}})
    .on("postgres_changes",{event:"*",schema:"public",table:"listings"},async payload=>{try{if(user&&(payload.new||payload.old)?.seller_id===user.id&&activeAccount==="seller")await loadSellerStudio();}catch(error){console.error("Seller product refresh failed.",error);}})
    .on("postgres_changes",{event:"*",schema:"public",table:"listing_reviews"},async()=>{try{if(user&&activeAccount==="seller")await loadSellerStudio();}catch(error){console.error("Seller review refresh failed.",error);}})
    .on("postgres_changes",{event:"*",schema:"public",table:"product_reviews"},async()=>{try{if(user&&activeAccount==="seller")await loadSellerStudio();}catch(error){console.error("Seller product review refresh failed.",error);}})
    .on("postgres_changes",{event:"*",schema:"public",table:"order_reports"},async()=>{try{if(user&&activeAccount==="seller")await loadSellerStudio();}catch(error){console.error("Seller report refresh failed.",error);}})
    .subscribe();
  client.auth.getSession().then(({ data, error }) => {
    if (error) report(error, "Could not check the current sign-in session.");
    else handleSession(data.session && data.session.user);
  });
  document.querySelectorAll('[data-page="services"]').forEach(button => button.addEventListener("click", () => {
    window.setTimeout(loadBuyerServiceRequests, 100);
  }));
})();
