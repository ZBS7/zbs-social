const state = {
  token: localStorage.getItem("zbs_token") || "",
  viewer: null,
  feed: [],
  bookmarks: [],
  trends: [],
  searchResults: null,
  profile: null,
  admin: null,
  activeView: "home",
  composerImageUrl: "",
  editingPostId: "",
  expandedComments: {},
  expandedReplies: {},
  profileAvatarImage: "",
  profileBannerImage: ""
};

const authPanel = document.getElementById("authPanel");
const workspace = document.getElementById("workspace");
const authStatus = document.getElementById("authStatus");
const content = document.getElementById("content");
const trends = document.getElementById("trends");
const viewerCard = document.getElementById("viewerCard");
const composerInput = document.getElementById("composerInput");
const composerCount = document.getElementById("composerCount");
const viewTitle = document.getElementById("viewTitle");
const composerBlock = document.getElementById("composerBlock");
const searchInput = document.getElementById("searchInput");
const composerModal = document.getElementById("composerModal");
const composerImageInput = document.getElementById("composerImageInput");
const imagePreviewWrap = document.getElementById("imagePreviewWrap");
const imagePreview = document.getElementById("imagePreview");
const mobileBottomNav = document.getElementById("mobileBottomNav");
const profileModal = document.getElementById("profileModal");
const profileNameInput = document.getElementById("profileNameInput");
const profileUsernameInput = document.getElementById("profileUsernameInput");
const profileBioInput = document.getElementById("profileBioInput");
const profileColorInput = document.getElementById("profileColorInput");
const profileStatus = document.getElementById("profileStatus");
const profileAvatarInput = document.getElementById("profileAvatarInput");
const profileBannerInput = document.getElementById("profileBannerInput");
const profileAvatarPreviewWrap = document.getElementById("profileAvatarPreviewWrap");
const profileAvatarPreview = document.getElementById("profileAvatarPreview");
const profileBannerPreviewWrap = document.getElementById("profileBannerPreviewWrap");
const profileBannerPreview = document.getElementById("profileBannerPreview");
const adminNavBtn = document.getElementById("adminNavBtn");
const adminMobileBtn = document.getElementById("adminMobileBtn");

function setStatus(message, isError = false) {
  authStatus.textContent = message || "";
  authStatus.style.color = isError ? "var(--danger)" : "var(--accent)";
}

function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  return fetch(path, { ...options, headers }).then(async response => {
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(data.error || "Request failed");
    }
    return data;
  });
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function initials(name) {
  return String(name || "")
    .split(" ")
    .map(part => part[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function verificationBadge(user) {
  return user && user.isVerified ? '<span class="verified-badge">✔</span>' : "";
}

function avatarTemplate(user, className = "avatar") {
  const image = user && user.avatarImage
    ? `<img src="${user.avatarImage}" alt="${escapeHtml(user.name)}" />`
    : `<span>${initials(user?.name || "U")}</span>`;
  return `<div class="${className}" style="background:${user?.avatarColor || "#888"}">${image}</div>`;
}

function authorMeta(user) {
  return `${escapeHtml(user.name)} ${verificationBadge(user)}<div class="username">@${escapeHtml(user.username)}</div>`;
}

function authorCard(user) {
  return `
    <button class="author-link" data-action="profile" data-username="${user.username}">
      ${avatarTemplate(user)}
      <div>${authorMeta(user)}</div>
    </button>
  `;
}

function setComposerImage(imageUrl) {
  state.composerImageUrl = imageUrl || "";
  imagePreviewWrap.classList.toggle("hidden", !state.composerImageUrl);
  imagePreview.src = state.composerImageUrl || "";
}

function setProfileImagePreview(type, value) {
  if (type === "avatar") {
    state.profileAvatarImage = value || "";
    profileAvatarPreviewWrap.classList.toggle("hidden", !state.profileAvatarImage);
    profileAvatarPreview.src = state.profileAvatarImage || "";
    return;
  }
  state.profileBannerImage = value || "";
  profileBannerPreviewWrap.classList.toggle("hidden", !state.profileBannerImage);
  profileBannerPreview.src = state.profileBannerImage || "";
}

function resetComposer() {
  state.editingPostId = "";
  composerInput.value = "";
  composerCount.textContent = "0 / 280";
  composerImageInput.value = "";
  setComposerImage("");
  document.getElementById("publishBtn").textContent = "Опубликовать";
}

function toggleAdminButtons() {
  const visible = Boolean(state.viewer?.isAdmin);
  adminNavBtn.classList.toggle("hidden", !visible);
  adminMobileBtn.classList.toggle("hidden", !visible);
}

function openComposer() {
  composerModal.classList.remove("hidden");
  composerInput.focus();
}

function closeComposer() {
  composerModal.classList.add("hidden");
}

function openProfileEditor() {
  if (!state.profile?.profile?.isMe) {
    return;
  }
  const profile = state.profile.profile;
  profileNameInput.value = profile.name || "";
  profileUsernameInput.value = profile.username || "";
  profileBioInput.value = profile.bio || "";
  profileColorInput.value = profile.avatarColor || "#ffd84d";
  setProfileImagePreview("avatar", profile.avatarImage || "");
  setProfileImagePreview("banner", profile.bannerImage || "");
  profileAvatarInput.value = "";
  profileBannerInput.value = "";
  profileStatus.textContent = "";
  profileModal.classList.remove("hidden");
}

function closeProfileEditor() {
  profileModal.classList.add("hidden");
}

function setActiveNav() {
  document.querySelectorAll(".nav-link, .mobile-nav-link").forEach(button => {
    button.classList.toggle("active", button.dataset.view === state.activeView);
  });
}

function actionButton(icon, count, action, idKey, idValue, isActive = false) {
  return `
    <button class="action-btn ${isActive ? "active" : ""}" data-action="${action}" data-${idKey}="${idValue}">
      <span class="action-label"><span class="action-icon">${icon}</span><span>${count}</span></span>
    </button>
  `;
}

function authorLikeBadge(isLiked) {
  return isLiked ? '<span class="author-like-badge">Лайк автора</span>' : "";
}

function replyKey(commentId, replyId) {
  return `${commentId}:${replyId}`;
}

function isRepliesExpanded(commentId, replyId) {
  return Boolean(state.expandedReplies[replyId ? replyKey(commentId, replyId) : commentId]);
}
function moderationActions(postId, commentId = "", replyId = "") {
  if (!state.viewer?.isAdmin) {
    return "";
  }
  if (replyId) {
    return `<button class="mini-action" data-action="admin-delete-reply" data-post-id="${postId}" data-comment-id="${commentId}" data-reply-id="${replyId}">Удалить</button>`;
  }
  if (commentId) {
    return `<button class="mini-action" data-action="admin-delete-comment" data-post-id="${postId}" data-comment-id="${commentId}">Удалить</button>`;
  }
  return `<button class="action-btn danger-btn" data-action="admin-delete-post" data-post-id="${postId}"><span class="action-icon">×</span></button>`;
}

function replyFormTemplate(postId, commentId, parentReplyId = "") {
  const parentAttr = parentReplyId ? ` data-parent-reply-id="${parentReplyId}"` : "";
  return `
    <form class="comment-form" data-action="reply-form" data-post-id="${postId}" data-comment-id="${commentId}"${parentAttr}>
      <input name="reply" maxlength="220" placeholder="Ответить" required />
      <button class="action-btn" type="submit">↩</button>
    </form>
  `;
}

function buildReplyNode(postId, commentId, reply, depth = 1) {
  const canDelete = state.viewer && state.viewer.id === reply.author.id;
  const expanded = isRepliesExpanded(commentId, reply.id);
  return `
    <div class="reply-item">
      <div class="comment-head">
        <button class="inline-user" data-action="profile" data-username="${reply.author.username}">${escapeHtml(reply.author.name)} ${verificationBadge(reply.author)}</button>
        <span class="small-meta">@${escapeHtml(reply.author.username)} · ${formatDate(reply.createdAt)}</span>
        ${authorLikeBadge(reply.likedByPostAuthor)}
      </div>
      <div class="comment-body">${escapeHtml(reply.content)}</div>
      <div class="comment-actions">
        <button class="mini-action ${reply.likedByMe ? "active" : ""}" data-action="reply-like" data-post-id="${postId}" data-comment-id="${commentId}" data-reply-id="${reply.id}">♥ ${reply.likesCount}</button>
        ${reply.replies.length ? `<button class="mini-action" data-action="toggle-replies" data-comment-id="${commentId}" data-reply-id="${reply.id}">${expanded ? "Скрыть" : `Ответы ${reply.replies.length}`}</button>` : ""}
        ${canDelete ? `<button class="mini-action" data-action="delete-reply" data-post-id="${postId}" data-comment-id="${commentId}" data-reply-id="${reply.id}">×</button>` : ""}
        ${moderationActions(postId, commentId, reply.id)}
      </div>
      ${expanded ? `<div class="replies-list ${depth >= 1 ? "depth-capped" : ""}">${reply.replies.map(child => buildReplyNode(postId, commentId, child, depth + 1)).join("")}</div>` : ""}
      ${replyFormTemplate(postId, commentId, reply.id)}
    </div>
  `;
}

function commentTemplate(post, comment) {
  const repliesExpanded = isRepliesExpanded(comment.id, "");
  const canDelete = state.viewer && state.viewer.id === comment.author.id;
  return `
    <div class="comment-item">
      <div class="comment-head">
        <button class="inline-user" data-action="profile" data-username="${comment.author.username}">${escapeHtml(comment.author.name)} ${verificationBadge(comment.author)}</button>
        <span class="small-meta">@${escapeHtml(comment.author.username)} · ${formatDate(comment.createdAt)}</span>
        ${authorLikeBadge(comment.likedByPostAuthor)}
      </div>
      <div class="comment-body">${escapeHtml(comment.content)}</div>
      <div class="comment-actions">
        <button class="mini-action ${comment.likedByMe ? "active" : ""}" data-action="comment-like" data-post-id="${post.id}" data-comment-id="${comment.id}">♥ ${comment.likesCount}</button>
        ${comment.replies.length ? `<button class="mini-action" data-action="toggle-replies" data-comment-id="${comment.id}">${repliesExpanded ? "Скрыть" : `Ответы ${comment.replies.length}`}</button>` : ""}
        ${canDelete ? `<button class="mini-action" data-action="delete-comment" data-post-id="${post.id}" data-comment-id="${comment.id}">×</button>` : ""}
        ${moderationActions(post.id, comment.id)}
      </div>
      ${repliesExpanded ? `<div class="replies-list">${comment.replies.map(reply => buildReplyNode(post.id, comment.id, reply)).join("")}</div>` : ""}
      ${replyFormTemplate(post.id, comment.id)}
    </div>
  `;
}

function postTemplate(post) {
  const expanded = Boolean(state.expandedComments[post.id]);
  const owner = state.viewer && state.viewer.id === post.author.id;
  const imageHtml = post.imageUrl ? `<div class="post-image-wrap"><img class="post-image" src="${post.imageUrl}" alt="post image" /></div>` : "";
  return `
    <article class="post-card">
      <div class="post-header">
        ${authorCard(post.author)}
        <div class="timestamp">${formatDate(post.createdAt)}</div>
      </div>
      ${post.content ? `<div class="post-content">${escapeHtml(post.content)}</div>` : ""}
      ${imageHtml}
      <div class="post-actions">
        ${actionButton("♥", post.likesCount, "like", "post-id", post.id, post.likedByMe)}
        ${actionButton("💬", post.commentsCount, "toggle-comments", "post-id", post.id, expanded)}
        ${actionButton("🔖", post.bookmarksCount, "bookmark", "post-id", post.id, post.bookmarkedByMe)}
        ${owner ? `<button class="action-btn" data-action="edit-post" data-post-id="${post.id}"><span class="action-icon">✎</span></button><button class="action-btn danger-btn" data-action="delete-post" data-post-id="${post.id}"><span class="action-icon">×</span></button>` : `<button class="action-btn" data-action="profile" data-username="${post.author.username}"><span class="action-icon">→</span></button>`}
        ${!owner ? moderationActions(post.id) : state.viewer?.isAdmin ? moderationActions(post.id) : ""}
      </div>
      ${expanded ? `<div class="comments-block">${post.comments.length ? `<div class="comments-list">${post.comments.map(comment => commentTemplate(post, comment)).join("")}</div>` : `<div class="small-meta comments-empty">Комментариев пока нет.</div>`}<form class="comment-form" data-action="comment-form" data-post-id="${post.id}"><input name="comment" maxlength="220" placeholder="Комментарий" required /><button class="action-btn active" type="submit">→</button></form></div>` : ""}
    </article>
  `;
}

function emptyTemplate(title, text) {
  return `<div class="empty-state"><h3>${title}</h3><p>${text}</p></div>`;
}

function renderViewer() {
  if (!state.viewer) {
    viewerCard.innerHTML = "";
    return;
  }
  viewerCard.innerHTML = `
    <div class="author-row">
      ${avatarTemplate(state.viewer)}
      <div>
        <div class="viewer-name">${escapeHtml(state.viewer.name)} ${verificationBadge(state.viewer)}</div>
        <div class="viewer-meta">@${escapeHtml(state.viewer.username)}</div>
      </div>
    </div>
    <p class="viewer-meta">${escapeHtml(state.viewer.bio || "")}</p>
    <p class="viewer-meta">${state.viewer.followingCount} following · ${state.viewer.followerCount} followers</p>
  `;
}

function renderTrends() {
  trends.innerHTML = state.trends.length ? state.trends.map(item => `<div class="trend-item"><strong>${escapeHtml(item.tag)}</strong><div class="small-meta">${item.count}</div></div>`).join("") : `<div class="trend-item"><div class="small-meta">Пока тихо</div></div>`;
}

function renderHome() {
  composerBlock.classList.remove("hidden");
  viewTitle.textContent = "Главная";
  content.innerHTML = state.feed.length ? state.feed.map(postTemplate).join("") : emptyTemplate("Пусто", "Создай первый пост.");
}

function renderBookmarks() {
  composerBlock.classList.add("hidden");
  viewTitle.textContent = "Сохраненное";
  content.innerHTML = state.bookmarks.length ? state.bookmarks.map(postTemplate).join("") : emptyTemplate("Пусто", "Закладок пока нет.");
}

function renderExplore() {
  composerBlock.classList.add("hidden");
  viewTitle.textContent = "Поиск";
  if (!state.searchResults) {
    content.innerHTML = emptyTemplate("Поиск", "Ищи людей и посты.");
    return;
  }
  const usersHtml = state.searchResults.users.length ? state.searchResults.users.map(user => `<div class="search-user">${authorCard(user)}<p class="small-meta">${escapeHtml(user.bio || "")}</p></div>`).join("") : `<div class="search-user"><div class="small-meta">Никого нет</div></div>`;
  const postsHtml = state.searchResults.posts.length ? state.searchResults.posts.map(postTemplate).join("") : emptyTemplate("Нет постов", "Попробуй другой запрос.");
  content.innerHTML = `<section class="search-card"><h3>Люди</h3>${usersHtml}</section>${postsHtml}`;
}
function renderProfile() {
  composerBlock.classList.add("hidden");
  viewTitle.textContent = "Профиль";
  if (!state.profile) {
    content.innerHTML = emptyTemplate("Нет профиля", "Открой профиль из ленты.");
    return;
  }
  const { profile, posts } = state.profile;
  const banner = profile.bannerImage ? `<div class="profile-banner"><img src="${profile.bannerImage}" alt="banner" /></div>` : `<div class="profile-banner profile-banner-fallback"></div>`;
  content.innerHTML = `
    <section class="profile-card">
      ${banner}
      <div class="profile-head">
        <div class="author-row">
          ${avatarTemplate(profile, "avatar avatar-large")}
          <div><h3>${escapeHtml(profile.name)} ${verificationBadge(profile)}</h3><div class="small-meta">@${escapeHtml(profile.username)}</div></div>
        </div>
        ${profile.isMe ? `<button class="follow-btn active" data-action="edit-profile">Редактировать</button>` : `<button class="follow-btn ${profile.isFollowing ? "active" : ""}" data-action="follow" data-username="${profile.username}">${profile.isFollowing ? "Отписка" : "Подписка"}</button>`}
      </div>
      <p class="post-content">${escapeHtml(profile.bio || "")}</p>
      <div class="small-meta">${profile.followingCount} following · ${profile.followerCount} followers</div>
    </section>
    ${posts.length ? posts.map(postTemplate).join("") : emptyTemplate("Пусто", "Постов пока нет.")}
  `;
}

function renderAdmin() {
  composerBlock.classList.add("hidden");
  viewTitle.textContent = "Admin";
  if (!state.admin) {
    content.innerHTML = emptyTemplate("Admin", "Загружаем панель.");
    return;
  }
  const cards = Object.entries(state.admin.stats).map(([key, value]) => `<div class="search-user"><strong>${escapeHtml(key)}</strong><div class="small-meta">${value}</div></div>`).join("");
  const users = state.admin.users.map(user => `
    <div class="search-user">
      <div class="post-header">
        ${authorCard(user)}
        <div class="comment-actions">
          <button class="mini-action ${user.isAdmin ? "active" : ""}" data-action="admin-toggle-admin" data-username="${user.username}">${user.isAdmin ? "Снять админку" : "Выдать админку"}</button>
          <button class="mini-action ${user.isVerified ? "active" : ""}" data-action="admin-toggle-verify" data-username="${user.username}">${user.isVerified ? "Убрать галку" : "Выдать галку"}</button>
          <button class="mini-action ${user.isBlocked ? "active" : ""}" data-action="admin-toggle-block" data-username="${user.username}">${user.isBlocked ? "Разблокировать" : "Блок"}</button>
        </div>
      </div>
      <div class="small-meta">login: @${escapeHtml(user.username)} · id: ${escapeHtml(user.id)}</div>
      <div class="small-meta">posts: ${user.postsCount} · followers: ${user.followerCount} · following: ${user.followingCount}</div>
      <div class="small-meta">joined: ${formatDate(user.joinedAt)}</div>
      <div class="small-meta">password hash: ${escapeHtml(user.passwordHash || "not available")}</div>
    </div>
  `).join("");
  const posts = state.admin.posts.length ? state.admin.posts.map(postTemplate).join("") : emptyTemplate("Пусто", "Постов нет.");
  content.innerHTML = `
    <section class="search-card">
      <div class="post-header"><h3>Аналитика</h3><button class="follow-btn" data-action="admin-clear-posts">Очистить все посты</button></div>
      <div class="admin-grid">${cards}</div>
    </section>
    <section class="search-card"><h3>Пользователи</h3>${users}</section>
    ${posts}
  `;
}

function renderActiveView() {
  setActiveNav();
  if (state.activeView === "home") return renderHome();
  if (state.activeView === "bookmarks") return renderBookmarks();
  if (state.activeView === "explore") return renderExplore();
  if (state.activeView === "admin") return renderAdmin();
  return renderProfile();
}

async function loadFeed() {
  const data = await api("/api/feed");
  state.viewer = data.viewer;
  state.feed = data.feed;
  state.trends = data.trends;
  renderViewer();
  renderTrends();
  toggleAdminButtons();
}

async function loadBookmarks() {
  state.bookmarks = (await api("/api/bookmarks")).posts;
}

async function loadProfile(username = state.viewer.username) {
  state.profile = await api(`/api/profile/${encodeURIComponent(username)}`);
}

async function loadAdmin() {
  if (!state.viewer?.isAdmin) return;
  state.admin = await api("/api/admin/overview");
}

async function refreshAllViews() {
  await Promise.all([loadFeed(), loadBookmarks()]);
  if (state.profile) {
    await loadProfile(state.profile.profile.username);
  }
  if (state.viewer?.isAdmin) {
    await loadAdmin();
  }
  if (state.searchResults && searchInput.value.trim()) {
    state.searchResults = await api(`/api/search?q=${encodeURIComponent(searchInput.value)}`);
  }
  renderActiveView();
}

async function bootstrapSession() {
  if (!state.token) {
    authPanel.classList.remove("hidden");
    workspace.classList.add("hidden");
    mobileBottomNav.classList.add("hidden");
    return;
  }
  try {
    await api("/api/session");
    await Promise.all([loadFeed(), loadBookmarks()]);
    await loadProfile();
    if (state.viewer?.isAdmin) {
      await loadAdmin();
    }
    authPanel.classList.add("hidden");
    workspace.classList.remove("hidden");
    mobileBottomNav.classList.remove("hidden");
    renderActiveView();
  } catch {
    localStorage.removeItem("zbs_token");
    state.token = "";
    authPanel.classList.remove("hidden");
    workspace.classList.add("hidden");
    mobileBottomNav.classList.add("hidden");
  }
}

async function handleAuthSubmit(event, endpoint) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
  try {
    setStatus("Подключаем...");
    const data = await api(endpoint, { method: "POST", body: JSON.stringify(payload) });
    state.token = data.token;
    localStorage.setItem("zbs_token", data.token);
    setStatus("");
    await bootstrapSession();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function publishPost() {
  if (!composerInput.value.trim() && !state.composerImageUrl) return;
  await api(state.editingPostId ? `/api/posts/${state.editingPostId}` : "/api/posts", {
    method: state.editingPostId ? "PATCH" : "POST",
    body: JSON.stringify({ content: composerInput.value.trim(), imageUrl: state.composerImageUrl })
  });
  resetComposer();
  closeComposer();
  await refreshAllViews();
}

async function saveProfile() {
  profileStatus.textContent = "Сохраняем...";
  const data = await api("/api/profile", {
    method: "PATCH",
    body: JSON.stringify({
      name: profileNameInput.value.trim(),
      username: profileUsernameInput.value.trim(),
      bio: profileBioInput.value.trim(),
      avatarColor: profileColorInput.value,
      avatarImage: state.profileAvatarImage,
      bannerImage: state.profileBannerImage
    })
  });
  state.viewer = data.user;
  closeProfileEditor();
  await Promise.all([loadFeed(), loadBookmarks(), loadProfile(data.user.username)]);
  if (state.viewer?.isAdmin) await loadAdmin();
  renderActiveView();
}

async function runSearch(query) {
  if (!query.trim()) {
    state.searchResults = null;
    renderActiveView();
    return;
  }
  state.searchResults = await api(`/api/search?q=${encodeURIComponent(query)}`);
  state.activeView = "explore";
  renderActiveView();
}
async function togglePostAction(postId, action) { await api(`/api/posts/${postId}/${action}`, { method: "POST" }); await refreshAllViews(); }
async function addComment(postId, contentValue) { await api(`/api/posts/${postId}/comments`, { method: "POST", body: JSON.stringify({ content: contentValue }) }); state.expandedComments[postId] = true; await refreshAllViews(); }
async function addReply(postId, commentId, contentValue, parentReplyId = "") { const path = parentReplyId ? `/api/posts/${postId}/comments/${commentId}/replies/${parentReplyId}/replies` : `/api/posts/${postId}/comments/${commentId}/replies`; await api(path, { method: "POST", body: JSON.stringify({ content: contentValue }) }); state.expandedComments[postId] = true; state.expandedReplies[parentReplyId ? replyKey(commentId, parentReplyId) : commentId] = true; await refreshAllViews(); }
async function toggleCommentLike(postId, commentId) { await api(`/api/posts/${postId}/comments/${commentId}/like`, { method: "POST" }); await refreshAllViews(); }
async function toggleReplyLike(postId, commentId, replyId) { await api(`/api/posts/${postId}/comments/${commentId}/replies/${replyId}/like`, { method: "POST" }); await refreshAllViews(); }
async function toggleFollow(username) { await api(`/api/profile/${encodeURIComponent(username)}/follow`, { method: "POST" }); await Promise.all([loadFeed(), loadProfile(username)]); renderActiveView(); }
async function deletePost(postId) { await api(`/api/posts/${postId}`, { method: "DELETE" }); await refreshAllViews(); }
async function deleteComment(postId, commentId) { await api(`/api/posts/${postId}/comments/${commentId}`, { method: "DELETE" }); await refreshAllViews(); }
async function deleteReply(postId, commentId, replyId) { await api(`/api/posts/${postId}/comments/${commentId}/replies/${replyId}`, { method: "DELETE" }); await refreshAllViews(); }
async function adminDeletePost(postId) { await api(`/api/admin/posts/${postId}`, { method: "DELETE" }); await refreshAllViews(); }
async function adminDeleteComment(postId, commentId) { await api(`/api/admin/posts/${postId}/comments/${commentId}`, { method: "DELETE" }); await refreshAllViews(); }
async function adminDeleteReply(postId, commentId, replyId) { await api(`/api/admin/posts/${postId}/comments/${commentId}/replies/${replyId}`, { method: "DELETE" }); await refreshAllViews(); }
async function adminPatchUser(username, patch) { await api(`/api/admin/users/${encodeURIComponent(username)}`, { method: "PATCH", body: JSON.stringify(patch) }); await refreshAllViews(); }
async function adminClearPosts() { await api("/api/admin/clear-posts", { method: "POST" }); await refreshAllViews(); }
function openProfile(username) { state.activeView = "profile"; return loadProfile(username).then(renderActiveView); }
function findPostAnywhere(postId) { return state.feed.find(p => p.id === postId) || state.bookmarks.find(p => p.id === postId) || state.profile?.posts.find(p => p.id === postId) || state.searchResults?.posts.find(p => p.id === postId) || state.admin?.posts.find(p => p.id === postId) || null; }
function startEditPost(post) { state.editingPostId = post.id; composerInput.value = post.content || ""; composerCount.textContent = `${composerInput.value.length} / 280`; setComposerImage(post.imageUrl || ""); document.getElementById("publishBtn").textContent = "Сохранить"; openComposer(); }
function readFileAsDataUrl(file, callback, options = {}) {
  if (!file) return;
  if (file.size > 12000000) {
    alert("Файл слишком большой. До 12 МБ.");
    return;
  }
  const {
    maxWidth = 1600,
    maxHeight = 1600,
    quality = 0.82,
    mimeType = "image/jpeg"
  } = options;
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      let { width, height } = image;
      const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
      width = Math.max(1, Math.round(width * ratio));
      height = Math.max(1, Math.round(height * ratio));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, width, height);
      callback(canvas.toDataURL(mimeType, quality));
    };
    image.onerror = () => alert("Не удалось обработать изображение.");
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
}

document.querySelectorAll("[data-auth-tab]").forEach(button => button.addEventListener("click", () => { document.querySelectorAll("[data-auth-tab]").forEach(tab => tab.classList.remove("active")); document.querySelectorAll(".auth-form").forEach(form => form.classList.remove("active")); button.classList.add("active"); document.getElementById(`${button.dataset.authTab}Form`).classList.add("active"); setStatus(""); }));
document.getElementById("loginForm").addEventListener("submit", event => handleAuthSubmit(event, "/api/auth/login"));
document.getElementById("registerForm").addEventListener("submit", event => handleAuthSubmit(event, "/api/auth/register"));
document.getElementById("logoutBtn").addEventListener("click", async () => { try { await api("/api/auth/logout", { method: "POST" }); } finally { localStorage.removeItem("zbs_token"); state.token = ""; location.reload(); } });
document.querySelectorAll(".nav-link, .mobile-nav-link").forEach(button => button.addEventListener("click", async () => { state.activeView = button.dataset.view; if (state.activeView === "bookmarks") await loadBookmarks(); if (state.activeView === "profile") await loadProfile(); if (state.activeView === "admin") await loadAdmin(); renderActiveView(); }));
["openComposerBtn", "openComposerTopBtn", "openComposerCardBtn", "openComposerMobileBtn"].forEach(id => document.getElementById(id)?.addEventListener("click", openComposer));
document.getElementById("closeComposerBtn").addEventListener("click", closeComposer);
document.querySelector('[data-close-modal="true"]').addEventListener("click", closeComposer);
document.getElementById("removeImageBtn").addEventListener("click", () => setComposerImage(""));
document.getElementById("closeProfileBtn").addEventListener("click", closeProfileEditor);
document.querySelector('[data-close-profile-modal="true"]').addEventListener("click", closeProfileEditor);
document.getElementById("saveProfileBtn").addEventListener("click", async () => { try { await saveProfile(); } catch (error) { profileStatus.textContent = error.message; } });
composerInput.addEventListener("input", () => { composerCount.textContent = `${composerInput.value.length} / 280`; });
composerImageInput.addEventListener("change", event => readFileAsDataUrl(event.target.files[0], setComposerImage, { maxWidth: 1600, maxHeight: 1600, quality: 0.82 }));
profileAvatarInput.addEventListener("change", event => readFileAsDataUrl(event.target.files[0], result => setProfileImagePreview("avatar", result), { maxWidth: 700, maxHeight: 700, quality: 0.8 }));
profileBannerInput.addEventListener("change", event => readFileAsDataUrl(event.target.files[0], result => setProfileImagePreview("banner", result), { maxWidth: 1600, maxHeight: 900, quality: 0.8 }));
document.getElementById("publishBtn").addEventListener("click", async () => { try { await publishPost(); } catch (error) { alert(error.message); } });
searchInput.addEventListener("input", event => runSearch(event.target.value).catch(console.error));
document.addEventListener("keydown", event => { if (event.key === "Escape") { closeComposer(); closeProfileEditor(); } });
content.addEventListener("click", async event => { const target = event.target.closest("[data-action]"); if (!target) return; const { action, postId, username, commentId, replyId } = target.dataset; try { if (action === "like" || action === "bookmark") return await togglePostAction(postId, action); if (action === "toggle-comments") { state.expandedComments[postId] = !state.expandedComments[postId]; return renderActiveView(); } if (action === "toggle-replies") { const key = replyId ? replyKey(commentId, replyId) : commentId; state.expandedReplies[key] = !state.expandedReplies[key]; return renderActiveView(); } if (action === "comment-like") return await toggleCommentLike(postId, commentId); if (action === "reply-like") return await toggleReplyLike(postId, commentId, replyId); if (action === "profile") return await openProfile(username); if (action === "edit-profile") return openProfileEditor(); if (action === "edit-post") { const post = findPostAnywhere(postId); if (post) startEditPost(post); return; } if (action === "delete-post") return await deletePost(postId); if (action === "delete-comment") return await deleteComment(postId, commentId); if (action === "delete-reply") return await deleteReply(postId, commentId, replyId); if (action === "follow") return await toggleFollow(username); if (action === "admin-delete-post") return await adminDeletePost(postId); if (action === "admin-delete-comment") return await adminDeleteComment(postId, commentId); if (action === "admin-delete-reply") return await adminDeleteReply(postId, commentId, replyId); if (action === "admin-toggle-admin") return await adminPatchUser(username, { isAdmin: !target.classList.contains("active") }); if (action === "admin-toggle-verify") return await adminPatchUser(username, { isVerified: !target.classList.contains("active") }); if (action === "admin-toggle-block") return await adminPatchUser(username, { isBlocked: !target.classList.contains("active") }); if (action === "admin-clear-posts") return await adminClearPosts(); } catch (error) { alert(error.message); } });
content.addEventListener("submit", async event => { const commentForm = event.target.closest('[data-action="comment-form"]'); const replyForm = event.target.closest('[data-action="reply-form"]'); if (commentForm) { event.preventDefault(); const value = String(commentForm.elements.comment.value || "").trim(); if (!value) return; try { await addComment(commentForm.dataset.postId, value); commentForm.reset(); } catch (error) { alert(error.message); } return; } if (replyForm) { event.preventDefault(); const value = String(replyForm.elements.reply.value || "").trim(); if (!value) return; try { await addReply(replyForm.dataset.postId, replyForm.dataset.commentId, value, replyForm.dataset.parentReplyId || ""); replyForm.reset(); } catch (error) { alert(error.message); } } });

bootstrapSession();
