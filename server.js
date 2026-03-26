const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const DATABASE_URL = process.env.DATABASE_URL || "";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

let pool = null;
let stateCache = null;
let lastPersist = Promise.resolve();

function createId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function normalizeDb(db) {
  let changed = false;
  if (!Array.isArray(db.users)) {
    db.users = [];
    changed = true;
  }
  if (!Array.isArray(db.posts)) {
    db.posts = [];
    changed = true;
  }
  if (!Array.isArray(db.sessions)) {
    db.sessions = [];
    changed = true;
  }
  for (const user of db.users || []) {
    const beforeName = user.name;
    const beforeBio = user.bio;
    repairUserText(user);
    if (!Array.isArray(user.followingIds)) {
      user.followingIds = [];
      changed = true;
    }
    if (!Array.isArray(user.followerIds)) {
      user.followerIds = [];
      changed = true;
    }
    if (!("isAdmin" in user)) {
      user.isAdmin = user.id === "user_zbs";
      changed = true;
    }
    if (!("isVerified" in user)) {
      user.isVerified = user.id === "user_zbs";
      changed = true;
    }
    if (!("isBlocked" in user)) {
      user.isBlocked = false;
      changed = true;
    }
    if (!("avatarImage" in user)) {
      user.avatarImage = "";
      changed = true;
    }
    if (!("bannerImage" in user)) {
      user.bannerImage = "";
      changed = true;
    }
    if (user.id === "user_zbs") {
      if (!user.isAdmin) {
        user.isAdmin = true;
        changed = true;
      }
      if (!user.isVerified) {
        user.isVerified = true;
        changed = true;
      }
    }

    const avatarImage = sanitizeImageDataUrl(user.avatarImage);
    if (avatarImage !== user.avatarImage) {
      user.avatarImage = avatarImage || "";
      changed = true;
    }
    const bannerImage = sanitizeImageDataUrl(user.bannerImage);
    if (bannerImage !== user.bannerImage) {
      user.bannerImage = bannerImage || "";
      changed = true;
    }
    if (beforeName !== user.name || beforeBio !== user.bio) {
      changed = true;
    }
  }

  for (const post of db.posts || []) {
    if (!Array.isArray(post.likes)) {
      post.likes = [];
      changed = true;
    }
    if (!Array.isArray(post.bookmarks)) {
      post.bookmarks = [];
      changed = true;
    }
    if (!Array.isArray(post.comments)) {
      post.comments = [];
      changed = true;
    }
    if (!("imageUrl" in post)) {
      post.imageUrl = "";
      changed = true;
    }
    const repairedPostContent = tryRepairText(post.content);
    if (repairedPostContent !== post.content) {
      post.content = repairedPostContent;
      changed = true;
    }
    for (const comment of post.comments) {
      if (normalizeReplyNode(comment)) {
        changed = true;
      }
      const repairedCommentContent = tryRepairText(comment.content);
      if (repairedCommentContent !== comment.content) {
        comment.content = repairedCommentContent;
        changed = true;
      }
      if (repairReplyTree(comment.replies || [])) {
        changed = true;
      }
    }
  }
  if (changed) {
    persistState(db);
  }
  return db;
}

function normalizeReplyNode(node) {
  let changed = false;
  if (!Array.isArray(node.likes)) {
    node.likes = [];
    changed = true;
  }
  if (!Array.isArray(node.replies)) {
    node.replies = [];
    changed = true;
  }
  for (const reply of node.replies) {
    if (normalizeReplyNode(reply)) {
      changed = true;
    }
  }
  return changed;
}

function tryRepairText(value) {
  if (typeof value !== "string" || !value) {
    return value;
  }

  const mojibakePattern = /[Р РЎРѓГ‘Гђ]{2,}/;
  if (mojibakePattern.test(value)) {
    try {
      const repaired = Buffer.from(value, "latin1").toString("utf8");
      const repairedCyrillic = (repaired.match(/[А-Яа-яЁё]/g) || []).length;
      const originalCyrillic = (value.match(/[А-Яа-яЁё]/g) || []).length;
      if (repairedCyrillic > originalCyrillic && !repaired.includes("пїЅ")) {
        return repaired;
      }
    } catch {}
  }

  const questionMarks = (value.match(/\?/g) || []).length;
  if (questionMarks >= Math.max(4, Math.floor(value.length * 0.4))) {
    return "Текст был поврежден кодировкой.";
  }

  return value;
}

function repairUserText(user) {
  user.name = tryRepairText(user.name);
  user.bio = tryRepairText(user.bio);
}

function repairReplyTree(nodes) {
  let changed = false;
  for (const node of nodes || []) {
    const nextContent = tryRepairText(node.content);
    if (nextContent !== node.content) {
      node.content = nextContent;
      changed = true;
    }
    if (repairReplyTree(node.replies || [])) {
      changed = true;
    }
  }
  return changed;
}

function persistState(db) {
  stateCache = db;
  if (!pool) {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    return;
  }
  lastPersist = lastPersist
    .catch(() => {})
    .then(() =>
      pool.query(
        `
          insert into app_state (id, data, updated_at)
          values (1, $1::jsonb, now())
          on conflict (id)
          do update set data = excluded.data, updated_at = now()
        `,
        [JSON.stringify(db)]
      )
    )
    .catch(error => {
      console.error("Failed to persist app state:", error);
    });
}

function writeDb(db) {
  persistState(db);
}

function readDb() {
  if (stateCache) {
    return stateCache;
  }
  if (!fs.existsSync(DB_PATH)) {
    const seed = createSeedDb();
    fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2));
    stateCache = normalizeDb(seed);
    return stateCache;
  }
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  stateCache = normalizeDb(db);
  return stateCache;
}

function createSeedDb() {
  const now = Date.now();
  const users = [
    {
      id: "user_zbs",
      name: "ZBS",
      username: "zbs",
      passwordHash: hashPassword("zbsdemo"),
      bio: "Главный аккаунт ZBS.",
      avatarColor: "#ffd84d",
      avatarImage: "",
      bannerImage: "",
      joinedAt: new Date(now - 1000 * 60 * 60 * 24 * 30).toISOString(),
      followingIds: [],
      followerIds: [],
      isAdmin: true,
      isVerified: true,
      isBlocked: false
    }
  ];

  return { users, posts: [], sessions: [] };
}

async function ensureDatabase() {
  if (!DATABASE_URL) {
    stateCache = readDb();
    return;
  }

  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await pool.query(`
    create table if not exists app_state (
      id integer primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);

  const existing = await pool.query("select data from app_state where id = 1");
  if (existing.rows.length) {
    stateCache = normalizeDb(existing.rows[0].data);
    return;
  }

  let initialState;
  if (fs.existsSync(DB_PATH)) {
    initialState = normalizeDb(JSON.parse(fs.readFileSync(DB_PATH, "utf8")));
  } else {
    initialState = createSeedDb();
  }

  stateCache = initialState;
  await pool.query(
    `
      insert into app_state (id, data, updated_at)
      values (1, $1::jsonb, now())
      on conflict (id)
      do update set data = excluded.data, updated_at = now()
    `,
    [JSON.stringify(initialState)]
  );
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  sendJson(res, 404, { error: "Not found" });
}

function badRequest(res, message) {
  sendJson(res, 400, { error: message });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk.toString();
      if (body.length > 10_000_000) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function getToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    return null;
  }
  return authHeader.slice("Bearer ".length);
}

function getSessionUser(db, req) {
  const token = getToken(req);
  if (!token) {
    return null;
  }
  const session = db.sessions.find(entry => entry.token === token);
  if (!session) {
    return null;
  }
  return db.users.find(user => user.id === session.userId) || null;
}

function publicUser(user) {
  if (!user) {
    return {
      id: "unknown",
      name: "Unknown",
      username: "unknown",
      bio: "",
      avatarColor: "#999999",
      avatarImage: "",
      bannerImage: "",
      isAdmin: false,
      isVerified: false,
      isBlocked: false,
      joinedAt: new Date(0).toISOString(),
      followingCount: 0,
      followerCount: 0
    };
  }
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    bio: user.bio,
    avatarColor: user.avatarColor,
    avatarImage: user.avatarImage || "",
    bannerImage: user.bannerImage || "",
    isAdmin: Boolean(user.isAdmin),
    isVerified: Boolean(user.isVerified),
    isBlocked: Boolean(user.isBlocked),
    joinedAt: user.joinedAt,
    followingCount: user.followingIds.length,
    followerCount: user.followerIds.length
  };
}

function adminUserView(db, user) {
  return {
    ...publicUser(user),
    passwordHash: user.passwordHash,
    postsCount: db.posts.filter(post => post.userId === user.id).length,
    rawFollowingIds: user.followingIds,
    rawFollowerIds: user.followerIds
  };
}

function enrichPost(db, post, viewerId) {
  const author = db.users.find(user => user.id === post.userId);
  const mapReplyNode = node => {
    const replyAuthor = db.users.find(user => user.id === node.userId);
    return {
      id: node.id,
      content: node.content,
      createdAt: node.createdAt,
      likesCount: (node.likes || []).length,
      likedByMe: viewerId ? (node.likes || []).includes(viewerId) : false,
      likedByPostAuthor: (node.likes || []).includes(post.userId),
      author: publicUser(replyAuthor),
      replies: (node.replies || []).map(mapReplyNode)
    };
  };
  return {
    id: post.id,
    content: post.content,
    imageUrl: post.imageUrl || "",
    createdAt: post.createdAt,
    likesCount: post.likes.length,
    bookmarksCount: post.bookmarks.length,
    commentsCount: (post.comments || []).length,
    likedByMe: viewerId ? post.likes.includes(viewerId) : false,
    bookmarkedByMe: viewerId ? post.bookmarks.includes(viewerId) : false,
    author: publicUser(author),
    comments: (post.comments || []).map(mapReplyNode)
  };
}

function sanitizeUsername(username) {
  return String(username || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 20);
}

function formatFeed(db, user) {
  return db.posts
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(post => enrichPost(db, post, user.id));
}

function collectTrends(db) {
  const counters = new Map();
  for (const post of db.posts) {
    const hashtags = post.content.match(/#[\p{L}\p{N}_]+/gu) || [];
    for (const tag of hashtags) {
      counters.set(tag, (counters.get(tag) || 0) + 1);
    }
  }
  return [...counters.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([tag, count]) => ({ tag, count }));
}

function searchData(db, query, viewerId) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return { users: [], posts: [] };
  }
  return {
    users: db.users
      .filter(user =>
        [user.name, user.username, user.bio].some(value =>
          value.toLowerCase().includes(normalized)
        )
      )
      .map(publicUser)
      .slice(0, 8),
    posts: db.posts
      .filter(post => post.content.toLowerCase().includes(normalized))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 10)
      .map(post => enrichPost(db, post, viewerId))
  };
}

function findPost(db, postId) {
  return db.posts.find(entry => entry.id === postId) || null;
}

function findComment(post, commentId) {
  return (post.comments || []).find(entry => entry.id === commentId) || null;
}

function findReply(comment, replyId) {
  return (comment.replies || []).find(entry => entry.id === replyId) || null;
}

function findReplyRecursive(nodes, replyId) {
  for (const node of nodes || []) {
    if (node.id === replyId) {
      return node;
    }
    const nested = findReplyRecursive(node.replies || [], replyId);
    if (nested) {
      return nested;
    }
  }
  return null;
}

function deleteReplyRecursive(nodes, replyId, viewerId) {
  for (let index = 0; index < (nodes || []).length; index += 1) {
    const node = nodes[index];
    if (node.id === replyId) {
      if (node.userId !== viewerId) {
        return { found: true, deleted: false };
      }
      nodes.splice(index, 1);
      return { found: true, deleted: true };
    }
    const nested = deleteReplyRecursive(node.replies || [], replyId, viewerId);
    if (nested.found) {
      return nested;
    }
  }
  return { found: false, deleted: false };
}

function deleteReplyRecursiveByAdmin(nodes, replyId) {
  for (let index = 0; index < (nodes || []).length; index += 1) {
    const node = nodes[index];
    if (node.id === replyId) {
      nodes.splice(index, 1);
      return true;
    }
    if (deleteReplyRecursiveByAdmin(node.replies || [], replyId)) {
      return true;
    }
  }
  return false;
}

function countReplyTree(nodes) {
  return (nodes || []).reduce((sum, node) => sum + 1 + countReplyTree(node.replies || []), 0);
}

function countAllComments(db) {
  return db.posts.reduce((sum, post) => {
    return sum + (post.comments || []).length + (post.comments || []).reduce((total, comment) => {
      return total + countReplyTree(comment.replies || []);
    }, 0);
  }, 0);
}

function removeUserSessions(db, userId) {
  db.sessions = db.sessions.filter(session => session.userId !== userId);
}

function requireAdmin(res, viewer) {
  if (!viewer || !viewer.isAdmin) {
    sendJson(res, 403, { error: "Только для администратора." });
    return false;
  }
  return true;
}

function sanitizeImageDataUrl(value) {
  const image = String(value || "");
  if (!image) {
    return "";
  }
  const isValid = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(image);
  if (!isValid || image.length > 2_800_000) {
    return null;
  }
  return image;
}

function sanitizeColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
}

function serveStatic(req, res, url) {
  const safePath = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath =
    safePath === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      if (safePath !== "/" && !path.extname(filePath)) {
        fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallbackData) => {
          if (fallbackError) {
            res.writeHead(404);
            res.end("Not found");
            return;
          }
          res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
          res.end(fallbackData);
        });
        return;
      }
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const contentType = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

async function handleApi(req, res, url) {
  const db = readDb();
  const viewer = getSessionUser(db, req);
  const { pathname, searchParams } = url;

  if (req.method === "POST" && pathname === "/api/auth/register") {
    const body = await parseBody(req);
    const name = String(body.name || "").trim().slice(0, 40);
    const username = sanitizeUsername(body.username);
    const password = String(body.password || "");
    if (!name || username.length < 3 || password.length < 4) {
      badRequest(res, "Введите имя, username от 3 символов и пароль от 4 символов.");
      return;
    }
    if (db.users.some(user => user.username === username)) {
      badRequest(res, "Этот username уже занят.");
      return;
    }

    const user = {
      id: createId("user"),
      name,
      username,
      passwordHash: hashPassword(password),
      bio: "Новый пользователь ZBS.",
      avatarColor: ["#ffd84d", "#ffbe0b", "#fff2b2", "#e1a700"][Math.floor(Math.random() * 4)],
      joinedAt: new Date().toISOString(),
      avatarImage: "",
      bannerImage: "",
      followingIds: [],
      followerIds: [],
      isAdmin: false,
      isVerified: false,
      isBlocked: false
    };

    db.users.push(user);
    const token = createId("token");
    db.sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
    writeDb(db);
    sendJson(res, 201, { token, user: publicUser(user) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/login") {
    const body = await parseBody(req);
    const username = sanitizeUsername(body.username);
    const password = String(body.password || "");
    const user = db.users.find(
      entry => entry.username === username && entry.passwordHash === hashPassword(password)
    );
    if (!user) {
      sendJson(res, 401, { error: "Неверный логин или пароль." });
      return;
    }
    if (user.isBlocked) {
      sendJson(res, 403, { error: "Аккаунт заблокирован администратором." });
      return;
    }
    const token = createId("token");
    db.sessions.push({ token, userId: user.id, createdAt: new Date().toISOString() });
    writeDb(db);
    sendJson(res, 200, { token, user: publicUser(user) });
    return;
  }


  if (req.method === "POST" && pathname === "/api/auth/logout") {
    const token = getToken(req);
    if (!token) {
      sendJson(res, 204, {});
      return;
    }
    db.sessions = db.sessions.filter(session => session.token !== token);
    writeDb(db);
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "GET" && pathname === "/api/session") {
    if (!viewer) {
      sendJson(res, 401, { error: "Нет активной сессии." });
      return;
    }
    if (viewer.isBlocked) {
      removeUserSessions(db, viewer.id);
      writeDb(db);
      sendJson(res, 403, { error: "Аккаунт заблокирован." });
      return;
    }
    sendJson(res, 200, { user: publicUser(viewer) });
    return;
  }

  if (!viewer) {
    sendJson(res, 401, { error: "Нужна авторизация." });
    return;
  }

  if (viewer.isBlocked) {
    removeUserSessions(db, viewer.id);
    writeDb(db);
    sendJson(res, 403, { error: "Аккаунт заблокирован." });
    return;
  }

  if (req.method === "GET" && pathname === "/api/feed") {
    sendJson(res, 200, {
      viewer: publicUser(viewer),
      feed: formatFeed(db, viewer),
      trends: collectTrends(db)
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/posts") {
    const body = await parseBody(req);
    const content = String(body.content || "").trim().slice(0, 280);
    const imageUrl = sanitizeImageDataUrl(body.imageUrl);
    if (imageUrl === null) {
      badRequest(res, "Некорректное изображение или слишком большой файл.");
      return;
    }
    if (!content && !imageUrl) {
      badRequest(res, "Пост не может быть пустым.");
      return;
    }
    const post = {
      id: createId("post"),
      userId: viewer.id,
      content,
      imageUrl,
      createdAt: new Date().toISOString(),
      likes: [],
      bookmarks: [],
      comments: []
    };
    db.posts.push(post);
    writeDb(db);
    sendJson(res, 201, { post: enrichPost(db, post, viewer.id) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/bookmarks") {
    const bookmarks = db.posts
      .filter(post => post.bookmarks.includes(viewer.id))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(post => enrichPost(db, post, viewer.id));
    sendJson(res, 200, { posts: bookmarks });
    return;
  }

  if (req.method === "GET" && pathname === "/api/search") {
    sendJson(res, 200, searchData(db, searchParams.get("q") || "", viewer.id));
    return;
  }

  if (req.method === "GET" && pathname === "/api/trends") {
    sendJson(res, 200, { trends: collectTrends(db) });
    return;
  }

  const deletePostMatch = pathname.match(/^\/api\/posts\/([^/]+)$/);
  if (req.method === "PATCH" && deletePostMatch) {
    const post = findPost(db, deletePostMatch[1]);
    if (!post) {
      notFound(res);
      return;
    }
    if (post.userId !== viewer.id) {
      sendJson(res, 403, { error: "Можно редактировать только свой пост." });
      return;
    }
    const body = await parseBody(req);
    const content = String(body.content || "").trim().slice(0, 280);
    const imageUrl = sanitizeImageDataUrl(body.imageUrl);
    if (imageUrl === null) {
      badRequest(res, "Некорректное изображение или слишком большой файл.");
      return;
    }
    if (!content && !imageUrl) {
      badRequest(res, "Пост не может быть пустым.");
      return;
    }
    post.content = content;
    post.imageUrl = imageUrl;
    writeDb(db);
    sendJson(res, 200, { post: enrichPost(db, post, viewer.id) });
    return;
  }

  if (req.method === "DELETE" && deletePostMatch) {
    const post = findPost(db, deletePostMatch[1]);
    if (!post) {
      notFound(res);
      return;
    }
    if (post.userId !== viewer.id) {
      sendJson(res, 403, { error: "Можно удалить только свой пост." });
      return;
    }
    db.posts = db.posts.filter(entry => entry.id !== post.id);
    writeDb(db);
    sendJson(res, 204, {});
    return;
  }

  const likeMatch = pathname.match(/^\/api\/posts\/([^/]+)\/like$/);
  if (req.method === "POST" && likeMatch) {
    const post = findPost(db, likeMatch[1]);
    if (!post) {
      notFound(res);
      return;
    }
    if (post.likes.includes(viewer.id)) {
      post.likes = post.likes.filter(id => id !== viewer.id);
    } else {
      post.likes.push(viewer.id);
    }
    writeDb(db);
    sendJson(res, 200, { post: enrichPost(db, post, viewer.id) });
    return;
  }

  const bookmarkMatch = pathname.match(/^\/api\/posts\/([^/]+)\/bookmark$/);
  if (req.method === "POST" && bookmarkMatch) {
    const post = findPost(db, bookmarkMatch[1]);
    if (!post) {
      notFound(res);
      return;
    }
    if (post.bookmarks.includes(viewer.id)) {
      post.bookmarks = post.bookmarks.filter(id => id !== viewer.id);
    } else {
      post.bookmarks.push(viewer.id);
    }
    writeDb(db);
    sendJson(res, 200, { post: enrichPost(db, post, viewer.id) });
    return;
  }

  const commentMatch = pathname.match(/^\/api\/posts\/([^/]+)\/comments$/);
  if (req.method === "POST" && commentMatch) {
    const post = findPost(db, commentMatch[1]);
    if (!post) {
      notFound(res);
      return;
    }
    const body = await parseBody(req);
    const content = String(body.content || "").trim().slice(0, 220);
    if (!content) {
      badRequest(res, "Комментарий не может быть пустым.");
      return;
    }
    if (!post.comments) {
      post.comments = [];
    }
    post.comments.push({
      id: createId("comment"),
      userId: viewer.id,
      content,
      createdAt: new Date().toISOString()
      ,
      likes: [],
      replies: []
    });
    writeDb(db);
    sendJson(res, 201, { post: enrichPost(db, post, viewer.id) });
    return;
  }

  const commentLikeMatch = pathname.match(/^\/api\/posts\/([^/]+)\/comments\/([^/]+)\/like$/);
  if (req.method === "POST" && commentLikeMatch) {
    const post = findPost(db, commentLikeMatch[1]);
    const comment = post ? findComment(post, commentLikeMatch[2]) : null;
    if (!post || !comment) {
      notFound(res);
      return;
    }
    if (comment.likes.includes(viewer.id)) {
      comment.likes = comment.likes.filter(id => id !== viewer.id);
    } else {
      comment.likes.push(viewer.id);
    }
    writeDb(db);
    sendJson(res, 200, { post: enrichPost(db, post, viewer.id) });
    return;
  }

  const deleteCommentMatch = pathname.match(/^\/api\/posts\/([^/]+)\/comments\/([^/]+)$/);
  if (req.method === "DELETE" && deleteCommentMatch) {
    const post = findPost(db, deleteCommentMatch[1]);
    const comment = post ? findComment(post, deleteCommentMatch[2]) : null;
    if (!post || !comment) {
      notFound(res);
      return;
    }
    if (comment.userId !== viewer.id) {
      sendJson(res, 403, { error: "Можно удалить только свой комментарий." });
      return;
    }
    post.comments = post.comments.filter(entry => entry.id !== comment.id);
    writeDb(db);
    sendJson(res, 204, {});
    return;
  }

  const replyMatch = pathname.match(/^\/api\/posts\/([^/]+)\/comments\/([^/]+)\/replies$/);
  if (req.method === "POST" && replyMatch) {
    const post = findPost(db, replyMatch[1]);
    const comment = post ? findComment(post, replyMatch[2]) : null;
    if (!post || !comment) {
      notFound(res);
      return;
    }
    const body = await parseBody(req);
    const content = String(body.content || "").trim().slice(0, 220);
    if (!content) {
      badRequest(res, "Ответ не может быть пустым.");
      return;
    }
    comment.replies.push({
      id: createId("reply"),
      userId: viewer.id,
      content,
      createdAt: new Date().toISOString(),
      likes: [],
      replies: []
    });
    writeDb(db);
    sendJson(res, 201, { post: enrichPost(db, post, viewer.id) });
    return;
  }

  const nestedReplyMatch = pathname.match(
    /^\/api\/posts\/([^/]+)\/comments\/([^/]+)\/replies\/([^/]+)\/replies$/
  );
  if (req.method === "POST" && nestedReplyMatch) {
    const post = findPost(db, nestedReplyMatch[1]);
    const comment = post ? findComment(post, nestedReplyMatch[2]) : null;
    const parentReply = comment ? findReplyRecursive(comment.replies || [], nestedReplyMatch[3]) : null;
    if (!post || !comment || !parentReply) {
      notFound(res);
      return;
    }
    const body = await parseBody(req);
    const content = String(body.content || "").trim().slice(0, 220);
    if (!content) {
      badRequest(res, "Ответ не может быть пустым.");
      return;
    }
    parentReply.replies.push({
      id: createId("reply"),
      userId: viewer.id,
      content,
      createdAt: new Date().toISOString(),
      likes: [],
      replies: []
    });
    writeDb(db);
    sendJson(res, 201, { post: enrichPost(db, post, viewer.id) });
    return;
  }

  const replyLikeMatch = pathname.match(
    /^\/api\/posts\/([^/]+)\/comments\/([^/]+)\/replies\/([^/]+)\/like$/
  );
  if (req.method === "POST" && replyLikeMatch) {
    const post = findPost(db, replyLikeMatch[1]);
    const comment = post ? findComment(post, replyLikeMatch[2]) : null;
    const reply = comment ? findReplyRecursive(comment.replies || [], replyLikeMatch[3]) : null;
    if (!post || !comment || !reply) {
      notFound(res);
      return;
    }
    if (reply.likes.includes(viewer.id)) {
      reply.likes = reply.likes.filter(id => id !== viewer.id);
    } else {
      reply.likes.push(viewer.id);
    }
    writeDb(db);
    sendJson(res, 200, { post: enrichPost(db, post, viewer.id) });
    return;
  }

  const deleteReplyMatch = pathname.match(
    /^\/api\/posts\/([^/]+)\/comments\/([^/]+)\/replies\/([^/]+)$/
  );
  if (req.method === "DELETE" && deleteReplyMatch) {
    const post = findPost(db, deleteReplyMatch[1]);
    const comment = post ? findComment(post, deleteReplyMatch[2]) : null;
    if (!post || !comment) {
      notFound(res);
      return;
    }
    const result = deleteReplyRecursive(comment.replies || [], deleteReplyMatch[3], viewer.id);
    if (!result.found) {
      notFound(res);
      return;
    }
    if (!result.deleted) {
      sendJson(res, 403, { error: "Можно удалить только свой ответ." });
      return;
    }
    writeDb(db);
    sendJson(res, 204, {});
    return;
  }


  if (req.method === "PATCH" && pathname === "/api/profile") {
    const body = await parseBody(req);
    const freshViewer = db.users.find(user => user.id === viewer.id);
    const name = String(body.name || "").trim().slice(0, 40);
    const username = sanitizeUsername(body.username);
    const bio = String(body.bio || "").trim().slice(0, 160);
    const avatarColor = sanitizeColor(body.avatarColor);
    const avatarImage = sanitizeImageDataUrl(body.avatarImage);
    const bannerImage = sanitizeImageDataUrl(body.bannerImage);
    if (!name || username.length < 3) {
      badRequest(res, "Введите имя и username от 3 символов.");
      return;
    }
    if (body.avatarColor && !avatarColor) {
      badRequest(res, "Некорректный цвет профиля.");
      return;
    }
    if (avatarImage === null || bannerImage === null) {
      badRequest(res, "Некорректное изображение профиля или баннера.");
      return;
    }
    const taken = db.users.find(user => user.username === username && user.id !== freshViewer.id);
    if (taken) {
      badRequest(res, "Этот username уже занят.");
      return;
    }
    freshViewer.name = name;
    freshViewer.username = username;
    freshViewer.bio = bio || "Без описания.";
    if (avatarColor) {
      freshViewer.avatarColor = avatarColor;
    }
    if ("avatarImage" in body) {
      freshViewer.avatarImage = avatarImage || "";
    }
    if ("bannerImage" in body) {
      freshViewer.bannerImage = bannerImage || "";
    }
    writeDb(db);
    sendJson(res, 200, { user: publicUser(freshViewer) });
    return;
  }

  const profileMatch = pathname.match(/^\/api\/profile\/([^/]+)$/);
  if (req.method === "GET" && profileMatch) {
    const username = sanitizeUsername(profileMatch[1]);
    const profile = db.users.find(user => user.username === username);
    if (!profile) {
      notFound(res);
      return;
    }
    const posts = db.posts
      .filter(post => post.userId === profile.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(post => enrichPost(db, post, viewer.id));

    sendJson(res, 200, {
      profile: {
        ...publicUser(profile),
        isMe: profile.id === viewer.id,
        isFollowing: viewer.followingIds.includes(profile.id)
      },
      posts
    });
    return;
  }

  const followMatch = pathname.match(/^\/api\/profile\/([^/]+)\/follow$/);
  if (req.method === "POST" && followMatch) {
    const username = sanitizeUsername(followMatch[1]);
    const profile = db.users.find(user => user.username === username);
    if (!profile || profile.id === viewer.id) {
      badRequest(res, "Нельзя подписаться на этот профиль.");
      return;
    }
    if (profile.isBlocked) {
      badRequest(res, "Нельзя подписаться на заблокированный профиль.");
      return;
    }
    const freshViewer = db.users.find(user => user.id === viewer.id);
    if (freshViewer.followingIds.includes(profile.id)) {
      freshViewer.followingIds = freshViewer.followingIds.filter(id => id !== profile.id);
      profile.followerIds = profile.followerIds.filter(id => id !== freshViewer.id);
    } else {
      freshViewer.followingIds.push(profile.id);
      if (!profile.followerIds.includes(freshViewer.id)) {
        profile.followerIds.push(freshViewer.id);
      }
    }
    writeDb(db);
    sendJson(res, 200, {
      profile: {
        ...publicUser(profile),
        isMe: false,
        isFollowing: freshViewer.followingIds.includes(profile.id)
      },
      viewer: publicUser(freshViewer)
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/overview") {
    if (!requireAdmin(res, viewer)) {
      return;
    }
    const stats = {
      users: db.users.length,
      posts: db.posts.length,
      comments: countAllComments(db),
      verified: db.users.filter(user => user.isVerified).length,
      blocked: db.users.filter(user => user.isBlocked).length,
      images: db.posts.filter(post => post.imageUrl).length
    };
    const users = db.users
      .slice()
      .sort((a, b) => new Date(b.joinedAt) - new Date(a.joinedAt))
      .map(user => adminUserView(db, user));
    const posts = db.posts
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(post => enrichPost(db, post, viewer.id))
      .slice(0, 50);
    sendJson(res, 200, { stats, users, posts });
    return;
  }

  const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (adminUserMatch && req.method === "PATCH") {
    if (!requireAdmin(res, viewer)) {
      return;
    }
    const user = db.users.find(entry => entry.username === sanitizeUsername(adminUserMatch[1]));
    if (!user) {
      notFound(res);
      return;
    }
    const body = await parseBody(req);
    if (user.id === viewer.id && body.isBlocked === true) {
      badRequest(res, "Нельзя заблокировать самого себя.");
      return;
    }
    if (user.id === viewer.id && body.isAdmin === false) {
      badRequest(res, "Нельзя снять админку у самого себя.");
      return;
    }
    if ("isBlocked" in body) {
      user.isBlocked = Boolean(body.isBlocked);
      if (user.isBlocked) {
        removeUserSessions(db, user.id);
      }
    }
    if ("isVerified" in body) {
      user.isVerified = Boolean(body.isVerified);
    }
    if ("isAdmin" in body) {
      user.isAdmin = Boolean(body.isAdmin);
    }
    writeDb(db);
    sendJson(res, 200, { user: adminUserView(db, user) });
    return;
  }

  const adminPostDeleteMatch = pathname.match(/^\/api\/admin\/posts\/([^/]+)$/);
  if (adminPostDeleteMatch && req.method === "DELETE") {
    if (!requireAdmin(res, viewer)) {
      return;
    }
    const post = findPost(db, adminPostDeleteMatch[1]);
    if (!post) {
      notFound(res);
      return;
    }
    db.posts = db.posts.filter(entry => entry.id !== post.id);
    writeDb(db);
    sendJson(res, 204, {});
    return;
  }

  const adminCommentDeleteMatch = pathname.match(/^\/api\/admin\/posts\/([^/]+)\/comments\/([^/]+)$/);
  if (adminCommentDeleteMatch && req.method === "DELETE") {
    if (!requireAdmin(res, viewer)) {
      return;
    }
    const post = findPost(db, adminCommentDeleteMatch[1]);
    const comment = post ? findComment(post, adminCommentDeleteMatch[2]) : null;
    if (!post || !comment) {
      notFound(res);
      return;
    }
    post.comments = post.comments.filter(entry => entry.id !== comment.id);
    writeDb(db);
    sendJson(res, 204, {});
    return;
  }

  const adminReplyDeleteMatch = pathname.match(/^\/api\/admin\/posts\/([^/]+)\/comments\/([^/]+)\/replies\/([^/]+)$/);
  if (adminReplyDeleteMatch && req.method === "DELETE") {
    if (!requireAdmin(res, viewer)) {
      return;
    }
    const post = findPost(db, adminReplyDeleteMatch[1]);
    const comment = post ? findComment(post, adminReplyDeleteMatch[2]) : null;
    if (!post || !comment) {
      notFound(res);
      return;
    }
    const deleted = deleteReplyRecursiveByAdmin(comment.replies || [], adminReplyDeleteMatch[3]);
    if (!deleted) {
      notFound(res);
      return;
    }
    writeDb(db);
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/clear-posts") {
    if (!requireAdmin(res, viewer)) {
      return;
    }
    db.posts = [];
    writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  notFound(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Server error", details: error.message });
  }
});

(async () => {
  try {
    await ensureDatabase();
    server.listen(PORT, () => {
      console.log(`ZBS server running on http://localhost:${PORT}`);
      if (DATABASE_URL) {
        console.log("Neon/Postgres storage enabled.");
      } else {
        console.log("Local db.json storage enabled.");
      }
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
})();


