// ==UserScript==
// @name         Bilibili Subtitle Comment Danmaku Extractor Export & AI Summarizer
// @namespace    https://github.com/constansino/
// @version      2.0.1
// @description  B站字幕/弹幕/评论提取导出 + AI视频总结（含自定义任务与LLM配置）
// @author       constansino
// @homepageURL  https://github.com/constansino/constansino-bilibili-subtitle-extractor-pro
// @supportURL   https://github.com/constansino/constansino-bilibili-subtitle-extractor-pro/issues
// @match        https://www.bilibili.com/video/*
// @grant        GM_setClipboard
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      *
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const STYLE_ID = "bscas-style";
  const PANEL_ID = "bscas-panel";
  const FLOAT_BTN_ID = "bscas-float-btn";
  const EDGE_TRIGGER_ID = "bscas-edge-trigger";
  const SETTINGS_KEY = "bscas-settings-v2";

  const TAB_LIST = [
    { id: "subtitle", label: "字幕" },
    { id: "videoSummary", label: "视频总结" },
    { id: "danmakuSummary", label: "弹幕总结" },
    { id: "commentSummary", label: "评论总结" },
    { id: "custom1", label: "自定义1" },
    { id: "custom2", label: "自定义2" },
    { id: "custom3", label: "自定义3" },
    { id: "settings", label: "设置" },
  ];

  const SUMMARY_TAB_MAP = {
    videoSummary: { key: "videoSummary", label: "视频总结" },
    danmakuSummary: { key: "danmakuSummary", label: "弹幕总结" },
    commentSummary: { key: "commentSummary", label: "评论总结" },
    custom1: { key: "custom1", label: "自定义1" },
    custom2: { key: "custom2", label: "自定义2" },
    custom3: { key: "custom3", label: "自定义3" },
  };

  const DEFAULT_SETTINGS = {
    ui: {
      defaultTab: "subtitle",
      panelMode: "edgeAuto",
      edgeCollapseDelayMs: 280,
      autoLoadSubtitle: true,
      autoLoadDanmaku: false,
      autoLoadComment: false,
    },
    llm: {
      apiUrl: "https://api.openai.com/v1/chat/completions",
      apiKey: "",
      model: "gpt-4o-mini",
      systemPrompt: "你是一个专业的视频内容分析助手。请根据输入材料，输出清晰、准确、结构化的中文结果。",
      temperature: null,
      topP: null,
      maxTokens: null,
      timeoutMs: 60000,
      stream: false,
    },
    data: {
      subtitleMaxLines: 800,
      danmakuMaxLines: 600,
      commentMaxItems: 400,
      commentPages: 5,
    },
    triggers: {
      videoSummary: "manual",
      danmakuSummary: "manual",
      commentSummary: "manual",
      custom1: "manual",
      custom2: "manual",
      custom3: "manual",
    },
    prompts: {
      videoSummary: "请根据以下视频字幕，生成结构化总结。要求：\n1. 用5-8条要点概括核心内容；\n2. 给出时间线脉络；\n3. 给出3条可执行结论。",
      danmakuSummary: "请根据以下弹幕内容，总结观众关注点。要求：\n1. 统计高频观点；\n2. 区分正向/负向情绪；\n3. 给出观众最关心的3个问题。",
      commentSummary: "请根据以下评论内容，提炼用户观点。要求：\n1. 归纳主要支持观点与反对观点；\n2. 提取有价值建议；\n3. 输出总体舆情结论。",
      custom1: "请基于输入材料完成你的分析任务。",
      custom2: "请基于输入材料完成你的分析任务。",
      custom3: "请基于输入材料完成你的分析任务。",
    },
  };

  const STATE = {
    bvid: "",
    cid: "",
    aid: "",
    title: "",
    page: 1,
    partTitle: "",
    tracks: [],
    activeTrack: null,
    subtitles: [],
    filteredSubtitles: [],
    danmakuRows: null,
    commentRows: null,
    initialized: false,
    currentUrl: location.href,
    activeTab: "subtitle",
    summaryResults: {
      videoSummary: "",
      danmakuSummary: "",
      commentSummary: "",
      custom1: "",
      custom2: "",
      custom3: "",
    },
    summaryStatus: {
      videoSummary: "idle",
      danmakuSummary: "idle",
      commentSummary: "idle",
      custom1: "idle",
      custom2: "idle",
      custom3: "idle",
    },
    summaryError: {
      videoSummary: "",
      danmakuSummary: "",
      commentSummary: "",
      custom1: "",
      custom2: "",
      custom3: "",
    },
    autoTriggered: {},
    edgeCollapseTimer: null,
  };

  const UI = {
    panel: null,
    floatBtn: null,
    edgeTrigger: null,
    tabButtons: {},
    tabPages: {},
    subtitle: {
      trackSelect: null,
      searchInput: null,
      list: null,
      meta: null,
    },
    summary: {
      videoSummary: {},
      danmakuSummary: {},
      commentSummary: {},
      custom1: {},
      custom2: {},
      custom3: {},
    },
    settings: {
      form: null,
      status: null,
    },
  };

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function deepMerge(base, extra) {
    const out = Array.isArray(base) ? [...base] : { ...base };
    if (!extra || typeof extra !== "object") return out;
    for (const [k, v] of Object.entries(extra)) {
      if (v && typeof v === "object" && !Array.isArray(v) && base && typeof base[k] === "object" && base[k] && !Array.isArray(base[k])) {
        out[k] = deepMerge(base[k], v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  function getSettings() {
    let raw = "";
    try {
      if (typeof GM_getValue === "function") raw = GM_getValue(SETTINGS_KEY, "");
      else raw = localStorage.getItem(SETTINGS_KEY) || "";
    } catch {
      raw = "";
    }
    if (!raw) return deepClone(DEFAULT_SETTINGS);
    try {
      const parsed = JSON.parse(raw);
      return deepMerge(deepClone(DEFAULT_SETTINGS), parsed);
    } catch {
      return deepClone(DEFAULT_SETTINGS);
    }
  }

  function saveSettings(nextSettings) {
    const text = JSON.stringify(nextSettings);
    try {
      if (typeof GM_setValue === "function") GM_setValue(SETTINGS_KEY, text);
      else localStorage.setItem(SETTINGS_KEY, text);
    } catch (e) {
      console.error("[BSCAS] save settings failed", e);
      alert("设置保存失败，请检查浏览器权限。");
    }
  }

  function withNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function withInt(value, fallback, min, max) {
    let n = parseInt(value, 10);
    if (!Number.isFinite(n)) n = fallback;
    if (Number.isFinite(min)) n = Math.max(min, n);
    if (Number.isFinite(max)) n = Math.min(max, n);
    return n;
  }

  function optionalNumber(value, min, max) {
    const raw = String(value == null ? "" : value).trim();
    if (!raw) return null;
    let n = Number(raw);
    if (!Number.isFinite(n)) return null;
    if (Number.isFinite(min)) n = Math.max(min, n);
    if (Number.isFinite(max)) n = Math.min(max, n);
    return n;
  }

  function optionalInt(value, min, max) {
    const raw = String(value == null ? "" : value).trim();
    if (!raw) return null;
    let n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return null;
    if (Number.isFinite(min)) n = Math.max(min, n);
    if (Number.isFinite(max)) n = Math.min(max, n);
    return n;
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderInlineMarkdown(line) {
    let s = line;
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "<a href=\"$2\" target=\"_blank\" rel=\"noreferrer noopener\">$1</a>");
    return s;
  }

  function markdownToHtml(mdText) {
    const src = String(mdText || "").replace(/\r\n/g, "\n");
    const escaped = escapeHtml(src);

    const blocks = [];
    let text = escaped.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (m, lang, code) => {
      const idx = blocks.length;
      const cls = lang ? ` class=\"lang-${lang}\"` : "";
      blocks.push(`<pre><code${cls}>${code}</code></pre>`);
      return `@@CODEBLOCK_${idx}@@`;
    });

    const lines = text.split("\n");
    const out = [];
    let inUl = false;
    let inOl = false;
    let inQuote = false;

    function closeLists() {
      if (inUl) {
        out.push("</ul>");
        inUl = false;
      }
      if (inOl) {
        out.push("</ol>");
        inOl = false;
      }
    }

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      const t = line.trim();

      if (!t) {
        closeLists();
        if (inQuote) {
          out.push("</blockquote>");
          inQuote = false;
        }
        continue;
      }

      const codeToken = t.match(/^@@CODEBLOCK_(\d+)@@$/);
      if (codeToken) {
        closeLists();
        if (inQuote) {
          out.push("</blockquote>");
          inQuote = false;
        }
        out.push(t);
        continue;
      }

      const h = t.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        closeLists();
        if (inQuote) {
          out.push("</blockquote>");
          inQuote = false;
        }
        const lv = h[1].length;
        out.push(`<h${lv}>${renderInlineMarkdown(h[2])}</h${lv}>`);
        continue;
      }

      const quote = t.match(/^>\s?(.*)$/);
      if (quote) {
        closeLists();
        if (!inQuote) {
          out.push("<blockquote>");
          inQuote = true;
        }
        out.push(`<p>${renderInlineMarkdown(quote[1])}</p>`);
        continue;
      }
      if (inQuote) {
        out.push("</blockquote>");
        inQuote = false;
      }

      const ul = t.match(/^[-*+]\s+(.*)$/);
      if (ul) {
        if (inOl) {
          out.push("</ol>");
          inOl = false;
        }
        if (!inUl) {
          out.push("<ul>");
          inUl = true;
        }
        out.push(`<li>${renderInlineMarkdown(ul[1])}</li>`);
        continue;
      }

      const ol = t.match(/^\d+\.\s+(.*)$/);
      if (ol) {
        if (inUl) {
          out.push("</ul>");
          inUl = false;
        }
        if (!inOl) {
          out.push("<ol>");
          inOl = true;
        }
        out.push(`<li>${renderInlineMarkdown(ol[1])}</li>`);
        continue;
      }

      closeLists();
      out.push(`<p>${renderInlineMarkdown(t)}</p>`);
    }

    closeLists();
    if (inQuote) out.push("</blockquote>");

    let html = out.join("\n");
    html = html.replace(/@@CODEBLOCK_(\d+)@@/g, (m, i) => blocks[Number(i)] || "");
    return html;
  }

  function formatTime(seconds, forSrt) {
    const s = Math.max(0, Number(seconds || 0));
    const ms = Math.floor((s % 1) * 1000);
    const total = Math.floor(s);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    const pad = (n, l = 2) => String(n).padStart(l, "0");
    return `${pad(h)}:${pad(m)}:${pad(sec)}${forSrt ? "," : "."}${pad(ms, 3)}`;
  }

  function normalizeUrl(url) {
    if (!url) return "";
    if (url.startsWith("//")) return `https:${url}`;
    if (/^http:\/\//i.test(url)) return url.replace(/^http:\/\//i, "https://");
    return url;
  }

  function getBvidFromUrl(url) {
    const m = String(url).match(/\/video\/(BV[0-9A-Za-z]+)/i);
    return m ? m[1] : "";
  }

  function getPageNoFromUrl(url) {
    try {
      const u = new URL(String(url || location.href), location.origin);
      const p = parseInt(u.searchParams.get("p") || "", 10);
      return Number.isFinite(p) && p > 0 ? p : 1;
    } catch {
      return 1;
    }
  }

  function pickPage(pages, pageNo) {
    if (!Array.isArray(pages) || !pages.length) return null;
    const targetPage = Number(pageNo) || 1;
    return pages.find((p) => Number(p.page) === targetPage) || pages[targetPage - 1] || pages[0] || null;
  }

  function pickCurrentVideoPage(videoData, url = location.href) {
    const vd = videoData || {};
    const pageNo = getPageNoFromUrl(url);
    const page = pickPage(vd.pages, pageNo);
    const cid = page && page.cid ? page.cid : vd.cid || "";
    return {
      cid: String(cid || ""),
      page: page ? withInt(page.page, pageNo, 1) : pageNo,
      partTitle: String((page && page.part) || ""),
    };
  }

  function tryGetCidAidFromPage(bvid) {
    try {
      const s = window.__INITIAL_STATE__ || {};
      const vd = s.videoData || {};
      if (bvid && vd.bvid && String(vd.bvid).toUpperCase() !== String(bvid).toUpperCase()) {
        return { cid: "", aid: "", title: "", page: getPageNoFromUrl(location.href), partTitle: "" };
      }
      const currentPage = pickCurrentVideoPage(vd);
      const aid = vd.aid || "";
      const title = vd.title || document.title.replace(/_哔哩哔哩_bilibili$/, "");
      return {
        cid: currentPage.cid,
        aid: String(aid || ""),
        title: String(title || ""),
        page: currentPage.page,
        partTitle: currentPage.partTitle,
      };
    } catch {
      return { cid: "", aid: "", title: "", page: getPageNoFromUrl(location.href), partTitle: "" };
    }
  }

  async function requestJson(url, withCredentials = false) {
    const res = await fetch(normalizeUrl(url), {
      credentials: withCredentials ? "include" : "omit",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function requestText(url, withCredentials = false) {
    const res = await fetch(normalizeUrl(url), {
      credentials: withCredentials ? "include" : "omit",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  function gmRequest(options) {
    const opts = {
      method: "GET",
      headers: {},
      timeout: 60000,
      ...options,
    };
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("GM_xmlhttpRequest 不可用"));
        return;
      }
      GM_xmlhttpRequest({
        method: opts.method,
        url: opts.url,
        headers: opts.headers,
        data: opts.data,
        timeout: opts.timeout,
        onprogress: opts.onprogress,
        onload: (res) => resolve(res),
        onerror: () => reject(new Error("网络请求失败")),
        ontimeout: () => reject(new Error("网络请求超时")),
      });
    });
  }

  async function loadVideoMeta(bvid, url = location.href) {
    const j = await requestJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, true);
    if (Number(j.code) !== 0) throw new Error(`view code=${j.code} msg=${j.message || ""}`);
    const d = j.data || {};
    const currentPage = pickCurrentVideoPage(d, url);
    return {
      aid: String(d.aid || ""),
      cid: currentPage.cid,
      title: String(d.title || ""),
      page: currentPage.page,
      partTitle: currentPage.partTitle,
    };
  }

  async function loadSubtitleTracks(bvid, cid) {
    const j = await requestJson(
      `https://api.bilibili.com/x/player/wbi/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`,
      true,
    );
    if (Number(j.code) !== 0) throw new Error(`player code=${j.code} msg=${j.message || ""}`);
    return (((j.data || {}).subtitle || {}).subtitles || [])
      .map((t) => ({
        id: String(t.id || ""),
        lan: String(t.lan || ""),
        lanDoc: String(t.lan_doc || t.lan || ""),
        url: normalizeUrl(String(t.subtitle_url || "")),
      }))
      .filter((x) => x.url);
  }

  async function loadSubtitleBody(url) {
    const j = await requestJson(url, false);
    return (j.body || [])
      .map((r, i) => ({
        index: i + 1,
        from: Number(r.from || 0),
        to: Number(r.to || 0),
        text: String(r.content || "").trim(),
      }))
      .filter((x) => x.text);
  }

  async function loadDanmakuRows(cid) {
    const text = await requestText(`https://comment.bilibili.com/${encodeURIComponent(cid)}.xml`, false);
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const rows = [];
    const nodes = doc.querySelectorAll("d");
    nodes.forEach((node, idx) => {
      const p = String(node.getAttribute("p") || "").split(",");
      const from = Number(p[0] || 0);
      const content = String(node.textContent || "").trim();
      if (!content) return;
      rows.push({
        index: idx + 1,
        from,
        text: content,
      });
    });
    return rows;
  }

  function pushComment(all, reply, level = 0) {
    if (!reply || typeof reply !== "object") return;
    const msg = String(((reply.content || {}).message || "")).trim();
    const uname = String(((reply.member || {}).uname || "未知用户")).trim() || "未知用户";
    const like = Number(reply.like || 0);
    const ctime = Number(reply.ctime || 0);
    if (msg) {
      all.push({
        uname,
        text: msg,
        like,
        ctime,
        level,
      });
    }
    const subs = Array.isArray(reply.replies) ? reply.replies : [];
    subs.forEach((x) => pushComment(all, x, level + 1));
  }

  async function loadCommentRows(aid, pages) {
    const rows = [];
    const maxPages = withInt(pages, 3, 1, 20);
    for (let pn = 1; pn <= maxPages; pn += 1) {
      const url = `https://api.bilibili.com/x/v2/reply?pn=${pn}&type=1&oid=${encodeURIComponent(aid)}&sort=2`;
      const j = await requestJson(url, true);
      if (Number(j.code) !== 0) {
        throw new Error(`评论接口异常: code=${j.code} msg=${j.message || ""}`);
      }
      const replies = ((j.data || {}).replies || []);
      if (!replies.length) break;
      replies.forEach((r) => pushComment(rows, r, 0));
      if (replies.length < 3) break;
    }
    return rows;
  }

  function toSrt(rows) {
    return rows
      .map((r, idx) => `${idx + 1}\n${formatTime(r.from, true)} --> ${formatTime(r.to, true)}\n${r.text}\n`)
      .join("\n");
  }

  function toVtt(rows) {
    const body = rows.map((r) => `${formatTime(r.from, false)} --> ${formatTime(r.to, false)}\n${r.text}\n`).join("\n");
    return `WEBVTT\n\n${body}`;
  }

  function subtitlesToText(rows) {
    return rows.map((r) => r.text).join("\n");
  }

  function subtitlesToTimeline(rows) {
    return rows.map((r) => `[${formatTime(r.from, false)} - ${formatTime(r.to, false)}] ${r.text}`).join("\n");
  }

  function danmakuToText(rows) {
    return rows.map((r) => `[${formatTime(r.from, false)}] ${r.text}`).join("\n");
  }

  function commentsToText(rows) {
    return rows
      .map((r) => {
        const t = r.ctime ? new Date(r.ctime * 1000).toLocaleString() : "";
        const prefix = `${"  ".repeat(Math.min(3, r.level || 0))}${r.uname}`;
        return `${prefix}${t ? ` (${t})` : ""} [赞${r.like}]：${r.text}`;
      })
      .join("\n");
  }

  function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
    if (typeof GM_download === "function") {
      const blob = new Blob([text], { type: mime });
      const u = URL.createObjectURL(blob);
      GM_download({
        url: u,
        name: filename,
        saveAs: true,
        onload: () => URL.revokeObjectURL(u),
        onerror: () => URL.revokeObjectURL(u),
      });
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function copyText(text) {
    if (!text) return;
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(text, "text");
      return;
    }
    navigator.clipboard.writeText(text).catch(() => {});
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) node.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null) return;
      if (typeof c === "string") node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    });
    return node;
  }

  function makeDraggable(panel, handle) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;
    handle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      panel.style.left = `${Math.max(0, e.clientX - offsetX)}px`;
      panel.style.top = `${Math.max(0, e.clientY - offsetY)}px`;
      panel.style.right = "auto";
    });
    document.addEventListener("mouseup", () => {
      dragging = false;
    });
  }
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        top: 96px;
        right: 18px;
        width: 680px;
        height: 74vh;
        min-width: 460px;
        min-height: 380px;
        max-width: 92vw;
        max-height: 92vh;
        z-index: 2147483646;
        background: #0f1622;
        color: #e6edf3;
        border: 1px solid #2b3b52;
        border-radius: 14px;
        box-shadow: 0 16px 36px rgba(0,0,0,.38);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        resize: both;
        font-family: "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      #${PANEL_ID} * { box-sizing: border-box; }
      #${PANEL_ID} .bscas-main {
        display: flex;
        flex-direction: column;
        min-height: 0;
        flex: 1;
      }
      #${PANEL_ID} .bscas-header {
        padding: 10px 12px;
        cursor: move;
        background: linear-gradient(90deg, #152237, #111925);
        border-bottom: 1px solid #2a3442;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      #${PANEL_ID} .bscas-title {
        font-weight: 700;
        font-size: 14px;
        color: #9fd0ff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${PANEL_ID} .bscas-tools {
        display: flex;
        gap: 6px;
      }
      #${PANEL_ID} button,
      #${PANEL_ID} select,
      #${PANEL_ID} input,
      #${PANEL_ID} textarea {
        background: #1a2533;
        color: #e6edf3;
        border: 1px solid #355071;
        border-radius: 8px;
        padding: 6px 8px;
        font-size: 12px;
      }
      #${PANEL_ID} button:hover { background: #223347; }
      #${PANEL_ID} .bscas-tabs {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        padding: 8px 10px;
        border-bottom: 1px solid #27364c;
        background: #0f1826;
      }
      #${PANEL_ID} .bscas-tab-btn {
        padding: 5px 10px;
        border-radius: 999px;
        cursor: pointer;
        border: 1px solid #3a4f69;
        background: #1a2533;
      }
      #${PANEL_ID} .bscas-tab-btn.active {
        background: #244064;
        border-color: #5e8fc2;
        color: #d7ecff;
      }
      #${PANEL_ID} .bscas-content {
        padding: 10px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 0;
        flex: 1;
      }
      #${PANEL_ID} .bscas-tab-page {
        display: none;
        min-height: 0;
        height: 100%;
        overflow: auto;
      }
      #${PANEL_ID} .bscas-tab-page.active {
        display: block;
      }
      #${PANEL_ID} .bscas-row {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-bottom: 8px;
      }
      #${PANEL_ID} .bscas-row > * { flex: 1; }
      #${PANEL_ID} .bscas-list {
        border: 1px solid #2f3d52;
        border-radius: 10px;
        background: #0d141f;
        overflow: auto;
        min-height: 220px;
        max-height: 36vh;
      }
      #${PANEL_ID} .bscas-item {
        border-bottom: 1px solid #1f2b3d;
        padding: 8px 10px;
      }
      #${PANEL_ID} .bscas-item:last-child { border-bottom: none; }
      #${PANEL_ID} .bscas-time { color: #8ebcff; font-size: 11px; margin-bottom: 2px; }
      #${PANEL_ID} .bscas-text { white-space: pre-wrap; word-break: break-word; font-size: 13px; }
      #${PANEL_ID} .bscas-footer {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-bottom: 8px;
      }
      #${PANEL_ID} .bscas-mini {
        font-size: 11px;
        color: #9db0c6;
      }
      #${PANEL_ID} .bscas-summary-output {
        border: 1px solid #2f3d52;
        border-radius: 10px;
        background: #0d141f;
        min-height: 220px;
        height: calc(100% - 72px);
        overflow: auto;
        padding: 10px;
        white-space: normal;
        word-break: break-word;
        line-height: 1.5;
        font-size: 13px;
      }
      #${PANEL_ID} .bscas-summary-output p { margin: 0 0 8px; }
      #${PANEL_ID} .bscas-summary-output h1,
      #${PANEL_ID} .bscas-summary-output h2,
      #${PANEL_ID} .bscas-summary-output h3,
      #${PANEL_ID} .bscas-summary-output h4,
      #${PANEL_ID} .bscas-summary-output h5,
      #${PANEL_ID} .bscas-summary-output h6 { margin: 8px 0; color: #b7d8ff; }
      #${PANEL_ID} .bscas-summary-output ul,
      #${PANEL_ID} .bscas-summary-output ol { margin: 8px 0 8px 20px; padding: 0; }
      #${PANEL_ID} .bscas-summary-output li { margin: 3px 0; }
      #${PANEL_ID} .bscas-summary-output code {
        background: #142238;
        padding: 1px 4px;
        border-radius: 4px;
        color: #cfe6ff;
        font-family: Consolas, "Courier New", monospace;
      }
      #${PANEL_ID} .bscas-summary-output pre {
        background: #0a1019;
        border: 1px solid #2f415a;
        border-radius: 8px;
        padding: 10px;
        overflow: auto;
        margin: 10px 0;
      }
      #${PANEL_ID} .bscas-summary-output pre code {
        background: none;
        padding: 0;
        border-radius: 0;
      }
      #${PANEL_ID} .bscas-summary-output blockquote {
        margin: 8px 0;
        padding: 6px 10px;
        border-left: 3px solid #4b729e;
        background: #101a2a;
      }
      #${PANEL_ID} .bscas-summary-output a { color: #82bbff; }
      #${PANEL_ID} .bscas-source-preview {
        border: 1px solid #2f3d52;
        border-radius: 10px;
        background: #0b121d;
        min-height: 92px;
        max-height: 22vh;
        overflow: auto;
        padding: 8px;
        margin-bottom: 8px;
        white-space: pre-wrap;
        word-break: break-word;
        line-height: 1.45;
        font-size: 12px;
        color: #b8c9db;
      }
      #${PANEL_ID} .bscas-status {
        color: #91bde8;
        font-size: 12px;
        margin-bottom: 6px;
      }
      #${PANEL_ID} .bscas-setting-section {
        border: 1px solid #2f415a;
        border-radius: 10px;
        padding: 10px;
        margin-bottom: 10px;
        background: #101a29;
      }
      #${PANEL_ID} .bscas-setting-title {
        color: #9fd0ff;
        font-size: 13px;
        font-weight: 700;
        margin-bottom: 8px;
      }
      #${PANEL_ID} .bscas-setting-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }
      #${PANEL_ID} .bscas-setting-grid .full {
        grid-column: 1 / -1;
      }
      #${PANEL_ID} .bscas-label {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 12px;
        color: #cad9ea;
      }
      #${PANEL_ID} textarea { min-height: 72px; resize: vertical; }
      #${FLOAT_BTN_ID} {
        position: fixed;
        right: 16px;
        bottom: 88px;
        z-index: 2147483645;
        padding: 8px 11px;
        border-radius: 999px;
        border: 1px solid #40648d;
        background: #112846;
        color: #d4eaff;
        font-size: 12px;
        cursor: pointer;
      }
      #${EDGE_TRIGGER_ID} {
        position: fixed;
        top: 0;
        right: 0;
        width: 10px;
        height: 100vh;
        z-index: 2147483644;
        background: transparent;
      }
    `;
    document.head.appendChild(style);
  }

  function setActiveTab(tabId) {
    if (!TAB_LIST.some((t) => t.id === tabId)) tabId = "subtitle";
    STATE.activeTab = tabId;
    Object.entries(UI.tabButtons).forEach(([id, btn]) => {
      btn.classList.toggle("active", id === tabId);
    });
    Object.entries(UI.tabPages).forEach(([id, page]) => {
      page.classList.toggle("active", id === tabId);
    });
  }

  function clearSummaryCache() {
    Object.keys(STATE.summaryResults).forEach((k) => {
      STATE.summaryResults[k] = "";
      STATE.summaryStatus[k] = "idle";
      STATE.summaryError[k] = "";
      updateSummaryUI(k);
    });
  }

  function markSummaryStatus(tabId, status, message) {
    STATE.summaryStatus[tabId] = status;
    if (status === "error") STATE.summaryError[tabId] = message || "未知错误";
    if (status !== "error") STATE.summaryError[tabId] = "";
    updateSummaryUI(tabId);
  }

  function updateSummaryUI(tabId) {
    const ui = UI.summary[tabId];
    if (!ui || !ui.status || !ui.output) return;
    const map = {
      idle: "未执行",
      loading: "正在生成...",
      done: "完成",
      error: `失败：${STATE.summaryError[tabId] || "未知错误"}`,
    };
    ui.status.textContent = `状态：${map[STATE.summaryStatus[tabId]] || "未执行"}`;
    const md = STATE.summaryResults[tabId] || "";
    ui.output.innerHTML = md ? markdownToHtml(md) : "";
  }

  function setSummaryOutput(tabId, text, append = false) {
    if (append) STATE.summaryResults[tabId] += text;
    else STATE.summaryResults[tabId] = text;
    updateSummaryUI(tabId);
  }

  function renderSourcePreview(tabId, text) {
    const ui = UI.summary[tabId];
    if (!ui || !ui.sourcePreview) return;
    ui.sourcePreview.textContent = String(text || "").trim() || "暂无已拉取数据";
  }

  function renderDanmakuPreview(rows) {
    const src = (rows || []).slice(0, 200).map((r) => `[${formatTime(r.from, false)}] ${r.text}`).join("\n");
    renderSourcePreview("danmakuSummary", src);
  }

  function renderCommentPreview(rows) {
    const src = commentsToText((rows || []).slice(0, 120));
    renderSourcePreview("commentSummary", src);
  }

  function getPreferredTrackIndex() {
    if (!STATE.tracks.length) return -1;
    const idx = STATE.tracks.findIndex((t) => ["zh-CN", "zh-Hans", "ai-zh", "zh"].includes(t.lan));
    return Math.max(0, idx);
  }

  function clearEdgeCollapseTimer() {
    if (STATE.edgeCollapseTimer) {
      clearTimeout(STATE.edgeCollapseTimer);
      STATE.edgeCollapseTimer = null;
    }
  }

  function showPanel() {
    const panel = UI.panel;
    if (!panel) return;
    panel.style.display = "flex";
  }

  function hidePanel() {
    const panel = UI.panel;
    if (!panel) return;
    panel.style.display = "none";
  }

  function scheduleEdgeCollapse() {
    const settings = getSettings();
    if ((settings.ui || {}).panelMode !== "edgeAuto") return;
    clearEdgeCollapseTimer();
    const delay = withInt(settings.ui.edgeCollapseDelayMs, DEFAULT_SETTINGS.ui.edgeCollapseDelayMs, 80, 5000);
    STATE.edgeCollapseTimer = setTimeout(() => {
      hidePanel();
    }, delay);
  }

  function applyPanelMode(settings) {
    const mode = (settings.ui || {}).panelMode || DEFAULT_SETTINGS.ui.panelMode;
    const panel = UI.panel;
    const floatBtn = UI.floatBtn;
    const edge = UI.edgeTrigger;
    if (!panel || !floatBtn || !edge) return;

    clearEdgeCollapseTimer();
    if (mode === "edgeAuto") {
      floatBtn.style.display = "none";
      edge.style.display = "block";
      hidePanel();
    } else {
      edge.style.display = "none";
      floatBtn.style.display = "block";
      hidePanel();
    }
  }

  function filterSubtitleRows(keyword) {
    const k = String(keyword || "").trim().toLowerCase();
    STATE.filteredSubtitles = !k
      ? [...STATE.subtitles]
      : STATE.subtitles.filter((r) => r.text.toLowerCase().includes(k));
    renderSubtitleList();
  }

  function renderSubtitleList() {
    const list = UI.subtitle.list;
    if (!list) return;
    list.innerHTML = "";
    if (!STATE.filteredSubtitles.length) {
      list.appendChild(el("div", { class: "bscas-item" }, [
        el("div", { class: "bscas-text", text: "暂无字幕内容（可能无字幕或提取失败）" }),
      ]));
      return;
    }
    const frag = document.createDocumentFragment();
    STATE.filteredSubtitles.forEach((r) => {
      frag.appendChild(el("div", { class: "bscas-item" }, [
        el("div", { class: "bscas-time", text: `${formatTime(r.from, false)} - ${formatTime(r.to, false)}` }),
        el("div", { class: "bscas-text", text: r.text }),
      ]));
    });
    list.appendChild(frag);
  }

  function updateSubtitleMeta() {
    const info = UI.subtitle.meta;
    if (!info) return;
    const t = STATE.activeTrack;
    info.textContent = [
      `BV: ${STATE.bvid || "-"}`,
      `分P: ${STATE.page || "-"}`,
      `CID: ${STATE.cid || "-"}`,
      `标题: ${STATE.partTitle || STATE.title || "-"}`,
      `轨道: ${t ? `${t.lanDoc} (${t.lan})` : "-"}`,
      `字幕行数: ${STATE.subtitles.length}`,
      `弹幕: ${STATE.danmakuRows ? STATE.danmakuRows.length : "-"}`,
      `评论: ${STATE.commentRows ? STATE.commentRows.length : "-"}`,
    ].join(" | ");
  }

  async function selectSubtitleTrack(index) {
    const track = STATE.tracks[index] || null;
    STATE.activeTrack = track;
    if (!track) {
      STATE.subtitles = [];
      filterSubtitleRows("");
      updateSubtitleMeta();
      return;
    }
    try {
      STATE.subtitles = await loadSubtitleBody(track.url);
      filterSubtitleRows(UI.subtitle.searchInput?.value || "");
      updateSubtitleMeta();
    } catch (e) {
      console.error("[BSCAS] load subtitle body failed", e);
      STATE.subtitles = [];
      filterSubtitleRows("");
      updateSubtitleMeta();
      alert(`字幕正文拉取失败: ${String(e.message || e)}`);
    }
  }

  function renderTrackOptions() {
    const sel = UI.subtitle.trackSelect;
    if (!sel) return;
    sel.innerHTML = "";
    if (!STATE.tracks.length) {
      sel.appendChild(el("option", { value: "-1", text: "无可用字幕轨" }));
      return;
    }
    STATE.tracks.forEach((t, idx) => {
      sel.appendChild(el("option", { value: String(idx), text: `${t.lanDoc} (${t.lan})` }));
    });
  }

  async function ensureDanmakuLoaded() {
    if (!STATE.cid) throw new Error("未拿到 CID，无法拉取弹幕");
    if (Array.isArray(STATE.danmakuRows)) {
      renderDanmakuPreview(STATE.danmakuRows);
      return STATE.danmakuRows;
    }
    STATE.danmakuRows = await loadDanmakuRows(STATE.cid);
    renderDanmakuPreview(STATE.danmakuRows);
    updateSubtitleMeta();
    return STATE.danmakuRows;
  }

  async function ensureCommentsLoaded() {
    if (!STATE.aid) throw new Error("未拿到 AID，无法拉取评论");
    if (Array.isArray(STATE.commentRows)) {
      renderCommentPreview(STATE.commentRows);
      return STATE.commentRows;
    }
    const settings = getSettings();
    STATE.commentRows = await loadCommentRows(STATE.aid, settings.data.commentPages);
    renderCommentPreview(STATE.commentRows);
    updateSubtitleMeta();
    return STATE.commentRows;
  }

  function trimLines(text, maxLines) {
    const lines = String(text || "").split(/\r?\n/).filter(Boolean);
    if (lines.length <= maxLines) return lines.join("\n");
    return lines.slice(0, maxLines).join("\n") + `\n\n[已截断，共 ${lines.length} 行，保留前 ${maxLines} 行]`;
  }

  async function buildTaskInput(tabId) {
    const settings = getSettings();
    const baseInfo = `视频标题：${STATE.title || "未知"}\nBV号：${STATE.bvid || "未知"}\nAID：${STATE.aid || "未知"}\nCID：${STATE.cid || "未知"}`;

    if (tabId === "videoSummary") {
      const txt = subtitlesToTimeline(STATE.subtitles);
      if (!txt.trim()) throw new Error("当前视频暂无可用字幕");
      return `${baseInfo}\n\n【字幕】\n${trimLines(txt, settings.data.subtitleMaxLines)}`;
    }

    if (tabId === "danmakuSummary") {
      const rows = await ensureDanmakuLoaded();
      const txt = danmakuToText(rows);
      if (!txt.trim()) throw new Error("当前视频暂无可用弹幕");
      return `${baseInfo}\n\n【弹幕】\n${trimLines(txt, settings.data.danmakuMaxLines)}`;
    }

    if (tabId === "commentSummary") {
      const rows = await ensureCommentsLoaded();
      const limited = rows.slice(0, settings.data.commentMaxItems);
      const txt = commentsToText(limited);
      if (!txt.trim()) throw new Error("当前视频暂无可用评论");
      return `${baseInfo}\n\n【评论】\n${txt}`;
    }

    if (["custom1", "custom2", "custom3"].includes(tabId)) {
      const parts = [baseInfo];
      if (STATE.subtitles.length) {
        parts.push(`【字幕】\n${trimLines(subtitlesToTimeline(STATE.subtitles), settings.data.subtitleMaxLines)}`);
      }
      try {
        const dm = await ensureDanmakuLoaded();
        if (dm.length) parts.push(`【弹幕】\n${trimLines(danmakuToText(dm), settings.data.danmakuMaxLines)}`);
      } catch (e) {
        console.warn("[BSCAS] load danmaku for custom failed", e);
      }
      try {
        const cm = await ensureCommentsLoaded();
        if (cm.length) parts.push(`【评论】\n${commentsToText(cm.slice(0, settings.data.commentMaxItems))}`);
      } catch (e) {
        console.warn("[BSCAS] load comments for custom failed", e);
      }
      return parts.join("\n\n");
    }

    throw new Error("未知任务类型");
  }
  function normalizeLlmMessageContent(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((x) => (typeof x === "string" ? x : (x && x.text) || "")).join("");
    }
    if (content && typeof content === "object") {
      if (typeof content.text === "string") return content.text;
    }
    return "";
  }

  async function callLlmNonStream(payload, llmSettings) {
    const headers = {
      "Content-Type": "application/json",
    };
    if (llmSettings.apiKey) headers.Authorization = `Bearer ${llmSettings.apiKey}`;

    const res = await gmRequest({
      method: "POST",
      url: llmSettings.apiUrl,
      headers,
      data: JSON.stringify(payload),
      timeout: llmSettings.timeoutMs,
    });

    if (res.status < 200 || res.status >= 300) {
      throw new Error(`LLM请求失败: HTTP ${res.status}`);
    }

    let data;
    try {
      data = JSON.parse(res.responseText || "{}");
    } catch {
      throw new Error("LLM响应不是合法JSON");
    }

    if (data.error) {
      const msg = (data.error.message || data.error.code || JSON.stringify(data.error));
      throw new Error(`LLM错误: ${msg}`);
    }

    const c0 = (data.choices || [])[0] || {};
    const text = normalizeLlmMessageContent((c0.message || {}).content) || normalizeLlmMessageContent(c0.text);
    if (!text) throw new Error("LLM未返回内容");
    return text;
  }

  async function callLlmStream(payload, llmSettings, onDelta) {
    const headers = {
      "Content-Type": "application/json",
    };
    if (llmSettings.apiKey) headers.Authorization = `Bearer ${llmSettings.apiKey}`;

    return new Promise((resolve, reject) => {
      let result = "";
      let processed = 0;
      let buffer = "";
      let done = false;

      function consumeChunk(chunk) {
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const lineRaw of lines) {
          const line = lineRaw.trim();
          if (!line || !line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") {
            done = true;
            continue;
          }
          try {
            const obj = JSON.parse(data);
            const choice = (obj.choices || [])[0] || {};
            const delta = normalizeLlmMessageContent((choice.delta || {}).content);
            if (delta) {
              result += delta;
              if (typeof onDelta === "function") onDelta(delta);
            }
            if (choice.finish_reason) done = true;
          } catch {
            // ignore partial/unrecognized line
          }
        }
      }

      GM_xmlhttpRequest({
        method: "POST",
        url: llmSettings.apiUrl,
        headers,
        data: JSON.stringify(payload),
        timeout: llmSettings.timeoutMs,
        onprogress: (ev) => {
          const text = String(ev.responseText || "");
          if (text.length <= processed) return;
          const chunk = text.slice(processed);
          processed = text.length;
          consumeChunk(chunk);
        },
        onload: (res) => {
          if (res.status < 200 || res.status >= 300) {
            reject(new Error(`LLM请求失败: HTTP ${res.status}`));
            return;
          }
          const full = String(res.responseText || "");
          if (full.length > processed) {
            consumeChunk(full.slice(processed));
            processed = full.length;
          }

          if (!result.trim()) {
            try {
              const obj = JSON.parse(full);
              if (obj.error) {
                reject(new Error(`LLM错误: ${(obj.error.message || obj.error.code || "未知错误")}`));
                return;
              }
              const c0 = (obj.choices || [])[0] || {};
              const txt = normalizeLlmMessageContent((c0.message || {}).content) || normalizeLlmMessageContent(c0.text);
              if (txt) result = txt;
            } catch {
              // no-op
            }
          }

          if (!result.trim()) {
            reject(new Error(done ? "LLM流式响应为空" : "LLM未返回有效内容"));
            return;
          }
          resolve(result);
        },
        onerror: () => reject(new Error("LLM网络请求失败")),
        ontimeout: () => reject(new Error("LLM请求超时")),
      });
    });
  }

  async function callLlm(prompt, input, onDelta, forceNonStream = false) {
    const settings = getSettings();
    const llm = settings.llm;

    if (!llm.apiUrl.trim()) throw new Error("请先在设置中填写 LLM API URL");
    if (!llm.model.trim()) throw new Error("请先在设置中填写模型名");

    const payload = {
      model: llm.model.trim(),
      messages: [
        { role: "system", content: llm.systemPrompt || "你是一个专业的中文分析助手。" },
        { role: "user", content: `${prompt}\n\n${input}` },
      ],
      stream: !forceNonStream && !!llm.stream,
    };

    const temperature = optionalNumber(llm.temperature, 0, 2);
    const topP = optionalNumber(llm.topP, 0, 1);
    const maxTokens = optionalInt(llm.maxTokens, 1, 262144);
    if (temperature != null) payload.temperature = temperature;
    if (topP != null) payload.top_p = topP;
    if (maxTokens != null) payload.max_tokens = maxTokens;

    if (payload.stream) {
      return callLlmStream(payload, {
        apiUrl: llm.apiUrl.trim(),
        apiKey: llm.apiKey || "",
        timeoutMs: withInt(llm.timeoutMs, 60000, 5000, 180000),
      }, onDelta);
    }

    return callLlmNonStream(payload, {
      apiUrl: llm.apiUrl.trim(),
      apiKey: llm.apiKey || "",
      timeoutMs: withInt(llm.timeoutMs, 60000, 5000, 180000),
    });
  }

  async function runSummaryTask(tabId, opts = {}) {
    if (!SUMMARY_TAB_MAP[tabId]) throw new Error("不支持的任务类型");
    const settings = getSettings();
    const prompt = String((settings.prompts || {})[tabId] || "").trim();
    if (!prompt) throw new Error(`请先在设置中填写 ${SUMMARY_TAB_MAP[tabId].label} 的提示词`);

    markSummaryStatus(tabId, "loading");
    setSummaryOutput(tabId, "", false);

    try {
      const input = await buildTaskInput(tabId);
      const text = await callLlm(
        prompt,
        input,
        (delta) => setSummaryOutput(tabId, delta, true),
        false,
      );
      if (!settings.llm.stream) {
        setSummaryOutput(tabId, text, false);
      } else if (!STATE.summaryResults[tabId].trim()) {
        setSummaryOutput(tabId, text, false);
      }
      markSummaryStatus(tabId, "done");
      return text;
    } catch (e) {
      markSummaryStatus(tabId, "error", String(e.message || e));
      if (!opts.silent) alert(`${SUMMARY_TAB_MAP[tabId].label} 失败：${String(e.message || e)}`);
      throw e;
    }
  }

  async function testLlmConnection() {
    const statusEl = UI.settings.status;
    if (statusEl) statusEl.textContent = "LLM连通测试中...";
    try {
      const text = await callLlm("请只回复：连接成功", "测试请求，请不要输出其他内容。", null, true);
      const ok = /连接成功|成功|ok|OK/.test(String(text));
      if (statusEl) statusEl.textContent = ok ? `连通成功：${String(text).trim()}` : `已连通，返回：${String(text).trim()}`;
    } catch (e) {
      if (statusEl) statusEl.textContent = `连通失败：${String(e.message || e)}`;
    }
  }

  function collectSettingsForm() {
    const form = UI.settings.form;
    if (!form) return getSettings();

    const next = deepClone(DEFAULT_SETTINGS);
    const get = (name) => form.querySelector(`[name='${name}']`);

    next.ui.defaultTab = String(get("defaultTab")?.value || "subtitle");
    next.ui.panelMode = String(get("panelMode")?.value || DEFAULT_SETTINGS.ui.panelMode);
    next.ui.edgeCollapseDelayMs = withInt(get("edgeCollapseDelayMs")?.value, DEFAULT_SETTINGS.ui.edgeCollapseDelayMs, 80, 5000);
    next.ui.autoLoadSubtitle = !!get("autoLoadSubtitle")?.checked;
    next.ui.autoLoadDanmaku = !!get("autoLoadDanmaku")?.checked;
    next.ui.autoLoadComment = !!get("autoLoadComment")?.checked;

    next.llm.apiUrl = String(get("llm_apiUrl")?.value || "").trim();
    next.llm.apiKey = String(get("llm_apiKey")?.value || "").trim();
    next.llm.model = String(get("llm_model")?.value || "").trim();
    next.llm.systemPrompt = String(get("llm_systemPrompt")?.value || "").trim();
    next.llm.temperature = optionalNumber(get("llm_temperature")?.value, 0, 2);
    next.llm.topP = optionalNumber(get("llm_topP")?.value, 0, 1);
    next.llm.maxTokens = optionalInt(get("llm_maxTokens")?.value, 1, 262144);
    next.llm.timeoutMs = withInt(get("llm_timeoutMs")?.value, DEFAULT_SETTINGS.llm.timeoutMs, 5000, 180000);
    next.llm.stream = !!get("llm_stream")?.checked;

    next.data.subtitleMaxLines = withInt(get("data_subtitleMaxLines")?.value, DEFAULT_SETTINGS.data.subtitleMaxLines, 50, 5000);
    next.data.danmakuMaxLines = withInt(get("data_danmakuMaxLines")?.value, DEFAULT_SETTINGS.data.danmakuMaxLines, 50, 5000);
    next.data.commentMaxItems = withInt(get("data_commentMaxItems")?.value, DEFAULT_SETTINGS.data.commentMaxItems, 20, 3000);
    next.data.commentPages = withInt(get("data_commentPages")?.value, DEFAULT_SETTINGS.data.commentPages, 1, 20);

    Object.keys(next.triggers).forEach((k) => {
      const v = String(get(`trigger_${k}`)?.value || "manual");
      next.triggers[k] = v === "auto" ? "auto" : "manual";
    });

    Object.keys(next.prompts).forEach((k) => {
      next.prompts[k] = String(get(`prompt_${k}`)?.value || "").trim();
    });

    return next;
  }

  function fillSettingsForm(settings) {
    const form = UI.settings.form;
    if (!form) return;
    const set = (name, value) => {
      const node = form.querySelector(`[name='${name}']`);
      if (!node) return;
      if (node.type === "checkbox") node.checked = !!value;
      else node.value = value == null ? "" : String(value);
    };

    set("defaultTab", settings.ui.defaultTab);
    set("panelMode", settings.ui.panelMode);
    set("edgeCollapseDelayMs", settings.ui.edgeCollapseDelayMs);
    set("autoLoadSubtitle", settings.ui.autoLoadSubtitle);
    set("autoLoadDanmaku", settings.ui.autoLoadDanmaku);
    set("autoLoadComment", settings.ui.autoLoadComment);

    set("llm_apiUrl", settings.llm.apiUrl);
    set("llm_apiKey", settings.llm.apiKey);
    set("llm_model", settings.llm.model);
    set("llm_systemPrompt", settings.llm.systemPrompt);
    set("llm_temperature", settings.llm.temperature);
    set("llm_topP", settings.llm.topP);
    set("llm_maxTokens", settings.llm.maxTokens);
    set("llm_timeoutMs", settings.llm.timeoutMs);
    set("llm_stream", settings.llm.stream);

    set("data_subtitleMaxLines", settings.data.subtitleMaxLines);
    set("data_danmakuMaxLines", settings.data.danmakuMaxLines);
    set("data_commentMaxItems", settings.data.commentMaxItems);
    set("data_commentPages", settings.data.commentPages);

    Object.keys(settings.triggers).forEach((k) => set(`trigger_${k}`, settings.triggers[k]));
    Object.keys(settings.prompts).forEach((k) => set(`prompt_${k}`, settings.prompts[k]));
  }

  function buildSummaryTab(tabId, label) {
    const page = el("div", { class: "bscas-tab-page", "data-tab": tabId });
    const status = el("div", { class: "bscas-status", text: "状态：未执行" });
    const sourcePreview = (tabId === "danmakuSummary" || tabId === "commentSummary")
      ? el("div", { class: "bscas-source-preview", text: "暂无已拉取数据" })
      : null;
    const output = el("div", { class: "bscas-summary-output" });

    const footerButtons = [
      el("button", { text: "生成", onclick: () => runSummaryTask(tabId).catch(() => {}) }),
      el("button", {
        text: "复制结果",
        onclick: () => {
          copyText(STATE.summaryResults[tabId] || "");
        },
      }),
      el("button", {
        text: "导出TXT",
        onclick: () => {
          const text = STATE.summaryResults[tabId] || "";
          if (!text.trim()) {
            alert("当前无可导出的总结内容");
            return;
          }
          downloadText(`${STATE.bvid || "video"}-${tabId}.txt`, text);
        },
      }),
      el("button", {
        text: "清空",
        onclick: () => {
          STATE.summaryResults[tabId] = "";
          STATE.summaryStatus[tabId] = "idle";
          STATE.summaryError[tabId] = "";
          updateSummaryUI(tabId);
        },
      }),
    ];

    if (tabId === "danmakuSummary") {
      footerButtons.unshift(
        el("button", {
          text: "拉取弹幕",
          onclick: async () => {
            try {
              status.textContent = "状态：正在拉取弹幕...";
              const rows = await ensureDanmakuLoaded();
              status.textContent = `状态：弹幕已拉取，共 ${rows.length} 条`;
            } catch (e) {
              status.textContent = `状态：弹幕拉取失败 - ${String(e.message || e)}`;
            }
          },
        }),
        el("button", {
          text: "导出弹幕TXT",
          onclick: async () => {
            try {
              const rows = await ensureDanmakuLoaded();
              downloadText(`${STATE.bvid || "video"}-danmaku.txt`, danmakuToText(rows));
            } catch (e) {
              alert(`导出弹幕失败：${String(e.message || e)}`);
            }
          },
        }),
      );
    }

    if (tabId === "commentSummary") {
      footerButtons.unshift(
        el("button", {
          text: "拉取评论",
          onclick: async () => {
            try {
              status.textContent = "状态：正在拉取评论...";
              const rows = await ensureCommentsLoaded();
              status.textContent = `状态：评论已拉取，共 ${rows.length} 条`;
            } catch (e) {
              status.textContent = `状态：评论拉取失败 - ${String(e.message || e)}`;
            }
          },
        }),
        el("button", {
          text: "导出评论TXT",
          onclick: async () => {
            try {
              const rows = await ensureCommentsLoaded();
              downloadText(`${STATE.bvid || "video"}-comments.txt`, commentsToText(rows));
            } catch (e) {
              alert(`导出评论失败：${String(e.message || e)}`);
            }
          },
        }),
      );
    }

    page.appendChild(el("div", { class: "bscas-mini", text: `${label}：支持手动/自动触发，提示词可在设置中自定义。` }));
    page.appendChild(el("div", { class: "bscas-footer" }, footerButtons));
    page.appendChild(status);
    if (sourcePreview) page.appendChild(sourcePreview);
    page.appendChild(output);

    UI.summary[tabId] = { status, output, sourcePreview };
    return page;
  }
  function buildSettingsTab() {
    const page = el("div", { class: "bscas-tab-page", "data-tab": "settings" });
    const form = el("div", { class: "bscas-settings-form" });
    UI.settings.form = form;

    function labelInput(title, inputEl, cls = "") {
      return el("label", { class: `bscas-label ${cls}`.trim() }, [el("span", { text: title }), inputEl]);
    }

    const uiSection = el("div", { class: "bscas-setting-section" }, [
      el("div", { class: "bscas-setting-title", text: "界面设置" }),
      el("div", { class: "bscas-setting-grid" }, [
        labelInput("默认打开导航页", el("select", { name: "defaultTab" }, TAB_LIST.filter((t) => t.id !== "settings").map((t) => el("option", { value: t.id, text: t.label })))),
        labelInput("弹窗模式", el("select", { name: "panelMode" }, [
          el("option", { value: "edgeAuto", text: "边缘悬停自动弹出/收回（默认）" }),
          el("option", { value: "buttonManual", text: "悬浮按钮手动开关" }),
        ]), "full"),
        labelInput("边缘收回延迟(ms)", el("input", { name: "edgeCollapseDelayMs", type: "number", step: "50", placeholder: "280" })),
        labelInput("自动拉取字幕并展示", el("input", { name: "autoLoadSubtitle", type: "checkbox" })),
        labelInput("自动拉取弹幕并展示", el("input", { name: "autoLoadDanmaku", type: "checkbox" })),
        labelInput("自动拉取评论并展示", el("input", { name: "autoLoadComment", type: "checkbox" })),
      ]),
    ]);

    const llmSection = el("div", { class: "bscas-setting-section" }, [
      el("div", { class: "bscas-setting-title", text: "LLM配置" }),
      el("div", { class: "bscas-setting-grid" }, [
        labelInput("API URL", el("input", { name: "llm_apiUrl", type: "text", placeholder: "https://.../chat/completions" }), "full"),
        labelInput("API Key", el("input", { name: "llm_apiKey", type: "password", placeholder: "sk-..." }), "full"),
        labelInput("模型名", el("input", { name: "llm_model", type: "text", placeholder: "gpt-4o-mini" })),
        labelInput("流式输出", el("input", { name: "llm_stream", type: "checkbox" })),
        labelInput("temperature（可空，留空不传）", el("input", { name: "llm_temperature", type: "number", step: "0.1", placeholder: "例如 0.7" })),
        labelInput("top_p（可空，留空不传）", el("input", { name: "llm_topP", type: "number", step: "0.1", placeholder: "例如 1" })),
        labelInput("max_tokens（可空，留空按模型最大）", el("input", { name: "llm_maxTokens", type: "number", step: "1", placeholder: "留空自动" })),
        labelInput("超时(毫秒)", el("input", { name: "llm_timeoutMs", type: "number", step: "1000" })),
        labelInput("System Prompt", el("textarea", { name: "llm_systemPrompt", rows: "4" }), "full"),
      ]),
    ]);

    const triggerSection = el("div", { class: "bscas-setting-section" }, [
      el("div", { class: "bscas-setting-title", text: "触发模式（手动/自动）" }),
      el("div", { class: "bscas-setting-grid" }, [
        labelInput("视频总结", el("select", { name: "trigger_videoSummary" }, [el("option", { value: "manual", text: "手动" }), el("option", { value: "auto", text: "自动" })])),
        labelInput("弹幕总结", el("select", { name: "trigger_danmakuSummary" }, [el("option", { value: "manual", text: "手动" }), el("option", { value: "auto", text: "自动" })])),
        labelInput("评论总结", el("select", { name: "trigger_commentSummary" }, [el("option", { value: "manual", text: "手动" }), el("option", { value: "auto", text: "自动" })])),
        labelInput("自定义1", el("select", { name: "trigger_custom1" }, [el("option", { value: "manual", text: "手动" }), el("option", { value: "auto", text: "自动" })])),
        labelInput("自定义2", el("select", { name: "trigger_custom2" }, [el("option", { value: "manual", text: "手动" }), el("option", { value: "auto", text: "自动" })])),
        labelInput("自定义3", el("select", { name: "trigger_custom3" }, [el("option", { value: "manual", text: "手动" }), el("option", { value: "auto", text: "自动" })])),
      ]),
    ]);

    const dataSection = el("div", { class: "bscas-setting-section" }, [
      el("div", { class: "bscas-setting-title", text: "数据规模限制" }),
      el("div", { class: "bscas-setting-grid" }, [
        labelInput("字幕最大行数", el("input", { name: "data_subtitleMaxLines", type: "number" })),
        labelInput("弹幕最大行数", el("input", { name: "data_danmakuMaxLines", type: "number" })),
        labelInput("评论最大条数", el("input", { name: "data_commentMaxItems", type: "number" })),
        labelInput("评论抓取页数", el("input", { name: "data_commentPages", type: "number" })),
      ]),
    ]);

    const promptSection = el("div", { class: "bscas-setting-section" }, [
      el("div", { class: "bscas-setting-title", text: "提示词模板" }),
      el("div", { class: "bscas-setting-grid" }, [
        labelInput("视频总结提示词", el("textarea", { name: "prompt_videoSummary", rows: "5" }), "full"),
        labelInput("弹幕总结提示词", el("textarea", { name: "prompt_danmakuSummary", rows: "5" }), "full"),
        labelInput("评论总结提示词", el("textarea", { name: "prompt_commentSummary", rows: "5" }), "full"),
        labelInput("自定义1提示词", el("textarea", { name: "prompt_custom1", rows: "4" }), "full"),
        labelInput("自定义2提示词", el("textarea", { name: "prompt_custom2", rows: "4" }), "full"),
        labelInput("自定义3提示词", el("textarea", { name: "prompt_custom3", rows: "4" }), "full"),
      ]),
    ]);

    UI.settings.status = el("div", { class: "bscas-status", text: "状态：未测试" });

    const actionRow = el("div", { class: "bscas-footer" }, [
      el("button", {
        text: "保存设置",
        onclick: () => {
          const next = collectSettingsForm();
          saveSettings(next);
          UI.settings.status.textContent = "设置已保存";
          applyPanelMode(next);
          setActiveTab(next.ui.defaultTab || "subtitle");
        },
      }),
      el("button", {
        text: "重置默认",
        onclick: () => {
          if (!confirm("确认恢复默认设置？")) return;
          const d = deepClone(DEFAULT_SETTINGS);
          saveSettings(d);
          fillSettingsForm(d);
          UI.settings.status.textContent = "已恢复默认设置";
          applyPanelMode(d);
        },
      }),
      el("button", { text: "测试LLM连通", onclick: () => testLlmConnection() }),
    ]);

    form.appendChild(uiSection);
    form.appendChild(llmSection);
    form.appendChild(triggerSection);
    form.appendChild(dataSection);
    form.appendChild(promptSection);

    page.appendChild(form);
    page.appendChild(actionRow);
    page.appendChild(UI.settings.status);
    return page;
  }

  function buildPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = el("div", { id: PANEL_ID });
    UI.panel = panel;

    const header = el("div", { class: "bscas-header" }, [
      el("div", { class: "bscas-title", text: "B站字幕/弹幕/评论提取导出 + AI总结" }),
      el("div", { class: "bscas-tools" }, [
        el("button", { text: "刷新", onclick: () => refreshAll() }),
        el("button", {
          text: "收起",
          onclick: () => {
            const body = panel.querySelector(".bscas-main");
            body.style.display = body.style.display === "none" ? "flex" : "none";
          },
        }),
        el("button", { text: "×", onclick: () => { panel.style.display = "none"; } }),
      ]),
    ]);

    const tabs = el("div", { class: "bscas-tabs" });
    TAB_LIST.forEach((t) => {
      const btn = el("button", {
        class: "bscas-tab-btn",
        text: t.label,
        onclick: () => setActiveTab(t.id),
      });
      UI.tabButtons[t.id] = btn;
      tabs.appendChild(btn);
    });

    const content = el("div", { class: "bscas-content" });

    const subtitlePage = el("div", { class: "bscas-tab-page", "data-tab": "subtitle" });
    const trackSelect = el("select", { "data-role": "track" });
    const searchInput = el("input", {
      type: "text",
      "data-role": "search",
      placeholder: "搜索字幕关键词",
      oninput: (e) => filterSubtitleRows(e.target.value),
    });
    const list = el("div", { class: "bscas-list" });
    const subtitleMeta = el("div", { class: "bscas-mini", text: "BV: - | CID: - | 轨道: - | 字幕行数: 0 | 弹幕: - | 评论: -" });

    trackSelect.addEventListener("change", () => selectSubtitleTrack(Number(trackSelect.value || 0)));

    UI.subtitle.trackSelect = trackSelect;
    UI.subtitle.searchInput = searchInput;
    UI.subtitle.list = list;
    UI.subtitle.meta = subtitleMeta;

    subtitlePage.appendChild(el("div", { class: "bscas-row" }, [trackSelect]));
    subtitlePage.appendChild(el("div", { class: "bscas-row" }, [searchInput]));
    subtitlePage.appendChild(list);
    subtitlePage.appendChild(el("div", { class: "bscas-footer" }, [
      el("button", {
        text: "拉取字幕",
        onclick: async () => {
          if (!STATE.tracks.length) return;
          let idx = Number(UI.subtitle.trackSelect?.value || -1);
          if (!Number.isFinite(idx) || idx < 0) idx = getPreferredTrackIndex();
          if (idx < 0) return;
          if (UI.subtitle.trackSelect) UI.subtitle.trackSelect.value = String(idx);
          await selectSubtitleTrack(idx);
        },
      }),
      el("button", { text: "复制纯文本", onclick: () => copyText(subtitlesToText(STATE.filteredSubtitles)) }),
      el("button", { text: "复制时间轴", onclick: () => copyText(subtitlesToTimeline(STATE.filteredSubtitles)) }),
      el("button", { text: "复制SRT", onclick: () => copyText(toSrt(STATE.filteredSubtitles)) }),
      el("button", { text: "导出TXT", onclick: () => downloadText(`${STATE.bvid || "subtitle"}.txt`, subtitlesToText(STATE.filteredSubtitles)) }),
      el("button", { text: "导出SRT", onclick: () => downloadText(`${STATE.bvid || "subtitle"}.srt`, toSrt(STATE.filteredSubtitles), "application/x-subrip;charset=utf-8") }),
      el("button", { text: "导出VTT", onclick: () => downloadText(`${STATE.bvid || "subtitle"}.vtt`, toVtt(STATE.filteredSubtitles), "text/vtt;charset=utf-8") }),
      el("button", {
        text: "导出JSON",
        onclick: () => downloadText(`${STATE.bvid || "subtitle"}.json`, JSON.stringify(STATE.filteredSubtitles, null, 2), "application/json;charset=utf-8"),
      }),
    ]));
    subtitlePage.appendChild(subtitleMeta);

    UI.tabPages.subtitle = subtitlePage;
    content.appendChild(subtitlePage);

    Object.entries(SUMMARY_TAB_MAP).forEach(([id, meta]) => {
      const page = buildSummaryTab(id, meta.label);
      UI.tabPages[id] = page;
      content.appendChild(page);
    });

    const settingsPage = buildSettingsTab();
    UI.tabPages.settings = settingsPage;
    content.appendChild(settingsPage);

    const main = el("div", { class: "bscas-main" }, [tabs, content]);

    panel.appendChild(header);
    panel.appendChild(main);
    document.body.appendChild(panel);
    makeDraggable(panel, header);

    const floatBtn = el("button", {
      id: FLOAT_BTN_ID,
      text: "视频助手",
      onclick: () => {
        const show = panel.style.display === "none";
        clearEdgeCollapseTimer();
        panel.style.display = show ? "flex" : "none";
        if (show) {
          const settings = getSettings();
          setActiveTab(settings.ui.defaultTab || "subtitle");
        }
      },
    });
    UI.floatBtn = floatBtn;
    document.body.appendChild(floatBtn);

    const edgeTrigger = el("div", { id: EDGE_TRIGGER_ID });
    edgeTrigger.addEventListener("mouseenter", () => {
      const settings = getSettings();
      if ((settings.ui || {}).panelMode !== "edgeAuto") return;
      clearEdgeCollapseTimer();
      showPanel();
      setActiveTab(settings.ui.defaultTab || "subtitle");
    });
    UI.edgeTrigger = edgeTrigger;
    document.body.appendChild(edgeTrigger);

    panel.addEventListener("mouseenter", () => clearEdgeCollapseTimer());
    panel.addEventListener("mouseleave", () => scheduleEdgeCollapse());

    const settings = getSettings();
    fillSettingsForm(settings);
    setActiveTab(settings.ui.defaultTab || "subtitle");
    applyPanelMode(settings);
    renderSubtitleList();
  }

  async function maybeAutoRunSummaries() {
    if (!STATE.bvid || !STATE.cid) return;
    const settings = getSettings();
    const videoKey = `${STATE.bvid}:${STATE.cid}`;
    if (!STATE.autoTriggered[videoKey]) STATE.autoTriggered[videoKey] = {};
    const used = STATE.autoTriggered[videoKey];

    const jobs = ["videoSummary", "danmakuSummary", "commentSummary", "custom1", "custom2", "custom3"];
    for (const tabId of jobs) {
      if ((settings.triggers || {})[tabId] !== "auto") continue;
      if (used[tabId]) continue;
      used[tabId] = true;
      try {
        await runSummaryTask(tabId, { silent: true });
      } catch (e) {
        console.warn(`[BSCAS] auto run ${tabId} failed`, e);
      }
    }
  }

  function resetForNewVideo(newBvid, newCid) {
    const oldKey = `${STATE.bvid || ""}:${STATE.cid || ""}`;
    const newKey = `${newBvid || ""}:${newCid || ""}`;
    if (!oldKey.trim() || oldKey === newKey) return;
    STATE.danmakuRows = null;
    STATE.commentRows = null;
    STATE.tracks = [];
    STATE.activeTrack = null;
    STATE.subtitles = [];
    filterSubtitleRows("");
    clearSummaryCache();
    renderSourcePreview("danmakuSummary", "");
    renderSourcePreview("commentSummary", "");
  }

  async function refreshAll() {
    try {
      const settings = getSettings();
      const bvid = getBvidFromUrl(location.href);
      if (!bvid) return;

      const fromPage = tryGetCidAidFromPage(bvid);
      let aid = fromPage.aid;
      let cid = fromPage.cid;
      let title = fromPage.title;
      let page = fromPage.page || getPageNoFromUrl(location.href);
      let partTitle = fromPage.partTitle;

      if (!cid) {
        const meta = await loadVideoMeta(bvid, location.href);
        aid = meta.aid;
        cid = meta.cid;
        title = meta.title || title;
        page = meta.page || page;
        partTitle = meta.partTitle || partTitle;
      }

      resetForNewVideo(bvid, cid);
      STATE.bvid = bvid;
      STATE.aid = aid;
      STATE.cid = cid;
      STATE.title = title;
      STATE.page = page;
      STATE.partTitle = partTitle;

      if (!STATE.cid) throw new Error("未拿到 CID，无法获取字幕轨");
      STATE.tracks = await loadSubtitleTracks(STATE.bvid, STATE.cid);
      renderTrackOptions();

      if (STATE.tracks.length) {
        const prefIndex = getPreferredTrackIndex();
        if (UI.subtitle.trackSelect) UI.subtitle.trackSelect.value = String(prefIndex);
        if (settings.ui.autoLoadSubtitle) {
          await selectSubtitleTrack(prefIndex);
        } else {
          STATE.activeTrack = STATE.tracks[prefIndex] || null;
          STATE.subtitles = [];
          filterSubtitleRows("");
          updateSubtitleMeta();
        }
      } else {
        STATE.subtitles = [];
        filterSubtitleRows("");
        updateSubtitleMeta();
      }

      if (settings.ui.autoLoadDanmaku) {
        try {
          await ensureDanmakuLoaded();
        } catch (e) {
          console.warn("[BSCAS] auto load danmaku failed", e);
        }
      }

      if (settings.ui.autoLoadComment) {
        try {
          await ensureCommentsLoaded();
        } catch (e) {
          console.warn("[BSCAS] auto load comments failed", e);
        }
      }

      await maybeAutoRunSummaries();
    } catch (e) {
      console.error("[BSCAS] refresh failed", e);
      alert(`刷新失败: ${String(e.message || e)}`);
    }
  }

  function observeUrlChange() {
    const check = async () => {
      if (STATE.currentUrl === location.href) return;
      STATE.currentUrl = location.href;
      const bvid = getBvidFromUrl(location.href);
      if (!bvid) return;
      await refreshAll();
    };

    const push = history.pushState;
    const replace = history.replaceState;

    history.pushState = function (...args) {
      push.apply(this, args);
      setTimeout(check, 80);
    };

    history.replaceState = function (...args) {
      replace.apply(this, args);
      setTimeout(check, 80);
    };

    window.addEventListener("popstate", () => setTimeout(check, 80));
    setInterval(check, 1000);
  }

  async function init() {
    if (STATE.initialized) return;
    injectStyle();
    buildPanel();
    observeUrlChange();
    STATE.initialized = true;
    await refreshAll();
  }

  init();
})();
