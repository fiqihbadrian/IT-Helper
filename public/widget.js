/*!
 * IT Helpdesk chat widget.
 *
 * Installed with one tag:
 *
 *   <script src="https://<helpdesk-host>/widget.js" data-key="wk_…" async></script>
 *
 * Plain JavaScript, no build step, no dependencies — it has to survive being
 * pasted into a website nobody here controls. Everything it renders lives in a
 * shadow root, so the host page's CSS cannot reach in and this cannot leak out.
 *
 * It makes no network request until the visitor actually opens it: a widget that
 * phones home on every page load of someone else's site is a cost they did not
 * ask for.
 *
 * The only thing it stores is a conversation token, in localStorage. There is no
 * cookie and no account: the token is the whole identity, and it is scoped to one
 * conversation on one channel.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) {
    var candidates = document.querySelectorAll("script[data-key][src*='widget.js']");
    script = candidates[candidates.length - 1];
  }
  if (!script) return;

  var publicKey = script.getAttribute("data-key");
  if (!publicKey) {
    console.warn("[helpdesk-widget] missing data-key attribute");
    return;
  }

  if (document.querySelector("[data-helpdesk-widget='" + publicKey + "']")) return;

  var base = script.getAttribute("data-base");
  if (!base) {
    try {
      base = new URL(script.src).origin;
    } catch (error) {
      console.warn("[helpdesk-widget] could not determine API origin", error);
      return;
    }
  }
  base = base.replace(/\/$/, "");

  var API = base + "/api/widget/v1";
  var TOKEN_KEY = "itw.token." + publicKey;
  var REF_KEY = "itw.ref";
  var POLL_MS = 4000;
  var DEFAULT_ACCENT = "#4f46e5";

  /* ---------------------------------------------------------------------- */
  /* storage                                                                 */
  /* ---------------------------------------------------------------------- */

  function readLocal(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function writeLocal(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (error) {
      /* private mode: the conversation simply will not survive a reload */
    }
  }

  function visitorRef() {
    var ref = readLocal(REF_KEY);
    if (!ref) {
      ref = "v_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
      writeLocal(REF_KEY, ref);
    }
    return ref;
  }

  /* ---------------------------------------------------------------------- */
  /* transport                                                               */
  /* ---------------------------------------------------------------------- */

  function request(path, options) {
    var init = options || {};
    var headers = { "X-Widget-Key": publicKey };
    if (init.token) headers["X-Widget-Token"] = init.token;
    if (init.body) headers["Content-Type"] = "application/json";

    return fetch(API + path, {
      method: init.method || "GET",
      headers: headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
      mode: "cors",
      credentials: "omit",
    }).then(function (response) {
      return response
        .json()
        .catch(function () {
          return null;
        })
        .then(function (payload) {
          if (!response.ok || !payload || payload.ok !== true) {
            var error = new Error(
              (payload && payload.error && payload.error.message) || "Request failed",
            );
            error.code = payload && payload.error ? payload.error.code : "network_error";
            error.status = response.status;
            throw error;
          }
          return payload.data;
        });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* markup                                                                  */
  /* ---------------------------------------------------------------------- */

  var CSS = [
    ":host { all: initial; }",
    "* { box-sizing: border-box; }",
    ".wrap { position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;",
    "  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;",
    "  font-size: 14px; line-height: 1.5; color: #111827; }",
    ".launcher { display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 18px;",
    "  border: 0; border-radius: 24px; cursor: pointer; color: #fff; font-size: 14px; font-weight: 600;",
    "  box-shadow: 0 6px 20px rgba(0,0,0,.22); }",
    ".launcher:hover { filter: brightness(1.06); }",
    ".dot { width: 9px; height: 9px; border-radius: 50%; background: #f87171; }",
    ".panel { display: none; flex-direction: column; width: 372px; height: 560px; max-height: calc(100vh - 40px);",
    "  background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,.26); }",
    ".wrap[data-open='true'] .panel { display: flex; }",
    ".wrap[data-open='true'] .launcher { display: none; }",
    ".head { display: flex; align-items: flex-start; gap: 10px; padding: 14px 16px; color: #fff; }",
    ".head h2 { margin: 0; font-size: 15px; font-weight: 600; }",
    ".head p { margin: 2px 0 0; font-size: 12px; opacity: .85; }",
    ".close { margin-left: auto; background: transparent; border: 0; color: #fff; cursor: pointer;",
    "  font-size: 20px; line-height: 1; padding: 2px 6px; border-radius: 6px; }",
    ".close:hover { background: rgba(255,255,255,.18); }",
    ".log { flex: 1; overflow-y: auto; padding: 14px 14px 4px; background: #f8fafc; }",
    ".msg { max-width: 84%; margin-bottom: 10px; padding: 9px 12px; border-radius: 12px;",
    "  white-space: pre-wrap; word-break: break-word; }",
    ".msg.visitor { margin-left: auto; color: #fff; border-bottom-right-radius: 4px; }",
    ".msg.staff { background: #fff; border: 1px solid #e5e7eb; border-bottom-left-radius: 4px; }",
    ".meta { margin-top: 4px; font-size: 11px; opacity: .65; }",
    ".note { margin: 0 0 10px; padding: 9px 12px; border-radius: 10px; background: #eef2ff;",
    "  color: #3730a3; font-size: 12px; }",
    ".note.warn { background: #fef3c7; color: #92400e; }",
    ".form { padding: 14px; border-top: 1px solid #e5e7eb; background: #fff; }",
    ".form h3 { margin: 0 0 10px; font-size: 14px; font-weight: 600; }",
    ".field { display: block; margin-bottom: 9px; }",
    ".field span { display: block; margin-bottom: 4px; font-size: 12px; color: #4b5563; }",
    ".field input, .field textarea { width: 100%; padding: 9px 10px; font: inherit; color: inherit;",
    "  background: #fff; border: 1px solid #d1d5db; border-radius: 8px; }",
    ".field textarea { resize: none; min-height: 74px; }",
    ".field input:focus, .field textarea:focus { outline: 2px solid currentColor; outline-offset: -1px; }",
    ".send { width: 100%; padding: 10px 14px; border: 0; border-radius: 8px; color: #fff;",
    "  font: inherit; font-weight: 600; cursor: pointer; }",
    ".send:disabled { opacity: .6; cursor: default; }",
    ".err { margin: 0 0 9px; color: #b91c1c; font-size: 12px; }",
    ".composer { display: flex; gap: 8px; align-items: flex-end; }",
    ".composer textarea { flex: 1; min-height: 40px; max-height: 110px; padding: 9px 10px; font: inherit;",
    "  color: inherit; border: 1px solid #d1d5db; border-radius: 8px; resize: none; }",
    ".composer button { border: 0; border-radius: 8px; color: #fff; font: inherit; font-weight: 600;",
    "  padding: 10px 14px; cursor: pointer; }",
    ".composer button:disabled { opacity: .6; cursor: default; }",
    "@media (max-width: 480px) {",
    "  .wrap { right: 12px; bottom: 12px; left: 12px; }",
    "  .panel { width: 100%; height: calc(100vh - 24px); max-height: none; }",
    "  .launcher { margin-left: auto; }",
    "}",
  ].join("\n");

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function timeOf(iso) {
    try {
      return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (error) {
      return "";
    }
  }

  var host = document.createElement("div");
  host.setAttribute("data-helpdesk-widget", publicKey);
  var root = host.attachShadow({ mode: "open" });
  document.body.appendChild(host);

  var style = document.createElement("style");
  style.textContent = CSS;
  root.appendChild(style);

  var wrap = document.createElement("div");
  wrap.className = "wrap";
  wrap.setAttribute("data-open", "false");
  wrap.innerHTML = [
    "<button class='launcher' type='button' aria-label='Open chat'>",
    "  <span>Chat with IT</span>",
    "  <span class='dot' hidden></span>",
    "</button>",
    "<section class='panel' role='dialog' aria-label='Chat'>",
    "  <header class='head'>",
    "    <div><h2 class='title'>Support</h2><p class='subtitle'>We usually reply within a few hours</p></div>",
    "    <button class='close' type='button' aria-label='Close chat'>&times;</button>",
    "  </header>",
    "  <div class='log'></div>",
    "  <div class='form'></div>",
    "</section>",
  ].join("");
  root.appendChild(wrap);

  var launcher = wrap.querySelector(".launcher");
  var launcherDot = wrap.querySelector(".dot");
  var closeButton = wrap.querySelector(".close");
  var titleEl = wrap.querySelector(".title");
  var subtitleEl = wrap.querySelector(".subtitle");
  var headEl = wrap.querySelector(".head");
  var logEl = wrap.querySelector(".log");
  var formEl = wrap.querySelector(".form");

  var state = {
    open: false,
    token: readLocal(TOKEN_KEY),
    channelName: null,
    greeting: "",
    accentColor: DEFAULT_ACCENT,
    conversation: null,
    messages: [],
    sending: false,
    error: null,
    loading: false,
    timer: null,
    formMode: null,
    renderedCount: -1,
  };

  /* ---------------------------------------------------------------------- */
  /* rendering                                                               */
  /* ---------------------------------------------------------------------- */

  function paintAccent() {
    var colour = state.accentColor || DEFAULT_ACCENT;
    headEl.style.background = colour;
    launcher.style.background = colour;
    logEl.querySelectorAll(".msg.visitor").forEach(function (node) {
      node.style.background = colour;
    });
    formEl.querySelectorAll(".send, .composer button").forEach(function (node) {
      node.style.background = colour;
    });
  }

  function renderHeader() {
    titleEl.textContent = state.channelName || "Support";

    if (state.conversation) {
      subtitleEl.textContent =
        state.conversation.ticketNumber +
        " · " +
        String(state.conversation.status).replace(/_/g, " ");
      return;
    }
    subtitleEl.textContent = state.loading ? "Loading…" : "We usually reply within a few hours";
  }

  function renderLog() {
    var count = state.messages.length;
    if (count === state.renderedCount) return;

    // Only follow the conversation when it actually grew, so a poll does not
    // yank the visitor back down while they are reading earlier messages.
    var grew = count > state.renderedCount;
    state.renderedCount = count;

    if (!count) {
      logEl.innerHTML = "<p class='note'>" + escapeHtml(state.greeting) + "</p>";
      return;
    }

    var html = state.messages
      .map(function (message) {
        return (
          "<div class='msg " +
          message.role +
          "'>" +
          escapeHtml(message.body) +
          "<div class='meta'>" +
          escapeHtml(message.author) +
          " · " +
          escapeHtml(timeOf(message.createdAt)) +
          "</div></div>"
        );
      })
      .join("");

    var status = state.conversation ? state.conversation.status : null;
    if (status === "CLOSED" || status === "RESOLVED") {
      html +=
        "<p class='note warn'>This ticket is marked " +
        escapeHtml(String(status).toLowerCase()) +
        ". Write again and the IT team will pick it up.</p>";
    }

    logEl.innerHTML = html;
    if (grew) logEl.scrollTop = logEl.scrollHeight;
  }

  function startFormMarkup() {
    return [
      "<form novalidate>",
      "  <h3>Start a conversation</h3>",
      "  <p class='err' hidden></p>",
      "  <label class='field'><span>Your name</span>",
      "    <input name='name' autocomplete='name' required maxlength='120'></label>",
      "  <label class='field'><span>Email</span>",
      "    <input name='email' type='email' autocomplete='email' required maxlength='200'></label>",
      "  <label class='field'><span>What do you need help with?</span>",
      "    <textarea name='message' required maxlength='4000'></textarea></label>",
      "  <button class='send' type='submit'>Send message</button>",
      "</form>",
    ].join("");
  }

  function composerMarkup() {
    return [
      "<form>",
      "  <p class='err' hidden></p>",
      "  <div class='composer'>",
      "    <textarea name='message' rows='1' placeholder='Write a message…' maxlength='4000'></textarea>",
      "    <button type='submit'>Send</button>",
      "  </div>",
      "</form>",
    ].join("");
  }

  /**
   * The form is rebuilt only when its *shape* changes, so a failed send leaves
   * what the visitor typed exactly where it was. Errors and the sending state are
   * painted onto the existing nodes instead.
   */
  function renderForm() {
    var mode = state.token ? "chat" : "start";
    if (state.formMode !== mode) {
      state.formMode = mode;
      formEl.innerHTML = mode === "chat" ? composerMarkup() : startFormMarkup();
      wireForm(mode);
    }

    var errorEl = formEl.querySelector(".err");
    if (errorEl) {
      errorEl.hidden = !state.error;
      errorEl.textContent = state.error || "";
    }

    var button = formEl.querySelector("button");
    if (button) {
      button.disabled = state.sending;
      button.textContent =
        mode === "chat" ? (state.sending ? "…" : "Send") : state.sending ? "Sending…" : "Send message";
    }

    paintAccent();
  }

  function render() {
    renderHeader();
    renderLog();
    renderForm();
  }

  function wireForm(mode) {
    var form = formEl.querySelector("form");

    if (mode === "chat") {
      var textarea = formEl.querySelector("textarea");

      textarea.addEventListener("keydown", function (event) {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          form.requestSubmit();
        }
      });

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var message = textarea.value.trim();
        if (!message || state.sending) return;
        textarea.value = "";
        sendMessage(message);
      });
      return;
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      if (state.sending) return;
      var data = new FormData(form);
      startConversation({
        name: String(data.get("name") || ""),
        email: String(data.get("email") || ""),
        message: String(data.get("message") || ""),
      });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* data                                                                    */
  /* ---------------------------------------------------------------------- */

  function mergeMessages(incoming) {
    if (!incoming || !incoming.length) return;

    var known = {};
    state.messages.forEach(function (message) {
      known[message.id] = true;
    });

    var fresh = incoming.filter(function (message) {
      return !known[message.id];
    });
    if (!fresh.length) return;

    state.messages = state.messages.concat(fresh);

    var fromStaff = fresh.some(function (message) {
      return message.role === "staff";
    });
    if (fromStaff && !state.open) launcherDot.hidden = false;
  }

  function loadConfig() {
    if (state.channelName) return Promise.resolve();

    state.loading = true;
    renderHeader();

    return request("/config")
      .then(function (config) {
        state.channelName = config.name;
        state.greeting = config.greeting;
        state.accentColor = config.accentColor;
      })
      .catch(function (error) {
        state.error = error.message;
        subtitleEl.textContent = "Unavailable";
        console.warn("[helpdesk-widget] could not load channel config:", error.message);
      })
      .then(function () {
        state.loading = false;
        render();
      });
  }

  function loadMessages() {
    return request("/messages", { token: state.token })
      .then(function (payload) {
        state.conversation = payload.conversation;
        state.messages = [];
        state.renderedCount = -1;
        mergeMessages(payload.messages);
        state.error = null;
        render();
      })
      .catch(function (error) {
        if (error.status === 401) {
          // expired, or minted against a different channel: start over rather
          // than leaving the visitor stuck on a conversation that is gone
          writeLocal(TOKEN_KEY, null);
          state.token = null;
          state.messages = [];
          state.renderedCount = -1;
          state.conversation = null;
          state.formMode = null;
          state.error = null;
          render();
          return;
        }
        state.error = error.message;
        render();
      });
  }

  function startConversation(input) {
    state.sending = true;
    state.error = null;
    renderForm();

    request("/session", {
      method: "POST",
      body: {
        name: input.name,
        email: input.email,
        message: input.message,
        visitorRef: visitorRef(),
        pageUrl: window.location.href,
      },
    })
      .then(function (payload) {
        state.sending = false;
        state.token = payload.token;
        writeLocal(TOKEN_KEY, payload.token);
        state.conversation = payload.conversation;
        state.messages = [];
        state.renderedCount = -1;
        mergeMessages(payload.messages);
        render();
        startPolling();
      })
      .catch(function (error) {
        state.sending = false;
        state.error = error.message;
        renderForm();
      });
  }

  function sendMessage(message) {
    state.sending = true;
    state.error = null;
    renderForm();

    request("/messages", { method: "POST", token: state.token, body: { message } })
      .then(function (payload) {
        state.sending = false;
        state.conversation = payload.conversation;
        state.messages = [];
        state.renderedCount = -1;
        mergeMessages(payload.messages);
        render();
      })
      .catch(function (error) {
        state.sending = false;
        state.error = error.message;
        renderForm();
      });
  }

  /* ---------------------------------------------------------------------- */
  /* polling                                                                 */
  /* ---------------------------------------------------------------------- */

  function startPolling() {
    if (state.timer) return;
    state.timer = window.setInterval(function () {
      if (!state.open || !state.token || document.hidden) return;
      request("/messages", { token: state.token })
        .then(function (payload) {
          state.conversation = payload.conversation;
          mergeMessages(payload.messages);
          render();
        })
        .catch(function () {
          /* a dropped poll is not worth telling the visitor about */
        });
    }, POLL_MS);
  }

  function stopPolling() {
    if (!state.timer) return;
    window.clearInterval(state.timer);
    state.timer = null;
  }

  /* ---------------------------------------------------------------------- */
  /* events                                                                  */
  /* ---------------------------------------------------------------------- */

  launcher.addEventListener("click", function () {
    state.open = true;
    wrap.setAttribute("data-open", "true");
    launcherDot.hidden = true;

    loadConfig().then(function () {
      if (state.token) {
        loadMessages();
        startPolling();
      }
    });
  });

  closeButton.addEventListener("click", function () {
    state.open = false;
    wrap.setAttribute("data-open", "false");
    stopPolling();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && state.open) closeButton.click();
  });
})();
