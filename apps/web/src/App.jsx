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
  LockKey,
  MagnifyingGlass,
  Moon,
  Paperclip,
  ShieldCheck,
  Sparkle,
  Sun,
  TerminalWindow,
  UploadSimple,
  WarningCircle,
  XCircle,
} from "@phosphor-icons/react";

import {
  ACCEPTED_ATTACHMENT_TYPES,
  UPLOAD_CAPABILITY_STORAGE_KEY,
  consumeUploadCapability,
  uploadAttachmentFile,
  validateAttachmentFiles,
} from "./attachment-client.js";

import {
  BETA_INVITE_STORAGE_KEY,
  betaApplyRedirect,
  betaJoinRedirect,
  createBetaInvite,
  decideOAuthAuthorization,
  getSupabaseClient,
  loadCreatorReports,
  loadBetaApplications,
  loadOAuthAuthorization,
  redeemBetaInvite,
  saveCreatorReportStatus,
  submitBetaApplication,
  approveBetaApplication,
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

function attachmentSize(sizeBytes) {
  const units = ["B", "KB", "MB", "GB"];
  let size = sizeBytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${Number.isInteger(size) || size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function AccessHeader({ icon: Icon, eyebrow, title, description }) {
  return (
    <header className="access-header">
      <span className="brand-mark" aria-hidden="true"><Icon size={23} weight="fill" /></span>
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}

function AccessScreen({ client }) {
  const [message, setMessage] = useState(null);
  const [redirecting, setRedirecting] = useState(false);

  const beginGithubSignIn = async () => {
    if (redirecting) return;
    setRedirecting(true);
    setMessage(null);
    const { error } = await client.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).href,
      },
    });
    if (error) {
      setRedirecting(false);
      setMessage({ tone: "error", text: "GitHub sign-in could not be started." });
    }
  };

  return (
    <main className="access-shell auth-shell">
      <section className="access-card auth-card">
        <AccessHeader
          icon={Lightning}
          eyebrow="Creator dashboard"
          title="Creator sign in"
          description="Use GitHub to continue to the creator dashboard."
        />
        <button className="primary-button" type="button" disabled={redirecting} onClick={beginGithubSignIn}>
          {redirecting ? <CircleNotch className="is-spinning" size={17} /> : <GithubLogo size={17} weight="fill" />}
          <span>{redirecting ? "Opening GitHub…" : "Continue with GitHub"}</span>
        </button>
        <p className="field-help">Only approved creator accounts can open the dashboard.</p>
        {message && (
          <p className={`access-message ${message.tone}`} role={message.tone === "error" ? "alert" : "status"}>
            {message.tone === "error" ? <WarningCircle size={17} /> : <CheckCircle size={17} />}
            <span>{message.text}</span>
          </p>
        )}
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
    const pendingInvite = window.sessionStorage.getItem(BETA_INVITE_STORAGE_KEY);
    if (!hasOAuthCallback && !(pendingInvite && session)) return;

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
    return (
      <FullPageState
        enhanced
        busy
        eyebrow="Project Builder beta"
        title={state === "redeeming" ? "Activating beta access…" : "Checking access…"}
        detail="Keep this tab open while we verify your GitHub account."
      />
    );
  }
  if (state === "success") {
    return (
      <FullPageState
        enhanced
        icon={CheckCircle}
        tone="success"
        eyebrow="Project Builder beta"
        title="Beta access activated"
        detail="Your GitHub identity is enrolled. You can close this tab and return to your MCP client."
      />
    );
  }
  if (state === "failure") {
    return (
      <FullPageState
        enhanced
        icon={WarningCircle}
        tone="error"
        eyebrow="Project Builder beta"
        title="Invitation could not be redeemed"
        detail="The invitation may be invalid, expired, or already used. Ask the creator for a new one."
        action={<button type="button" onClick={() => setState("form")}>Try another invitation</button>}
      />
    );
  }

  return (
    <main className="access-shell auth-shell">
      <section className="access-card auth-card">
        <AccessHeader
          icon={GithubLogo}
          eyebrow="Project Builder beta"
          title="Join the Project Builder beta"
          description="Enter your invitation, continue to GitHub, and you'll return here automatically."
        />
        <form onSubmit={beginGithubSignIn}>
          <label htmlFor="beta-invite-code">Beta invitation code</label>
          <input
            id="beta-invite-code"
            type="text"
            required
            autoComplete="off"
            spellCheck="false"
            aria-describedby="beta-invite-help"
            pattern="pb_inv_[A-Za-z0-9_-]{43}"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <span className="field-help" id="beta-invite-help">Use the one-time invitation sent by the creator.</span>
          <button className="primary-button" type="submit" disabled={state === "redirecting"}>
            {state === "redirecting" ? <CircleNotch className="is-spinning" size={17} /> : <GithubLogo size={17} weight="fill" />}
            <span>{state === "redirecting" ? "Opening GitHub…" : "Continue with GitHub"}</span>
          </button>
        </form>
        {message && <p className="access-message" role="alert">{message}</p>}
      </section>
    </main>
  );
}

function OAuthConsentScreen({ client, session, sessionLoading }) {
  const [authorization, setAuthorization] = useState(null);
  const [state, setState] = useState("loading");
  const [message, setMessage] = useState("");
  const authorizationId = new URLSearchParams(window.location.search).get("authorization_id");

  useEffect(() => {
    if (sessionLoading) return;
    if (!session) {
      setState("sign-in");
      return;
    }
    if (!authorizationId) {
      setState("error");
      return;
    }

    let active = true;
    setState("loading");
    const loadAuthorization = async () => {
      const { data: { user }, error } = await client.auth.getUser();
      if (!active) return;
      if (error || !user) {
        await client.auth.signOut({ scope: "local" });
        if (active) setState("sign-in");
        return;
      }

      try {
        const details = await loadOAuthAuthorization(client, authorizationId);
        if (!active) return;
        if ("redirect_url" in details) {
          window.location.assign(details.redirect_url);
          return;
        }
        setAuthorization(details);
        setState("ready");
      } catch {
        if (active) setState("error");
      }
    };
    loadAuthorization();
    return () => {
      active = false;
    };
  }, [authorizationId, client, session, sessionLoading]);

  const beginGithubSignIn = async () => {
    setMessage("");
    setState("redirecting");
    const { error } = await client.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: window.location.href },
    });
    if (error) {
      setState("sign-in");
      setMessage("GitHub sign-in could not be started.");
    }
  };

  const decide = async (decision) => {
    setMessage("");
    setState("redirecting");
    try {
      const redirectUrl = await decideOAuthAuthorization(client, authorizationId, decision);
      window.location.assign(redirectUrl);
    } catch {
      setState("ready");
      setMessage("Authorization could not be completed.");
    }
  };

  if (sessionLoading || state === "loading") {
    return (
      <FullPageState
        enhanced
        busy
        eyebrow="Project Builder MCP"
        title="Checking authorization…"
        detail="Keep this tab open while we confirm the connection request."
      />
    );
  }
  if (state === "error") {
    return (
      <FullPageState
        enhanced
        icon={WarningCircle}
        tone="error"
        eyebrow="Project Builder MCP"
        title="Authorization request is invalid"
        detail="This request may have expired or already been used. Return to your MCP client and start the connection again."
      />
    );
  }
  if (!session || state === "sign-in") {
    return (
      <main className="access-shell auth-shell">
        <section className="access-card auth-card">
          <AccessHeader
            icon={TerminalWindow}
            eyebrow="Project Builder MCP"
            title="Connect your MCP client"
            description="Sign in with the GitHub account enrolled in the Project Builder beta."
          />
          <div className="access-note"><LockKey size={18} /><span>GitHub confirms your identity; your password is never shared with Project Builder.</span></div>
          <button className="primary-button full-width" type="button" disabled={state === "redirecting"} onClick={beginGithubSignIn}>
            {state === "redirecting" ? <CircleNotch className="is-spinning" size={17} /> : <GithubLogo size={17} weight="fill" />}
            <span>{state === "redirecting" ? "Opening GitHub…" : "Continue with GitHub"}</span>
          </button>
          {message && <p className="access-message" role="alert">{message}</p>}
        </section>
      </main>
    );
  }

  const scopes = authorization.scope.split(/\s+/).filter(Boolean);
  return (
    <main className="access-shell auth-shell">
      <section className="access-card auth-card consent-card">
        <AccessHeader
          icon={ShieldCheck}
          eyebrow="Project Builder MCP"
          title={`Authorize ${authorization.client.name}`}
          description="Review what this MCP client can access before you continue."
        />
        <dl className="consent-details">
          <dt>Requested access</dt>
          <dd className="scope-list">{scopes.map((scope) => <span key={scope}>{scope}</span>)}</dd>
          <dt>Return address</dt>
          <dd><code>{authorization.redirect_uri}</code></dd>
        </dl>
        <div className="access-note"><ShieldCheck size={18} /><span>You can revoke this connection later from your MCP client.</span></div>
        <div className="access-actions">
          <button className="primary-button" type="button" disabled={state === "redirecting"} onClick={() => decide("approve")}>
            {state === "redirecting" ? <CircleNotch className="is-spinning" size={17} /> : <CheckCircle size={17} />}
            <span>{state === "redirecting" ? "Authorizing…" : "Allow access"}</span>
          </button>
          <button className="secondary-button" type="button" disabled={state === "redirecting"} onClick={() => decide("deny")}>Cancel</button>
        </div>
        {message && <p className="access-message" role="alert">{message}</p>}
      </section>
    </main>
  );
}

const UPLOAD_STATUS_LABELS = {
  ready: "Ready to upload",
  preparing: "Preparing secure upload…",
  uploading: "Uploading…",
  finalizing: "Securing attachment…",
  complete: "Attached",
  error: "Upload failed",
};

function AttachmentUploadScreen({ client }) {
  const [capability] = useState(() =>
    consumeUploadCapability({
      location: window.location,
      history: window.history,
      storage: window.sessionStorage,
    }),
  );
  const [entries, setEntries] = useState([]);
  const [selectionError, setSelectionError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [reportId, setReportId] = useState("");
  const [batchError, setBatchError] = useState("");

  const updateEntry = (id, status, message = UPLOAD_STATUS_LABELS[status]) => {
    setEntries((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, status, message } : entry)),
    );
  };

  const selectFiles = (event) => {
    const selection = validateAttachmentFiles(event.target.files);
    setEntries(selection.entries);
    setSelectionError(selection.selectionError);
    setBatchError("");
  };

  const uploadFiles = async () => {
    if (!capability || entries.length === 0 || entries.some((entry) => entry.status === "error")) {
      return;
    }

    setUploading(true);
    setBatchError("");
    let failed = false;
    let attachedReportId = "";
    for (const entry of entries) {
      try {
        attachedReportId = await uploadAttachmentFile(
          client,
          capability,
          entry.file,
          (status) => updateEntry(entry.id, status),
        );
      } catch {
        failed = true;
        updateEntry(entry.id, "error");
      }
    }
    setUploading(false);
    if (failed) {
      setBatchError("Some files couldn't be attached. Request a new upload link from your MCP client before retrying.");
      return;
    }

    window.sessionStorage.removeItem(UPLOAD_CAPABILITY_STORAGE_KEY);
    setReportId(attachedReportId);
  };

  if (!capability) {
    return (
      <FullPageState
        enhanced
        icon={WarningCircle}
        tone="error"
        eyebrow="Project Builder evidence"
        title="Upload link is unavailable"
        detail="Return to your MCP client and request a new attachment link."
      />
    );
  }

  if (reportId) {
    return (
      <FullPageState
        enhanced
        icon={CheckCircle}
        tone="success"
        eyebrow="Project Builder evidence"
        title="Evidence attached"
        detail={`Your files are securely attached to ${reportId}. You can close this tab and return to your MCP client.`}
      />
    );
  }

  const hasInvalidFiles = entries.some((entry) => entry.status === "error");
  const fileCount = entries.length;
  return (
    <main className="access-shell auth-shell">
      <section className="access-card auth-card upload-card">
        <AccessHeader
          icon={Paperclip}
          eyebrow="Project Builder evidence"
          title="Add evidence to your report"
          description="Attach screenshots or short recordings that make the issue easier to reproduce."
        />
        <div className="access-note"><LockKey size={18} /><span>This private link is temporary. Files are stored in a private report folder.</span></div>
        <label className="upload-picker" htmlFor="report-attachments">
          <UploadSimple size={24} />
          <strong>Images or videos</strong>
          <span>Choose up to 5 files</span>
        </label>
        <input
          className="visually-hidden"
          id="report-attachments"
          type="file"
          aria-label="Images or videos"
          multiple
          accept={ACCEPTED_ATTACHMENT_TYPES.join(",")}
          disabled={uploading}
          onChange={selectFiles}
        />
        <p className="upload-limits">Images up to 10 MiB · Videos up to 50 MiB</p>
        {selectionError && <p className="access-message error" role="alert"><WarningCircle size={17} /><span>{selectionError}</span></p>}
        {entries.length > 0 && (
          <ul className="upload-list" aria-label="Selected files">
            {entries.map((entry) => (
              <li className={entry.status === "error" ? "error" : ""} key={entry.id}>
                <Paperclip size={17} aria-hidden="true" />
                <span><strong>{entry.file.name}</strong><small aria-live="polite">{entry.message}</small></span>
                {entry.status === "complete" ? <CheckCircle size={18} weight="fill" /> : entry.status === "error" ? <WarningCircle size={18} weight="fill" /> : null}
              </li>
            ))}
          </ul>
        )}
        {batchError && <p className="access-message error" role="alert"><WarningCircle size={17} /><span>{batchError}</span></p>}
        <button
          className="primary-button full-width upload-submit"
          type="button"
          disabled={uploading || fileCount === 0 || hasInvalidFiles}
          onClick={uploadFiles}
        >
          {uploading ? <CircleNotch className="is-spinning" size={17} /> : <UploadSimple size={17} />}
          <span>{uploading ? "Uploading files…" : `Upload ${fileCount} ${fileCount === 1 ? "file" : "files"}`}</span>
        </button>
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

function BetaApplicationsControl({ client }) {
  const [applications, setApplications] = useState([]);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState("idle");
  const [approvingId, setApprovingId] = useState(null);
  const load = async () => {
    setOpen(true);
    setState("loading");
    try {
      setApplications(await loadBetaApplications(client));
      setState("ready");
    } catch {
      setState("error");
    }
  };
  const approve = async (id) => {
    setApprovingId(id);
    try {
      await approveBetaApplication(client, id);
      setApplications((current) => current.map((item) => item.id === id ? { ...item, status: "approved" } : item));
    } catch {
      setApplications((current) => current.map((item) => item.id === id ? { ...item, approvalError: true } : item));
    } finally {
      setApprovingId(null);
    }
  };
  const pending = applications.filter((item) => item.status === "pending");
  return <section className="beta-control" aria-label="Beta applications">
    <button className="secondary-button" type="button" onClick={load}>Review applications</button>
    {open && <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !approvingId) setOpen(false); }}>
      <section className="applications-dialog" role="dialog" aria-modal="true" aria-labelledby="applications-title">
        <header className="applications-dialog-header">
          <div><span className="eyebrow">Beta program</span><h2 id="applications-title">Beta applications</h2><p>{pending.length} pending {pending.length === 1 ? "application" : "applications"}</p></div>
          <button className="icon-button" type="button" aria-label="Close beta applications" onClick={() => setOpen(false)}><XCircle size={20} /></button>
        </header>
        <div className="applications-list">
          {state === "loading" && <p className="applications-empty">Loading applications…</p>}
          {state === "error" && <div className="applications-empty" role="alert"><strong>Applications could not be loaded.</strong><button className="secondary-button" type="button" onClick={load}>Try again</button></div>}
          {state === "ready" && applications.length === 0 && <p className="applications-empty">No beta applications yet.</p>}
          {state === "ready" && applications.map((item) => <article className="application-row" key={item.id}>
            <div className="application-copy"><strong>{item.email}</strong><span>Applied <time dateTime={item.created_at}>{new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(item.created_at))}</time></span></div>
            <div className="application-action">
              {item.status === "approved" ? <span className="application-approved"><CheckCircle size={16} weight="fill" />Approved · Email sent</span> : <><span className="application-status">Pending review</span><button className="primary-button" type="button" disabled={approvingId === item.id} aria-label={`Approve ${item.email}`} onClick={() => approve(item.id)}>{approvingId === item.id ? "Approving…" : "Approve"}</button>{item.approvalError && <span className="application-error" role="alert">Approval failed. Try again.</span>}</>}
            </div>
          </article>)}
        </div>
      </section>
    </div>}
  </section>;
}

function FullPageState({ title, detail, action, icon: Icon = CircleNotch, tone = "neutral", busy = false, eyebrow, enhanced = false }) {
  return (
    <main className={`access-shell${enhanced ? " auth-shell" : ""}`}>
      <section
        className={`access-card state-card ${tone}${enhanced ? " auth-card" : ""}`}
        role={enhanced ? (tone === "error" ? "alert" : "status") : undefined}
        aria-live={enhanced ? "polite" : undefined}
      >
        <Icon className={busy ? "is-spinning" : ""} size={30} weight={tone === "neutral" ? "regular" : "fill"} aria-hidden="true" />
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {detail && <p>{detail}</p>}
        {action}
      </section>
    </main>
  );
}

function BetaApplicationScreen({ client, session, sessionLoading }) {
  const [state, setState] = useState("idle");
  const [email, setEmail] = useState(session?.user?.email ?? "");
  const signIn = () => client.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo: betaApplyRedirect() },
  });
  const apply = async () => {
    setState("submitting");
    try {
      await submitBetaApplication(client, email);
      setState("submitted");
    } catch {
      setState("error");
    }
  };
  if (sessionLoading) return <FullPageState title="Checking GitHub access…" />;
  if (state === "submitted") return <FullPageState eyebrow="Project Builder beta" title="Application received" detail="We will review your application and email you when MCP access is ready." icon={CheckCircle} tone="success" enhanced />;
  return <FullPageState eyebrow="Project Builder beta" title="Apply to become a beta tester" detail="Use the GitHub account you plan to connect to the feedback MCP. Applications are reviewed manually." enhanced action={session ? <form onSubmit={(event) => { event.preventDefault(); apply(); }}><label htmlFor="beta-email">Approval email</label><input id="beta-email" type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} /><button className="primary-button" type="submit" disabled={state === "submitting"}>{state === "submitting" ? "Submitting…" : "Join the review list"}</button></form> : <button className="primary-button" type="button" onClick={signIn}><GithubLogo size={18} />Continue with GitHub</button>} tone={state === "error" ? "error" : "neutral"} />;
}

export function App({ client = getSupabaseClient() }) {
  const mode = new URLSearchParams(window.location.search).get("mode");
  const joinMode = mode === "join";
  const applyMode = mode === "apply";
  const uploadMode = mode === "upload";
  const consentMode = window.location.pathname.endsWith("/oauth/consent/");
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
  const [mobilePane, setMobilePane] = useState("queue");
  const searchRef = useRef(null);

  useEffect(() => {
    const focusSearch = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

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
    if (!session || joinMode || applyMode || uploadMode || consentMode) return;
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
  }, [applyMode, client, consentMode, joinMode, session, uploadMode]);

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
  const selected = visibleReports.find((report) => report.reportId === selectedId) ?? visibleReports[0] ?? null;

  if (joinMode) {
    return <BetaJoinScreen client={client} session={session} sessionLoading={sessionLoading} />;
  }
  if (applyMode) {
    return <BetaApplicationScreen client={client} session={session} sessionLoading={sessionLoading} />;
  }
  if (uploadMode) {
    return <AttachmentUploadScreen client={client} />;
  }
  if (consentMode) {
    return <OAuthConsentScreen client={client} session={session} sessionLoading={sessionLoading} />;
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
    return <FullPageState title="No feedback reports yet" detail="New beta reports will appear here." action={<><BetaApplicationsControl client={client} /><BetaInviteControl client={client} /><button type="button" onClick={() => client.auth.signOut()}>Sign out</button></>} />;
  }

  const selectFilter = (status) => {
    setFilter(status);
    setQuery("");
    setMobilePane("queue");
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
          <input ref={searchRef} value={query} onChange={(event) => { setQuery(event.target.value); setMobilePane("queue"); }} placeholder="Search feedback, testers, versions…" />
          <kbd>{navigator.platform?.includes("Mac") ? "⌘" : "Ctrl"} K</kbd>
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

      <main className={`workspace show-${mobilePane}`} id="top">
        <aside className="queue-panel">
          <div className="queue-title"><div><span className="eyebrow">Beta program</span><h1>Feedback queue</h1></div><div><BetaApplicationsControl client={client} /><BetaInviteControl client={client} /></div></div>
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
              <button type="button" className={`report-row ${selected?.reportId === report.reportId ? "selected" : ""}`} key={report.reportId} onClick={() => { setSelectedId(report.reportId); setMobilePane("detail"); }} aria-label={`${report.title}, ${report.severity} severity`}>
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

        {selected ? <article className="report-detail">
          <div className="detail-topline"><button className="back-button" type="button" onClick={() => setMobilePane("queue")}><ArrowLeft size={15} /> Back to queue</button></div>
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
            {selected.attachments.length === 0 ? (
              <div className="not-provided-panel">No evidence was submitted with this report.</div>
            ) : (
              <div className="attachment-grid">
                {selected.attachments.map((attachment) => (
                  <article className="attachment-card" key={attachment.id}>
                    {attachment.contentType.startsWith("image/") ? (
                      <a
                        className="attachment-preview"
                        href={attachment.signedUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Preview ${attachment.fileName}`}
                      >
                        <img src={attachment.signedUrl} alt={attachment.fileName} loading="lazy" />
                      </a>
                    ) : (
                      <video
                        className="attachment-preview"
                        src={attachment.signedUrl}
                        controls
                        preload="metadata"
                        aria-label={`Video: ${attachment.fileName}`}
                      />
                    )}
                    <footer>
                      <div><strong>{attachment.fileName}</strong><span>{attachmentSize(attachment.sizeBytes)}</span></div>
                      <a
                        href={attachment.signedUrl}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Open ${attachment.fileName}`}
                      ><Paperclip size={14} />Open</a>
                    </footer>
                  </article>
                ))}
              </div>
            )}
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
        </article> : <section className="detail-empty" aria-live="polite">
          <span className="detail-empty-icon"><MagnifyingGlass size={22} /></span>
          <h2>{query ? "No matching feedback" : `No reports in ${filter}`}</h2>
          <p>{query ? "Try a different search term or clear the search." : "Choose another status to keep reviewing the queue."}</p>
          {query && <button type="button" className="secondary-button" onClick={() => setQuery("")}>Clear search</button>}
        </section>}
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
