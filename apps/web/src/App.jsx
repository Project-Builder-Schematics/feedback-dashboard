import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bug,
  CaretDown,
  Check,
  CheckCircle,
  CircleNotch,
  Database,
  GithubLogo,
  Hammer,
  Lightning,
  MagnifyingGlass,
  Moon,
  Sparkle,
  Sun,
  TerminalWindow,
  XCircle,
} from "@phosphor-icons/react";

import {
  BETA_INVITE_STORAGE_KEY,
  betaJoinRedirect,
  createBetaInvite,
  getSupabaseClient,
  loadCreatorReports,
  magicLinkRedirect,
  redeemBetaInvite,
  saveCreatorReportStatus,
} from "./creator-client.js";

const STATUS_ORDER = ["Pending", "Validating", "In construction", "Resolved", "Discarded"];
const STATUS_META = {
  Pending: { className: "pending", icon: CircleNotch },
  Validating: { className: "validating", icon: MagnifyingGlass },
  "In construction": { className: "building", icon: Hammer },
  Resolved: { className: "resolved", icon: CheckCircle },
  Discarded: { className: "discarded", icon: XCircle },
};

function StatusIcon({ status, size = 16 }) {
  const Icon = STATUS_META[status].icon;
  return <Icon size={size} weight="bold" />;
}

function Platform({ name }) {
  return <span className="platform"><TerminalWindow size={14} weight="fill" />{name}</span>;
}

function AccessScreen({ client }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1_000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const submit = async (event) => {
    event.preventDefault();
    if (sending || cooldown > 0) return;
    setSending(true);
    setMessage("");
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: magicLinkRedirect(import.meta.env.BASE_URL, window.location.origin),
      },
    });
    setSending(false);
    setCooldown(60);
    setMessage(
      error
        ? "We couldn't send a sign-in link. Try again later."
        : "Check your email for a sign-in link if it has access.",
    );
  };

  return (
    <main className="access-shell">
      <section className="access-card">
        <span className="brand-mark"><Lightning size={23} weight="fill" /></span>
        <span className="eyebrow">Project Builder</span>
        <h1>Creator feedback access</h1>
        <p>Use the email address already provisioned for the creator dashboard.</p>
        <form onSubmit={submit}>
          <label htmlFor="creator-email">Creator email</label>
          <input
            id="creator-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <button type="submit" disabled={sending || cooldown > 0}>
            {sending ? "Sending…" : cooldown > 0 ? `Try again in ${cooldown}s` : "Send magic link"}
          </button>
        </form>
        {message && <p className="access-message" role="status">{message}</p>}
      </section>
    </main>
  );
}

function BetaJoinScreen({ client, session, sessionLoading }) {
  const [code, setCode] = useState("");
  const [state, setState] = useState("form");
  const [message, setMessage] = useState("");
  const redemptionStarted = useRef(false);

  useEffect(() => {
    if (sessionLoading || redemptionStarted.current) return;

    const callbackUrl = new URL(window.location.href);
    const callbackHash = new URLSearchParams(callbackUrl.hash.slice(1));
    const hasOAuthCallback = ["code", "error", "error_code", "error_description"].some(
      (parameter) => callbackUrl.searchParams.has(parameter) || callbackHash.has(parameter),
    );
    if (!hasOAuthCallback) return;

    const pendingInvite = window.sessionStorage.getItem(BETA_INVITE_STORAGE_KEY);
    window.sessionStorage.removeItem(BETA_INVITE_STORAGE_KEY);
    window.history.replaceState(
      window.history.state,
      "",
      `${callbackUrl.pathname}?mode=join`,
    );

    if (!pendingInvite) {
      setState("form");
      return;
    }
    if (!session) {
      setState("failure");
      return;
    }

    redemptionStarted.current = true;
    setState("redeeming");
    redeemBetaInvite(client, pendingInvite).then(
      () => setState("success"),
      () => setState("failure"),
    );
  }, [client, session, sessionLoading]);

  const beginGithubSignIn = async (event) => {
    event.preventDefault();
    const invite = code.trim();
    setMessage("");
    window.sessionStorage.setItem(BETA_INVITE_STORAGE_KEY, invite);
    setState("redirecting");
    const { error } = await client.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: betaJoinRedirect(),
      },
    });
    if (error) {
      window.sessionStorage.removeItem(BETA_INVITE_STORAGE_KEY);
      setState("form");
      setMessage("GitHub sign-in could not be started.");
    }
  };

  if (sessionLoading || state === "redeeming") {
    return <FullPageState title={state === "redeeming" ? "Activating beta access…" : "Checking access…"} />;
  }
  if (state === "success") {
    return (
      <FullPageState
        title="Beta access activated"
        detail="Your verified GitHub identity is now enrolled in the Project Builder beta."
      />
    );
  }
  if (state === "failure") {
    return (
      <FullPageState
        title="Invitation could not be redeemed"
        detail="Request a new invitation from the Project Builder creator."
      />
    );
  }

  return (
    <main className="access-shell">
      <section className="access-card">
        <span className="brand-mark"><GithubLogo size={23} weight="fill" /></span>
        <span className="eyebrow">Project Builder beta</span>
        <h1>Join with GitHub</h1>
        <p>Your invitation is verified only after GitHub confirms your identity.</p>
        <form onSubmit={beginGithubSignIn}>
          <label htmlFor="beta-invite-code">Beta invitation code</label>
          <input
            id="beta-invite-code"
            type="text"
            required
            autoComplete="off"
            pattern="pb_inv_[A-Za-z0-9_-]{43}"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button type="submit" disabled={state === "redirecting"}>
            {state === "redirecting" ? "Redirecting…" : "Continue with GitHub"}
          </button>
        </form>
        {message && <p className="access-message" role="alert">{message}</p>}
      </section>
    </main>
  );
}

function BetaInviteControl({ client }) {
  const [invite, setInvite] = useState(null);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState("");

  const createInvite = async () => {
    setCreating(true);
    setMessage("");
    try {
      setInvite(await createBetaInvite(client));
    } catch {
      setMessage("Invitation could not be created.");
    } finally {
      setCreating(false);
    }
  };

  const copyInvite = async () => {
    try {
      await window.navigator.clipboard.writeText(invite.code);
      setMessage("Invitation code copied.");
    } catch {
      setMessage("Invitation code could not be copied.");
    }
  };

  return (
    <section aria-label="Beta invitation">
      <button className="secondary-button" type="button" disabled={creating} onClick={createInvite}>
        {creating ? "Creating…" : invite ? "Create another beta invite" : "Create beta invite"}
      </button>
      {invite && (
        <div role="status">
          <code>{invite.code}</code>
          <p>Expires in 24 hours. This code is shown only in this session.</p>
          <button className="secondary-button" type="button" onClick={copyInvite}>
            Copy invitation code
          </button>
        </div>
      )}
      {message && <p className="access-message" role="status">{message}</p>}
    </section>
  );
}

function FullPageState({ title, detail, action }) {
  return (
    <main className="access-shell">
      <section className="access-card state-card">
        <CircleNotch size={26} />
        <h1>{title}</h1>
        {detail && <p>{detail}</p>}
        {action}
      </section>
    </main>
  );
}

export function App({ client = getSupabaseClient() }) {
  const joinMode = new URLSearchParams(window.location.search).get("mode") === "join";
  const [sessionLoading, setSessionLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [reports, setReports] = useState([]);
  const [reportsState, setReportsState] = useState("idle");
  const [selectedId, setSelectedId] = useState(null);
  const [filter, setFilter] = useState("Pending");
  const [query, setQuery] = useState("");
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardReason, setDiscardReason] = useState("");
  const [mutationError, setMutationError] = useState("");
  const [saving, setSaving] = useState(false);
  const [theme, setTheme] = useState("light");

  useEffect(() => {
    let active = true;
    client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      setSession(error ? null : data.session);
      setSessionLoading(false);
    });
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setSessionLoading(false);
      if (!nextSession) {
        setReports([]);
        setSelectedId(null);
        setReportsState("idle");
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  useEffect(() => {
    if (!session || joinMode) return;
    let active = true;
    setReportsState("loading");
    loadCreatorReports(client).then(
      (loadedReports) => {
        if (!active) return;
        setReports(loadedReports);
        setSelectedId(loadedReports[0]?.reportId ?? null);
        setFilter(loadedReports[0]?.status ?? "Pending");
        setReportsState(loadedReports.length > 0 ? "ready" : "empty");
      },
      () => {
        if (active) setReportsState("error");
      },
    );
    return () => {
      active = false;
    };
  }, [client, joinMode, session]);

  const selected = reports.find((report) => report.reportId === selectedId) ?? reports[0];
  const counts = useMemo(
    () =>
      Object.fromEntries(
        STATUS_ORDER.map((status) => [
          status,
          reports.filter((report) => report.status === status).length,
        ]),
      ),
    [reports],
  );
  const visibleReports = useMemo(
    () =>
      reports.filter((report) => {
        const needle = query.trim().toLowerCase();
        return (
          report.status === filter &&
          (!needle || `${report.title} ${report.tester} ${report.id}`.toLowerCase().includes(needle))
        );
      }),
    [filter, query, reports],
  );

  if (joinMode) {
    return <BetaJoinScreen client={client} session={session} sessionLoading={sessionLoading} />;
  }
  if (sessionLoading) return <FullPageState title="Checking creator access…" />;
  if (!session) return <AccessScreen client={client} />;
  if (reportsState === "loading" || reportsState === "idle") {
    return <FullPageState title="Loading feedback…" />;
  }
  if (reportsState === "error") {
    return <FullPageState title="Feedback could not be loaded." detail="Sign out and try again." action={<button type="button" onClick={() => client.auth.signOut()}>Sign out</button>} />;
  }
  if (reportsState === "empty") {
    return <FullPageState title="No feedback reports yet" detail="New beta reports will appear here." action={<><BetaInviteControl client={client} /><button type="button" onClick={() => client.auth.signOut()}>Sign out</button></>} />;
  }

  const selectFilter = (status) => {
    setFilter(status);
    setQuery("");
    const firstMatch = reports.find((report) => report.status === status);
    if (firstMatch) setSelectedId(firstMatch.reportId);
  };

  const applyStatus = async (status, reason) => {
    setSaving(true);
    setMutationError("");
    try {
      const updated = await saveCreatorReportStatus(client, {
        reportId: selected.reportId,
        status,
        ...(reason ? { discardReason: reason } : {}),
      });
      setReports((items) =>
        items.map((report) => (report.reportId === updated.reportId ? updated : report)),
      );
      setFilter(updated.status);
      setStatusMenuOpen(false);
      setDiscardOpen(false);
      setDiscardReason("");
    } catch {
      setMutationError("Status could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const chooseStatus = (status) => {
    if (status === "Discarded") {
      setDiscardOpen(true);
      setStatusMenuOpen(false);
      return;
    }
    applyStatus(status);
  };

  const creatorEmail = session.user?.email ?? "Creator";

  return (
    <div className="app-shell" data-theme={theme}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Project Builder feedback home">
          <span className="brand-mark"><Lightning size={23} weight="fill" /></span>
          <span>Project Builder</span><em>Feedback</em>
        </a>
        <label className="global-search">
          <MagnifyingGlass size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search feedback, testers, versions…" />
          <kbd>⌘ K</kbd>
        </label>
        <div className="topbar-actions">
          <span className="connection"><Database size={16} />Supabase <i></i></span>
          <span className="connection"><Lightning size={16} />MCP <i></i></span>
          <a className="icon-button" href="https://github.com/Project-Builder-Schematics" aria-label="Project Builder on GitHub"><GithubLogo size={18} /></a>
          <button className="icon-button" type="button" onClick={() => setTheme((value) => (value === "light" ? "dark" : "light"))} aria-label={`Use ${theme === "light" ? "dark" : "light"} theme`}>
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button className="sign-out-button" type="button" onClick={() => client.auth.signOut()} aria-label="Sign out">{creatorEmail}</button>
        </div>
      </header>

      <main className="workspace" id="top">
        <aside className="queue-panel">
          <div className="queue-title"><div><span className="eyebrow">Beta program</span><h1>Feedback queue</h1></div><BetaInviteControl client={client} /></div>
          <nav className="status-filters" aria-label="Feedback states">
            {STATUS_ORDER.map((status) => (
              <button type="button" key={status} className={filter === status ? "active" : ""} onClick={() => selectFilter(status)} aria-label={`${status} ${counts[status]} reports`}>
                <StatusIcon status={status} /><span>{status}</span><b>{counts[status]}</b>
              </button>
            ))}
          </nav>
          <div className="queue-summary"><span>{filter}</span><small>{visibleReports.length} report{visibleReports.length === 1 ? "" : "s"}</small></div>
          <div className="report-list" aria-label="Feedback queue">
            {visibleReports.map((report) => (
              <button type="button" className={`report-row ${selected.reportId === report.reportId ? "selected" : ""}`} key={report.reportId} onClick={() => setSelectedId(report.reportId)} aria-label={`${report.title}, ${report.severity} severity`}>
                <span className="report-row-top"><small>{report.id}</small><em className={`severity ${report.severity.toLowerCase()}`}>{report.severity}</em></span>
                <strong>{report.title}</strong>
                <span className="report-row-meta"><span>{report.tester} · {report.version}</span><time>{report.age}</time></span>
                <span className="report-row-meta"><Platform name={report.platform} /><span className="type"><span>{report.type === "Bug" ? <Bug size={13} /> : <Sparkle size={13} />}</span>{report.type}</span></span>
              </button>
            ))}
            {visibleReports.length === 0 && <div className="empty-state"><MagnifyingGlass size={24} /><strong>No matching feedback</strong><span>Try another status or search term.</span></div>}
          </div>
          <footer className="queue-footer"><span>Loaded from Supabase</span><span><i></i>MCP connected</span></footer>
        </aside>

        <article className="report-detail">
          <div className="detail-topline"><button className="back-button" type="button"><ArrowLeft size={15} /> Back to queue</button></div>
          <header className="report-header">
            <div className="report-heading">
              <h1>{selected.title}</h1>
              <div className="report-meta-grid">
                <div className="meta-item tester-meta"><span>Tester</span><strong><i className="tester-avatar">{selected.initials}</i>{selected.email}</strong></div>
                <div className="meta-item"><span>CLI version</span><strong>{selected.version}</strong></div>
                <div className="meta-item"><span>Platform</span><strong><Platform name={selected.platform} /></strong></div>
                <div className="meta-item"><span>Submitted</span><strong>{selected.submitted}</strong></div>
              </div>
            </div>
            <div className="report-actions">
              <div className="status-control">
                <button className={`status-button ${STATUS_META[selected.status].className}`} type="button" disabled={saving} onClick={() => setStatusMenuOpen((value) => !value)} aria-label={`Change status, current ${selected.status}`}>
                  <StatusIcon status={selected.status} />{saving ? "Saving…" : selected.status}<CaretDown size={14} />
                </button>
                {statusMenuOpen && (
                  <div className="status-menu" role="menu">
                    <span>Move report to</span>
                    {STATUS_ORDER.map((status) => (
                      <button key={status} type="button" role="menuitem" onClick={() => chooseStatus(status)} disabled={status === selected.status || saving}>
                        <StatusIcon status={status} /><span>{status}</span>{status === selected.status && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {mutationError && !discardOpen && <p className="mutation-error" role="alert">{mutationError}</p>}
            </div>
          </header>

          <div className="classification-row">
            <span className="report-id">{selected.id}</span>
            <span className="classification bug"><Bug size={15} />{selected.type}</span>
            <span className={`classification severity ${selected.severity.toLowerCase()}`}>{selected.severity} severity</span>
            <span className="classification received"><Lightning size={15} />Received via MCP</span>
          </div>
          <section className="incident-summary" aria-label="Incident summary">
            <div><span>Trigger</span><strong>{selected.trigger}</strong></div>
            <div><span>Failure</span><strong>{selected.failure}</strong></div>
            <div><span>Impact</span><strong>{selected.impact}</strong></div>
          </section>
          <section className="report-copy" aria-labelledby="problem-title">
            <div><h2 id="problem-title">Problem</h2><p>{selected.problem}</p></div>
            <aside><span>Expected behavior</span><p>{selected.expected}</p></aside>
          </section>
          {selected.discardReason && <p className="discard-reason"><strong>Discard reason:</strong> {selected.discardReason}</p>}
          <section className="steps-section" aria-labelledby="steps-title">
            <h2 id="steps-title">Steps to reproduce</h2>
            <ol>{selected.steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol>
          </section>
          <section className="evidence-section" aria-labelledby="evidence-title">
            <div className="section-heading"><div><h2 id="evidence-title">Evidence</h2><span className="section-hint">Attachments supplied by the tester</span></div></div>
            <div className="not-provided-panel">No evidence was submitted with this report.</div>
          </section>
          <div className="detail-lower">
            <section className="environment" aria-labelledby="environment-title">
              <div className="section-heading compact"><div><h2 id="environment-title">Environment</h2><span className="section-hint">Per-report environment details</span></div></div>
              <div className="not-provided-inline">Not provided</div>
            </section>
            <section className="activity" aria-labelledby="activity-title">
              <div className="section-heading compact"><div><h2 id="activity-title">Activity</h2><span className="section-hint">Durable report history</span></div></div>
              <div className="not-provided-inline">No durable activity is available yet.</div>
            </section>
          </div>
        </article>
      </main>

      {discardOpen && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setDiscardOpen(false); }}>
          <section className="discard-dialog" role="dialog" aria-modal="true" aria-labelledby="discard-title">
            <span className="dialog-icon"><XCircle size={22} weight="bold" /></span>
            <h2 id="discard-title">Discard report</h2>
            <p>Close this report without moving it into development. A reason is required.</p>
            <label htmlFor="discard-reason">Discard reason</label>
            <textarea id="discard-reason" maxLength={500} value={discardReason} onChange={(event) => setDiscardReason(event.target.value)} placeholder="Duplicate, cannot reproduce, out of scope…" autoFocus />
            {mutationError && <p className="mutation-error" role="alert">{mutationError}</p>}
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={saving} onClick={() => setDiscardOpen(false)}>Cancel</button>
              <button className="discard-button" type="button" disabled={!discardReason.trim() || saving} onClick={() => applyStatus("Discarded", discardReason.trim())}>{saving ? "Saving…" : "Discard report"}</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
