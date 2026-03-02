// ==UserScript==
// @name         constansino Bilibili Subtitle Extractor Pro
// @namespace    https://github.com/constansino/
// @version      1.1.0
// @description  B站视频字幕提取、可视化、搜索、复制与导出（SRT/TXT/JSON/VTT）
// @author       constansino
// @homepageURL  https://github.com/constansino/constansino-bilibili-subtitle-extractor-pro
// @supportURL   https://github.com/constansino/constansino-bilibili-subtitle-extractor-pro/issues
// @match        https://www.bilibili.com/video/*
// @grant        GM_setClipboard
// @grant        GM_download
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const STYLE_ID = "bsepro-style";
  const PANEL_ID = "bsepro-panel";
  const STATE = {
    bvid: "",
    cid: "",
    aid: "",
    title: "",
    tracks: [],
    activeTrack: null,
    subtitles: [],
    filtered: [],
    initialized: false,
    currentUrl: location.href,
  };

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        position: fixed;
        top: 100px;
        right: 20px;
        width: 420px;
        max-height: 78vh;
        z-index: 2147483646;
        background: #11161f;
        color: #e6edf3;
        border: 1px solid #2a3442;
        border-radius: 14px;
        box-shadow: 0 10px 30px rgba(0,0,0,.35);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: "SF Pro Text", "PingFang SC", "Microsoft YaHei", sans-serif;
      }
      #${PANEL_ID} .bse-header {
        padding: 10px 12px;
        cursor: move;
        background: linear-gradient(90deg, #172131, #121a27);
        border-bottom: 1px solid #2a3442;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      #${PANEL_ID} .bse-title {
        font-weight: 700;
        font-size: 14px;
        color: #9cd1ff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #${PANEL_ID} .bse-tools {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      #${PANEL_ID} button, #${PANEL_ID} select, #${PANEL_ID} input {
        background: #1c2633;
        color: #e6edf3;
        border: 1px solid #334255;
        border-radius: 8px;
        padding: 6px 8px;
        font-size: 12px;
      }
      #${PANEL_ID} button:hover {
        background: #233043;
      }
      #${PANEL_ID} .bse-body {
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        overflow: hidden;
      }
      #${PANEL_ID} .bse-row {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      #${PANEL_ID} .bse-row > * {
        flex: 1;
      }
      #${PANEL_ID} .bse-list {
        border: 1px solid #2f3d52;
        border-radius: 10px;
        background: #0f141d;
        overflow: auto;
        min-height: 220px;
        max-height: 40vh;
      }
      #${PANEL_ID} .bse-item {
        border-bottom: 1px solid #1d2635;
        padding: 8px 10px;
        line-height: 1.45;
      }
      #${PANEL_ID} .bse-item:last-child { border-bottom: none; }
      #${PANEL_ID} .bse-time {
        color: #7fb2ff;
        font-size: 11px;
        margin-bottom: 2px;
      }
      #${PANEL_ID} .bse-text {
        color: #d9e2ec;
        font-size: 13px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      #${PANEL_ID} .bse-footer {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      #${PANEL_ID} .bse-mini {
        font-size: 11px;
        color: #9ba9ba;
      }
      #bsepro-float-btn {
        position: fixed;
        right: 16px;
        bottom: 90px;
        z-index: 2147483645;
        padding: 8px 10px;
        border-radius: 999px;
        border: 1px solid #395275;
        background: #10233f;
        color: #cde4ff;
        font-size: 12px;
        cursor: pointer;
      }
    `;
    document.head.appendChild(style);
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

  function normalizeSubtitleUrl(url) {
    if (!url) return "";
    if (url.startsWith("//")) return `https:${url}`;
    if (/^http:\/\//i.test(url)) return url.replace(/^http:\/\//i, "https://");
    return url;
  }

  function getBvidFromUrl(url) {
    const m = String(url).match(/\/video\/(BV[0-9A-Za-z]+)/i);
    return m ? m[1] : "";
  }

  function tryGetCidAidFromPage() {
    try {
      const s = window.__INITIAL_STATE__ || {};
      const vd = s.videoData || {};
      const cid = vd.cid || (vd.pages && vd.pages[0] && vd.pages[0].cid) || "";
      const aid = vd.aid || "";
      const title = vd.title || document.title.replace(/_哔哩哔哩_bilibili$/, "");
      return { cid: String(cid || ""), aid: String(aid || ""), title: String(title || "") };
    } catch {
      return { cid: "", aid: "", title: "" };
    }
  }

  async function requestJson(url, withCredentials = false) {
    const res = await fetch(normalizeSubtitleUrl(url), {
      credentials: withCredentials ? "include" : "omit",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function loadVideoMeta(bvid) {
    const j = await requestJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, true);
    if (Number(j.code) !== 0) throw new Error(`view code=${j.code} msg=${j.message || ""}`);
    const d = j.data || {};
    return {
      aid: String(d.aid || ""),
      cid: String(d.cid || (d.pages && d.pages[0] && d.pages[0].cid) || ""),
      title: String(d.title || ""),
    };
  }

  async function loadSubtitleTracks(bvid, cid) {
    const j = await requestJson(
      `https://api.bilibili.com/x/player/wbi/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`,
      true,
    );
    if (Number(j.code) !== 0) throw new Error(`player code=${j.code} msg=${j.message || ""}`);
    const tracks = (((j.data || {}).subtitle || {}).subtitles || []).map((t) => ({
      id: String(t.id || ""),
      lan: String(t.lan || ""),
      lanDoc: String(t.lan_doc || t.lan || ""),
      url: normalizeSubtitleUrl(String(t.subtitle_url || "")),
    })).filter((x) => x.url);
    return tracks;
  }

  async function loadSubtitleBody(url) {
    const j = await requestJson(url, false);
    const rows = (j.body || []).map((r, i) => ({
      index: i + 1,
      from: Number(r.from || 0),
      to: Number(r.to || 0),
      text: String(r.content || "").trim(),
    })).filter((x) => x.text);
    return rows;
  }

  function toSrt(rows) {
    return rows.map((r, idx) => (
      `${idx + 1}\n${formatTime(r.from, true)} --> ${formatTime(r.to, true)}\n${r.text}\n`
    )).join("\n");
  }

  function toVtt(rows) {
    const body = rows.map((r) => `${formatTime(r.from, false)} --> ${formatTime(r.to, false)}\n${r.text}\n`).join("\n");
    return `WEBVTT\n\n${body}`;
  }

  function toPlainText(rows) {
    return rows.map((r) => r.text).join("\n");
  }

  function toTimelineText(rows) {
    return rows.map((r) => `[${formatTime(r.from, false)} - ${formatTime(r.to, false)}] ${r.text}`).join("\n");
  }

  function downloadText(filename, text, mime = "text/plain;charset=utf-8") {
    if (typeof GM_download === "function") {
      const blob = new Blob([text], { type: mime });
      const u = URL.createObjectURL(blob);
      GM_download({ url: u, name: filename, saveAs: true, onload: () => URL.revokeObjectURL(u) });
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function copyText(text) {
    if (typeof GM_setClipboard === "function") {
      GM_setClipboard(text, "text");
      return;
    }
    navigator.clipboard.writeText(text).catch(() => {});
  }

  function filterRows(keyword) {
    const k = String(keyword || "").trim().toLowerCase();
    STATE.filtered = !k
      ? [...STATE.subtitles]
      : STATE.subtitles.filter((r) => r.text.toLowerCase().includes(k));
    renderList();
  }

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(props).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k === "text") node.textContent = v;
      else node.setAttribute(k, v);
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
    document.addEventListener("mouseup", () => { dragging = false; });
  }

  function renderList() {
    const list = document.querySelector(`#${PANEL_ID} .bse-list`);
    if (!list) return;
    list.innerHTML = "";
    if (!STATE.filtered.length) {
      list.appendChild(el("div", { class: "bse-item" }, [
        el("div", { class: "bse-text", text: "暂无字幕内容（可能无字幕或提取失败）" }),
      ]));
      return;
    }
    const frag = document.createDocumentFragment();
    STATE.filtered.forEach((r) => {
      frag.appendChild(el("div", { class: "bse-item" }, [
        el("div", { class: "bse-time", text: `${formatTime(r.from, false)} - ${formatTime(r.to, false)}` }),
        el("div", { class: "bse-text", text: r.text }),
      ]));
    });
    list.appendChild(frag);
  }

  function updateMetaInfo() {
    const info = document.querySelector(`#${PANEL_ID} .bse-mini`);
    if (!info) return;
    const t = STATE.activeTrack;
    info.textContent = [
      `BV: ${STATE.bvid || "-"}`,
      `CID: ${STATE.cid || "-"}`,
      `轨道: ${t ? `${t.lanDoc}(${t.lan})` : "-"}`,
      `行数: ${STATE.subtitles.length}`,
    ].join(" | ");
  }

  async function selectTrack(trackIndex) {
    const track = STATE.tracks[trackIndex] || null;
    STATE.activeTrack = track;
    if (!track) {
      STATE.subtitles = [];
      filterRows("");
      updateMetaInfo();
      return;
    }
    try {
      STATE.subtitles = await loadSubtitleBody(track.url);
      filterRows(document.querySelector(`#${PANEL_ID} input[data-role='search']`)?.value || "");
      updateMetaInfo();
    } catch (e) {
      console.error("[BSEPRO] load subtitle body failed", e);
      STATE.subtitles = [];
      filterRows("");
      updateMetaInfo();
      alert(`字幕正文拉取失败: ${String(e.message || e)}`);
    }
  }

  function buildPanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = el("div", { id: PANEL_ID });
    const header = el("div", { class: "bse-header" }, [
      el("div", { class: "bse-title", text: "B站字幕提取器 Pro" }),
      el("div", { class: "bse-tools" }, [
        el("button", { text: "刷新", onclick: refreshAll }),
        el("button", {
          text: "收起",
          onclick: () => {
            const body = panel.querySelector(".bse-body");
            body.style.display = body.style.display === "none" ? "flex" : "none";
          },
        }),
        el("button", { text: "×", onclick: () => { panel.style.display = "none"; } }),
      ]),
    ]);

    const trackSelect = el("select", { "data-role": "track" });
    trackSelect.addEventListener("change", () => selectTrack(Number(trackSelect.value || 0)));

    const searchInput = el("input", {
      "data-role": "search",
      placeholder: "搜索字幕关键字",
      type: "text",
      oninput: (e) => filterRows(e.target.value),
    });

    const body = el("div", { class: "bse-body" }, [
      el("div", { class: "bse-row" }, [trackSelect]),
      el("div", { class: "bse-row" }, [searchInput]),
      el("div", { class: "bse-list" }),
      el("div", { class: "bse-footer" }, [
        el("button", { text: "复制纯文本", onclick: () => copyText(toPlainText(STATE.filtered)) }),
        el("button", { text: "复制时间轴", onclick: () => copyText(toTimelineText(STATE.filtered)) }),
        el("button", { text: "复制SRT", onclick: () => copyText(toSrt(STATE.filtered)) }),
        el("button", { text: "导出TXT", onclick: () => downloadText(`${STATE.bvid || "subtitle"}.txt`, toPlainText(STATE.filtered)) }),
        el("button", { text: "导出SRT", onclick: () => downloadText(`${STATE.bvid || "subtitle"}.srt`, toSrt(STATE.filtered), "application/x-subrip;charset=utf-8") }),
        el("button", { text: "导出VTT", onclick: () => downloadText(`${STATE.bvid || "subtitle"}.vtt`, toVtt(STATE.filtered), "text/vtt;charset=utf-8") }),
        el("button", {
          text: "导出JSON",
          onclick: () => downloadText(`${STATE.bvid || "subtitle"}.json`, JSON.stringify(STATE.filtered, null, 2), "application/json;charset=utf-8"),
        }),
      ]),
      el("div", { class: "bse-mini", text: "BV: - | CID: - | 轨道: - | 行数: 0" }),
    ]);

    panel.appendChild(header);
    panel.appendChild(body);
    document.body.appendChild(panel);
    makeDraggable(panel, header);

    const floatBtn = el("button", {
      id: "bsepro-float-btn",
      text: "字幕提取",
      onclick: () => {
        const p = document.getElementById(PANEL_ID);
        p.style.display = p.style.display === "none" ? "flex" : "none";
      },
    });
    document.body.appendChild(floatBtn);
  }

  function updateTrackOptions() {
    const sel = document.querySelector(`#${PANEL_ID} select[data-role='track']`);
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

  async function refreshAll() {
    try {
      const bvid = getBvidFromUrl(location.href);
      if (!bvid) return;
      STATE.bvid = bvid;

      const fromPage = tryGetCidAidFromPage();
      let aid = fromPage.aid;
      let cid = fromPage.cid;
      let title = fromPage.title;

      if (!cid) {
        const meta = await loadVideoMeta(bvid);
        aid = meta.aid;
        cid = meta.cid;
        title = meta.title || title;
      }

      STATE.aid = aid;
      STATE.cid = cid;
      STATE.title = title;

      if (!STATE.cid) throw new Error("未拿到 CID，无法获取字幕轨");
      STATE.tracks = await loadSubtitleTracks(STATE.bvid, STATE.cid);
      updateTrackOptions();

      if (STATE.tracks.length) {
        const prefIndex = Math.max(
          0,
          STATE.tracks.findIndex((t) => ["zh-CN", "zh-Hans", "ai-zh", "zh"].includes(t.lan)),
        );
        const sel = document.querySelector(`#${PANEL_ID} select[data-role='track']`);
        if (sel) sel.value = String(prefIndex);
        await selectTrack(prefIndex);
      } else {
        STATE.subtitles = [];
        filterRows("");
        updateMetaInfo();
      }
    } catch (e) {
      console.error("[BSEPRO] refresh failed", e);
      alert(`字幕提取失败: ${String(e.message || e)}`);
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
