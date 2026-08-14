import { useMemo, useState } from "react";
import {
  AppleLogo,
  ArrowLeft,
  Bug,
  CaretDown,
  ChatCircleDots,
  Check,
  CheckCircle,
  CircleNotch,
  Copy,
  Database,
  DotsThree,
  FunnelSimple,
  GithubLogo,
  Hammer,
  ImageSquare,
  Lightning,
  LinuxLogo,
  MagnifyingGlass,
  Moon,
  Pause,
  Play,
  Sparkle,
  Sun,
  TerminalWindow,
  UserPlus,
  VideoCamera,
  WindowsLogo,
  XCircle,
} from "@phosphor-icons/react";

const STATUS_ORDER = ["Pending", "Validating", "In construction", "Resolved", "Discarded"];

const STATUS_META = {
  Pending: { className: "pending", icon: CircleNotch },
  Validating: { className: "validating", icon: MagnifyingGlass },
  "In construction": { className: "building", icon: Hammer },
  Resolved: { className: "resolved", icon: CheckCircle },
  Discarded: { className: "discarded", icon: XCircle },
};

const REPORTS = [
  {
    id: "PB-142",
    title: "Autocomplete freezes after malformed config",
    tester: "Alex K.",
    initials: "AK",
    email: "alex@beta.dev",
    status: "Pending",
    severity: "High",
    platform: "macOS",
    version: "v1.8.1",
    age: "10m",
    submitted: "Aug 14, 2026 at 09:42",
    type: "Bug",
    problem: "When config.toml contains an invalid table, typing any command and pressing Tab causes the CLI to hang. The UI stops updating and the process must be force quit.",
    expected: "Autocomplete should show suggestions or a parse error while the CLI remains responsive.",
    trigger: "Malformed config + Tab completion",
    failure: "Autocomplete deadlock",
    impact: "CLI becomes unresponsive",
    steps: ["Add an invalid table to ~/.project-builder/config.toml", "Run pb and start typing a command", "Press Tab to trigger autocomplete", "The CLI freezes"],
  },
  {
    id: "PB-141",
    title: "CLI hangs on init with WSL path",
    tester: "Charlie W.",
    initials: "CW",
    email: "charlie@beta.dev",
    status: "Validating",
    severity: "Medium",
    platform: "Windows",
    version: "v1.8.1",
    age: "48m",
    submitted: "Aug 14, 2026 at 09:04",
    type: "Bug",
    problem: "Running pb init from a mounted WSL workspace never completes after the destination path is confirmed.",
    expected: "The workspace should initialize normally on mounted Windows paths.",
    trigger: "Init from a mounted WSL path",
    failure: "Filesystem operation never returns",
    impact: "Workspace cannot be created",
    steps: ["Open Ubuntu in WSL", "Navigate to /mnt/c/projects/demo", "Run pb init", "Confirm the destination"],
  },
  {
    id: "PB-139",
    title: "Crash on plugin load: undefined symbol",
    tester: "Sarah J.",
    initials: "SJ",
    email: "sarah@company.test",
    status: "Pending",
    severity: "High",
    platform: "Linux",
    version: "v1.8.0",
    age: "2h",
    submitted: "Aug 14, 2026 at 07:38",
    type: "Bug",
    problem: "A locally linked plugin crashes Project Builder before the first command is rendered.",
    expected: "Invalid plugins should be isolated and reported without crashing the CLI.",
    trigger: "Load a locally linked plugin",
    failure: "Undefined native symbol",
    impact: "CLI exits during startup",
    steps: ["Link a local plugin", "Launch Project Builder", "Wait for plugin discovery"],
  },
  {
    id: "PB-136",
    title: "Progress bar renders incorrectly in non-interactive mode",
    tester: "Mike R.",
    initials: "MR",
    email: "mike@testers.dev",
    status: "In construction",
    severity: "Medium",
    platform: "macOS",
    version: "v1.8.1",
    age: "1d",
    submitted: "Aug 13, 2026 at 15:16",
    type: "Bug",
    problem: "Progress output leaves control characters in CI logs when the process is not attached to a TTY.",
    expected: "Non-interactive sessions should receive plain progress messages.",
    trigger: "Run without an interactive TTY",
    failure: "ANSI controls are not stripped",
    impact: "CI logs become unreadable",
    steps: ["Run a schematic in CI", "Pipe output to a log file", "Open the generated log"],
  },
  {
    id: "PB-131",
    title: "Help output shows raw markup",
    tester: "Jordan B.",
    initials: "JB",
    email: "jordan@beta.io",
    status: "Resolved",
    severity: "Low",
    platform: "Windows",
    version: "v1.8.0",
    age: "2d",
    submitted: "Aug 12, 2026 at 11:30",
    type: "Bug",
    problem: "The help command prints formatting tokens in Windows Terminal.",
    expected: "Help copy should render as plain readable text on every supported terminal.",
    trigger: "Open help in Windows Terminal",
    failure: "Markup is rendered as text",
    impact: "Help content is hard to scan",
    steps: ["Open Windows Terminal", "Run pb --help", "Inspect the option descriptions"],
  },
  {
    id: "PB-128",
    title: "Config schema docs are unclear",
    tester: "Sam T.",
    initials: "ST",
    email: "sam@preview.dev",
    status: "Discarded",
    severity: "Low",
    platform: "macOS",
    version: "v1.8.0",
    age: "3d",
    submitted: "Aug 11, 2026 at 14:12",
    type: "Improvement",
    problem: "The schema reference does not explain whether custom keys are preserved.",
    expected: "The documentation should clarify how unknown keys are handled.",
    trigger: "Review custom configuration keys",
    failure: "Preservation behavior is unclear",
    impact: "Users avoid safe customization",
    steps: ["Open the schema guide", "Search for custom keys"],
  },
  {
    id: "PB-125",
    title: "Config migration fails from v1.7.x",
    tester: "Noah P.",
    initials: "NP",
    email: "noah@beta.dev",
    status: "Validating",
    severity: "High",
    platform: "Linux",
    version: "v1.7.3",
    age: "4d",
    submitted: "Aug 10, 2026 at 08:44",
    type: "Bug",
    problem: "Automatic config migration exits when an older workspace contains a custom template path.",
    expected: "Existing custom paths should migrate without data loss.",
    trigger: "Migrate a v1.7 custom template path",
    failure: "Migration rejects the legacy value",
    impact: "Upgrade is blocked",
    steps: ["Create a v1.7 workspace", "Set a custom template path", "Upgrade and run pb migrate"],
  },
  {
    id: "PB-138",
    title: "Installer loops after proxy timeout",
    tester: "Priya N.",
    initials: "PN",
    email: "priya@preview.dev",
    status: "Pending",
    severity: "Medium",
    platform: "Windows",
    version: "v1.8.1",
    age: "5h",
    submitted: "Aug 14, 2026 at 04:22",
    type: "Bug",
    problem: "After a corporate proxy times out, the installer retries indefinitely without returning control to the terminal.",
    expected: "The installer should stop after the retry limit and explain how to retry.",
    trigger: "Package request through a slow proxy",
    failure: "Retry limit is not applied",
    impact: "Installation never completes",
    steps: ["Configure a delayed HTTP proxy", "Run pb install", "Wait for the first timeout"],
  },
  {
    id: "PB-137",
    title: "Schema preview truncates nested paths",
    tester: "Theo L.",
    initials: "TL",
    email: "theo@beta.dev",
    status: "Pending",
    severity: "Medium",
    platform: "macOS",
    version: "v1.8.1",
    age: "7h",
    submitted: "Aug 14, 2026 at 02:31",
    type: "Bug",
    problem: "The schema preview shortens deeply nested paths until different properties look identical.",
    expected: "The preview should preserve the distinguishing end of each path.",
    trigger: "Preview a deeply nested schema",
    failure: "Path truncation removes unique segments",
    impact: "Properties cannot be distinguished",
    steps: ["Open a schema with six nested levels", "Run pb schema preview", "Compare sibling paths"],
  },
  {
    id: "PB-135",
    title: "Colored output unreadable on light terminal",
    tester: "Morgan C.",
    initials: "MC",
    email: "morgan@testers.dev",
    status: "Pending",
    severity: "Low",
    platform: "Linux",
    version: "v1.8.0",
    age: "1d",
    submitted: "Aug 13, 2026 at 12:04",
    type: "Improvement",
    problem: "Informational output uses a low-contrast yellow that disappears on light terminal themes.",
    expected: "Semantic output colors should remain readable on common light and dark themes.",
    trigger: "Use a light terminal theme",
    failure: "Info color lacks contrast",
    impact: "Important guidance is missed",
    steps: ["Select a light terminal theme", "Run pb inspect", "Read the informational messages"],
  },
];

const INITIAL_ACTIVITY = [
  { title: "Report submitted", detail: "Received through the Project Builder MCP", time: "10m ago" },
  { title: "Evidence processed", detail: "Screenshot, video, terminal trace and environment attached", time: "9m ago" },
  { title: "Auto-triage complete", detail: "Classified as Bug · High severity · Pending", time: "9m ago" },
];

const TRACE_CONTENT = `$ pb --log-level debug
2026-08-14T09:41:58.112Z DEBUG config: loading
2026-08-14T09:41:58.113Z ERROR config: parse error
2026-08-14T09:41:59.003Z DEBUG complete: source=filesystem
2026-08-14T09:41:59.117Z DEBUG input: char="i"
2026-08-14T09:41:59.233Z ERROR complete: deadlock detected

thread 'main' panic at src/complete.rs:214:9
index out of bounds: the len is 12 but the index is 12
note: run with RUST_BACKTRACE=1 to display a backtrace`;

const PLATFORM_ICONS = { macOS: AppleLogo, Windows: WindowsLogo, Linux: LinuxLogo };

function StatusIcon({ status, size = 16 }) {
  const Icon = STATUS_META[status].icon;
  return <Icon size={size} weight="bold" />;
}

function Platform({ name }) {
  const Icon = PLATFORM_ICONS[name] ?? TerminalWindow;
  return <span className="platform"><Icon size={14} weight="fill" />{name}</span>;
}

function EvidenceViewer({ active, onChange }) {
  const [playing, setPlaying] = useState(false);
  const tabs = [
    { id: "Screenshot", icon: ImageSquare },
    { id: "Video", icon: VideoCamera },
    { id: "Terminal trace", icon: TerminalWindow },
  ];

  return (
    <section className="evidence-section" aria-labelledby="evidence-title">
      <div className="section-heading">
        <div>
          <h2 id="evidence-title">Evidence</h2>
          <span className="section-hint">Reproduce what the tester saw</span>
        </div>
        <button className="text-button" type="button"><Copy size={15} /> Copy link</button>
      </div>

      <div className="evidence-tabs" role="tablist" aria-label="Report evidence">
        {tabs.map(({ id, icon: Icon }) => (
          <button
            className={active === id ? "active" : ""}
            key={id}
            role="tab"
            aria-selected={active === id}
            type="button"
            onClick={() => onChange(id)}
          >
            <Icon size={16} weight={active === id ? "fill" : "regular"} />{id}
          </button>
        ))}
      </div>

      <div className={`evidence-panel ${active === "Terminal trace" ? "trace-only" : ""}`} role="tabpanel">
        {active === "Screenshot" && (
          <div className="terminal-capture" aria-label="Screenshot of the frozen autocomplete menu">
            <div className="terminal-bar"><span></span><span></span><span></span><strong>pb · project-builder</strong></div>
            <div className="terminal-body">
              <p><b className="prompt">›</b> pb</p>
              <p><b className="prompt">›</b> ini</p>
              <div className="completion-list">
                <span className="selected"><b>init</b><small>Initialize a new workspace</small></span>
                <span><b>inspect</b><small>Inspect a schematic</small></span>
                <span><b>info</b><small>Show environment info</small></span>
                <span><b>index</b><small>Rebuild the search index</small></span>
              </div>
              <p className="terminal-note">Autocomplete remains open · input unresponsive</p>
            </div>
          </div>
        )}

        {active === "Video" && (
          <div className="video-player">
            <div className="video-stage">
              <div className="video-terminal">
                <p>$ pb --config ~/.project-builder/bad-config.toml</p>
                <p>Loading config…</p>
                <p>Autocomplete engine ready</p>
                <p className="video-error">Input stops responding after Tab</p>
              </div>
              <button type="button" className="play-button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? "Pause video" : "Play video"}>
                {playing ? <Pause size={26} weight="fill" /> : <Play size={26} weight="fill" />}
              </button>
            </div>
            <div className="video-controls">
              <span>{playing ? "Playing reproduction" : "Freeze reproduction · 00:18"}</span>
              <div><i style={{ width: playing ? "58%" : "18%" }}></i></div>
              <time>{playing ? "00:10" : "00:03"} / 00:18</time>
            </div>
          </div>
        )}

        {active === "Terminal trace" && <pre className="trace-block"><code>{TRACE_CONTENT}</code></pre>}
        {active !== "Terminal trace" && (
          <aside className="trace-preview" aria-label="Terminal trace preview">
            <div><span>Terminal trace</span><button type="button" onClick={() => onChange("Terminal trace")}><TerminalWindow size={14} /> Expand</button></div>
            <pre><code>{TRACE_CONTENT}</code></pre>
          </aside>
        )}
      </div>
    </section>
  );
}

export function App() {
  const [reports, setReports] = useState(REPORTS);
  const [selectedId, setSelectedId] = useState(REPORTS[0].id);
  const [filter, setFilter] = useState("Pending");
  const [query, setQuery] = useState("");
  const [evidence, setEvidence] = useState("Screenshot");
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardReason, setDiscardReason] = useState("");
  const [activities, setActivities] = useState(INITIAL_ACTIVITY);
  const [theme, setTheme] = useState("light");
  const [assigned, setAssigned] = useState(false);

  const selected = reports.find((report) => report.id === selectedId) ?? reports[0];
  const counts = useMemo(() => Object.fromEntries(STATUS_ORDER.map((status) => [status, reports.filter((report) => report.status === status).length])), [reports]);
  const visibleReports = useMemo(() => reports.filter((report) => {
    const matchesFilter = report.status === filter;
    const needle = query.trim().toLowerCase();
    return matchesFilter && (!needle || `${report.title} ${report.tester} ${report.id}`.toLowerCase().includes(needle));
  }), [reports, filter, query]);

  const selectFilter = (status) => {
    setFilter(status);
    setQuery("");
    const firstMatch = reports.find((report) => report.status === status);
    if (firstMatch) setSelectedId(firstMatch.id);
  };

  const recordActivity = (title, detail) => {
    setActivities((items) => [{ title, detail, time: "Just now" }, ...items]);
  };

  const applyStatus = (status, reason = "") => {
    setReports((items) => items.map((report) => report.id === selected.id ? { ...report, status } : report));
    recordActivity(status === "Discarded" ? "Report discarded" : `Status changed to ${status}`, reason || `Moved from ${selected.status} by Maya Chen`);
    setFilter(status);
    setStatusMenuOpen(false);
    setDiscardOpen(false);
    setDiscardReason("");
  };

  const chooseStatus = (status) => {
    if (status === "Discarded") {
      setDiscardOpen(true);
      setStatusMenuOpen(false);
      return;
    }
    applyStatus(status);
  };

  const assignOwner = () => {
    setAssigned(true);
    recordActivity("Owner assigned", "Maya Chen is now responsible for this report");
  };

  const requestDetails = () => recordActivity("Details requested", `Follow-up sent to ${selected.tester}`);

  return (
    <div className="app-shell" data-theme={theme}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Project Builder feedback home">
          <span className="brand-mark"><Lightning size={23} weight="fill" /></span>
          <span>Project Builder</span>
          <em>Feedback</em>
        </a>
        <label className="global-search">
          <MagnifyingGlass size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search feedback, testers, versions…" />
          <kbd>⌘ K</kbd>
        </label>
        <div className="topbar-actions">
          <span className="connection"><Database size={16} />SQLite <i></i></span>
          <span className="connection"><Lightning size={16} />MCP <i></i></span>
          <a className="icon-button" href="https://github.com/Project-Builder-Schematics" aria-label="Project Builder on GitHub"><GithubLogo size={18} /></a>
          <button className="icon-button" type="button" onClick={() => setTheme((value) => value === "light" ? "dark" : "light")} aria-label={`Use ${theme === "light" ? "dark" : "light"} theme`}>
            {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <span className="avatar">MC</span>
        </div>
      </header>

      <main className="workspace" id="top">
        <aside className="queue-panel">
          <div className="queue-title">
            <div><span className="eyebrow">Beta program</span><h1>Feedback queue</h1></div>
            <button className="icon-button" type="button" aria-label="Filter feedback"><FunnelSimple size={18} /></button>
          </div>

          <nav className="status-filters" aria-label="Feedback states">
            {STATUS_ORDER.map((status) => (
              <button
                type="button"
                key={status}
                className={filter === status ? "active" : ""}
                onClick={() => selectFilter(status)}
                aria-label={`${status} ${counts[status]} reports`}
              >
                <StatusIcon status={status} />
                <span>{status}</span>
                <b>{counts[status]}</b>
              </button>
            ))}
          </nav>

          <div className="queue-summary"><span>{filter}</span><small>{visibleReports.length} report{visibleReports.length === 1 ? "" : "s"}</small></div>
          <div className="report-list" aria-label="Feedback queue">
            {visibleReports.map((report) => (
              <button
                type="button"
                className={`report-row ${selected.id === report.id ? "selected" : ""}`}
                key={report.id}
                onClick={() => { setSelectedId(report.id); setEvidence("Screenshot"); }}
                aria-label={`${report.title}, ${report.severity} severity`}
              >
                <span className="report-row-top"><small>{report.id}</small><em className={`severity ${report.severity.toLowerCase()}`}>{report.severity}</em></span>
                <strong>{report.title}</strong>
                <span className="report-row-meta"><span>{report.tester} · {report.version}</span><time>{report.age}</time></span>
                <span className="report-row-meta"><Platform name={report.platform} /><span className="type"><span>{report.type === "Bug" ? <Bug size={13} /> : <Sparkle size={13} />}</span>{report.type}</span></span>
              </button>
            ))}
            {visibleReports.length === 0 && <div className="empty-state"><MagnifyingGlass size={24} /><strong>No matching feedback</strong><span>Try another status or search term.</span></div>}
          </div>
          <footer className="queue-footer"><span>Updated just now</span><span><i></i>MCP connected</span></footer>
        </aside>

        <article className="report-detail">
          <div className="detail-topline">
            <button className="back-button" type="button"><ArrowLeft size={15} /> Back to queue</button>
            <button className="icon-button" type="button" aria-label="More report actions"><DotsThree size={21} weight="bold" /></button>
          </div>

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
                <button className={`status-button ${STATUS_META[selected.status].className}`} type="button" onClick={() => setStatusMenuOpen((value) => !value)} aria-label={`Change status, current ${selected.status}`}>
                  <StatusIcon status={selected.status} />{selected.status}<CaretDown size={14} />
                </button>
                {statusMenuOpen && (
                  <div className="status-menu" role="menu">
                    <span>Move report to</span>
                    {STATUS_ORDER.map((status) => (
                      <button key={status} type="button" role="menuitem" onClick={() => chooseStatus(status)} disabled={status === selected.status}>
                        <StatusIcon status={status} /><span>{status}</span>{status === selected.status && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button className="secondary-button" type="button" onClick={assignOwner}><UserPlus size={17} />{assigned ? "Assigned to Maya" : "Assign owner"}</button>
              <button className="secondary-button" type="button" onClick={requestDetails}><ChatCircleDots size={17} />Request details</button>
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

          <section className="steps-section" aria-labelledby="steps-title">
            <h2 id="steps-title">Steps to reproduce</h2>
            <ol>{selected.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          </section>

          <EvidenceViewer active={evidence} onChange={setEvidence} />

          <div className="detail-lower">
            <section className="environment" aria-labelledby="environment-title">
              <div className="section-heading compact"><div><h2 id="environment-title">Environment</h2><span className="section-hint">Captured automatically</span></div></div>
              <dl>
                <div><dt>Shell</dt><dd>zsh 5.9</dd></div>
                <div><dt>Terminal</dt><dd>iTerm2 3.5.10</dd></div>
                <div><dt>CPU</dt><dd>Apple M2 Pro</dd></div>
                <div><dt>Memory</dt><dd>32 GB</dd></div>
                <div><dt>Working directory</dt><dd>~/projects/project-builder</dd></div>
              </dl>
            </section>

            <section className="activity" aria-labelledby="activity-title">
              <div className="section-heading compact"><div><h2 id="activity-title">Activity</h2><span className="section-hint">Report history</span></div></div>
              <div className="timeline">
                {activities.map((item, index) => (
                  <div className="timeline-item" key={`${item.title}-${index}`}>
                    <i></i><div><strong>{item.title}</strong><p>{item.detail}</p></div><time>{item.time}</time>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </article>
      </main>

      {discardOpen && (
        <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDiscardOpen(false); }}>
          <section className="discard-dialog" role="dialog" aria-modal="true" aria-labelledby="discard-title">
            <span className="dialog-icon"><XCircle size={22} weight="bold" /></span>
            <h2 id="discard-title">Discard report</h2>
            <p>Close this report without moving it into development. The reason will remain visible in its activity history.</p>
            <label htmlFor="discard-reason">Discard reason</label>
            <textarea id="discard-reason" value={discardReason} onChange={(event) => setDiscardReason(event.target.value)} placeholder="Duplicate, cannot reproduce, out of scope…" autoFocus />
            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={() => setDiscardOpen(false)}>Cancel</button>
              <button className="discard-button" type="button" disabled={!discardReason.trim()} onClick={() => applyStatus("Discarded", discardReason.trim())}>Discard report</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
