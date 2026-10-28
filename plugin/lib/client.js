window.__ModuleLoader__.load({
  id: "dsh-plugin-geminapi-quotas",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const { useState, useEffect, useCallback, useMemo, useRef } = React;
    const h = React.createElement;

    // Primitives from DSH
    let primitives = {};
    try {
      primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    } catch {}

    function safeStorageGet(key, def = "") {
      try {
        if (typeof localStorage !== "undefined") {
          const val = localStorage.getItem(key);
          return val !== null ? val : def;
        }
      } catch {}
      return def;
    }

    // Clean up legacy key in localStorage if left over from early versions
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem("dsh_geminapi_key");
      }
    } catch {}

    // ─────────────────────────────────────────────────────────────
    // Theme Tokens (DESIGN.md & DSH System Variables)
    // ─────────────────────────────────────────────────────────────
    const THEME = {
      bgBase: "var(--dsw-alias-bg-base, #0c111b)",
      bgPanel: "var(--dsw-alias-bg-layer-1, #141c2a)",
      bgLayer2: "var(--dsw-alias-bg-layer-2, #1a2334)",
      bgLayer3: "var(--dsw-alias-bg-layer-3, #222d42)",
      line: "var(--dsw-alias-border-l2, #293449)",
      lineSubtle: "var(--dsw-alias-border-l3, rgba(41, 52, 73, 0.6))",
      ink: "var(--dsw-alias-label-primary, #edf3ff)",
      inkSecondary: "var(--dsw-alias-label-secondary, #a1afc7)",
      inkMuted: "var(--dsw-alias-label-tertiary, #76859f)",
      brand: "var(--dsw-alias-brand-primary, #83aaff)",
      green: "var(--dsw-alias-state-success-primary, #86e4ba)",
      yellow: "var(--dsw-alias-state-warn-primary, #f59e0b)",
      red: "var(--dsw-alias-state-error-primary, #ffb1b1)",
      badgeClaudeBg: "#3b2318",
      badgeClaudeLine: "#6e3c25",
      badgeClaudeInk: "#ffb999",
      badgeClaude55Bg: "rgba(255, 147, 87, 0.16)",
      badgeClaude55Line: "rgba(255, 147, 87, 0.38)",
      badgeClaude55Ink: "#ff9357",
      badgeClaude46Bg: "rgba(229, 176, 114, 0.16)",
      badgeClaude46Line: "rgba(229, 176, 114, 0.38)",
      badgeClaude46Ink: "#e5b072",
      badgeArgonBg: "rgba(34, 211, 238, 0.14)",
      badgeArgonLine: "rgba(34, 211, 238, 0.38)",
      badgeArgonInk: "#22d3ee",
      monoFont: "ui-monospace, SFMono-Regular, Consolas, monospace"
    };

    // ─────────────────────────────────────────────────────────────
    // Helpers: Time & Formatting
    // ─────────────────────────────────────────────────────────────
    function formatTimeRemaining(timestamp) {
      if (!timestamp) return "";
      const diff = Math.max(0, Math.floor(timestamp - Date.now() / 1000));
      if (diff === 0) return "Сброшен";
      const hours = Math.floor(diff / 3600);
      const minutes = Math.floor((diff % 3600) / 60);
      if (hours >= 24) {
        const days = Math.floor(hours / 24);
        return `через ${days} дн. ${hours % 24} ч.`;
      }
      if (hours > 0) return `через ${hours} ч. ${minutes} мин.`;
      return `через ${minutes} мин.`;
    }

    function formatAbsoluteReset(timestamp) {
      if (!timestamp) return "";
      const d = new Date(timestamp * 1000);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (isToday) return `сегодня в ${timeStr}`;
      const dateStr = d.toLocaleDateString([], { day: "numeric", month: "short" });
      return `${dateStr}, ${timeStr}`;
    }

    function getFractionColor(fraction) {
      if (typeof fraction !== "number" || !Number.isFinite(fraction)) return THEME.inkMuted;
      if (fraction <= 0.1) return THEME.red;
      if (fraction <= 0.3) return THEME.yellow;
      return THEME.green;
    }

    function claudeVersions(account) {
      const versions = new Set();
      for (const [id, info] of Object.entries(account.quota || {})) {
        for (const name of [id, (info && info.name) || ""]) {
          const match = name.match(/\bclaude(?:[\s_-]+(?:opus|sonnet|haiku))?[\s_()-]+(\d+)[.\s_-](\d+)\b/i);
          if (match) versions.add(`${match[1]}.${match[2]}`);
        }
      }
      return [...versions].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    }

    function hasArgon(account) {
      if (!account) return false;
      for (const [id, info] of Object.entries(account.quota || {})) {
        if (/argon/i.test(id) && !/disabled/i.test(id)) return true;
        if (/argon/i.test((info && info.name) || "") && !/disabled/i.test((info && info.name) || "")) return true;
      }
      for (const g of account.quota_groups || []) {
        if (/argon/i.test(g.name || "")) return true;
        for (const b of g.buckets || []) {
          if (/argon/i.test(b.id || "") || /argon/i.test(b.name || "")) return true;
        }
      }
      return false;
    }

    function extractBuckets(account, family) {
      const isArgon = family === "argon";
      const isGemini = family === "gemini";
      const buckets = (account.quota_groups || [])
        .filter(g => {
          const gname = g.name || "";
          if (isArgon) return /argon/i.test(gname);
          if (isGemini) return /gemini/i.test(gname) && !/argon/i.test(gname);
          return /claude|gpt|3p|third[\s_-]*party/i.test(gname);
        })
        .flatMap(g => (g.buckets || []).filter(b => {
          const bid = (b.id || "") + " " + (b.name || "");
          if (isArgon) return true;
          if (isGemini) return !/argon/i.test(bid);
          return true;
        }));

      const b5h = buckets.find(b => b.window === "5h" || /5h|five/i.test(b.id || "") || /18000/i.test(b.id || "")) || null;
      const bWeekly = buckets.find(b => b.window === "weekly" || /week/i.test(b.id || "") || /604800/i.test(b.id || "")) || null;

      let frac5h = b5h && typeof b5h.remaining_fraction === "number" ? b5h.remaining_fraction : null;
      let fracWeekly = bWeekly && typeof bWeekly.remaining_fraction === "number" ? bWeekly.remaining_fraction : null;
      let resetAt5h = b5h?.reset_at || 0;
      let resetAtWeekly = bWeekly?.reset_at || 0;

      if (isArgon && fracWeekly === null) {
        const argonModel = Object.entries(account.quota || {}).find(([id, m]) => /argon/i.test(id) && !/disabled/i.test(id))?.[1];
        if (argonModel && typeof argonModel.remaining_fraction === "number" && Number.isFinite(argonModel.remaining_fraction)) {
          fracWeekly = argonModel.remaining_fraction;
          resetAtWeekly = argonModel.reset_at || 0;
        }
      }

      return {
        fiveHours: {
          fraction: frac5h,
          resetAt: resetAt5h,
          resetTime: b5h?.reset_time || ""
        },
        weekly: {
          fraction: fracWeekly,
          resetAt: resetAtWeekly,
          resetTime: bWeekly?.reset_time || ""
        }
      };
    }

    // ─────────────────────────────────────────────────────────────
    // Global Quota Store
    // ─────────────────────────────────────────────────────────────
    const globalState = {
      loading: false,
      refreshing: false,
      accounts: [],
      gateway: null,
      error: null,
      lastUpdated: 0,
      latencyMs: 0,
      apiUrl: safeStorageGet("dsh_geminapi_url", "https://gem.onarous.ru"),
      sessionApiKey: "",
      autoRefresh: safeStorageGet("dsh_geminapi_auto", "true") !== "false",
      intervalSec: parseInt(safeStorageGet("dsh_geminapi_interval", "60"), 10),
      listeners: new Set(),
      subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
      },
      notify() {
        for (const fn of this.listeners) fn(this);
      }
    };

    async function loadQuotas() {
      if (globalState.loading) return;
      globalState.loading = true;
      globalState.notify();

      try {
        const headers = {};
        if (globalState.apiUrl) headers["x-geminapi-url"] = globalState.apiUrl;
        if (globalState.sessionApiKey) headers["x-geminapi-key"] = globalState.sessionApiKey;

        const res = await fetch("/api/geminapi/quotas", { headers });
        const data = await res.json();

        if (data.ok) {
          globalState.accounts = data.accounts || [];
          globalState.gateway = data.gateway || null;
          globalState.error = null;
          globalState.lastUpdated = Date.now();
          globalState.latencyMs = data.latencyMs || 0;
        } else {
          globalState.error = data.error || "Не удалось загрузить квоты";
          if (data.latencyMs) globalState.latencyMs = data.latencyMs;
        }
      } catch (err) {
        globalState.error = err instanceof Error ? err.message : "Ошибка сетевого соединения с сервером";
      } finally {
        globalState.loading = false;
        globalState.notify();
      }
    }

    async function refreshQuotasRemote() {
      if (globalState.refreshing) return;
      globalState.refreshing = true;
      globalState.notify();

      try {
        const res = await fetch("/api/geminapi/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiUrl: globalState.apiUrl,
            apiKey: globalState.sessionApiKey || undefined
          })
        });
        const data = await res.json();
        if (data.ok) {
          globalState.accounts = data.accounts || [];
          globalState.error = null;
          globalState.lastUpdated = Date.now();
          globalState.latencyMs = data.latencyMs || 0;
        } else {
          globalState.error = data.error || "Ошибка обновления квот";
        }
      } catch (err) {
        globalState.error = err instanceof Error ? err.message : "Ошибка сети";
      } finally {
        globalState.refreshing = false;
        globalState.notify();
      }
    }

    function useQuotasStore() {
      const [, setTick] = useState(0);
      useEffect(() => {
        return globalState.subscribe(() => setTick(t => t + 1));
      }, []);
      return globalState;
    }

    let autoRefreshTimer = null;
    function setupAutoRefresh() {
      if (autoRefreshTimer) clearInterval(autoRefreshTimer);
      if (globalState.autoRefresh && globalState.intervalSec > 0) {
        autoRefreshTimer = setInterval(() => {
          if (typeof document !== "undefined" && !document.hidden) {
            loadQuotas();
          }
        }, globalState.intervalSec * 1000);
      }
    }

    loadQuotas();
    setupAutoRefresh();

    // ─────────────────────────────────────────────────────────────
    // Telemetry: 5-Hour and Weekly Limit Calculations
    // ─────────────────────────────────────────────────────────────
    function calculatePoolLimits(accounts, gateway) {
      const active = accounts.filter(a => !a.disabled && !a.auth_error);

      // Gemini: 5h and weekly
      let g5hSum = 0, g5hCount = 0, g5hNearestReset = 0;
      let gWeeklySum = 0, gWeeklyCount = 0, gWeeklyNearestReset = 0;

      // Claude 5.5: 5h and weekly
      const c55Accounts = accounts.filter(a => claudeVersions(a).includes("5.5"));
      let c55_5hSum = 0, c55_5hCount = 0, c55_5hNearestReset = 0;
      let c55_wSum = 0, c55_wCount = 0, c55_wNearestReset = 0;

      // Claude 4.6: 5h and weekly
      const c46Accounts = accounts.filter(a => claudeVersions(a).includes("4.6"));
      let c46_5hSum = 0, c46_5hCount = 0, c46_5hNearestReset = 0;
      let c46_wSum = 0, c46_wCount = 0, c46_wNearestReset = 0;

      // Claude: All / 3P
      const cAllAccounts = accounts.filter(a => claudeVersions(a).length > 0);
      let cAll5hSum = 0, cAll5hCount = 0, cAll5hNearestReset = 0;
      let cAllWeeklySum = 0, cAllWeeklyCount = 0, cAllWeeklyNearestReset = 0;

      // Gemini 4 Argon
      const argonAccounts = accounts.filter(a => hasArgon(a));
      let a5hSum = 0, a5hCount = 0, a5hNearestReset = 0;
      let aWeeklySum = 0, aWeeklyCount = 0, aWeeklyNearestReset = 0;

      for (const acc of active) {
        if (hasArgon(acc)) {
          const a = extractBuckets(acc, "argon");
          if (a.fiveHours.fraction !== null) {
            a5hSum += a.fiveHours.fraction;
            a5hCount++;
            if (a.fiveHours.resetAt && (!a5hNearestReset || a.fiveHours.resetAt < a5hNearestReset)) {
              a5hNearestReset = a.fiveHours.resetAt;
            }
          }
          if (a.weekly.fraction !== null) {
            aWeeklySum += a.weekly.fraction;
            aWeeklyCount++;
            if (a.weekly.resetAt && (!aWeeklyNearestReset || a.weekly.resetAt < aWeeklyNearestReset)) {
              aWeeklyNearestReset = a.weekly.resetAt;
            }
          }
        }
        const g = extractBuckets(acc, "gemini");
        if (g.fiveHours.fraction !== null) {
          g5hSum += g.fiveHours.fraction;
          g5hCount++;
          if (g.fiveHours.resetAt && (!g5hNearestReset || g.fiveHours.resetAt < g5hNearestReset)) {
            g5hNearestReset = g.fiveHours.resetAt;
          }
        }
        if (g.weekly.fraction !== null) {
          gWeeklySum += g.weekly.fraction;
          gWeeklyCount++;
          if (g.weekly.resetAt && (!gWeeklyNearestReset || g.weekly.resetAt < gWeeklyNearestReset)) {
            gWeeklyNearestReset = g.weekly.resetAt;
          }
        }

        const c = extractBuckets(acc, "claude");
        const versions = claudeVersions(acc);

        if (c.fiveHours.fraction !== null) {
          cAll5hSum += c.fiveHours.fraction;
          cAll5hCount++;
          if (c.fiveHours.resetAt && (!cAll5hNearestReset || c.fiveHours.resetAt < cAll5hNearestReset)) {
            cAll5hNearestReset = c.fiveHours.resetAt;
          }

          if (versions.includes("5.5")) {
            c55_5hSum += c.fiveHours.fraction;
            c55_5hCount++;
            if (c.fiveHours.resetAt && (!c55_5hNearestReset || c.fiveHours.resetAt < c55_5hNearestReset)) {
              c55_5hNearestReset = c.fiveHours.resetAt;
            }
          }

          if (versions.includes("4.6")) {
            c46_5hSum += c.fiveHours.fraction;
            c46_5hCount++;
            if (c.fiveHours.resetAt && (!c46_5hNearestReset || c.fiveHours.resetAt < c46_5hNearestReset)) {
              c46_5hNearestReset = c.fiveHours.resetAt;
            }
          }
        }

        if (c.weekly.fraction !== null) {
          cAllWeeklySum += c.weekly.fraction;
          cAllWeeklyCount++;
          if (c.weekly.resetAt && (!cAllWeeklyNearestReset || c.weekly.resetAt < cAllWeeklyNearestReset)) {
            cAllWeeklyNearestReset = c.weekly.resetAt;
          }

          if (versions.includes("5.5")) {
            c55_wSum += c.weekly.fraction;
            c55_wCount++;
            if (c.weekly.resetAt && (!c55_wNearestReset || c.weekly.resetAt < c55_wNearestReset)) {
              c55_wNearestReset = c.weekly.resetAt;
            }
          }

          if (versions.includes("4.6")) {
            c46_wSum += c.weekly.fraction;
            c46_wCount++;
            if (c.weekly.resetAt && (!c46_wNearestReset || c.weekly.resetAt < c46_wNearestReset)) {
              c46_wNearestReset = c.weekly.resetAt;
            }
          }
        }
      }

      const gemini5hAvg = g5hCount > 0 ? g5hSum / g5hCount : null;
      const geminiWeeklyAvg = gWeeklyCount > 0 ? gWeeklySum / gWeeklyCount : null;

      const claude55_5hAvg = c55_5hCount > 0 ? c55_5hSum / c55_5hCount : null;
      const claude55_wAvg = c55_wCount > 0 ? c55_wSum / c55_wCount : null;

      const claude46_5hAvg = c46_5hCount > 0 ? c46_5hSum / c46_5hCount : null;
      const claude46_wAvg = c46_wCount > 0 ? c46_wSum / c46_wCount : null;

      const claudeAll_5hAvg = cAll5hCount > 0 ? cAll5hSum / cAll5hCount : null;
      const claudeAll_wAvg = cAllWeeklyCount > 0 ? cAllWeeklySum / cAllWeeklyCount : null;

      const argon5hAvg = a5hCount > 0 ? a5hSum / a5hCount : null;
      const argonWeeklyAvg = aWeeklyCount > 0 ? aWeeklySum / aWeeklyCount : null;

      return {
        totalAccounts: accounts.length,
        activeAccounts: active.length,
        gemini: {
          fiveHours: {
            fraction: gemini5hAvg,
            resetAt: g5hNearestReset
          },
          weekly: {
            fraction: geminiWeeklyAvg,
            resetAt: gWeeklyNearestReset
          }
        },
        argon: {
          totalAccounts: argonAccounts.length,
          activeAccounts: argonAccounts.filter(a => !a.disabled && !a.auth_error).length,
          fiveHours: {
            fraction: argon5hAvg,
            resetAt: a5hNearestReset
          },
          weekly: {
            fraction: argonWeeklyAvg,
            resetAt: aWeeklyNearestReset
          }
        },
        claude55: {
          totalAccounts: c55Accounts.length,
          activeAccounts: c55Accounts.filter(a => !a.disabled && !a.auth_error).length,
          fiveHours: {
            fraction: claude55_5hAvg,
            resetAt: c55_5hNearestReset
          },
          weekly: {
            fraction: claude55_wAvg,
            resetAt: c55_wNearestReset
          }
        },
        claude46: {
          totalAccounts: c46Accounts.length,
          activeAccounts: c46Accounts.filter(a => !a.disabled && !a.auth_error).length,
          fiveHours: {
            fraction: claude46_5hAvg,
            resetAt: c46_5hNearestReset
          },
          weekly: {
            fraction: claude46_wAvg,
            resetAt: c46_wNearestReset
          }
        },
        claudeAll: {
          totalAccounts: cAllAccounts.length,
          activeAccounts: cAllAccounts.filter(a => !a.disabled && !a.auth_error).length,
          fiveHours: {
            fraction: claudeAll_5hAvg,
            resetAt: cAll5hNearestReset
          },
          weekly: {
            fraction: claudeAll_wAvg,
            resetAt: cAllWeeklyNearestReset
          }
        },
        concurrency: gateway ? `${gateway.active_requests || 0}/${gateway.max_concurrency || 4}` : "1/4",
        rotation: (gateway && gateway.rotation) || "least_tokens",
        upstreamHost: (gateway && gateway.upstream_host) || "daily-cloudcode-pa.googleapis.com"
      };
    }

    // ─────────────────────────────────────────────────────────────
    // Component: Explicit Limit Gauge (5 часов / Недельный)
    // ─────────────────────────────────────────────────────────────
    function LimitGauge({ title, badge, fraction, resetAt, height = 7 }) {
      const percent = typeof fraction === "number" && Number.isFinite(fraction)
        ? Math.round(fraction * 100)
        : null;
      const color = getFractionColor(fraction);
      const safeFraction = fraction !== null ? Math.max(0.01, Math.min(1, fraction)) : 0;
      const countdown = resetAt ? formatTimeRemaining(resetAt) : "";
      const absoluteDate = resetAt ? formatAbsoluteReset(resetAt) : "";

      return h("div", {
        style: {
          backgroundColor: THEME.bgBase,
          border: `1px solid ${THEME.lineSubtle}`,
          borderRadius: "6px",
          padding: "8px 10px",
          marginBottom: "6px"
        },
        role: "progressbar",
        "aria-valuenow": percent !== null ? percent : 0,
        "aria-valuemin": 0,
        "aria-valuemax": 100,
        "aria-label": `${title} ${badge}`
      },
        // Header line: Title + Badge + Percent
        h("div", {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "6px"
          }
        },
          h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } },
            h("span", {
              style: {
                fontSize: "12px",
                fontWeight: 600,
                color: THEME.ink
              }
            }, title),
            badge ? h("span", {
              style: {
                fontSize: "10px",
                fontWeight: 600,
                padding: "1px 5px",
                borderRadius: "3px",
                backgroundColor: THEME.bgLayer3,
                color: THEME.inkSecondary,
                border: `1px solid ${THEME.line}`
              }
            }, badge) : null
          ),
          h("span", {
            style: {
              fontSize: "14px",
              fontWeight: 700,
              color,
              fontVariantNumeric: "tabular-nums"
            }
          }, percent !== null ? `${percent}%` : "—")
        ),

        // Progress track
        h("div", {
          style: {
            width: "100%",
            height: `${height}px`,
            borderRadius: "3px",
            backgroundColor: "rgba(0, 0, 0, 0.4)",
            border: `1px solid ${THEME.line}`,
            overflow: "hidden",
            marginBottom: "5px"
          }
        },
          percent !== null ? h("div", {
            style: {
              width: "100%",
              height: "100%",
              backgroundColor: color,
              borderRadius: "2px",
              transformOrigin: "left center",
              transform: `scaleX(${safeFraction})`,
              transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.3s ease"
            }
          }) : null
        ),

        // Reset info line
        countdown ? h("div", {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "11px",
            color: THEME.inkMuted
          }
        },
          h("span", null, `Сброс: ${countdown}`),
          absoluteDate ? h("span", { style: { fontSize: "10px" } }, `(${absoluteDate})`) : null
        ) : null
      );
    }

    // ─────────────────────────────────────────────────────────────
    // Component: Model Family Block (Gemini or Claude)
    // ─────────────────────────────────────────────────────────────
    function ModelFamilyCard({ name, subtitle, tag, fiveHours, weekly }) {
      return h("div", {
        style: {
          backgroundColor: THEME.bgPanel,
          borderRadius: "8px",
          border: `1px solid ${THEME.line}`,
          padding: "12px",
          marginBottom: "10px"
        }
      },
        // Title header
        h("div", {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "10px"
          }
        },
          h("div", null,
            h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } },
              h("span", { style: { fontWeight: 700, fontSize: "14px", color: THEME.ink } }, name),
              tag ? h("span", {
                style: {
                  fontSize: "10px",
                  fontWeight: 600,
                  padding: "1px 6px",
                  borderRadius: "4px",
                  backgroundColor: tag.bg || THEME.bgLayer3,
                  color: tag.color || THEME.ink,
                  border: `1px solid ${tag.border || THEME.line}`
                }
              }, tag.label) : null
            ),
            subtitle ? h("div", { style: { fontSize: "11px", color: THEME.inkMuted, marginTop: "2px" } }, subtitle) : null
          )
        ),

        // 5-Hour Limit
        h(LimitGauge, {
          title: "⏱ 5-часовой лимит",
          badge: "Скользящее окно",
          fraction: fiveHours.fraction,
          resetAt: fiveHours.resetAt,
          height: 7
        }),

        // Weekly Limit
        h(LimitGauge, {
          title: "📅 Недельный лимит",
          badge: "Квота на 7 дней",
          fraction: weekly.fraction,
          resetAt: weekly.resetAt,
          height: 7
        })
      );
    }

    // ─────────────────────────────────────────────────────────────
    // Component: Account Row
    // ─────────────────────────────────────────────────────────────
    function AccountRow({ account }) {
      const [isExpanded, setIsExpanded] = useState(false);
      const [filter, setFilter] = useState("");

      const email = account.email || account.name || `Аккаунт ${account.id.slice(0, 8)}`;
      const gemini = extractBuckets(account, "gemini");
      const argon = extractBuckets(account, "argon");
      const claude = extractBuckets(account, "claude");
      const isArgonAvail = hasArgon(account);
      const versions = claudeVersions(account);
      const has55 = versions.includes("5.5");
      const has46 = versions.includes("4.6");
      const quotaEntries = Object.entries(account.quota || {});

      let claudeTitle = "Claude & 3P";
      let claudeTitleColor = THEME.ink;
      if (has55 && !has46) {
        claudeTitle = "Claude 5.5";
        claudeTitleColor = THEME.badgeClaude55Ink;
      } else if (has46 && !has55) {
        claudeTitle = "Claude 4.6";
        claudeTitleColor = THEME.badgeClaude46Ink;
      } else if (has55 && has46) {
        claudeTitle = "Claude 5.5 & 4.6";
        claudeTitleColor = THEME.badgeClaude55Ink;
      }

      let statusPill = { text: "Активен", color: THEME.green, bg: "rgba(134, 228, 186, 0.12)", border: "rgba(134, 228, 186, 0.3)" };
      if (account.disabled) {
        statusPill = { text: "Отключен", color: THEME.inkMuted, bg: "rgba(118, 133, 159, 0.12)", border: "rgba(118, 133, 159, 0.3)" };
      } else if (account.auth_error) {
        statusPill = { text: "Ошибка авторизации", color: THEME.red, bg: "rgba(255, 177, 177, 0.12)", border: "rgba(255, 177, 177, 0.3)" };
      } else if (account.quota_error) {
        statusPill = { text: "Ошибка квот", color: THEME.yellow, bg: "rgba(245, 158, 11, 0.12)", border: "rgba(245, 158, 11, 0.3)" };
      }

      const filtered = quotaEntries.filter(([id, info]) => {
        return (id + " " + (info?.name || "")).toLowerCase().includes(filter.toLowerCase());
      });

      return h("div", {
        style: {
          backgroundColor: THEME.bgPanel,
          borderRadius: "8px",
          border: `1px solid ${THEME.line}`,
          padding: "10px 12px",
          marginBottom: "8px"
        }
      },
        // Top line
        h("div", {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "8px",
            flexWrap: "wrap",
            gap: "6px"
          }
        },
          h("div", { style: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" } },
            h("span", { style: { fontWeight: 600, fontSize: "13px", color: THEME.ink } }, email),
            h("span", {
              style: {
                fontSize: "11px",
                padding: "2px 6px",
                borderRadius: "4px",
                fontWeight: 600,
                color: statusPill.color,
                backgroundColor: statusPill.bg,
                border: `1px solid ${statusPill.border}`
              }
            }, statusPill.text)
          ),
          h("div", { style: { display: "flex", gap: "4px", flexWrap: "wrap" } },
            isArgonAvail ? h("span", {
              style: {
                fontSize: "11px",
                padding: "2px 7px",
                borderRadius: "4px",
                fontWeight: 700,
                color: THEME.badgeArgonInk,
                backgroundColor: THEME.badgeArgonBg,
                border: `1px solid ${THEME.badgeArgonLine}`
              }
            }, "Gemini 4 Argon") : null,
            versions.map(v => {
              const is55 = v === "5.5";
              const is46 = v === "4.6";
              const color = is55 ? THEME.badgeClaude55Ink : is46 ? THEME.badgeClaude46Ink : THEME.badgeClaudeInk;
              const bg = is55 ? THEME.badgeClaude55Bg : is46 ? THEME.badgeClaude46Bg : THEME.badgeClaudeBg;
              const border = is55 ? THEME.badgeClaude55Line : is46 ? THEME.badgeClaude46Line : THEME.badgeClaudeLine;
              return h("span", {
                key: v,
                style: {
                  fontSize: "11px",
                  padding: "2px 7px",
                  borderRadius: "4px",
                  fontWeight: 700,
                  color,
                  backgroundColor: bg,
                  border: `1px solid ${border}`
                }
              }, `Claude ${v}`);
            })
          )
        ),

        // Side-by-side: Gemini vs Claude limits
        h("div", {
          style: {
            display: "grid",
            gridTemplateColumns: isArgonAvail ? "repeat(auto-fit, minmax(120px, 1fr))" : "1fr 1fr",
            gap: "8px",
            marginBottom: "6px"
          }
        },
          // Gemini limits
          h("div", {
            style: {
              backgroundColor: THEME.bgBase,
              border: `1px solid ${THEME.lineSubtle}`,
              borderRadius: "6px",
              padding: "6px 8px"
            }
          },
            h("div", { style: { fontSize: "11px", fontWeight: 700, color: THEME.brand, marginBottom: "4px" } }, "Gemini"),
            h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" } },
              h("span", { style: { color: THEME.inkSecondary } }, "5 часов:"),
              h("span", {
                style: {
                  fontWeight: 600,
                  color: getFractionColor(gemini.fiveHours.fraction),
                  fontVariantNumeric: "tabular-nums"
                }
              }, gemini.fiveHours.fraction !== null ? `${Math.round(gemini.fiveHours.fraction * 100)}%` : "—")
            ),
            h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "11px" } },
              h("span", { style: { color: THEME.inkSecondary } }, "Неделя:"),
              h("span", {
                style: {
                  fontWeight: 600,
                  color: getFractionColor(gemini.weekly.fraction),
                  fontVariantNumeric: "tabular-nums"
                }
              }, gemini.weekly.fraction !== null ? `${Math.round(gemini.weekly.fraction * 100)}%` : "—")
            )
          ),

          // Gemini 4 Argon limits
          isArgonAvail ? h("div", {
            style: {
              backgroundColor: THEME.bgBase,
              border: `1px solid ${THEME.lineSubtle}`,
              borderRadius: "6px",
              padding: "6px 8px"
            }
          },
            h("div", { style: { fontSize: "11px", fontWeight: 700, color: THEME.badgeArgonInk, marginBottom: "4px" } }, "Gemini 4 Argon"),
            argon.fiveHours.fraction !== null ? h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" } },
              h("span", { style: { color: THEME.inkSecondary } }, "5 часов:"),
              h("span", {
                style: {
                  fontWeight: 600,
                  color: getFractionColor(argon.fiveHours.fraction),
                  fontVariantNumeric: "tabular-nums"
                }
              }, `${Math.round(argon.fiveHours.fraction * 100)}%`)
            ) : null,
            h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "11px" } },
              h("span", { style: { color: THEME.inkSecondary } }, "Неделя:"),
              h("span", {
                style: {
                  fontWeight: 600,
                  color: getFractionColor(argon.weekly.fraction),
                  fontVariantNumeric: "tabular-nums"
                }
              }, argon.weekly.fraction !== null ? `${Math.round(argon.weekly.fraction * 100)}%` : "—")
            )
          ) : null,

          // Claude limits
          h("div", {
            style: {
              backgroundColor: THEME.bgBase,
              border: `1px solid ${THEME.lineSubtle}`,
              borderRadius: "6px",
              padding: "6px 8px"
            }
          },
            h("div", { style: { fontSize: "11px", fontWeight: 700, color: claudeTitleColor, marginBottom: "4px" } }, claudeTitle),
            h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "2px" } },
              h("span", { style: { color: THEME.inkSecondary } }, "5 часов:"),
              h("span", {
                style: {
                  fontWeight: 600,
                  color: getFractionColor(claude.fiveHours.fraction),
                  fontVariantNumeric: "tabular-nums"
                }
              }, claude.fiveHours.fraction !== null ? `${Math.round(claude.fiveHours.fraction * 100)}%` : "—")
            ),
            h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "11px" } },
              h("span", { style: { color: THEME.inkSecondary } }, "Неделя:"),
              h("span", {
                style: {
                  fontWeight: 600,
                  color: getFractionColor(claude.weekly.fraction),
                  fontVariantNumeric: "tabular-nums"
                }
              }, claude.weekly.fraction !== null ? `${Math.round(claude.weekly.fraction * 100)}%` : "—")
            )
          )
        ),

        // Expand model details
        quotaEntries.length > 0 ? h("div", null,
          h("button", {
            onClick: () => setIsExpanded(!isExpanded),
            style: {
              background: "none",
              border: "none",
              padding: "4px 0",
              fontSize: "12px",
              color: THEME.brand,
              cursor: "pointer",
              fontWeight: 500
            }
          }, `${isExpanded ? "▾ Скрыть" : "▸ Детали"} моделей (${quotaEntries.length})`),
          isExpanded ? h("div", {
            style: {
              marginTop: "6px",
              paddingTop: "6px",
              borderTop: `1px solid ${THEME.lineSubtle}`
            }
          },
            h("input", {
              type: "text",
              placeholder: "Поиск модели...",
              value: filter,
              onChange: e => setFilter(e.target.value),
              style: {
                width: "100%",
                boxSizing: "border-box",
                padding: "5px 8px",
                fontSize: "11px",
                borderRadius: "4px",
                border: `1px solid ${THEME.line}`,
                backgroundColor: THEME.bgBase,
                color: THEME.ink,
                marginBottom: "6px",
                outline: "none",
                fontFamily: THEME.monoFont
              }
            }),
            h("div", {
              style: {
                maxHeight: "180px",
                overflowY: "auto",
                fontSize: "11px",
                fontFamily: THEME.monoFont
              }
            },
              filtered.map(([id, info]) => {
                const frac = info?.remaining_fraction ?? null;
                const pct = frac !== null ? Math.round(frac * 100) : null;
                const color = getFractionColor(frac);
                const rStr = info?.reset_at ? formatTimeRemaining(info.reset_at) : "";

                return h("div", {
                  key: id,
                  style: {
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "3px 4px",
                    borderBottom: `1px solid ${THEME.lineSubtle}`
                  }
                },
                  h("span", {
                    style: {
                      color: THEME.ink,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: "60%"
                    },
                    title: id
                  }, id),
                  h("div", { style: { display: "flex", gap: "6px", alignItems: "center" } },
                    rStr ? h("span", { style: { color: THEME.inkMuted, fontSize: "10px" } }, rStr) : null,
                    h("span", { style: { fontWeight: 600, color, minWidth: "32px", textAlign: "right" } },
                      pct !== null ? `${pct}%` : "—"
                    )
                  )
                );
              })
            )
          ) : null
        ) : null
      );
    }

    // ─────────────────────────────────────────────────────────────
    // Component: QuotasSidebarTitle (Tab Chip in Right Sidebar)
    // ─────────────────────────────────────────────────────────────
    function QuotasSidebarTitle() {
      const store = useQuotasStore();
      const telemetry = calculatePoolLimits(store.accounts, store.gateway);

      return h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } },
        h("span", null, "⚡ Лимиты GeminApi"),
        telemetry.totalAccounts > 0 ? h("span", {
          style: {
            fontSize: "11px",
            padding: "1px 5px",
            borderRadius: "4px",
            color: THEME.ink,
            backgroundColor: THEME.bgLayer3,
            border: `1px solid ${THEME.line}`,
            fontWeight: 600
          }
        }, `${telemetry.activeAccounts}/${telemetry.totalAccounts}`) : null
      );
    }

    // ─────────────────────────────────────────────────────────────
    // Component: QuotasSidebarTab (Full Right Sidebar Panel)
    // ─────────────────────────────────────────────────────────────
    function QuotasSidebarTab() {
      const store = useQuotasStore();
      const [filterTab, setFilterTab] = useState("all");
      const [searchQuery, setSearchQuery] = useState("");

      const telemetry = calculatePoolLimits(store.accounts, store.gateway);

      const filteredAccounts = store.accounts.filter(acc => {
        if (filterTab === "active" && (acc.disabled || acc.auth_error)) return false;
        if (filterTab === "argon" && !hasArgon(acc)) return false;
        if (filterTab === "claude55" && !claudeVersions(acc).includes("5.5")) return false;
        if (filterTab === "claude46" && !claudeVersions(acc).includes("4.6")) return false;
        if (filterTab === "errors" && !acc.auth_error && !acc.quota_error) return false;
        if (filterTab === "low") {
          const g = extractBuckets(acc, "gemini");
          const c = extractBuckets(acc, "claude");
          const isLow = (g.fiveHours.fraction !== null && g.fiveHours.fraction < 0.2)
            || (g.weekly.fraction !== null && g.weekly.fraction < 0.2)
            || (c.fiveHours.fraction !== null && c.fiveHours.fraction < 0.2)
            || (c.weekly.fraction !== null && c.weekly.fraction < 0.2);
          if (!isLow) return false;
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchEmail = (acc.email || acc.name || "").toLowerCase().includes(q);
          const matchModel = Object.keys(acc.quota || {}).some(k => k.toLowerCase().includes(q));
          if (!matchEmail && !matchModel) return false;
        }

        return true;
      });

      return h("div", {
        style: {
          padding: "14px",
          height: "100%",
          boxSizing: "border-box",
          overflowY: "auto",
          color: THEME.ink,
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif"
        }
      },
        // Top status bar
        h("div", {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "12px",
            paddingBottom: "8px",
            borderBottom: `1px solid ${THEME.line}`
          }
        },
          h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
            h("div", {
              style: {
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: store.error ? THEME.red : THEME.green
              }
            }),
            h("div", null,
              h("div", { style: { fontSize: "13px", fontWeight: 700 } }, "GeminApi Quotas"),
              h("div", { style: { fontSize: "11px", color: THEME.inkMuted } },
                `${telemetry.upstreamHost} · ${store.latencyMs ? `${store.latencyMs} мс` : "готов"}`
              )
            )
          ),
          h("button", {
            onClick: () => refreshQuotasRemote(),
            disabled: store.refreshing || store.loading,
            title: "Синхронизировать лимиты из Google Upstream",
            style: {
              padding: "5px 10px",
              fontSize: "12px",
              fontWeight: 600,
              borderRadius: "4px",
              border: `1px solid ${THEME.line}`,
              backgroundColor: THEME.bgPanel,
              color: THEME.ink,
              cursor: store.refreshing ? "wait" : "pointer"
            }
          }, store.refreshing ? "Синхронизация…" : "🔄 Синхронизировать")
        ),

        // Error message if any
        store.error ? h("div", {
          style: {
            padding: "8px 12px",
            marginBottom: "12px",
            borderRadius: "6px",
            backgroundColor: "rgba(255, 177, 177, 0.12)",
            border: `1px solid ${THEME.red}`,
            color: THEME.red,
            fontSize: "12px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }
        },
          h("span", null, `⚠️ ${store.error}`),
          h("button", {
            onClick: () => loadQuotas(),
            style: {
              background: "none",
              border: "none",
              color: THEME.brand,
              cursor: "pointer",
              fontSize: "11px",
              fontWeight: 600,
              textDecoration: "underline"
            }
          }, "Повторить")
        ) : null,

        // Prominent 5-Hour & Weekly Limit Breakdown for Pool
        store.accounts.length > 0 ? h("div", { style: { marginBottom: "14px" } },
          // Section header
          h("div", {
            style: {
              fontSize: "12px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: THEME.inkSecondary,
              marginBottom: "8px"
            }
          }, "Общие лимиты пула (5 часов и Неделя)"),

          // Gemini Pool
          h(ModelFamilyCard, {
            name: "Google Gemini Models",
            subtitle: "Пул моделей Gemini 2.5 Flash / Pro / 3.8",
            tag: { label: `${telemetry.activeAccounts} акк.`, bg: THEME.bgLayer3, color: THEME.brand, border: THEME.line },
            fiveHours: telemetry.gemini.fiveHours,
            weekly: telemetry.gemini.weekly
          }),

          // Gemini 4 Argon Pool
          telemetry.argon.totalAccounts > 0 ? h(ModelFamilyCard, {
            name: "Gemini 4 Argon",
            subtitle: "Frontier Reasoning (1M Context)",
            tag: {
              label: `${telemetry.argon.activeAccounts}/${telemetry.argon.totalAccounts} акк.`,
              bg: THEME.badgeArgonBg,
              color: THEME.badgeArgonInk,
              border: THEME.badgeArgonLine
            },
            fiveHours: telemetry.argon.fiveHours,
            weekly: telemetry.argon.weekly
          }) : null,

          // Claude 5.5 Pool
          telemetry.claude55.totalAccounts > 0 ? h(ModelFamilyCard, {
            name: "Claude 5.5 Models",
            subtitle: "Opus 5.5 High & Sonnet 5.5",
            tag: {
              label: `${telemetry.claude55.activeAccounts}/${telemetry.claude55.totalAccounts} акк.`,
              bg: THEME.badgeClaude55Bg,
              color: THEME.badgeClaude55Ink,
              border: THEME.badgeClaude55Line
            },
            fiveHours: telemetry.claude55.fiveHours,
            weekly: telemetry.claude55.weekly
          }) : null,

          // Claude 4.6 Pool
          telemetry.claude46.totalAccounts > 0 ? h(ModelFamilyCard, {
            name: "Claude 4.6 Models",
            subtitle: "Opus 4.6 Thinking & Sonnet 4.6",
            tag: {
              label: `${telemetry.claude46.activeAccounts}/${telemetry.claude46.totalAccounts} акк.`,
              bg: THEME.badgeClaude46Bg,
              color: THEME.badgeClaude46Ink,
              border: THEME.badgeClaude46Line
            },
            fiveHours: telemetry.claude46.fiveHours,
            weekly: telemetry.claude46.weekly
          }) : null,

          // Fallback if neither 5.5 nor 4.6 detected
          telemetry.claude55.totalAccounts === 0 && telemetry.claude46.totalAccounts === 0 && telemetry.claudeAll.totalAccounts > 0 ? h(ModelFamilyCard, {
            name: "Claude & 3P Models",
            subtitle: "Сторонние модели Claude / GPT",
            tag: { label: "Anthropic", bg: THEME.badgeClaudeBg, color: THEME.badgeClaudeInk, border: THEME.badgeClaudeLine },
            fiveHours: telemetry.claudeAll.fiveHours,
            weekly: telemetry.claudeAll.weekly
          }) : null
        ) : null,

        // Accounts section title & search toolbar
        h("div", {
          style: {
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "8px",
            flexWrap: "wrap",
            gap: "6px"
          }
        },
          h("div", { style: { display: "flex", gap: "4px", flexWrap: "wrap" } },
            [
              { id: "all", label: `Все (${store.accounts.length})` },
              ...(telemetry.argon.totalAccounts > 0 ? [{ id: "argon", label: `Argon (${telemetry.argon.totalAccounts})` }] : []),
              ...(telemetry.claude55.totalAccounts > 0 ? [{ id: "claude55", label: `Claude 5.5 (${telemetry.claude55.totalAccounts})` }] : []),
              ...(telemetry.claude46.totalAccounts > 0 ? [{ id: "claude46", label: `Claude 4.6 (${telemetry.claude46.totalAccounts})` }] : []),
              { id: "active", label: `Активные (${telemetry.activeAccounts})` },
              { id: "low", label: "Мало квоты" },
              { id: "errors", label: "Ошибки" }
            ].map(tab => h("button", {
              key: tab.id,
              onClick: () => setFilterTab(tab.id),
              style: {
                padding: "3px 8px",
                fontSize: "11px",
                fontWeight: 600,
                borderRadius: "4px",
                border: "none",
                backgroundColor: filterTab === tab.id ? THEME.brand : THEME.bgPanel,
                color: filterTab === tab.id ? "#0b1833" : THEME.inkSecondary,
                cursor: "pointer"
              }
            }, tab.label))
          ),
          h("input", {
            type: "text",
            placeholder: "Поиск...",
            value: searchQuery,
            onChange: e => setSearchQuery(e.target.value),
            style: {
              padding: "4px 8px",
              fontSize: "11px",
              borderRadius: "4px",
              border: `1px solid ${THEME.line}`,
              backgroundColor: THEME.bgBase,
              color: THEME.ink,
              outline: "none",
              maxWidth: "110px"
            }
          })
        ),

        // Accounts List
        filteredAccounts.length === 0 && !store.loading ? h("div", {
          style: {
            padding: "24px",
            textAlign: "center",
            backgroundColor: THEME.bgPanel,
            borderRadius: "8px",
            border: `1px solid ${THEME.line}`,
            color: THEME.inkMuted,
            fontSize: "13px"
          }
        },
          store.accounts.length === 0
            ? h("div", null,
              h("div", { style: { marginBottom: "6px", color: THEME.ink, fontWeight: 600 } }, "Нет подключенных Google-аккаунтов"),
              h("div", { style: { fontSize: "12px", marginBottom: "12px" } }, "Добавьте аккаунт в веб-панели управления GeminApi."),
              h("a", {
                href: `${globalState.apiUrl}/admin`,
                target: "_blank",
                rel: "noopener noreferrer",
                style: {
                  display: "inline-block",
                  padding: "6px 12px",
                  borderRadius: "4px",
                  backgroundColor: THEME.brand,
                  color: "#0b1833",
                  fontSize: "12px",
                  fontWeight: 600,
                  textDecoration: "none"
                }
              }, "Открыть панель GeminApi →")
            )
            : "Нет аккаунтов, соответствующих выбранному фильтру."
        ) : filteredAccounts.map(account => h(AccountRow, { key: account.id, account }))
      );
    }

    // ─────────────────────────────────────────────────────────────
    // Component: QuotasHeaderIndicator (Header Bar Trigger & Popover)
    // ─────────────────────────────────────────────────────────────
    function QuotasHeaderIndicator(props) {
      const store = useQuotasStore();
      const [isOpen, setIsOpen] = useState(false);
      const containerRef = useRef(null);

      const telemetry = calculatePoolLimits(store.accounts, store.gateway);

      // Dismiss on Escape
      useEffect(() => {
        function handleKeyDown(e) {
          if (e.key === "Escape" && isOpen) setIsOpen(false);
        }
        if (isOpen) {
          window.addEventListener("keydown", handleKeyDown);
          return () => window.removeEventListener("keydown", handleKeyDown);
        }
      }, [isOpen]);

      // Dismiss on outside click
      useEffect(() => {
        function handleClickOutside(e) {
          if (containerRef.current && !containerRef.current.contains(e.target)) {
            setIsOpen(false);
          }
        }
        if (isOpen) {
          document.addEventListener("mousedown", handleClickOutside);
          return () => document.removeEventListener("mousedown", handleClickOutside);
        }
      }, [isOpen]);

      // Robust handler to open tab in right sidebar
      const handleOpenSidebar = () => {
        setIsOpen(false);
        try {
          const sr = window.__DSH_SIDEBAR_RIGHT__;
          if (sr) {
            if (typeof sr.isExpanded === "function" && !sr.isExpanded()) {
              if (typeof sr.toggleExpanded === "function") sr.toggleExpanded();
            }
            if (typeof sr.openTab === "function") {
              sr.openTab("geminapi-quotas");
              return;
            }
            if (typeof sr.openTabIn === "function") {
              const sid = props.sessionId || sr.mounted?.getSnapshot?.();
              if (sid) {
                sr.openTabIn(sid, "geminapi-quotas");
                return;
              }
            }
          }
        } catch (e) {
          console.warn("Could not open tab directly via sidebarRight:", e);
        }

        // DOM fallback click on right sidebar tab if already present
        try {
          const tabButton = document.querySelector('[data-sidebar-right-tab="geminapi-quotas"]');
          if (tabButton) tabButton.click();
        } catch {}
      };

      const g5h = telemetry.gemini.fiveHours.fraction !== null ? Math.round(telemetry.gemini.fiveHours.fraction * 100) : null;
      const c55_5h = telemetry.claude55.fiveHours.fraction !== null ? Math.round(telemetry.claude55.fiveHours.fraction * 100) : null;
      const c46_5h = telemetry.claude46.fiveHours.fraction !== null ? Math.round(telemetry.claude46.fiveHours.fraction * 100) : null;
      const cAll_5h = telemetry.claudeAll.fiveHours.fraction !== null ? Math.round(telemetry.claudeAll.fiveHours.fraction * 100) : null;

      // Status dot color based on lowest available limit
      const fractions = [
        telemetry.gemini.fiveHours.fraction,
        telemetry.gemini.weekly.fraction,
        telemetry.argon.fiveHours.fraction,
        telemetry.argon.weekly.fraction,
        telemetry.claude55.fiveHours.fraction,
        telemetry.claude55.weekly.fraction,
        telemetry.claude46.fiveHours.fraction,
        telemetry.claude46.weekly.fraction,
        telemetry.claudeAll.fiveHours.fraction,
        telemetry.claudeAll.weekly.fraction
      ].filter(f => typeof f === "number");

      const minFrac = fractions.length > 0 ? Math.min(...fractions) : null;
      const dotColor = store.error ? THEME.red : getFractionColor(minFrac);

      let badgeLabel = "GeminApi";
      if (store.loading && !store.lastUpdated) {
        badgeLabel = "Загрузка…";
      } else if (telemetry.claude55.totalAccounts > 0 && telemetry.claude46.totalAccounts > 0 && g5h !== null) {
        badgeLabel = `G: ${g5h}% · C5.5: ${c55_5h !== null ? `${c55_5h}%` : "—"} · C4.6: ${c46_5h !== null ? `${c46_5h}%` : "—"}`;
      } else if (telemetry.claude55.totalAccounts > 0 && g5h !== null) {
        badgeLabel = `G: ${g5h}% · C5.5: ${c55_5h !== null ? `${c55_5h}%` : "—"}`;
      } else if (telemetry.claude46.totalAccounts > 0 && g5h !== null) {
        badgeLabel = `G: ${g5h}% · C4.6: ${c46_5h !== null ? `${c46_5h}%` : "—"}`;
      } else if (g5h !== null && cAll_5h !== null) {
        badgeLabel = `G: ${g5h}% · C: ${cAll_5h}%`;
      } else if (g5h !== null) {
        badgeLabel = `Gemini: ${g5h}%`;
      }

      return h("div", {
        ref: containerRef,
        style: {
          position: "relative",
          display: "inline-flex",
          alignItems: "center"
        }
      },
        // Trigger Button
        h("button", {
          onClick: () => setIsOpen(!isOpen),
          "aria-haspopup": "dialog",
          "aria-expanded": isOpen,
          title: "Квоты и лимиты GeminApi (нажмите для подробностей)",
          style: {
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "3px 8px",
            fontSize: "12px",
            fontWeight: 600,
            borderRadius: "6px",
            border: `1px solid ${THEME.line}`,
            backgroundColor: THEME.bgPanel,
            color: THEME.ink,
            cursor: "pointer",
            outline: "none"
          }
        },
          h("span", {
            style: {
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              backgroundColor: dotColor
            }
          }),
          h("span", {
            style: {
              fontVariantNumeric: "tabular-nums",
              color: THEME.ink
            }
          }, badgeLabel)
        ),

        // Popover Dialog
        isOpen ? h("div", {
          role: "dialog",
          "aria-label": "Сводка лимитов GeminApi",
          style: {
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: "330px",
            zIndex: 9999,
            backgroundColor: THEME.bgBase,
            border: `1px solid ${THEME.line}`,
            borderRadius: "8px",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.6)",
            padding: "12px",
            color: THEME.ink,
            fontSize: "12px"
          }
        },
          // Header
          h("div", {
            style: {
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "10px",
              paddingBottom: "6px",
              borderBottom: `1px solid ${THEME.line}`
            }
          },
            h("div", { style: { display: "flex", alignItems: "center", gap: "6px" } },
              h("span", { style: { fontWeight: 700, color: THEME.ink } }, "Лимиты GeminApi"),
              h("span", { style: { fontSize: "11px", color: THEME.inkMuted } },
                `(${telemetry.activeAccounts}/${telemetry.totalAccounts} акк.)`
              )
            ),
            h("button", {
              onClick: () => setIsOpen(false),
              style: {
                background: "none",
                border: "none",
                color: THEME.inkMuted,
                cursor: "pointer",
                fontSize: "14px"
              }
            }, "✕")
          ),

          // Google Gemini section
          h("div", { style: { marginBottom: "10px" } },
            h("div", { style: { fontWeight: 700, fontSize: "12px", color: THEME.brand, marginBottom: "4px" } }, "Google Gemini"),
            h(LimitGauge, {
              title: "⏱ 5 часов",
              fraction: telemetry.gemini.fiveHours.fraction,
              resetAt: telemetry.gemini.fiveHours.resetAt,
              height: 5
            }),
            h(LimitGauge, {
              title: "📅 Недельный",
              fraction: telemetry.gemini.weekly.fraction,
              resetAt: telemetry.gemini.weekly.resetAt,
              height: 5
            })
          ),

          // Gemini 4 Argon section
          telemetry.argon.totalAccounts > 0 ? h("div", { style: { marginBottom: "10px" } },
            h("div", {
              style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "4px"
              }
            },
              h("span", { style: { fontWeight: 700, fontSize: "12px", color: THEME.badgeArgonInk } }, "Gemini 4 Argon"),
              h("span", {
                style: {
                  fontSize: "10px",
                  fontWeight: 600,
                  padding: "1px 5px",
                  borderRadius: "3px",
                  color: THEME.badgeArgonInk,
                  backgroundColor: THEME.badgeArgonBg,
                  border: `1px solid ${THEME.badgeArgonLine}`
                }
              }, `${telemetry.argon.activeAccounts} акк.`)
            ),
            telemetry.argon.fiveHours.fraction !== null ? h(LimitGauge, {
              title: "⏱ 5 часов",
              fraction: telemetry.argon.fiveHours.fraction,
              resetAt: telemetry.argon.fiveHours.resetAt,
              height: 5
            }) : null,
            h(LimitGauge, {
              title: "📅 Недельный",
              fraction: telemetry.argon.weekly.fraction,
              resetAt: telemetry.argon.weekly.resetAt,
              height: 5
            })
          ) : null,

          // Claude 5.5 section
          telemetry.claude55.totalAccounts > 0 ? h("div", { style: { marginBottom: "10px" } },
            h("div", {
              style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "4px"
              }
            },
              h("span", { style: { fontWeight: 700, fontSize: "12px", color: THEME.badgeClaude55Ink } }, "Claude 5.5 Models"),
              h("span", {
                style: {
                  fontSize: "10px",
                  fontWeight: 600,
                  padding: "1px 5px",
                  borderRadius: "3px",
                  color: THEME.badgeClaude55Ink,
                  backgroundColor: THEME.badgeClaude55Bg,
                  border: `1px solid ${THEME.badgeClaude55Line}`
                }
              }, `${telemetry.claude55.activeAccounts} акк.`)
            ),
            h(LimitGauge, {
              title: "⏱ 5 часов",
              fraction: telemetry.claude55.fiveHours.fraction,
              resetAt: telemetry.claude55.fiveHours.resetAt,
              height: 5
            }),
            h(LimitGauge, {
              title: "📅 Недельный",
              fraction: telemetry.claude55.weekly.fraction,
              resetAt: telemetry.claude55.weekly.resetAt,
              height: 5
            })
          ) : null,

          // Claude 4.6 section
          telemetry.claude46.totalAccounts > 0 ? h("div", { style: { marginBottom: "10px" } },
            h("div", {
              style: {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "4px"
              }
            },
              h("span", { style: { fontWeight: 700, fontSize: "12px", color: THEME.badgeClaude46Ink } }, "Claude 4.6 Models"),
              h("span", {
                style: {
                  fontSize: "10px",
                  fontWeight: 600,
                  padding: "1px 5px",
                  borderRadius: "3px",
                  color: THEME.badgeClaude46Ink,
                  backgroundColor: THEME.badgeClaude46Bg,
                  border: `1px solid ${THEME.badgeClaude46Line}`
                }
              }, `${telemetry.claude46.activeAccounts} акк.`)
            ),
            h(LimitGauge, {
              title: "⏱ 5 часов",
              fraction: telemetry.claude46.fiveHours.fraction,
              resetAt: telemetry.claude46.fiveHours.resetAt,
              height: 5
            }),
            h(LimitGauge, {
              title: "📅 Недельный",
              fraction: telemetry.claude46.weekly.fraction,
              resetAt: telemetry.claude46.weekly.resetAt,
              height: 5
            })
          ) : null,

          // Fallback generic Claude if neither 5.5 nor 4.6
          telemetry.claude55.totalAccounts === 0 && telemetry.claude46.totalAccounts === 0 && telemetry.claudeAll.totalAccounts > 0 ? h("div", { style: { marginBottom: "10px" } },
            h("div", { style: { fontWeight: 700, fontSize: "12px", color: THEME.badgeClaudeInk, marginBottom: "4px" } }, "Claude & 3P (GPT)"),
            h(LimitGauge, {
              title: "⏱ 5 часов",
              fraction: telemetry.claudeAll.fiveHours.fraction,
              resetAt: telemetry.claudeAll.fiveHours.resetAt,
              height: 5
            }),
            h(LimitGauge, {
              title: "📅 Недельный",
              fraction: telemetry.claudeAll.weekly.fraction,
              resetAt: telemetry.claudeAll.weekly.resetAt,
              height: 5
            })
          ) : null,

          // Action buttons
          h("div", {
            style: {
              display: "flex",
              gap: "6px",
              paddingTop: "6px",
              borderTop: `1px solid ${THEME.line}`
            }
          },
            h("button", {
              onClick: () => refreshQuotasRemote(),
              disabled: store.refreshing,
              style: {
                flex: 1,
                padding: "6px",
                fontSize: "11px",
                fontWeight: 600,
                borderRadius: "4px",
                border: `1px solid ${THEME.line}`,
                backgroundColor: THEME.bgPanel,
                color: THEME.ink,
                cursor: "pointer"
              }
            }, store.refreshing ? "Синхронизация…" : "🔄 Обновить"),
            h("button", {
              onClick: handleOpenSidebar,
              style: {
                flex: 1.2,
                padding: "6px",
                fontSize: "11px",
                fontWeight: 600,
                borderRadius: "4px",
                border: "none",
                backgroundColor: THEME.brand,
                color: "#0b1833",
                cursor: "pointer"
              }
            }, "В боковую панель →")
          )
        ) : null
      );
    }

    // ─────────────────────────────────────────────────────────────
    // Cordis Client Plugin Definition (Dual Static/Dynamic Parity)
    // ─────────────────────────────────────────────────────────────
    const inject = [
      "slots",
      "sidebarRightTabs",
      "sidebarRight"
    ];

    function apply(ctx) {
      // 1. Capture sidebarRight instance for opening tabs
      try {
        if (ctx.sidebarRight) {
          window.__DSH_SIDEBAR_RIGHT__ = ctx.sidebarRight;
        }
      } catch (err) {
        console.warn("capture sidebarRight:", err);
      }

      // 2. Register tab type in sidebarRightTabs (idempotent & safe against HMR re-sync)
      if (ctx.sidebarRightTabs && typeof ctx.sidebarRightTabs.register === "function") {
        try {
          const alreadyRegistered = ctx.sidebarRightTabs.ids && ctx.sidebarRightTabs.ids.has("geminapi-quotas");
          if (!alreadyRegistered) {
            ctx.sidebarRightTabs.register({
              id: "geminapi-quotas",
              kind: "geminapi-quotas",
              title: () => "Лимиты GeminApi",
              guide: [{
                id: "geminapi-quotas",
                order: 15,
                title: () => "Лимиты GeminApi",
                description: () => "Квоты моделей Google Gemini и Claude (5 часов и Недельный)",
                icon: primitives.IconGaugeOutlineRegular || primitives.IconApiOutlineRegular
              }]
            });
          }
        } catch (err) {
          // If already registered during session sync, ignore gracefully
          if (!String(err?.message || err).includes("already registered")) {
            console.warn("sidebarRightTabs.register:", err);
          }
        }
      }

      // 3. Register Slots (Tab Body, Tab Title, Header Utility)
      if (ctx.slots) {
        // Tab Body
        try {
          ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
            name: "sidebar.right.pane.tab",
            key: "geminapi-quotas"
          }, QuotasSidebarTab));
        } catch (err) {
          console.warn("slots.inject sidebar.right.pane.tab:", err);
        }

        // Tab Title
        try {
          ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
            name: "sidebar.right.pane.tab.title",
            key: "geminapi-quotas"
          }, QuotasSidebarTitle));
        } catch (err) {
          console.warn("slots.inject sidebar.right.pane.tab.title:", err);
        }

        // Header Utility Indicator
        try {
          ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
            name: "conversation.session.header.utilities",
            id: "geminapi-quotas-indicator",
            order: -10,
            label: () => "Лимиты"
          }, QuotasHeaderIndicator));
        } catch (err) {
          console.warn("slots.inject conversation.session.header.utilities:", err);
        }
      }
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
